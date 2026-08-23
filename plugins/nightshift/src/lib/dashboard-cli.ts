// Orchestration for bin/dashboard (v3 A6): read $OPS/config.yml, load every
// configured repo's pack (registries, findings, suppressions, daily.jsonl,
// costs.jsonl, run records), stat referenced evidence files, parse the latest
// $OPS/digests/<repo>.md when present, then hand the assembled DashboardInput
// to the pure renderer and atomically write the HTML. Pure of process.argv.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CostRecord, DailyMetrics, Finding, Lane, RunMetrics, Suppression } from "./types.js";
import { readYaml, readJsonl, atomicWrite } from "./io.js";
import { expandPath } from "./ops-config.js";
import { extractEntries } from "./registry.js";
import { openFindings } from "./findings-store.js";
import { COSTS_FILENAME } from "./record-cost-run.js";
import {
  renderDashboard,
  ORPHAN_AGE_DAYS,
  type DashboardInput,
  type DigestInput,
  type LaneInput,
  type OpenFinding,
  type RepoInput,
} from "./dashboard-run.js";
import { daysBetween, tsNewer } from "./staleness.js";

const LANES: Lane[] = ["security", "design"];

/* ---------- config ---------- */

// $OPS/config.yml is written by hand. The documented shape (a7-ops-launcher.md
// §config.yml, plan §WS7) is `{path, lanes: [security, design], enabled: true}`
// — a lane ARRAY, a boolean `enabled`, and no `name`. Accept that shape as
// canonical, and keep tolerating the lane-map form so neither spelling silently
// produces a dashboard with both lanes off and a repo called "undefined".
interface ConfigRepo {
  name?: string;
  path: string;
  enabled?: boolean;
  lanes?: Lane[] | Partial<Record<Lane, boolean | "on" | "off">>;
}

interface OpsConfig {
  repos?: ConfigRepo[];
}

/** Repo display name: explicit `name`, else the path's basename. Never "undefined". */
function repoName(repo: ConfigRepo): string {
  if (repo.name && repo.name.length > 0) return repo.name;
  const cleaned = String(repo.path ?? "").replace(/\/+$/, "");
  return cleaned.slice(cleaned.lastIndexOf("/") + 1) || "unnamed";
}

/** A repo is considered unless it opts out with `enabled: false`. */
function repoEnabled(repo: ConfigRepo): boolean {
  return repo.enabled !== false;
}

function laneEnabled(repo: ConfigRepo, lane: Lane): boolean {
  const lanes = repo.lanes;
  if (lanes === undefined) return false;
  if (Array.isArray(lanes)) return lanes.includes(lane);
  const v = lanes[lane];
  return v === true || v === "on";
}

/* ---------- digest (consumed when present; never a verdict source) ---------- */

/** Parse $OPS/digests/<repo>.md leniently: a `generated:` line (or file mtime)
 *  dates it; top-level `- ` bullets under a "Decisions" heading (or anywhere,
 *  as fallback) become items. The digest is narrative — imprecision is fine. */
