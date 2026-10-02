// bin/due — which configured repo+lane pairs warrant a run right now (A7 / T4).
// Thin argv shell over lib/due (E4: the predicate and its ordering live there,
// vitest-covered, so `ns run --due` and A9's sentinel cannot drift apart).
//
// Usage:
//   node bin/due.mjs --config $OPS/config.yml [--today YYYY-MM-DD]
//   node bin/due.mjs --config $OPS/config.yml --format sh   # "<repo> <lane>" per DUE pair
//   node bin/due.mjs --config $OPS/config.yml --all         # include not-due pairs (ns status)
//
// Exit 0 always when the config loaded — "nothing is due" is an answer, not a
// failure. Exit 2 only when the config itself could not be read.
import { parseArgs, requireArg, resolveToday } from "../lib/args.js";
import { readOpsConfig } from "../lib/ops-config.js";
import { dueSweep } from "../lib/due.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cfg = readOpsConfig(requireArg(args, "config"));
  if (!cfg.ok) {
    process.stderr.write(`due: ${cfg.reason}\n`);
    process.exitCode = 2;
    return;
  }

  let verdicts;
  try {
    verdicts = dueSweep({ config: cfg.config, today: resolveToday(args) });
  } catch (err) {
    process.stderr.write(`due: ${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  const shown = args.all !== undefined ? verdicts : verdicts.filter((v) => v.due);

  if (args.format === "sh") {
    // Only ever the DUE pairs here, whatever --all says: this output is fed
    // straight into `ns run`'s loop, and a not-due pair leaking in would run it.
    for (const v of verdicts.filter((x) => x.due)) {
      process.stdout.write(`${v.repo} ${v.lane}\n`);
    }
    return;
  }

  process.stdout.write(JSON.stringify(shown, null, 2) + "\n");
  const dueCount = verdicts.filter((v) => v.due).length;
  process.stderr.write(`due: ${dueCount} of ${verdicts.length} configured repo/lane pair(s) due\n`);
}

main();
