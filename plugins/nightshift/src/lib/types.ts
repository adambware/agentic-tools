// Canonical record shapes for the nightshift deterministic core.
// Field names are load-bearing — they match schemas/*.yml and the pack's
// .nightshift/ registries + metrics. Do NOT rename without updating the schemas.

export type Lane = "security" | "design";
export type Weight = "critical" | "high" | "medium" | "low";
export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "low" | "medium" | "high";
export type Band = "low" | "medium" | "high" | "critical";
export type Anchor =
  | "friction_delta"
  | "broken_path"
  | "a11y"
  | "evidence"
  | "consistency";

// schemas/registry-entry.yml — one unit of coverage (a vector or a flow).
export interface RegistryEntry {
  id: string;
  title: string;
  kind: "vector" | "flow";
  area: string[];
  weight: Weight;
  interval_days: number;
  owner: Lane;
  asvs_ref?: string;
  persona?: string;
  core?: boolean;
  last_reviewed?: string; // YYYY-MM-DD, (auto)
  status?: "green" | "stale" | "overdue" | "open-findings";
  linear?: string[];
}

// Output of bin/select -> surfaces.json. One per selected entry.
export interface Surface {
  id: string;
  title: string;
  weight: Weight;
  area: string[];
  staleness: number; // (today - last_reviewed) / interval_days; Infinity if never reviewed
  change_flag: 0 | 1;
  score: number; // max(staleness, change_flag) * weight_multiplier
  band: Band; // compute-allocation key for the fan-out budget table
  asvs_ref?: string;
  persona?: string;
}

// schemas/finding.yml — dedupe spine.
export interface DedupeKey {
  surface: string;
  symptom: string;
  root_cause: string;
}

// A model-written candidate finding (judgment-agent artifact, E3). Validated by
// bin/validate before it may enter the stateful path (dedupe/record).
export interface CandidateFinding {
  dedupe_key: DedupeKey;
  severity: Severity;
  confidence: Confidence;
  needs_human_verification: boolean;
  // security write-up
  asvs_ref?: string;
  location?: string;
  why_abusable_under_preconditions?: string;
  preconditions?: Record<string, unknown>;
  // ux
  anchor?: Anchor;
  screen?: string;
  evidence?: string;
  measured?: string;
}

// A confirmed, logged finding (candidate + engine-managed lifecycle).
export interface Finding extends CandidateFinding {
  first_seen: string;
  last_seen: string;
  resolved_at?: string;
  run_id: string;
  linear?: string[];
}

// schemas/finding.yml suppression sub-schema.
export interface Suppression {
  dedupe_key: DedupeKey;
  reason: string;
  expires: string; // YYYY-MM-DD
  approved_by: string;
}

// schemas/run-metrics.yml — one per run.
export interface RunMetrics {
  run_id: string;
  ts: string;
  date: string;
  lane: Lane;
  pack_sha: string;
  selected: number;
  reviewed: number;
  findings_created: number;
  confirmed: number;
  rejected_tier1: number;
  rejected_tier2: number;
  suppressed: number;
  usage_by_model: Record<string, number | string>;
  usage_spent: number | string;
  elapsed: number | string;
}

// schemas/daily-metrics.yml — one rollup per (date, lane).
export interface DailyMetrics {
  date: string;
  lane: Lane;
  ts: string;
  runs: number;
  surfaces_total: number;
  surfaces_green: number;
  surfaces_stale: number;
  surfaces_overdue: number;
  open_findings: number;
  coverage_freshness_pct: number;
  median_staleness_ratio: number;
  fpr_7d: number | null;
  fpr_30d: number | null;
}

// Monotonic weight multiplier: weight breaks ties and amplifies priority.
// (run-loop.md step 2 — critical > high > medium > low.)
export const WEIGHT_MULTIPLIER: Record<Weight, number> = {
  critical: 8,
  high: 4,
  medium: 2,
  low: 1,
};

// interval_days derived from weight (registry-entry.yml / run-loop.md step 1).
export const DEFAULT_INTERVAL_DAYS: Record<Weight, number> = {
  critical: 7,
  high: 14,
  medium: 30,
  low: 90,
};
