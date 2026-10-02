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
  modelUsage?: Record<string, { costUSD?: number }>;
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

/**
 * What the run actually cost: the greater of the envelope's own `total_cost_usd`
 * and the sum of its per-model `modelUsage[*].costUSD`.
 *
 * WHY NOT JUST total_cost_usd. It undercounts when the session ends before work
 * it started has finished. Measured on a real run: the session answered as soon
 * as the Workflow tool handed back a task id, and the envelope reported
 * `total_cost_usd: 0.3633` while its own `modelUsage` summed to `$4.4681813` —
 * $4.10 of real spend that would never have reached costs.jsonl, in the ledger
 * whose entire job is making spend visible. On a run that completes normally the
 * two agree to floating-point noise ($4.652074950000001 vs $4.652074949999999),
 * so taking the max costs nothing in the normal case.
 *
 * The max, not the sum, and not a replacement: `total_cost_usd` stays the
 * primary figure and this can only ever revise it UPWARD. Under-reporting spend
 * is the failure that matters — a cost trend that quietly reads low sets a
 * budget expectation the system then breaks.
 */
function envelopeUsd(e: Record<string, unknown>): number {
  const reported = num(e.total_cost_usd);
  const mu = e.modelUsage;
  if (typeof mu !== "object" || mu === null || Array.isArray(mu)) return reported;
  let summed = 0;
  for (const entry of Object.values(mu as Record<string, unknown>)) {
    if (typeof entry === "object" && entry !== null) {
      summed += num((entry as Record<string, unknown>).costUSD);
    }
  }
  return Math.max(reported, summed);
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
    usd: envelopeUsd(e),
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

/**
 * A run whose result envelope never arrived, or arrived unusable (the CLI was
 * killed, wrote nothing, wrote half a line, or reported no `is_error`).
 *
 * WHY THIS IS NOT A THROW (A7). Without it, `ns` has exactly two options after a
 * crashed headless run: write no cost row at all, or make the shell synthesize
 * one — and a shell that decides what a cost row says is precisely the decision
 * logic §9.4 keeps out of `ns`. A missing row is worse than a $0 row: the
 * dashboard's verdict strip reads cost rows, so a crash with no row renders as
 * "no run happened" rather than "a run failed", which is the silent staleness
 * the whole system exists to prevent.
 *
 * usd is 0 because the true figure is unknowable — the envelope that would have
 * carried it is the thing that went missing. `source` stays "cli-json" because
 * that IS the path this row came from (a headless run with --json); the
 * terminal_reason says in words that the envelope was unusable, so nobody reads
 * the zero as a measured cost. It is a floor, never an estimate, and the runbook
 * says so next to the measured per-run figure (T15).
 */
export function buildFallbackErrorRecord(meta: CostMeta, reason: string): CostRecord {
  return {
    run_id: meta.runId,
    lane: meta.lane,
    date: meta.date,
    ts: meta.ts,
    usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    source: "cli-json",
    status: "error",
    terminal_reason: reason,
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
  /**
   * When set, an envelope that cannot be turned into a record becomes a
   * status:"error" row carrying this reason instead of a throw. Opt-in: every
   * pre-A7 caller keeps the strict behaviour, so a malformed envelope in a
   * context that can actually fix it still fails loudly.
   */
  fallbackErrorReason?: string;
}

export const COSTS_FILENAME = "costs.jsonl";

/** Validate + atomically append one cost record. Returns the appended record. */
export function runRecordCost(opts: RecordCostOpts): CostRecord {
  let record: CostRecord;
  if (opts.envelope !== undefined) {
    try {
      record = buildCostRecord(opts.envelope, opts.meta);
    } catch (err) {
      if (opts.fallbackErrorReason === undefined) throw err;
      record = buildFallbackErrorRecord(
        opts.meta,
        `${opts.fallbackErrorReason}: ${(err as Error).message}`,
      );
    }
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
