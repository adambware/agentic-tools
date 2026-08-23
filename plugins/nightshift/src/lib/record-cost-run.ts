// bin/record-cost logic (v3 A2 / T7). Turn a headless `claude -p --output-format
// json` result envelope (or manual flags) into one validated cost-record line
// appended to metrics/costs.jsonl.
//
// The load-bearing rule (plan §9.7): status is gated on `is_error` and NOTHING
// else. A failed run's envelope carries `subtype: "success"` right next to
// `is_error: true`, so keying on subtype would record failures as normal runs.
// This module never reads `subtype`.
import { join } from "node:path";
import type { CostRecord, CostSource, Lane } from "./types.js";
import { appendJsonl } from "./io.js";
import { validateCostRecord } from "./validate.js";

// The subset of the CLI JSON envelope we consume. Everything else (subtype,
// modelUsage, duration_ms, ...) is deliberately ignored.
export interface CliJsonEnvelope {
  is_error: boolean;
  total_cost_usd?: number;
  terminal_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export interface CostMeta {
  runId: string;
  lane: Lane;
  date: string;
  ts: string;
}

function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

/** Build a cost record from a CLI JSON envelope. Gates on `is_error` ONLY. */
export function buildCostRecord(envelope: unknown, meta: CostMeta): CostRecord {
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new Error("envelope: not an object");
  }
  const e = envelope as Record<string, unknown>;
  if (typeof e.is_error !== "boolean") {
    // Without a boolean is_error there is no trustworthy status; refuse rather
    // than guess (subtype is NOT an acceptable fallback).
    throw new Error("envelope: is_error must be a boolean");
  }
  if (e.is_error === false && !(typeof e.total_cost_usd === "number" && Number.isFinite(e.total_cost_usd))) {
    // Same refusal as above, one field over. A successful run always reports its
    // cost; coercing a missing or mistyped total_cost_usd to 0 would record that
    // run as free — the exact "silently record as a free success" failure this
    // module exists to prevent, just reached through the cost field instead of
    // through subtype. An error run legitimately reports 0, so it is exempt.
    throw new Error("envelope: total_cost_usd must be a finite number when is_error is false");
  }
  const usage = (typeof e.usage === "object" && e.usage !== null ? e.usage : {}) as Record<
    string,
    unknown
  >;
  const record: CostRecord = {
    run_id: meta.runId,
    lane: meta.lane,
    date: meta.date,
    ts: meta.ts,
    usd: num(e.total_cost_usd),
    input_tokens: num(usage.input_tokens),
    output_tokens: num(usage.output_tokens),
    cache_read_tokens: num(usage.cache_read_input_tokens),
    cache_creation_tokens: num(usage.cache_creation_input_tokens),
    source: "cli-json",
    status: e.is_error === false ? "ok" : "error",
  };
  if (record.status === "error") {
    record.terminal_reason =
      typeof e.terminal_reason === "string" && e.terminal_reason.length > 0
        ? e.terminal_reason
        : "unknown";
  }
  return record;
}

/** Build a manual cost record (`ns cost add` / interactive runs without JSON). */
export function buildManualCostRecord(
  meta: CostMeta,
  usd: number,
  tokens?: Partial<
    Pick<
      CostRecord,
      "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_creation_tokens"
    >
  >,
): CostRecord {
  return {
    run_id: meta.runId,
    lane: meta.lane,
    date: meta.date,
    ts: meta.ts,
    usd: num(usd),
    input_tokens: num(tokens?.input_tokens),
    output_tokens: num(tokens?.output_tokens),
    cache_read_tokens: num(tokens?.cache_read_tokens),
    cache_creation_tokens: num(tokens?.cache_creation_tokens),
    source: "manual",
    status: "ok",
  };
}

export interface RecordCostOpts {
  metricsDir: string;
  meta: CostMeta;
  // Exactly one of the two:
  envelope?: unknown; // parsed CLI JSON result -> source: "cli-json"
  manualUsd?: number; // -> source: "manual"
  manualTokens?: Partial<
    Pick<
      CostRecord,
      "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_creation_tokens"
    >
  >;
}

export const COSTS_FILENAME = "costs.jsonl";

/** Validate + atomically append one cost record. Returns the appended record. */
export function runRecordCost(opts: RecordCostOpts): CostRecord {
  let record: CostRecord;
  if (opts.envelope !== undefined) {
    record = buildCostRecord(opts.envelope, opts.meta);
  } else if (opts.manualUsd !== undefined) {
    record = buildManualCostRecord(opts.meta, opts.manualUsd, opts.manualTokens);
  } else {
    throw new Error("record-cost: need an envelope or a manual --usd");
  }
  const result = validateCostRecord(record);
  if (!result.ok) {
    throw new Error(`cost-record invalid: ${result.errors.join("; ")}`);
  }
  appendJsonl(join(opts.metricsDir, COSTS_FILENAME), record);
  return record;
}
