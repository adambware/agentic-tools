// bin/record-cost — validate + atomically append one cost-record line to
// metrics/costs.jsonl (v3 A2 / T7). Thin argv shell over lib/record-cost-run
// (zero decision logic here). Exit 0 on success (recording a FAILED run's cost
// is a success of record-cost), 2 on usage/IO/validation error.
//
// Usage (cli-json — the normal `ns` path):
//   node bin/record-cost.mjs --metrics-dir <.nightshift/metrics> --run-id <id> \
//     --lane security --json <result-envelope.json> [--date YYYY-MM-DD] [--ts <iso>] \
//     [--fallback-error-reason <text>]
//
// --fallback-error-reason makes a missing/unparseable/unusable envelope a
// status:"error" cost row carrying that reason, instead of exiting 2. `ns` uses
// it so a crashed headless run still leaves a row for the dashboard's verdict
// strip to read — "a run failed" rather than "no run happened" (A7 / T22).
//
// Usage (manual — `ns cost add` / interactive runs without JSON output):
//   node bin/record-cost.mjs --metrics-dir <.nightshift/metrics> --run-id <id> \
//     --lane security --usd 1.23 [--input-tokens N] [--output-tokens N] \
//     [--cache-read-tokens N] [--cache-creation-tokens N] [--date ...] [--ts ...]
import { existsSync } from "node:fs";
import { parseArgs, requireArg, resolveToday } from "../lib/args.js";
import { readJson } from "../lib/io.js";
import { runRecordCost } from "../lib/record-cost-run.js";
import type { Lane } from "../lib/types.js";

function optNum(args: Record<string, string>, key: string): number | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    process.stderr.write(`record-cost: --${key} must be a number, got "${raw}"\n`);
    process.exit(2);
  }
  return n;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const metricsDir = requireArg(args, "metrics-dir");
  const runId = requireArg(args, "run-id");
  const lane = (args.lane ?? "security") as Lane;
  const today = resolveToday(args);
  const meta = {
    runId,
    lane,
    date: args.date ?? today,
    ts: args.ts ?? new Date().toISOString(),
  };

  if (args.json !== undefined && args.usd !== undefined) {
    process.stderr.write("record-cost: --json and --usd are mutually exclusive\n");
    process.exit(2);
  }

  try {
    const fallbackErrorReason = args["fallback-error-reason"];
    let envelope: unknown;
    if (args.json !== undefined) {
      if (!existsSync(args.json)) {
        if (fallbackErrorReason === undefined) throw new Error(`envelope not found: ${args.json}`);
        // `null` is deliberately NOT undefined: it takes runRecordCost down the
        // envelope branch, where buildCostRecord rejects it and the fallback
        // turns the rejection into the status:"error" row. A crashed headless
        // run that wrote no file must still leave a cost row (A7 / T22).
        envelope = null;
      } else {
        try {
          envelope = readJson(args.json);
        } catch (err) {
          if (fallbackErrorReason === undefined) throw err;
          envelope = null;
        }
      }
    }
    const record = runRecordCost({
      metricsDir,
      meta,
      envelope,
      manualUsd: optNum(args, "usd"),
      ...(fallbackErrorReason === undefined ? {} : { fallbackErrorReason }),
      manualTokens: {
        input_tokens: optNum(args, "input-tokens"),
        output_tokens: optNum(args, "output-tokens"),
        cache_read_tokens: optNum(args, "cache-read-tokens"),
        cache_creation_tokens: optNum(args, "cache-creation-tokens"),
      },
    });
    process.stderr.write(
      `record-cost: ${record.run_id} ${record.status} usd=${record.usd} source=${record.source}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`record-cost: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
