// bin/tier2-gate — the conditional Tier-2 refute pass, both halves. Thin argv
// shell over lib/tier2-gate-run (E4: the ONE decision here is which mode to
// run; the gate predicate and every invariant live in the lib). Exit 0 ok,
// 2 on any violation/IO error (the workflow chains with && and aborts).
//
// Usage:
//   node bin/tier2-gate.mjs --run-dir <run-dir> [--survivors <path>]
//   node bin/tier2-gate.mjs --run-dir <run-dir> --assemble
//
// gate:     reads <run-dir>/candidates.json (or --survivors), writes tier2.json,
//           tier2.pass.json and surfaces/<sid>/tier2.pending.json.
// assemble: reads the Tier-2 refuter's surfaces/<sid>/tier2.survivors.json and
//           writes <run-dir>/candidates.tier2.json.
import { parseArgs, requireArg } from "../lib/args.js";
import { runTier2Gate, runTier2Assemble } from "../lib/tier2-gate-run.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    const runDir = requireArg(args, "run-dir");
    // Bare --assemble parses to "true"; any presence selects assemble mode.
    if (args.assemble !== undefined) {
      const res = runTier2Assemble({ runDir });
      process.stderr.write(
        `tier2-gate: assembled=${res.pass + res.survivors} ` +
          `(pass=${res.pass} tier2_survivors=${res.survivors}) ` +
          `rejected_tier2=${res.rejectedTier2}\n`,
      );
    } else {
      const res = runTier2Gate({ runDir, survivorsPath: args.survivors });
      process.stderr.write(
        `tier2-gate: gated=${res.gatedCount} ` +
          `surfaces=[${res.gatedSurfaces.join(",")}] pass=${res.passCount}\n`,
      );
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`tier2-gate: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