export function parseDigest(
  path: string,
  repo: string,
  runsSince: number,
  today: string,
): DigestInput | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const genMatch = text.match(/^generated:\s*(.+)$/im);
  const generated_at = genMatch
    ? genMatch[1]!.trim()
    : statSync(path).mtime.toISOString().slice(0, 16).replace("T", " ");
  const genDate = generated_at.slice(0, 10);
  const age_days = /^\d{4}-\d{2}-\d{2}/.test(genDate) ? Math.max(0, daysBetween(genDate, today)) : 0;
  const lines = text.split("\n");
  // The heading the digest skill actually writes is "## 1. Top 3 human decisions
  // needed" — numbered, with the word buried mid-phrase. The old anchored
  // /^#+\s*decisions/ never matched it, so this fell through to the
  // bullets-anywhere fallback and rendered the FINDINGS list as the decision
  // queue: the living document confidently showing the wrong thing. Match a
  // heading that CONTAINS the word instead.
  const decisionsIdx = lines.findIndex((l) => /^#+\s.*\bdecisions?\b/i.test(l));
  const scope = decisionsIdx === -1 ? lines : lines.slice(decisionsIdx + 1);
  // SKILL.md pins the digest's SECTIONS but deliberately not its bullet syntax,
  // so an item legitimately arrives as "- ", "1. ", or "**1. ...**". Accept all
  // three. `[-*]\s+` cannot swallow a "**1." lead because bold has no space
  // after the first star.
  const ITEM_START = /^\s*(?:[-*]\s+|(?:\*\*)?\d+[.)]\s+)(.*)$/;
  const items: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null) {
      const t = current.replace(/\*\*/g, "").trim();
      if (t) items.push(t);
    }
    current = null;
  };
  for (const line of scope) {
    if (decisionsIdx !== -1 && /^#+\s/.test(line)) break; // next heading ends the section
    const m = line.match(ITEM_START);
    if (m) {
      flush();
      current = m[1]!;
      continue;
    }
    // A hard-wrapped item continues on the next non-blank line. Without this
    // every wrapped decision was truncated at its first line break and reached
    // the dashboard as a sentence fragment.
    if (current !== null && line.trim() !== "") {
      current += " " + line.trim();
      continue;
    }
    flush();
  }
  flush();
  return {
    repo,
    generated_at,
    runs_behind: runsSince,
    age_days,
    items: items.map((text) => ({ text, repo })),
  };
}

/* ---------- pack loading ---------- */

function loadRunRecords(metricsDir: string): RunMetrics[] {
  const runsDir = join(metricsDir, "runs");
  const out: RunMetrics[] = [];
  if (existsSync(runsDir)) {
    for (const shard of readdirSync(runsDir).filter((f) => f.endsWith(".jsonl")).sort()) {
      out.push(...readJsonl<RunMetrics>(join(runsDir, shard)));
    }
  }
  return out;
}

/** Only UNEXPIRED suppressions. The dedupe engine already treats an expired
 *  entry as lifted (dedupekey.ts activeSuppression), so rendering it as an
 *  "active suppression" would tell the operator a vulnerability is still
 *  accepted-risk after the acceptance ran out — the auto-lift contract read
 *  backwards. `expires` is inclusive, matching activeSuppression. */
function loadSuppressions(packDir: string, today: string): Suppression[] {
  const doc = readYaml<{ suppressions?: Suppression[] }>(
    join(packDir, "findings", "suppressions.yml"),
  );
  return (doc?.suppressions ?? []).filter((s) => s.expires >= today);
}

function laneInput(packDir: string, lane: Lane, enabled: boolean): LaneInput {
  if (!enabled) return { lane, state: "disabled", entries: [] };
  const registryPath = join(
    packDir,
    "registries",
    lane === "security" ? "vectors.yml" : "flows.yml",
  );
  const entries = existsSync(registryPath)
    ? extractEntries(readYaml(registryPath), lane)
    : [];
  if (lane === "design") {
    // State 4: the design lane needs seeded personas AND a browser base_url
    // before `ns` will run it — surface exactly what is missing.
    const personas = existsSync(join(packDir, "fixtures", "personas.yml"));
    const manifest = readYaml<{
      stack_adapter?: { browser?: { base_url?: string } };
    }>(join(packDir, "manifest.yml"));
    const baseUrl = manifest?.stack_adapter?.browser?.base_url;
    if (!personas || !baseUrl) {
      const missing = [
        personas ? null : "`fixtures/personas.yml` is missing",
        baseUrl ? null : "`stack_adapter.browser.base_url` is unset",
      ]
        .filter(Boolean)
        .join(" and ");
      return { lane, state: "not-ready", not_ready_reason: missing, entries };
    }
  }
  return { lane, state: "on", entries };
}

