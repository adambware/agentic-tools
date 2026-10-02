// bin/run-outcome — did this run complete its durable phase? (v3 A7 Part 2.)
// Thin argv shell over lib/run-outcome (E4). `ns` gates NS_STATUS on the exit
// code, so the launcher never has to decide what "success" means.
//
// Usage:
//   node bin/run-outcome.mjs --metrics-dir <pack>/metrics --run-id <id>
//   node bin/run-outcome.mjs --metrics-dir <dir> --run-id <id> --json
//
// Exit 0  a run row exists — the record chain ran.
// Exit 1  no run row — the run did not do its job, whatever it reported.
// Exit 2  bad usage.
import { parseArgs, requireArg } from "../lib/args.js";
import { runOutcome } from "../lib/run-outcome.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  let outcome;
  try {
    outcome = runOutcome(requireArg(args, "metrics-dir"), requireArg(args, "run-id"));
  } catch (err) {
    process.stderr.write(`run-outcome: ${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  if (args.json !== undefined) {
    process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
  }
  process.stderr.write(`run-outcome: ${outcome.reason}\n`);
  process.exitCode = outcome.recorded ? 0 : 1;
}

main();
