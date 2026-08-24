// The completion sentinel — the marker that says the WHOLE durable chain
// finished, not just its first append.
//
// WHY A SECOND MARKER, WHEN THERE IS ALREADY A RUN ROW. `bin/record` appends the
// run row and THEN rewrites the registry; `bin/rollup` runs after record in the
// workflow's `&&`-chain. So the run row — the thing run-outcome read as proof of
// success — is written while two fallible steps still lie ahead of it. A
// registry rewrite that throws, or a rollup that aborts on a malformed cost
// line, leaves that row sitting in the shard: honest about what it counted, and
// completely wrong about whether the run finished. `ns` then reads it, calls the
// run a success, DELETES the run dir that held the diagnosis, and refreshes the
// living document to say all was well.
//
// That is the same failure shape run-outcome.ts exists to stop, one step further
// down the chain: durable evidence that is real but does not mean what the
// reader takes it to mean. So the row proves "record ran"; this marker proves
// "everything after record ran too". It is written by `bin/rollup`, the last
// durable step, once daily.jsonl is appended and nothing fallible remains.
//
// Sibling of runs/.claims/, and the same rule governs it: the directory must
// never be named *.jsonl, or the shard scans in record-run.ts and run-outcome.ts
// would try to parse it as a month shard.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Subdirectory of metrics/runs/ holding one file per completed run. */
export const COMPLETE_DIRNAME = ".complete";

const RUN_ID_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * run_id becomes a filename here, so it gets the same filename-safety check
 * record-run.ts and clean-run.ts each make before letting one near a path. Kept
 * local to this module for the same reason theirs are: one small regex copied
 * three times reads better than a shared constant that hides which paths a
 * forged id could reach.
 */
function assertValidRunId(runId: string): void {
  if (runId === "." || runId === ".." || !RUN_ID_RE.test(runId)) {
    throw new Error(`run_id "${runId}" must be filename-safe (matches ${RUN_ID_RE} and not "." or "..")`);
  }
}

export function runCompleteDir(metricsDir: string): string {
  return join(metricsDir, "runs", COMPLETE_DIRNAME);
}

export function runCompletePath(metricsDir: string, runId: string): string {
  assertValidRunId(runId);
  return join(runCompleteDir(metricsDir), runId);
}

export interface RunCompleteMarker {
  ts: string;
  date: string;
  lane: string;
}

/**
 * Stamp the run complete. Called by `bin/rollup` and nowhere else — moving this
 * call earlier in the chain would silently restore exactly the bug the marker
 * exists to close.
 *
 * A plain write, not the O_CREAT|O_EXCL claim record-run.ts uses: the claim is a
 * uniqueness token and a second one is a real error, while this is a statement
 * of fact that stays true if it is written twice. Re-running rollup alone after
 * a transient failure should be able to re-stamp; it cannot double-append
 * anything, because `bin/record` has already refused the duplicate run_id by the
 * time any retry gets this far.
 *
 * The payload is for a human reading the directory during a diagnosis. Nothing
 * reads it back — `isRunComplete` only asks whether the file is there.
 */
export function markRunComplete(metricsDir: string, runId: string, marker: RunCompleteMarker): void {
  const path = runCompletePath(metricsDir, runId);
  mkdirSync(runCompleteDir(metricsDir), { recursive: true });
  writeFileSync(path, JSON.stringify(marker) + "\n");
}

/** True iff `bin/rollup` stamped this run complete. A pure existence check. */
export function isRunComplete(metricsDir: string, runId: string): boolean {
  if (runId === "." || runId === ".." || !RUN_ID_RE.test(runId)) return false;
  return existsSync(join(runCompleteDir(metricsDir), runId));
}
