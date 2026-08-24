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
// is what this reads. TWO pieces of it, because one is not enough:
//
//   1. THE RUN ROW. `bin/record` appends exactly one RunMetrics row per run to
//      metrics/runs/<YYYY-MM>.jsonl, under A1's per-repo lock, after validate
//      and dedupe have passed. It proves record ran, and it carries the counts
//      the row-level rule below reads.
//   2. THE COMPLETION SENTINEL. The row alone was the original predicate here,
//      and it was subtly too weak: record appends it BEFORE its own registry
//      rewrite, and the workflow chains rollup AFTER record. Either can fail and
//      leave that row behind, honest about what it counted and wrong about
//      whether the run finished — so `ns` called it a success, deleted the run
//      dir holding the diagnosis, and refreshed the living document to green.
//      `bin/rollup` is the last durable step and stamps the sentinel as its
//      final act; requiring it closes that window. See lib/run-complete.ts.
//
// It is a READ. It never writes, never repairs, and never infers an outcome from
// anything the model said — which is the point of having it at all.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonl } from "./io.js";
import { COMPLETE_DIRNAME, isRunComplete } from "./run-complete.js";
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

/**
 * A ROW IS NOT ENOUGH — the part of the outcome rule that reads the row itself,
 * split out so the launcher is not the only thing that can apply it.
 *
 * `reviewed: 0` against `selected: 2` is a paid-for run that reviewed nothing.
 * It happens when every reviewer is cut off before it writes its artifacts —
 * merge-candidates then finds no complete surface dir and correctly unions
 * nothing, so the chain completes, the row is honest, and no registry entry is
 * stamped. All correct, and still not a success: the third real run cost real
 * money to record exactly this.
 *
 * `selected: 0` never reaches runOutcome (bin/workflow-args exits 3 for "nothing
 * to review" and the launcher skips the model), but it is treated as recorded
 * anyway rather than as a failure — a genuinely quiet night is not an error.
 *
 * WHY IT IS EXPORTED. bin/dashboard used to derive the same verdict on its own
 * and get it backwards: any run row at all printed "<lane> ok <ts>" on the repo
 * header, so the exact run this function calls a failure — the one `ns` exits
 * non-zero for, keeps the run dir for, and reports as failed — rendered green on
 * the living document, with the dollar amount beside it. Two surfaces, one rule;
 * dashboard-run.ts calls this rather than re-deciding.
 *
 * Returns the shortfall as a short phrase an operator can read in a status line
 * ("reviewed 0 of 2 selected"), or undefined when the row is a real success. The
 * phrase is also spliced into runOutcome's own reason below, so the launcher log
 * and the dashboard cannot describe the same failure differently.
 */
export function runRowShortfall(run: RunMetrics): string | undefined {
  if (run.selected > 0 && run.reviewed === 0) {
    return `reviewed 0 of ${run.selected} selected`;
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
  const shortfall = runRowShortfall(run);
  if (shortfall !== undefined) {
    return {
      recorded: false,
      run_id: runId,
      run,
      reason:
        `run row exists but ${shortfall} — every reviewer was ` +
        `cut off before writing its artifacts, so nothing was stamped and the run was ` +
        `paid for nothing (raise the band's maxTurns, or narrow the surface)`,
    };
  }
  // THE ROW IS NOT THE END OF THE CHAIN. record appends this row and THEN
  // rewrites the registry; rollup runs after record in the workflow's
  // `&&`-chain. So a row can exist while two fallible steps that were supposed
  // to follow it never finished — and reading the row as success is how a run
  // whose registry rewrite threw got its diagnostic run dir deleted and its
  // dashboard refreshed to green. bin/rollup stamps the sentinel as its last
  // act, so requiring it here is the difference between "record ran" and "the
  // run finished". See lib/run-complete.ts.
  if (!isRunComplete(metricsDir, runId)) {
    return {
      recorded: false,
      run_id: runId,
      run,
      reason:
        `run row exists but "${runId}" was never stamped complete in ` +
        `${metricsDir}/runs/${COMPLETE_DIRNAME}/ — record appended its row and then ` +
        `something after it failed (the registry rewrite, or rollup), so freshness or ` +
        `the daily metrics are incomplete; the run dir is kept, check the log`,
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
