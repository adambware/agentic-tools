// $OPS/config.yml — the operator's answer to "which repos, which lanes, how
// wide" (A7). The file itself is hand-written and NEVER committed; this module
// is the committed, tested reader for it.
//
// WHY A READER MODULE AND NOT `yq` IN THE SHELL. `ns` is a thin shell (plan
// §9.4): every decision it appears to make — is this repo enabled, is this lane
// enabled for it, where is the pack, how wide may the fan-out go — is resolved
// here, in vitest-covered code, and handed back to the shell as flat values it
// only echoes into other commands. That is also what lets A9's sentinel reuse
// `ns`'s logic instead of reimplementing it against the same YAML.
//
// SHAPE (a7-ops-launcher.md §config.yml — the canonical spelling):
//
//   repos:
//     - path: ~/code/novudesk
//       lanes: [security, design]
//       enabled: true
//   dashboard: { out: dashboard.html, open_after_run: true }
//   sentinel:  { enabled: false, hour: 7, cooldown_days: 2, weekly_floor_days: 7 }
//   max_concurrent_reviewers: 3
//
// The lane-MAP spelling (`lanes: {security: true}`) is also accepted, matching
// what dashboard-cli.ts already tolerates — one config file feeds both readers,
// and a repo silently rendering with both lanes off is the exact failure A6 hit.
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readYaml } from "./io.js";
import type { Lane } from "./types.js";

export const LANES: readonly Lane[] = ["security", "design"];

/** Default fan-out cap when config.yml does not set one. */
export const DEFAULT_MAX_CONCURRENT_REVIEWERS = 3;

export interface OpsRepo {
  /** Display name — explicit `name`, else the path's basename. Never "undefined". */
  name: string;
  /** Absolute, tilde-expanded repo root. */
  path: string;
  enabled: boolean;
  lanes: Lane[];
}

export interface OpsConfig {
  repos: OpsRepo[];
  dashboard: { out: string; open_after_run: boolean };
  sentinel: { enabled: boolean; hour: number; cooldown_days: number; weekly_floor_days: number };
  max_concurrent_reviewers: number;
}

export type OpsConfigResult = { ok: true; config: OpsConfig } | { ok: false; reason: string };

/** One repo+lane the launcher can actually act on, with every path resolved. */
export interface OpsTarget {
  repo: OpsRepo;
  lane: Lane;
  /** <repo>/.nightshift */
  packDir: string;
  /** <repo>/.nightshift/metrics */
  metricsDir: string;
  /** <repo>/.nightshift/.run */
  runRoot: string;
  max_concurrent_reviewers: number;
}

export type OpsTargetResult = { ok: true; target: OpsTarget } | { ok: false; reason: string };

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function filled(x: unknown): x is string {
  return typeof x === "string" && x.trim() !== "";
}

/**
 * Expand a leading `~` against `home`.
 *
 * Only a leading "~" or "~/" is expanded — never "~user", which this cannot
 * resolve and must not silently mangle into a relative path that resolves under
 * the operator's cwd. Everything else is returned untouched and resolved
 * against `base` (the config file's own directory), so a relative `path:` in
 * config.yml means "next to my config", not "wherever I happened to run ns".
 */
export function expandPath(raw: string, home: string, base: string): string {
  const p = raw.trim();
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  if (isAbsolute(p)) return resolve(p);
  return resolve(base, p);
}

/** Basename of a path with trailing slashes stripped; never empty. */
function basenameOf(path: string): string {
  const cleaned = path.replace(/[/\\]+$/, "");
  const cut = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return cleaned.slice(cut + 1) || "unnamed";
}

function parseLanes(raw: unknown): Lane[] {
  if (Array.isArray(raw)) {
    return LANES.filter((lane) => raw.some((v) => filled(v) && v.trim() === lane));
  }
  if (isObj(raw)) {
    return LANES.filter((lane) => {
      const v = raw[lane];
      return v === true || v === "on";
    });
  }
  return [];
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function parsePositiveInt(raw: unknown, fallback: number): number | undefined {
  if (raw === undefined || raw === null) return fallback;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1) return undefined;
  return n;
}

