// bin/retain — A7 retention. Copies the evidence cited by open findings out of
// this run's scratch dir into $OPS/evidence/<repo>/ (content-addressed) before
// bin/clean deletes the run dir, lifecycle-prunes that repo's evidence, and
// time-prunes $OPS/logs/. Thin argv shell over lib/retain (E4).
//
// Usage:
//   node bin/retain.mjs --evidence-root $OPS/evidence --repo novudesk \
//     --repo-root ~/code/novudesk --metrics-dir <pack>/metrics \
//     --run-dir <pack>/.run/<run_id> [--logs $OPS/logs]
//   node bin/retain.mjs --logs $OPS/logs            # logs only (no run to harvest)
//
// Exit 0 on success, 2 on usage/IO error. Retention failing must NOT be
// confused with the run failing: `ns` reports it and carries on to the
// dashboard, because a stale dashboard is the worse outcome (T22).
import { parseArgs, requireArg } from "../lib/args.js";
import { retainEvidence, retainLogs, evidenceBytes } from "../lib/retain.js";
import { join } from "node:path";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    const summary: Record<string, unknown> = {};

    if (args["run-dir"] !== undefined) {
      const evidenceRoot = requireArg(args, "evidence-root");
      const repoName = requireArg(args, "repo");
      const res = retainEvidence({
        runDir: args["run-dir"],
        repoRoot: requireArg(args, "repo-root"),
        metricsDir: requireArg(args, "metrics-dir"),
        evidenceRoot,
        repoName,
      });
      summary.evidence = {
        copied: res.copied.length,
        deduped: res.copied.filter((c) => c.deduped).length,
        skipped: res.skipped,
        pruned: res.pruned.removed.length,
        bytes: evidenceBytes(join(evidenceRoot, repoName)),
      };
      process.stderr.write(
        `retain: evidence copied=${res.copied.length} skipped=${res.skipped.length} ` +
          `pruned=${res.pruned.removed.length}\n`,
      );
    }

    if (args.logs !== undefined) {
      const pruned = retainLogs(args.logs);
      summary.logs = { pruned: pruned.removed.length, kept: pruned.kept.length };
      process.stderr.write(`retain: logs pruned=${pruned.removed.length} kept=${pruned.kept.length}\n`);
    }

    if (Object.keys(summary).length === 0) {
      throw new Error("nothing to do — pass --run-dir (evidence) and/or --logs");
    }
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(`retain: ${(err as Error).message}\n`);
    process.exitCode = 2;
  }
}

main();
