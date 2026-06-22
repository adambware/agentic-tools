// bin/run-meta — assemble run.json from surfaces.json, candidates.proposed.json,
// and candidates.json (Tier-1 refuter survivors). Thin argv shell over
// lib/run-meta-build (E4: zero decision logic here). Exit 0 on success,
// 2 on usage/IO error (workflow aborts).
//
// Usage:
//   node bin/run-meta.mjs --surfaces <run-dir>/surfaces.json \
//     --proposed <run-dir>/candidates.proposed.json \
//     --survivors <run-dir>/candidates.json \
//     --run-id "$NIGHTSHIFT_RUN_ID" \
//     --lane security \
//     --pack .nightshift \
//     --repo . \
//     --out <run-dir>/run.json \
//     [--today YYYY-MM-DD] [--ts ISO8601]
import { parseArgs, requireArg } from "../lib/args.js";
import { buildRunMeta } from "../lib/run-meta-build.js";
import type { Lane } from "../lib/types.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const lane = (args.lane ?? "security") as Lane;
  try {
    const res = buildRunMeta({
      surfacesPath: requireArg(args, "surfaces"),
      proposedPath: requireArg(args, "proposed"),
      survivorsPath: requireArg(args, "survivors"),
      runId: requireArg(args, "run-id"),
      lane,
      packDir: args.pack ?? args.repo ?? process.cwd(),
      outPath: requireArg(args, "out"),
      args,
      nowTs: args.ts,
    });
    process.stderr.write(
      `run-meta: run_id=${res.meta.run_id} lane=${lane} reviewed=${res.meta.reviewed} ` +
        `rejected_tier1=${res.meta.rejected_tier1} ` +
        `-> ${requireArg(args, "out")}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`run-meta: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
