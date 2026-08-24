// bin/rollup — recompute and append the daily metrics rollup for a (date, lane).
// Thin argv shell over lib/rollup-cli (zero decision logic here).
// Exit 0 on success, 2 on usage/IO error (workflow aborts).
//
// Usage:
//   node bin/rollup.mjs --registry <vectors.yml> --metrics-dir <.nightshift/metrics> \
//     --lane security --ts <iso> [--today YYYY-MM-DD] [--date YYYY-MM-DD] \
//     [--run-id <run_id>]
//
// --run-id is what makes this command the run's completion sentinel: rollup is
// the last durable step, so it is the only place that can honestly stamp a run
// complete (see lib/run-complete.ts). The launcher path always passes it; a
// standalone recompute of some past day deliberately does not, and stamps
// nothing.
import { parseArgs, requireArg, resolveToday } from "../lib/args.js";
import { runRollup } from "../lib/rollup-cli.js";
import type { Lane } from "../lib/types.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const lane = (args.lane ?? "security") as Lane;
  const ts = args.ts ?? new Date().toISOString();
  const today = resolveToday(args);
  const date = args.date ?? today;
  try {
    const res = runRollup({
      registryPath: requireArg(args, "registry"),
      metricsDir: requireArg(args, "metrics-dir"),
      lane,
      today,
      date,
      ts,
      runId: args["run-id"],
    });
    process.stderr.write(
      `rollup: ${res.date} ${res.lane} freshness=${res.coverage_freshness_pct}% open=${res.open_findings}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`rollup: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