/**
 * The repo root as every OTHER bin resolves it.
 *
 * `config.yml` paths are operator-written and the documented, templated form is
 * `~/code/my-project`. `join("~/code/x", ".nightshift")` is a RELATIVE path that
 * resolves against the dashboard process's cwd, so it never exists — and this
 * function's own not-found branch then renders the repo as "pack missing /
 * Cannot read this repo".
 *
 * Found on the first real bring-up, by a verifier reading the generated page:
 * the dashboard showed the one onboarded repo as missing, with no runs and no
 * cost, minutes after a successful run of that exact repo — while `ns status`,
 * which goes through `readOpsConfig`, read the same pack perfectly. A living
 * document that reports a healthy repo as absent is worse than a stale one.
 *
 * `expandPath` is the shared, tested resolver `ops-config` uses: leading `~`
 * against home, relative against the config file's own directory (never cwd).
 */
function repoRoot(cfg: ConfigRepo, opsHome: string): string {
  return expandPath(String(cfg.path ?? ""), homedir(), opsHome);
}

function loadRepo(cfg: ConfigRepo, opsHome: string, today: string): RepoInput {
  const packDir = join(repoRoot(cfg, opsHome), ".nightshift");
  if (!existsSync(packDir)) {
    return {
      name: repoName(cfg),
      path: repoRoot(cfg, opsHome),
      pack_present: false,
      lanes: [],
      findings: [],
      suppressions: [],
      run_records: [],
      daily: [],
      costs: [],
    };
  }
  const metricsDir = join(packDir, "metrics");
  const run_records = loadRunRecords(metricsDir);
  const costs = readJsonl<CostRecord>(join(metricsDir, COSTS_FILENAME));
  const daily = readJsonl<DailyMetrics>(join(metricsDir, "daily.jsonl"));
  const lanesByEntryOwner = new Map<string, Lane>();
  const lanes = LANES.map((lane) => {
    const li = laneInput(packDir, lane, laneEnabled(cfg, lane));
    for (const e of li.entries) lanesByEntryOwner.set(e.id, lane);
    return li;
  });
  const findings: OpenFinding[] = openFindings(metricsDir).map((f: Finding) => {
    const evidence = f.evidence;
    // Evidence hrefs are relative to $OPS (the dashboard's own directory).
    const evidencePath = evidence
      ? isAbsolute(evidence)
        ? evidence
        : join(opsHome, evidence)
      : undefined;
    return {
      ...f,
      repo: repoName(cfg),
      lane: lanesByEntryOwner.get(f.dedupe_key.surface) ?? (f.anchor ? "design" : "security"),
      title: f.dedupe_key.symptom,
      ...(evidencePath ? { evidence_present: existsSync(evidencePath) } : {}),
      age_days: f.first_seen ? Math.max(0, daysBetween(f.first_seen, today)) : undefined,
    };
  });
  return {
    name: repoName(cfg),
    path: repoRoot(cfg, opsHome),
    pack_present: true,
    lanes,
    findings,
    suppressions: loadSuppressions(packDir, today),
    run_records,
    daily,
    costs,
  };
}

function scanOrphanRunDirs(
  repos: { cfg: ConfigRepo; input: RepoInput }[],
  now: Date,
): { path: string; age_days: number }[] {
  const out: { path: string; age_days: number }[] = [];
  for (const { cfg, input } of repos) {
    if (!input.pack_present) continue;
    const runDir = join(cfg.path, ".nightshift", ".run");
    if (!existsSync(runDir)) continue;
    for (const d of readdirSync(runDir).sort()) {
      const full = join(runDir, d);
      let age_days: number;
      try {
        age_days = Math.floor((now.getTime() - statSync(full).mtime.getTime()) / 86_400_000);
      } catch {
        continue;
      }
      if (age_days >= ORPHAN_AGE_DAYS) {
        out.push({ path: `${repoName(cfg)}/.nightshift/.run/${d}/`, age_days });
      }
    }
  }
  return out;
}

