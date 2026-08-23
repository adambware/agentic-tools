// Due-detection (A7 / T4) — "which repo+lane pairs warrant a run right now?"
//
// `ns run --due` is the manual form; A9's sentinel is the scheduled form. They
// MUST answer the question identically, so the answer lives here once, in
// vitest-covered code, and both callers read it. A sentinel that reimplemented
// this against the same YAML is how a system ends up reviewing on a schedule
// nobody can explain.
//
// THE PREDICATE, in the order it is evaluated (first match wins, so the reason
// an operator reads is the STRONGEST reason, not an arbitrary one):
//
//   1. cooldown  — a run for this repo+lane within `cooldown_days` blocks a new
//                  one outright. Nothing below can override it. Without this,
//                  "changed today" would re-fire every single invocation for as
//                  long as the diff sits in the working tree.
//   2. never-run — no run record at all: run it. A pack that was onboarded and
//                  then never exercised is the single most common silent hole.
//   3. overdue   — some selected surface is past its interval (staleness >= 1).
//   4. changed   — some selected surface's `area` intersects the working diff.
//   5. weekly floor — nothing is overdue and nothing changed, but the last run
//                  was `weekly_floor_days` ago. Coverage freshness decays even
//                  on a quiet repo, and a lane that only ever fires on change
//                  reports "all clear" for surfaces it has not looked at in
//                  months.
//   otherwise    — not due, with the distance to whichever floor fires first.
//
// SELECTION IS REUSED, NOT REIMPLEMENTED. Due-ness is computed from exactly the
// surfaces bin/select WOULD pick (same registry, same K, same staleness math,
// same git diff) — so "due" can never disagree with "there is something to
// review", and `ns status` can show the two side by side truthfully.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CostRecord, Lane, RegistryEntry, RunMetrics, Surface } from "./types.js";
import { readJsonl, readYaml } from "./io.js";
import { extractEntries } from "./registry.js";
import { selectSurfaces, tsNewer } from "./staleness.js";
import { makeGitRunner, type GitRunner } from "./git.js";
import { REGISTRY_BY_LANE } from "./lane-plan.js";
import type { OpsConfig, OpsRepo } from "./ops-config.js";

export type DueReason =
  | "never-run"
  | "overdue"
  | "changed"
  | "weekly-floor"
  | "cooldown"
  | "nothing-selected"
  | "not-due"
  | "unrunnable";

export interface DueVerdict {
  repo: string;
  lane: Lane;
  due: boolean;
  reason: DueReason;
  /** One line an operator can read without opening anything else. */
  detail: string;
  /** How many surfaces bin/select would pick right now. */
  selected: number;
  /** Of those, how many are past their interval. */
  overdue: number;
  /** Of those, how many intersect the working diff. */
  changed: number;
  last_run_date?: string;
  days_since_run?: number;
  /** Recorded cost of the most recent run of this lane, if one was captured. */
  last_run_usd?: number;
  /** Present when that run failed — a `usd: 0` error row is a floor, not a cost. */
  last_run_status?: "ok" | "error";
}

export interface DueOpts {
  config: OpsConfig;
  today: string;
  /** Injectable for tests; defaults to a real git runner rooted at each repo. */
  gitFor?: (repo: OpsRepo) => GitRunner;
}

function readK(packDir: string, lane: Lane): number | undefined {
  const manifestPath = join(packDir, "manifest.yml");
  if (!existsSync(manifestPath)) return undefined;
  let manifest: { window_budget_k?: Record<string, unknown> } | undefined;
  try {
    manifest = readYaml(manifestPath);
  } catch {
    return undefined;
  }
  const k = manifest?.window_budget_k?.[lane];
  if (typeof k !== "number" || !Number.isInteger(k) || k < 0) return undefined;
  return k;
}

/** Latest run record for this lane, by date. Missing dir/shards -> undefined. */
function lastRunDate(metricsDir: string, lane: Lane): string | undefined {
  const runsDir = join(metricsDir, "runs");
  if (!existsSync(runsDir)) return undefined;
  let latest: string | undefined;
  // Shards are <YYYY-MM>.jsonl; comparing the `date` field directly (not the
  // shard name) is what makes a manually-backfilled or out-of-order line safe.
  for (const shard of readdirSyncSafe(runsDir)) {
    if (!shard.endsWith(".jsonl")) continue;
    for (const rec of readJsonl<RunMetrics>(join(runsDir, shard))) {
      if (rec.lane !== lane) continue;
      if (typeof rec.date !== "string" || rec.date === "") continue;
      if (latest === undefined || rec.date > latest) latest = rec.date;
    }
  }
  return latest;
}

/** readdirSync that yields [] instead of throwing — a permission or race error
 *  on one metrics dir must not abort a whole `--due` sweep. */
function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * The most recent cost row for this lane. `ns status` shows it beside the last run
 * date so an operator can answer "what does this lane cost me" without opening the
 * dashboard — and the STATUS travels with the number, because a failed run records
 * `usd: 0` (the envelope carrying the real figure is the thing that went missing).
 * Showing that 0 unlabelled would read as "this lane is free".
 */
function lastCost(metricsDir: string, lane: Lane): CostRecord | undefined {
  const p = join(metricsDir, "costs.jsonl");
  if (!existsSync(p)) return undefined;
  let latest: CostRecord | undefined;
  for (const rec of readJsonl<CostRecord>(p)) {
    if (rec.lane !== lane) continue;
    if (typeof rec.ts !== "string" || rec.ts === "") continue;
    if (latest === undefined || tsNewer(rec.ts, latest.ts)) latest = rec;
  }
  return latest;
}

