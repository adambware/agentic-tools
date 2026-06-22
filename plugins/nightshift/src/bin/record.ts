// bin/record — consume decisions.json + a run-meta file and durably write the
// stateful path (per-run record, finding lines, registry state). Thin argv shell
// over lib/record-run (E4). Exit 0 ok, 2 on error (workflow aborts; state stays
// at last good).
//
// Usage:
//   node bin/record.mjs --decisions <decisions.json> --run-meta <run.json> \
//     --metrics-dir <.nightshift/metrics> [--registry <vectors.yml>]
//
// run.json carries the run metadata + judgment-derived counts + reviewed_ids.
import { existsSync } from "node:fs";
import { parseArgs, requireArg } from "../lib/args.js";
import { readJson } from "../lib/io.js";
import { runRecord } from "../lib/record-run.js";
import type { Decisions } from "../lib/dedupe-run.js";
import type { RunMeta } from "../lib/types.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    const decisionsPath = requireArg(args, "decisions");
    const runMetaPath = requireArg(args, "run-meta");
    if (!existsSync(decisionsPath)) throw new Error(`decisions not found: ${decisionsPath}`);
    if (!existsSync(runMetaPath)) throw new Error(`run-meta not found: ${runMetaPath}`);
    const decisions = readJson<Decisions>(decisionsPath)!;
    const m = readJson<RunMeta>(runMetaPath)!;
    const res = runRecord({
      decisions,
      metricsDir: requireArg(args, "metrics-dir"),
      registryPath: args.registry,
      reviewedIds: m.reviewed_ids ?? [],
      runId: m.run_id,
      lane: m.lane,
      date: m.date,
      ts: m.ts,
      packSha: m.pack_sha,
      selected: m.selected,
      reviewed: m.reviewed,
      rejectedTier1: m.rejected_tier1,
      rejectedTier2: m.rejected_tier2,
      usageByModel: m.usage_by_model ?? {},
      usageSpent: m.usage_spent ?? 0,
      elapsed: m.elapsed ?? 0,
    });
    process.stderr.write(
      `record: logged=${res.findingsAppended} recurring=${res.recurringBumped} run=${m.run_id}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`record: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
