// bin/clean logic (v3 plan §9.8). End-of-run housekeeping for .nightshift/.run/:
// a successful run's scratch dir is deleted (nothing left to diagnose); a failed
// run's scratch dir is kept so a human/agent can inspect it. Either way the run
// root is then time-pruned so scratch dirs don't accumulate without bound.
import { existsSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { prune, type PruneResult } from "./prune.js";

export interface CleanOpts {
  runRoot: string;
  runId: string;
  status: "success" | "failure";
  now?: () => number;
}

export interface CleanResult {
  deletedRunDir: boolean;
  pruned: PruneResult;
}

const RUN_ID_RE = /^[A-Za-z0-9_.-]+$/;
const KEEP = 5;
const MAX_AGE_DAYS = 7;

export function runClean(opts: CleanOpts): CleanResult {
  // An empty/blank runRoot resolves to cwd via node:path's resolve() — that
  // would turn every path-containment check below into a no-op guard against
  // deleting the wrong directory, since "the wrong directory" would be cwd
  // itself. Reject before any resolve/rm touches the filesystem.
  if (opts.runRoot.trim() === "") {
    throw new Error("runRoot must not be empty");
  }
  if (!RUN_ID_RE.test(opts.runId)) {
    throw new Error(`invalid run id: ${opts.runId}`);
  }

  const rootResolved = resolve(opts.runRoot);
  const runDir = resolve(opts.runRoot, opts.runId);
  // Path containment: runDir must land strictly inside rootResolved (not
  // equal to it either — a run id of "." would otherwise resolve to the root
  // itself). A forged id like "../../x" resolves outside the root and must
  // be rejected before anything is touched — checked unconditionally rather
  // than trusting the regex alone.
  if (!runDir.startsWith(rootResolved + sep)) {
    throw new Error(`run id escapes run root: ${opts.runId}`);
  }

  let deletedRunDir = false;
  if (opts.status === "success") {
    deletedRunDir = existsSync(runDir);
    if (deletedRunDir) rmSync(runDir, { recursive: true, force: true });
  }
  // status === "failure": leave the run dir in place for diagnosis.

  const pruned = prune(
    opts.runRoot,
    { kind: "time", keep: KEEP, maxAgeDays: MAX_AGE_DAYS },
    { now: opts.now },
  );

  return { deletedRunDir, pruned };
}
