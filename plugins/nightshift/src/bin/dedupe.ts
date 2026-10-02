// bin/dedupe — partition validated candidate findings into new/recurring/suppressed
// against the open-findings log + active suppressions; write decisions.json.
// Thin argv shell over lib/dedupe-cli (E4). Exit 0 ok, 2 on error (workflow aborts).
//
// Usage:
//   node bin/dedupe.mjs --candidates <candidates.json> --metrics-dir <.nightshift/metrics> \
//     --suppressions <.nightshift/findings/suppressions.yml> --out <decisions.json> \
//     --run-id <id> --lane security [--today YYYY-MM-DD]
import { parseArgs, requireArg, resolveToday } from "../lib/args.js";
import { runDedupe } from "../lib/dedupe-cli.js";
import type { Lane } from "../lib/types.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const lane = (args.lane ?? "security") as Lane;
  try {
    const res = runDedupe({
      candidatesPath: requireArg(args, "candidates"),
      metricsDir: requireArg(args, "metrics-dir"),
      suppressionsPath: requireArg(args, "suppressions"),
      outPath: requireArg(args, "out"),
      runId: requireArg(args, "run-id"),
      lane,
      today: resolveToday(args),
    });
    process.stderr.write(
      `dedupe: confirmed=${res.counts.confirmed} recurring=${res.counts.recurring} suppressed=${res.counts.suppressed}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`dedupe: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