/** Whole days from `from` to `to` (YYYY-MM-DD). */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function unrunnable(repo: OpsRepo, lane: Lane, detail: string): DueVerdict {
  return {
    repo: repo.name,
    lane,
    due: false,
    reason: "unrunnable",
    detail,
    selected: 0,
    overdue: 0,
    changed: 0,
  };
}

/**
 * Due-ness for ONE repo+lane. Never throws for anything an operator can fix —
 * a missing pack, registry, or K is reported as `unrunnable` with the reason,
 * because a launcher that crashed on one misconfigured repo would take the
 * whole `--due` sweep (and the sentinel) down with it.
 */
export function laneDue(
  repo: OpsRepo,
  lane: Lane,
  opts: DueOpts,
): DueVerdict {
  const { config, today } = opts;
  const packDir = join(repo.path, ".nightshift");
  if (!existsSync(packDir)) {
    return unrunnable(repo, lane, `no .nightshift pack in ${repo.path} — run /nightshift:onboard there`);
  }
  const k = readK(packDir, lane);
  if (k === undefined) {
    return unrunnable(
      repo,
      lane,
      `manifest.window_budget_k.${lane} is missing or not a non-negative integer in ${packDir}/manifest.yml`,
    );
  }
  const registryPath = join(packDir, REGISTRY_BY_LANE[lane]);
  if (!existsSync(registryPath)) {
    return unrunnable(repo, lane, `registry not found: ${registryPath}`);
  }

  let entries: RegistryEntry[];
  try {
    entries = extractEntries(readYaml(registryPath), lane);
  } catch (err) {
    return unrunnable(repo, lane, `registry ${registryPath} is malformed: ${(err as Error).message}`);
  }

  const git = (opts.gitFor ?? ((r: OpsRepo) => makeGitRunner(r.path)))(repo);
  let surfaces: Surface[];
  try {
    surfaces = selectSurfaces(entries, {
      today,
      k,
      changedFilesFor: (e) => git.changedFilesSince(e.last_reviewed),
    });
  } catch (err) {
    return unrunnable(repo, lane, `selection failed for ${registryPath}: ${(err as Error).message}`);
  }

  const overdue = surfaces.filter((s) => s.staleness >= 1).length;
  const changed = surfaces.filter((s) => s.change_flag === 1).length;
  const metricsDir = join(packDir, "metrics");
  const last = lastRunDate(metricsDir, lane);
  const sinceRun = last === undefined ? undefined : daysBetween(last, today);
  const cost = lastCost(metricsDir, lane);
  const base = {
    repo: repo.name,
    lane,
    selected: surfaces.length,
    overdue,
    changed,
    ...(last === undefined ? {} : { last_run_date: last, days_since_run: sinceRun }),
    ...(cost === undefined ? {} : { last_run_usd: cost.usd, last_run_status: cost.status }),
  };

  // 1. Cooldown outranks everything — including a fresh diff. A working tree
  //    that stays dirty would otherwise re-trigger on every invocation.
  if (sinceRun !== undefined && sinceRun < config.sentinel.cooldown_days) {
    return {
      ...base,
      due: false,
      reason: "cooldown",
      detail:
        `last run ${last} (${sinceRun}d ago) is inside the ${config.sentinel.cooldown_days}d ` +
        `cooldown — run it explicitly with \`ns run\` to override`,
    };
  }

  // A lane with nothing selectable cannot be due no matter how long it has been:
  // a run would burn a run id and stamp "all clear" for coverage nobody wrote.
  if (surfaces.length === 0) {
    return {
      ...base,
      due: false,
      reason: "nothing-selected",
      detail:
        k === 0
          ? `window_budget_k.${lane} is 0 — the lane is budgeted to review nothing`
          : `no entries selected from ${registryPath} — seed the registry`,
    };
  }

  if (last === undefined) {
    return { ...base, due: true, reason: "never-run", detail: `no run recorded for this lane yet` };
  }
  if (overdue > 0) {
    return {
      ...base,
      due: true,
      reason: "overdue",
      detail: `${overdue} of ${surfaces.length} selected surface(s) past their interval`,
    };
  }
  if (changed > 0) {
    return {
      ...base,
      due: true,
      reason: "changed",
      detail: `${changed} of ${surfaces.length} selected surface(s) intersect the working diff`,
    };
  }
  if (sinceRun !== undefined && sinceRun >= config.sentinel.weekly_floor_days) {
    return {
      ...base,
      due: true,
      reason: "weekly-floor",
      detail:
        `nothing overdue or changed, but the last run was ${sinceRun}d ago ` +
        `(floor: ${config.sentinel.weekly_floor_days}d)`,
    };
  }
  return {
    ...base,
    due: false,
    reason: "not-due",
    detail:
      `nothing overdue, nothing changed; ${config.sentinel.weekly_floor_days - (sinceRun ?? 0)}d ` +
      `until the weekly floor fires`,
  };
}

/**
 * Due-ness for every enabled repo x enabled lane, in config order then lane
 * order. Disabled repos and unlisted lanes are omitted entirely — they are not
 * "not due", they are not part of this system's job.
 */
export function dueSweep(opts: DueOpts): DueVerdict[] {
  const out: DueVerdict[] = [];
  for (const repo of opts.config.repos) {
    if (!repo.enabled) continue;
    for (const lane of repo.lanes) {
      out.push(laneDue(repo, lane, opts));
    }
  }
  return out;
}
