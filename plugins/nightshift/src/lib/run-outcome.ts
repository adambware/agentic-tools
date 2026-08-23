// Did this run actually complete its durable phase? (v3 A7 Part 2.)
//
// WHY THIS EXISTS. `ns` used to treat the headless CLI's exit code as the run's
// outcome. The first real run showed what that is worth: every reviewer dispatch
// failed ("agent type not found"), every plumbing bin failed (MODULE_NOT_FOUND),
// the workflow returned `{"status":"complete"}` because its LAST stages ran, the
// CLI exited 0, and `ns` recorded status:"ok", deleted the run dir as a success,
// and refreshed the dashboard to say all was well. Nothing had been reviewed.
//
// A model-authored status line cannot be the success predicate — neither the
// session's reply nor the workflow's return value. The only trustworthy evidence
// that a run did its job is the durable state it was supposed to leave, so that
// is what this reads: `bin/record` appends exactly one RunMetrics row per run to
// metrics/runs/<YYYY-MM>.jsonl, under A1's per-repo lock, after validate and
// dedupe have passed. The row exists iff the whole chain ran.
//
// It is a READ. It never writes, never repairs, and never infers an outcome from
// anything the model said — which is the point of having it at all.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonl } from "./io.js";
import type { RunMetrics } from "./types.js";

export interface RunOutcome {
  /** True iff bin/record left a run row for this run_id. */
  recorded: boolean;
  run_id: string;
  /** The row itself, when there is one. */
  run?: RunMetrics;
  /** Human-readable one-liner for the launcher log. */
  reason: string;
}

/**
 * Scan every month shard, not just the current one: a run that straddles a month
 * boundary (or one re-checked the next day) still has exactly one row, and
 * looking only at "this month" would report a real success as a failure.
 *
 * Mirrors `findExistingRunId` in record-run.ts deliberately — same filter to
 * *.jsonl so the runs/.claims/ subdirectory is never read as a shard.
 */
function findRunRow(metricsDir: string, runId: string): RunMetrics | undefined {
  const runsDir = join(metricsDir, "runs");
  if (!existsSync(runsDir)) return undefined;
  for (const shard of readdirSync(runsDir).filter((f) => f.endsWith(".jsonl"))) {
    for (const row of readJsonl<RunMetrics>(join(runsDir, shard))) {
      if (row.run_id === runId) return row;
    }
  }
  return undefined;
}

export function runOutcome(metricsDir: string, runId: string): RunOutcome {
  if (typeof runId !== "string" || runId.trim() === "") {
    return { recorded: false, run_id: String(runId), reason: "no run id given" };
  }
  const run = findRunRow(metricsDir, runId);
  if (run === undefined) {
    return {
      recorded: false,
      run_id: runId,
      reason:
        `no run row for "${runId}" in ${metricsDir}/runs/ — the record chain did not ` +
        `complete, so nothing was reviewed and nothing was stamped, whatever the ` +
        `session reported`,
    };
  }
  // A ROW IS NOT ENOUGH: `reviewed: 0` against `selected: 2` is a paid-for run
  // that reviewed nothing. It happens when every reviewer is cut off before it
  // writes its artifacts — merge-candidates then finds no complete surface dir
  // and correctly unions nothing, so the chain completes, the row is honest, and
  // no registry entry is stamped. All correct, and still not a success: the third
  // real run cost real money to record exactly this.
  //
  // `selected: 0` never reaches here (bin/workflow-args exits 3 for "nothing to
  // review" and the launcher skips the model), but it is treated as recorded
  // anyway rather than as a failure — a genuinely quiet night is not an error.
  if (run.selected > 0 && run.reviewed === 0) {
    return {
      recorded: false,
      run_id: runId,
      run,
      reason:
        `run row exists but reviewed 0 of ${run.selected} selected — every reviewer was ` +
        `cut off before writing its artifacts, so nothing was stamped and the run was ` +
        `paid for nothing (raise the band's maxTurns, or narrow the surface)`,
    };
  }
  return {
    recorded: true,
    run_id: runId,
    run,
    reason:
      `recorded: reviewed ${run.reviewed} of ${run.selected} selected, ` +
      `${run.findings_created} finding(s) created, ${run.confirmed} confirmed`,
  };
}
