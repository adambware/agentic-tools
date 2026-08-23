// Pure computation for the daily metrics rollup (run-loop.md step 5c).
// No I/O — fully unit-testable.
import type { CostRecord, DailyMetrics, Lane, RegistryEntry, RunMetrics } from "./types.js";
import { computeStaleness, daysBetween, MAX_STALENESS, tsNewer } from "./staleness.js";

export interface RollupInput {
  date: string;
  lane: Lane;
  ts: string;
  entries: RegistryEntry[];
  openFindingsCount: number;
  runRecords: RunMetrics[];
  // Cost lines for THIS lane from metrics/costs.jsonl (v3 A2, additive).
  costRecords?: CostRecord[];
  today: string;
}

/** Median of a numeric array (sorted ascending). Returns 0 for empty arrays.
 *  Even-length: average of the two middle values. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  const lo = sorted[mid - 1] ?? 0;
  const hi = sorted[mid] ?? 0;
  return (lo + hi) / 2;
}

/** Round to N decimal places. */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Compute the FPR over a trailing N-day window ending at `endDate` (inclusive).
 *  Window = [endDate - (N-1) days, endDate].
 *  Returns null when findings_created === 0 (division undefined). */
function computeFpr(
  runs: RunMetrics[],
  endDate: string,
  windowDays: number,
): number | null {
  let created = 0;
  let rejected = 0;
  for (const r of runs) {
    const d = daysBetween(r.date, endDate);
    // d = endDate - r.date; must be >= 0 (not in the future) and < windowDays
    if (d >= 0 && d <= windowDays - 1) {
      created += r.findings_created;
      rejected += r.rejected_tier1 + r.rejected_tier2;
    }
  }
  if (created === 0) return null;
  return Math.round((rejected / created) * 100);
}

/** costs.jsonl is append-only, so a retried `record-cost` legitimately writes a
 *  second row for the same run_id. Summing both would bill one run twice and
 *  inflate every cost window with no error. Keep the max-ts row per run_id —
 *  the same last-write-wins reduction daily.jsonl already relies on. */
function dedupeByRunId(costs: CostRecord[]): CostRecord[] {
  const best = new Map<string, CostRecord>();
  for (const c of costs) {
    const cur = best.get(c.run_id);
    if (!cur || tsNewer(c.ts, cur.ts)) best.set(c.run_id, c);
  }
  return [...best.values()];
}

function inWindow(recordDate: string, endDate: string, windowDays: number): boolean {
  const d = daysBetween(recordDate, endDate);
  return d >= 0 && d <= windowDays - 1;
}

/** Total spend over a trailing window. Error rows are included: a failed run's
 *  recorded usd (typically 0) is still honest spend, and excluding it would hide
 *  partial burn. Only the per-run AVERAGE excludes error rows (plan A2). */
function costSum(costs: CostRecord[], endDate: string, windowDays: number): number {
  let sum = 0;
  for (const c of costs) {
    if (inWindow(c.date, endDate, windowDays)) sum += c.usd;
  }
  return round(sum, 4);
}

/** Average usd per successful run over a trailing window. Error rows are
 *  excluded from numerator AND denominator; null when no ok rows in window. */
function costAvgPerRun(
  costs: CostRecord[],
  endDate: string,
  windowDays: number,
): number | null {
  let sum = 0;
  let n = 0;
  for (const c of costs) {
    if (c.status !== "error" && inWindow(c.date, endDate, windowDays)) {
      sum += c.usd;
      n++;
    }
  }
  if (n === 0) return null;
  return round(sum / n, 4);
}

export function computeDailyRollup(input: RollupInput): DailyMetrics {
  const { date, lane, ts, entries, openFindingsCount, runRecords, today } = input;

  // runs: count of records for this (date, lane)
  const runs = runRecords.filter((r) => r.date === date && r.lane === lane).length;

  // Per-entry staleness and status
  let surfaces_green = 0;
  let surfaces_stale = 0;
  let surfaces_overdue = 0;
  const stalenessValues: number[] = [];

  for (const entry of entries) {
    const s = computeStaleness(entry, today);
    stalenessValues.push(s);
    if (s <= 1.0) {
      surfaces_green++;
    } else if (s <= 2.0) {
      surfaces_stale++;
    } else {
      // s > 2.0, including MAX_STALENESS (never reviewed)
      surfaces_overdue++;
    }
  }

  const surfaces_total = entries.length;

  // coverage_freshness_pct: share of surfaces with staleness <= 1.0
  const coverage_freshness_pct =
    surfaces_total === 0
      ? 100
      : round((surfaces_green / surfaces_total) * 100, 1);

  // median_staleness_ratio
  const median_staleness_ratio = round(median(stalenessValues), 2);

  // FPR windows — filter run records to this lane only
  const laneRuns = runRecords.filter((r) => r.lane === lane);
  const fpr_7d = computeFpr(laneRuns, date, 7);
  const fpr_30d = computeFpr(laneRuns, date, 30);

  // Cost windows — filter cost records to this lane only (v3 A2, additive).
  const laneCosts = dedupeByRunId((input.costRecords ?? []).filter((c) => c.lane === lane));
  const cost_usd_7d = costSum(laneCosts, date, 7);
  const cost_usd_30d = costSum(laneCosts, date, 30);
  const cost_usd_avg_per_run_30d = costAvgPerRun(laneCosts, date, 30);

  return {
    date,
    lane,
    ts,
    runs,
    surfaces_total,
    surfaces_green,
    surfaces_stale,
    surfaces_overdue,
    open_findings: openFindingsCount,
    coverage_freshness_pct,
    median_staleness_ratio,
    fpr_7d,
    fpr_30d,
    cost_usd_7d,
    cost_usd_30d,
    cost_usd_avg_per_run_30d,
  };
}
