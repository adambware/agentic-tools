// bin/lane-plan — resolve the launcher-side lane plan (registry file, the three
// agent types, and the design lane's browser adapter + seeded personas) for one
// pack + lane. `ns` preflight runs this BEFORE the run starts and splices the
// plan into the Workflow's args, so an unrunnable lane fails fast with a reason
// instead of half-running. Thin argv shell over lib/lane-plan (E4: zero decision
// logic here — the lane -> data tables and every refusal live in the tested lib).
//
// Usage:
//   node bin/lane-plan.mjs --pack <packDir> --lane <security|design> [--out plan.json]
//
// ok     -> exit 0, plan JSON on stdout (always), one human summary line on stderr.
// refuse -> exit 2, "lane-plan: <reason>" on stderr and NOTHING on stdout, so a
//           caller doing `PLAN=$(node bin/lane-plan.mjs ...)` can never capture a
//           partial or misleading plan.
import { parseArgs, requireArg } from "../lib/args.js";
import { writeJson } from "../lib/io.js";
import { buildLanePlan } from "../lib/lane-plan.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    const res = buildLanePlan({
      packDir: requireArg(args, "pack"),
      lane: requireArg(args, "lane"),
    });
    if (!res.ok) {
      process.stderr.write(`lane-plan: ${res.reason}\n`);
      process.exitCode = 2;
      return;
    }
    const plan = res.plan;
    // --out is for callers that would rather read a file than capture stdout
    // (writeJson is atomic; a killed preflight never leaves a partial plan).
    if (args.out !== undefined) writeJson(args.out, plan);
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    process.stderr.write(
      `lane-plan: lane=${plan.lane} registry=${plan.registry} reviewer=${plan.agents.reviewer}\n`,
    );
  } catch (err) {
    // Anything that escaped the lib is a host/programmer fault, not an
    // operator-fixable pack problem — same exit code, still nothing on stdout.
    process.stderr.write(`lane-plan: ${(err as Error).message}\n`);
    process.exitCode = 2;
  }
  // Deliberately no process.exit(): stdout may be a pipe, and exit() can drop an
  // unflushed write. Falling off main() exits 0 (or with process.exitCode) after
  // the stream drains.
}

main();