function parseNonNegativeInt(raw: unknown, fallback: number): number | undefined {
  if (raw === undefined || raw === null) return fallback;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

/**
 * Read and normalize $OPS/config.yml. Read-only and total: an operator-fixable
 * problem is always {ok:false, reason}, never a throw and never a silent
 * default. The one thing this deliberately does NOT check is whether each repo
 * path exists — `ns status` should be able to LIST a repo whose clone is
 * missing and say so, rather than refusing to load the config at all.
 */
export function readOpsConfig(
  configPath: string,
  opts?: { home?: string },
): OpsConfigResult {
  const home = opts?.home ?? process.env.HOME ?? "";
  if (!existsSync(configPath)) {
    return {
      ok: false,
      reason:
        `ops config not found: ${configPath} — create it (see a7-ops-launcher.md §config.yml) ` +
        `or point --config / $NIGHTSHIFT_OPS at the ops home that holds it`,
    };
  }

  let doc: unknown;
  try {
    doc = readYaml(configPath);
  } catch (err) {
    return { ok: false, reason: `ops config is not valid YAML: ${configPath} — ${(err as Error).message}` };
  }
  if (!isObj(doc)) {
    return {
      ok: false,
      reason: `ops config is not a YAML mapping: ${configPath} — expected top-level \`repos:\``,
    };
  }

  const rawRepos = doc.repos;
  if (!Array.isArray(rawRepos)) {
    return { ok: false, reason: `ops config has no \`repos:\` list: ${configPath}` };
  }
  if (rawRepos.length === 0) {
    return {
      ok: false,
      reason:
        `ops config \`repos:\` is empty: ${configPath} — add at least one repo ` +
        `({path, lanes: [security], enabled: true}) before running anything`,
    };
  }

  // The config file's own directory is the base for relative repo paths.
  const base = resolve(configPath, "..");

  const repos: OpsRepo[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < rawRepos.length; i++) {
    const raw = rawRepos[i];
    if (!isObj(raw)) {
      return { ok: false, reason: `${configPath}: repos[${i}] is not a mapping` };
    }
    if (!filled(raw.path)) {
      return { ok: false, reason: `${configPath}: repos[${i}] has no \`path:\`` };
    }
    const path = expandPath(raw.path, home, base);
    const name = filled(raw.name) ? raw.name.trim() : basenameOf(path);
    // Two repos sharing a display name would collide in $OPS/evidence/<repo>/
    // and in $OPS/digests/<repo>.md — one would silently overwrite the other.
    if (seenNames.has(name)) {
      return {
        ok: false,
        reason:
          `${configPath}: two repos resolve to the display name "${name}" — evidence and ` +
          `digests are stored per name, so one would overwrite the other; give one an ` +
          `explicit \`name:\``,
      };
    }
    seenNames.add(name);
    repos.push({ name, path, enabled: parseBool(raw.enabled, true), lanes: parseLanes(raw.lanes) });
  }

  const maxConcurrent = parsePositiveInt(doc.max_concurrent_reviewers, DEFAULT_MAX_CONCURRENT_REVIEWERS);
  if (maxConcurrent === undefined) {
    return {
      ok: false,
      reason:
        `${configPath}: max_concurrent_reviewers must be an integer >= 1, got ` +
        `"${String(doc.max_concurrent_reviewers)}"`,
    };
  }

  const dashboardRaw = isObj(doc.dashboard) ? doc.dashboard : {};
  const sentinelRaw = isObj(doc.sentinel) ? doc.sentinel : {};

  const hour = parseNonNegativeInt(sentinelRaw.hour, 7);
  const cooldown = parseNonNegativeInt(sentinelRaw.cooldown_days, 2);
  const weeklyFloor = parsePositiveInt(sentinelRaw.weekly_floor_days, 7);
  if (hour === undefined || hour > 23) {
    return { ok: false, reason: `${configPath}: sentinel.hour must be an integer 0-23` };
  }
  if (cooldown === undefined) {
    return { ok: false, reason: `${configPath}: sentinel.cooldown_days must be an integer >= 0` };
  }
  if (weeklyFloor === undefined) {
    return { ok: false, reason: `${configPath}: sentinel.weekly_floor_days must be an integer >= 1` };
  }

  return {
    ok: true,
    config: {
      repos,
      dashboard: {
        out: filled(dashboardRaw.out) ? dashboardRaw.out.trim() : "dashboard.html",
        open_after_run: parseBool(dashboardRaw.open_after_run, true),
      },
      sentinel: {
        enabled: parseBool(sentinelRaw.enabled, false),
        hour,
        cooldown_days: cooldown,
        weekly_floor_days: weeklyFloor,
      },
      max_concurrent_reviewers: maxConcurrent,
    },
  };
}

/** Look a repo up by display name, then by exact resolved path. */
export function findRepo(config: OpsConfig, nameOrPath: string, opts?: { home?: string }): OpsRepo | undefined {
  const wanted = nameOrPath.trim();
  const byName = config.repos.find((r) => r.name === wanted);
  if (byName !== undefined) return byName;
  const home = opts?.home ?? process.env.HOME ?? "";
  const resolved = expandPath(wanted, home, process.cwd());
  return config.repos.find((r) => r.path === resolved);
}

/**
 * Resolve one repo+lane into every path `ns run` needs, refusing loudly for
 * anything the operator has to fix. This is where "the repo is configured" and
 * "the repo is actually runnable" are separated: a lane that is not listed for
 * the repo is a config problem, a missing clone or pack is a machine problem,
 * and each gets its own reason.
 */
export function resolveTarget(config: OpsConfig, repoName: string, lane: string): OpsTargetResult {
  if (lane !== "security" && lane !== "design") {
    return {
      ok: false,
      reason: `unknown lane "${lane}" — expected "security" or "design"`,
    };
  }
  const repo = findRepo(config, repoName);
  if (repo === undefined) {
    const known = config.repos.map((r) => r.name).join(", ");
    return {
      ok: false,
      reason: `repo "${repoName}" is not in the ops config — configured repos: ${known || "(none)"}`,
    };
  }
  if (!repo.enabled) {
    return {
      ok: false,
      reason: `repo "${repo.name}" is disabled in the ops config (enabled: false) — enable it to run`,
    };
  }
  if (!repo.lanes.includes(lane)) {
    const listed = repo.lanes.join(", ");
    return {
      ok: false,
      reason:
        `lane "${lane}" is not enabled for repo "${repo.name}" — its \`lanes:\` list is ` +
        `[${listed}]; add "${lane}" to run it`,
    };
  }
  if (!existsSync(repo.path) || !statSync(repo.path).isDirectory()) {
    return {
      ok: false,
      reason: `repo path for "${repo.name}" is not a directory: ${repo.path} — fix \`path:\` or clone it`,
    };
  }
  const packDir = join(repo.path, ".nightshift");
  if (!existsSync(packDir)) {
    return {
      ok: false,
      reason:
        `no .nightshift pack in ${repo.path} — run /nightshift:onboard in that repo before ` +
        `the launcher can review it`,
    };
  }
  return {
    ok: true,
    target: {
      repo,
      lane,
      packDir,
      metricsDir: join(packDir, "metrics"),
      runRoot: join(packDir, ".run"),
      max_concurrent_reviewers: config.max_concurrent_reviewers,
    },
  };
}
