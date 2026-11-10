// loop-metrics: append one baseline row of loop metrics to ~/.claude/metrics/loops.jsonl.
// See plugins/loops/README.md; all logic lives in src/lib/cli.ts.
import { main } from "../lib/cli.js";

process.exitCode = await main(process.argv.slice(2));
