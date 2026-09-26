// bin/eval-planted — score a finished security-lane run against the planted-vuln
// answer key (T14): caught/total planted + false positives on clean controls.
// REPORT-ONLY: exits 0 whatever the score; 2 only on a usage / input error.
//
// Usage:
//   node bin/eval-planted.mjs --key examples/novudesk/eval/answer-key.yml \
//     --findings <target>/.nightshift/metrics/findings [--run-id <id>] [--slack 3] [--json]
//
// --findings takes a findings .jsonl, a candidates .json array, or a directory of
// either (recursive; non-finding JSON and pre-refutation run artifacts are skipped).
import { parseArgs, requireArg } from "../lib/args.js";
import { formatReport, runPlantedEval } from "../lib/planted-eval.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    let slack: number | undefined;
    if (args.slack !== undefined) {
      slack = Number(args.slack);
      if (!Number.isInteger(slack) || slack < 0) throw new Error("--slack must be a non-negative integer");
    }
    const report = runPlantedEval({
      keyPath: requireArg(args, "key"),
      findingsPath: requireArg(args, "findings"),
      runId: args["run-id"],
      slack,
    });
    process.stdout.write(args.json === "true" ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`eval-planted: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
