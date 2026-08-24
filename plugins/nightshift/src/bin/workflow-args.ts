// bin/workflow-args — assemble the exact `args` object nightshift.workflow.js
// reads, from this run's lane plan + selected surfaces, chunked by
// max_concurrent_reviewers (A7 / T11). Thin argv shell over lib/workflow-args
// (E4: zero decision logic here).
//
// Usage:
//   node bin/workflow-args.mjs --plan <lane-plan.json> --surfaces <surfaces.json> \
//     --run-id <id> --max-concurrent 3 --out <args.json>
//
// EXIT CODES — three outcomes, not two, because "nothing to review" is not an
// error and must never be reported as one:
//   0  args written; stdout carries the JSON as well.
//   2  refusal (bad run id, unsafe surface id, missing dispatch, bad cap).
//   3  NOTHING TO REVIEW — bin/select picked zero surfaces. `ns` skips the model
//      call, still regenerates the dashboard, and exits 0. Collapsing this into
//      2 would paint a red verdict strip on every quiet night, which is exactly
//      the kind of noise that trains an operator to stop reading the dashboard.
import { parseArgs, requireArg } from "../lib/args.js";
import { readJson, writeJson } from "../lib/io.js";
import { buildWorkflowArgs } from "../lib/workflow-args.js";
import type { LanePlan } from "../lib/lane-plan.js";
import type { Surface } from "../lib/types.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    const plan = readJson<LanePlan>(requireArg(args, "plan"));
    if (plan === undefined) throw new Error(`lane plan not found or empty: ${args.plan}`);
    const surfaces = readJson<Surface[]>(requireArg(args, "surfaces"));
    if (surfaces === undefined) throw new Error(`surfaces not found or empty: ${args.surfaces}`);

    const maxConcurrentRaw = requireArg(args, "max-concurrent");
    const res = buildWorkflowArgs({
      runId: requireArg(args, "run-id"),
      lanePlan: plan,
      surfaces,
      maxConcurrentReviewers: Number(maxConcurrentRaw),
    });

    if (!res.ok) {
      process.stderr.write(`workflow-args: ${res.reason}\n`);
      process.exitCode = res.kind === "nothing-to-review" ? 3 : 2;
      return;
    }

    // Write before printing: a caller that reads the file must never see a
    // stdout success for a file that was not durably written.
    if (args.out !== undefined) writeJson(args.out, res.args);
    process.stdout.write(JSON.stringify(res.args, null, 2) + "\n");
    process.stderr.write(
      `workflow-args: lane=${res.args.lane} surfaces=${surfaces.length} ` +
        `chunks=${res.chunks} cap=${maxConcurrentRaw}\n`,
    );
  } catch (err) {
    process.stderr.write(`workflow-args: ${(err as Error).message}\n`);
    process.exitCode = 2;
  }
}

main();
