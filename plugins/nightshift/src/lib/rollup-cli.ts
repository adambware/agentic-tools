// Orchestration for bin/rollup: load registry + run records + open findings,
// compute the daily rollup, append to daily.jsonl. Pure of process.argv so
// it is fully unit-testable. The CLI shell (src/bin/rollup.ts) only parses args.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DailyMetrics, Lane, RunMetrics } from "./types.js";
import { readYaml, readJsonl, appendJsonl } from "./io.js";
import { extractEntries } from "./registry.js";
import { openFindings } from "./findings-store.js";
import { computeDailyRollup } from "./rollup-run.js";

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

  // Compute rollup
  const rollup = computeDailyRollup({
    date,
    lane: opts.lane,
    ts: opts.ts,
    entries,
    openFindingsCount,
    runRecords: laneRunRecords,
    today: opts.today,
  });

  // Append to daily.jsonl
  const outPath = opts.outPath ?? join(opts.metricsDir, "daily.jsonl");
  appendJsonl(outPath, rollup);

  return rollup;
}
