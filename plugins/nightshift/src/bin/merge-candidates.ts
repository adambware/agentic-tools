// bin/merge-candidates — fold the K per-surface review artifacts under
// <run-dir>/surfaces/<sid>/ into the three run-level files run-meta consumes.
// Thin argv shell over lib/merge-candidates-run (E4: zero decision logic here).
// Exit 0 on success, 2 on usage/IO error or any invariant violation — the
// workflow chains with && so exit 2 aborts before durable state.
//
// Usage:
//   node bin/merge-candidates.mjs --run-dir <dir> [--surfaces <path>]
//
// --surfaces defaults to <run-dir>/surfaces.json.
import { join } from "node:path";
import { parseArgs, requireArg } from "../lib/args.js";
import { runMergeCandidates } from "../lib/merge-candidates-run.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    const runDir = requireArg(args, "run-dir");
    const surfacesPath = args.surfaces ?? join(runDir, "surfaces.json");
    const res = runMergeCandidates({ runDir, surfacesPath });
    // skipped ids are printed inline: a partial fan-out is the one outcome a
    // human reading the run log must be able to see without opening the pack.
    const skipped = res.skipped.length > 0 ? ` [${res.skipped.join(",")}]` : "";
    process.stderr.write(
      `merge-candidates: merged=${res.merged.length} skipped=${res.skipped.length}${skipped} ` +
        `proposed=${res.proposedCount} survivors=${res.survivorsCount} -> ${runDir}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`merge-candidates: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
