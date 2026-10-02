// bin/run-meta — assemble run.json from surfaces.json, candidates.proposed.json,
// and candidates.json (Tier-1 refuter survivors). Thin argv shell over
// lib/run-meta-build (E4: zero decision logic here). Exit 0 on success,
// 2 on usage/IO error (workflow aborts).
//
// Usage:
//   node bin/run-meta.mjs --surfaces <run-dir>/surfaces.json \
//     --proposed <run-dir>/candidates.proposed.json \
//     --survivors <run-dir>/candidates.json \
//     --reviewed <run-dir>/reviewed.json \
//     [--tier2 <run-dir>/candidates.tier2.json] \
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
      // Optional: omitted -> rejected_tier2 = 0 (no Tier-2 pass this run).
      // A bare `--tier2` parses to the string "true", which then fails the
      // existsSync check with `tier2 candidates file not found: true` — loud,
      // not a silent fall back to 0.
      tier2Path: args.tier2,
      reviewedPath: requireArg(args, "reviewed"),
      runId: requireArg(args, "run-id"),
      lane,
      packDir: args.pack ?? args.repo ?? process.cwd(),
      outPath: requireArg(args, "out"),
      args,
      nowTs: args.ts,
    });
    process.stderr.write(
      `run-meta: run_id=${res.meta.run_id} lane=${lane} ` +
        `selected=${res.meta.selected} reviewed=${res.meta.reviewed} ` +
        `rejected_tier1=${res.meta.rejected_tier1} ` +
        `rejected_tier2=${res.meta.rejected_tier2} ` +
        `-> ${requireArg(args, "out")}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`run-meta: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