function evidenceStats(opsHome: string, referenced: Set<string>) {
  const evDir = join(opsHome, "evidence");
  if (!existsSync(evDir)) return undefined;
  let files = 0,
    bytes = 0,
    unreferenced = 0;
  // lstat, never stat: a symlink cycle under evidence/ would recurse forever and
  // hang every dashboard rebuild, and a link out to a large tree would silently
  // bill someone else's bytes to the evidence store. Per-entry errors (broken
  // link, permission) skip that entry rather than killing the whole scan.
  const walk = (dir: string, rel: string) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      const relPath = `${rel}${name}`;
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full, `${relPath}/`);
      else if (st.isFile()) {
        files++;
        bytes += st.size;
        if (!referenced.has(`evidence/${relPath}`)) unreferenced++;
      }
    }
  };
  walk(evDir, "");
  return { files, bytes, unreferenced };
}

/* ---------- entry ---------- */

export interface DashboardOpts {
  configPath: string;
  outPath: string;
  today: string;
  generatedAt: string; // display string
  engineVersion: string;
  now?: Date; // orphan-dir age baseline (injectable for tests)
}

export function runDashboard(opts: DashboardOpts): { html: string; outPath: string } {
  if (!existsSync(opts.configPath)) {
    throw new Error(`config not found: ${opts.configPath}`);
  }
  const opsHome = dirname(resolve(opts.configPath));
  const config = readYaml<OpsConfig>(opts.configPath) ?? {};
  const repoCfgs = config.repos ?? [];
  // Isolate per repo. One truncated JSONL line in ONE repo used to throw out of
  // the whole map, so `bin/dashboard` exited non-zero and the operator kept
  // staring at yesterday's HTML for every OTHER repo too — the multi-repo
  // living document taken down by a single bad line.
  const loaded = repoCfgs
    .filter((cfg) => repoEnabled(cfg))
    .map((cfg) => {
      try {
        return { cfg, input: loadRepo(cfg, opsHome, opts.today) };
      } catch (err) {
        return {
          cfg,
          input: {
            name: repoName(cfg),
            path: repoRoot(cfg, opsHome),
            pack_present: true,
            read_error: err instanceof Error ? err.message : String(err),
            lanes: [],
            findings: [],
            suppressions: [],
            run_records: [],
            daily: [],
            costs: [],
          } satisfies RepoInput,
        };
      }
    });

  const digests: DigestInput[] = [];
  for (const { cfg, input } of loaded) {
    const digestPath = join(opsHome, "digests", `${repoName(cfg)}.md`);
    const digest = parseDigest(
      digestPath,
      repoName(cfg),
      runsSinceDigest(digestPath, input.run_records),
      opts.today,
    );
    if (digest) digests.push(digest);
  }

  const referenced = new Set(
    loaded.flatMap(({ input }) =>
      input.findings.map((f) => f.evidence).filter((e): e is string => !!e),
    ),
  );

  const input: DashboardInput = {
    generated_at: opts.generatedAt,
    engine_version: opts.engineVersion,
    today: opts.today,
    repos: loaded.map((l) => l.input),
    digests,
    orphan_run_dirs: scanOrphanRunDirs(loaded, opts.now ?? new Date()),
    evidence_stats: evidenceStats(opsHome, referenced),
  };

  const html = renderDashboard(input);
  atomicWrite(opts.outPath, html);
  return { html, outPath: opts.outPath };
}

/** Run-distance of a digest: runs recorded strictly after the digest file's mtime. */
function runsSinceDigest(digestPath: string, runs: RunMetrics[]): number {
  if (!existsSync(digestPath)) return 0;
  const mtime = statSync(digestPath).mtime.toISOString();
  return runs.filter((r) => tsNewer(r.ts, mtime)).length;
}
