// bin/clean — end-of-run housekeeping (v3 plan §9.8). Thin argv shell over
// lib/clean-run (E4). Exit 0 ok, 2 on error (invalid run id, path escape,
// or any unexpected failure).
//
// Usage:
//   node bin/clean.mjs --run-root <dir> --run-id <id> --status success|failure
import { parseArgs, requireArg } from "../lib/args.js";
import { runClean } from "../lib/clean-run.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    const runRoot = requireArg(args, "run-root");
    const runId = requireArg(args, "run-id");
    const status = requireArg(args, "status");
    if (status !== "success" && status !== "failure") {
      throw new Error(`--status must be 'success' or 'failure', got '${status}'`);
    }
    const res = runClean({ runRoot, runId, status });
    process.stderr.write(
      `clean: run=${runId} deleted=${res.deletedRunDir} pruned=${res.pruned.removed.length}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`clean: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
