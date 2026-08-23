// Orchestration for bin/dashboard (v3 A6): read $OPS/config.yml, load every
// configured repo's pack (registries, findings, suppressions, daily.jsonl,
// costs.jsonl, run records), stat referenced evidence files, parse the latest
// $OPS/digests/<repo>.md when present, then hand the assembled DashboardInput
// to the pure renderer and atomically write the HTML. Pure of process.argv.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CostRecord, DailyMetrics, Finding, Lane, RunMetrics, Suppression } from "./types.js";
import { readYaml, readJsonl, atomicWrite } from "./io.js";
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
import { daysBetween } from "./staleness.js";

const LANES: Lane[] = ["security", "design"];

/* ---------- config ---------- */

interface ConfigRepo {
  name: string;
  path: string;
  lanes?: Partial<Record<Lane, boolean | "on" | "off">>;
}

interface OpsConfig {
  repos?: ConfigRepo[];
}

function laneEnabled(repo: ConfigRepo, lane: Lane): boolean {
  const v = repo.lanes?.[lane];
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
  const decisionsIdx = lines.findIndex((l) => /^#+\s*decisions/i.test(l));
  const scope = decisionsIdx === -1 ? lines : lines.slice(decisionsIdx + 1);
  const items: string[] = [];
  for (const line of scope) {
    if (decisionsIdx !== -1 && /^#+\s/.test(line)) break; // next heading ends the section
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (m) items.push(m[1]!.trim());
  }
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

function loadSuppressions(packDir: string): Suppression[] {
  const doc = readYaml<{ suppressions?: Suppression[] }>(
    join(packDir, "findings", "suppressions.yml"),
  );
  return doc?.suppressions ?? [];
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

function loadRepo(cfg: ConfigRepo, opsHome: string, today: string): RepoInput {
  const packDir = join(cfg.path, ".nightshift");
  if (!existsSync(packDir)) {
    return {
      name: cfg.name,
      path: cfg.path,
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
      repo: cfg.name,
      lane: lanesByEntryOwner.get(f.dedupe_key.surface) ?? (f.anchor ? "design" : "security"),
      title: f.dedupe_key.symptom,
      ...(evidencePath ? { evidence_present: existsSync(evidencePath) } : {}),
      age_days: f.first_seen ? Math.max(0, daysBetween(f.first_seen, today)) : undefined,
    };
  });
  return {
    name: cfg.name,
    path: cfg.path,
    pack_present: true,
    lanes,
    findings,
    suppressions: loadSuppressions(packDir),
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
        out.push({ path: `${cfg.name}/.nightshift/.run/${d}/`, age_days });
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
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const relPath = `${rel}${name}`;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, `${relPath}/`);
      else {
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
  const loaded = repoCfgs.map((cfg) => ({ cfg, input: loadRepo(cfg, opsHome, opts.today) }));

  const digests: DigestInput[] = [];
  for (const { cfg, input } of loaded) {
    const digestPath = join(opsHome, "digests", `${cfg.name}.md`);
    const digest = parseDigest(
      digestPath,
      cfg.name,
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
  return runs.filter((r) => r.ts > mtime).length;
}
