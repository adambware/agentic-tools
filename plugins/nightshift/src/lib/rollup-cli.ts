// Orchestration for bin/rollup: load registry + run records + open findings,
// compute the daily rollup, append to daily.jsonl. Pure of process.argv so
// it is fully unit-testable. The CLI shell (src/bin/rollup.ts) only parses args.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CostRecord, DailyMetrics, Lane, RunMetrics } from "./types.js";
import { readYaml, readJsonl, appendJsonl } from "./io.js";
import { extractEntries } from "./registry.js";
import { openFindings } from "./findings-store.js";
import { computeDailyRollup } from "./rollup-run.js";
import { COSTS_FILENAME } from "./record-cost-run.js";
import { validateCostRecord, validateDailyMetrics } from "./validate.js";

export interface RollupOpts {
  registryPath: string;
  metricsDir: string;
  lane: Lane;
  today: string;
  date?: string;
  ts: string;
  outPath?: string;
}

export function runRollup(opts: RollupOpts): DailyMetrics {
  const date = opts.date ?? opts.today;

  // Load registry
  if (!existsSync(opts.registryPath)) {
    throw new Error(`registry not found: ${opts.registryPath}`);
  }
  const doc = readYaml(opts.registryPath);
  const entries = extractEntries(doc, opts.lane);

  // Load run records from all shards under <metricsDir>/runs/
  const runsDir = join(opts.metricsDir, "runs");
  const runRecords: RunMetrics[] = [];
  if (existsSync(runsDir)) {
    const shards = readdirSync(runsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
    for (const shard of shards) {
      runRecords.push(...readJsonl<RunMetrics>(join(runsDir, shard)));
    }
  }
  // Filter to this lane (for FPR windows)
  const laneRunRecords = runRecords.filter((r) => r.lane === opts.lane);

  // Open findings count (all lanes — no per-lane field on findings)
  const openFindingsCount = openFindings(opts.metricsDir).length;

  // Cost records (v3 A2) — costs.jsonl is optional; missing file -> [].
  // Validate on READ, not just on write: costs.jsonl is append-only and
  // operator-editable (`ns cost add`), and an untyped `usd` would sum to NaN,
  // serialize to null in daily.jsonl, and flatline the dashboard's cost trend
  // without a single error. Abort naming the offending line instead.
  const costsPath = join(opts.metricsDir, COSTS_FILENAME);
  const costRecords = readJsonl<CostRecord>(costsPath);
  costRecords.forEach((c, i) => {
    const res = validateCostRecord(c);
    if (!res.ok) {
      throw new Error(`${costsPath}:${i + 1}: invalid cost-record — ${res.errors.join("; ")}`);
    }
  });

  // Compute rollup
  const rollup = computeDailyRollup({
    date,
    lane: opts.lane,
    ts: opts.ts,
    entries,
    openFindingsCount,
    runRecords: laneRunRecords,
    costRecords,
    today: opts.today,
  });

  // Validate before the append — daily.jsonl is the stateful path, and every
  // other writer in the engine gates on its schema before entering it.
  const rollupCheck = validateDailyMetrics(rollup);
  if (!rollupCheck.ok) {
    throw new Error(`rollup produced an invalid daily-metrics row: ${rollupCheck.errors.join("; ")}`);
  }

  // Append to daily.jsonl
  const outPath = opts.outPath ?? join(opts.metricsDir, "daily.jsonl");
  appendJsonl(outPath, rollup);

  return rollup;
}
