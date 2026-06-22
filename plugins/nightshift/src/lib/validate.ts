// Runtime validators — the deterministic gate (E2/E3). Each validator mirrors a
// schema in schemas/*.yml; that YAML stays the human reference, these are the
// machine check that gates every artifact before it enters the stateful path.
// bin/validate is a thin CLI over `validateArtifact`.
import type {
  RegistryEntry,
  CandidateFinding,
  Finding,
  Suppression,
  RunMetrics,
  DailyMetrics,
  Surface,
} from "./types.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const WEIGHTS = ["critical", "high", "medium", "low"];
const SEVERITIES = WEIGHTS;
const CONFIDENCES = ["low", "medium", "high"];
const LANES = ["security", "design"];
const ANCHORS = ["friction_delta", "broken_path", "a11y", "evidence", "consistency"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Obj = Record<string, unknown>;

function v(): { errors: string[]; out: ValidationResult } {
  const errors: string[] = [];
  return { errors, out: { ok: true, errors } };
}

function isObj(x: unknown): x is Obj {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function reqStr(o: Obj, k: string, errors: string[], where: string): void {
  if (typeof o[k] !== "string" || (o[k] as string).length === 0)
    errors.push(`${where}: ${k} must be a non-empty string`);
}
function reqEnum(o: Obj, k: string, allowed: string[], errors: string[], where: string): void {
  if (typeof o[k] !== "string" || !allowed.includes(o[k] as string))
    errors.push(`${where}: ${k} must be one of ${allowed.join("|")}`);
}
function reqBool(o: Obj, k: string, errors: string[], where: string): void {
  if (typeof o[k] !== "boolean") errors.push(`${where}: ${k} must be a boolean`);
}
function reqNum(o: Obj, k: string, errors: string[], where: string): void {
  if (typeof o[k] !== "number" || !Number.isFinite(o[k]))
    errors.push(`${where}: ${k} must be a finite number`);
}
function reqDate(o: Obj, k: string, errors: string[], where: string): void {
  if (typeof o[k] !== "string" || !DATE_RE.test(o[k] as string))
    errors.push(`${where}: ${k} must be a YYYY-MM-DD date`);
}
function reqDedupeKey(o: Obj, errors: string[], where: string): void {
  const dk = o.dedupe_key;
  if (!isObj(dk)) {
    errors.push(`${where}: dedupe_key must be an object {surface,symptom,root_cause}`);
    return;
  }
  reqStr(dk, "surface", errors, `${where}.dedupe_key`);
  reqStr(dk, "symptom", errors, `${where}.dedupe_key`);
  reqStr(dk, "root_cause", errors, `${where}.dedupe_key`);
}

function finish(errors: string[]): ValidationResult {
  return { ok: errors.length === 0, errors };
}

export function validateRegistryEntry(x: unknown): ValidationResult {
  const { errors } = v();
  if (!isObj(x)) return finish(["registry-entry: not an object"]);
  reqStr(x, "id", errors, "registry-entry");
  reqStr(x, "title", errors, "registry-entry");
  reqEnum(x, "kind", ["vector", "flow"], errors, "registry-entry");
  if (!Array.isArray(x.area) || x.area.length === 0 || !x.area.every((a) => typeof a === "string"))
    errors.push("registry-entry: area must be a non-empty string[]");
  reqEnum(x, "weight", WEIGHTS, errors, "registry-entry");
  reqNum(x, "interval_days", errors, "registry-entry");
  reqEnum(x, "owner", LANES, errors, "registry-entry");
  if (x.last_reviewed !== undefined) reqDate(x, "last_reviewed", errors, "registry-entry");
  return finish(errors);
}

export function validateCandidateFinding(x: unknown): ValidationResult {
  const { errors } = v();
  if (!isObj(x)) return finish(["finding: not an object"]);
  reqDedupeKey(x, errors, "finding");
  reqEnum(x, "severity", SEVERITIES, errors, "finding");
  reqEnum(x, "confidence", CONFIDENCES, errors, "finding");
  reqBool(x, "needs_human_verification", errors, "finding");
  // critical/high MUST need human verification (assurance, not a pentest).
  if ((x.severity === "critical" || x.severity === "high") && x.needs_human_verification !== true)
    errors.push("finding: critical/high requires needs_human_verification=true");
  // UX findings require an anchor; security findings require the write-up fields.
  if (x.anchor !== undefined) reqEnum(x, "anchor", ANCHORS, errors, "finding");
  return finish(errors);
}

export function validateFinding(x: unknown): ValidationResult {
  const base = validateCandidateFinding(x);
  const errors = [...base.errors];
  if (isObj(x)) {
    reqDate(x, "first_seen", errors, "finding");
    reqDate(x, "last_seen", errors, "finding");
    reqStr(x, "run_id", errors, "finding");
    if (x.resolved_at !== undefined) reqDate(x, "resolved_at", errors, "finding");
  }
  return finish(errors);
}

export function validateSuppression(x: unknown): ValidationResult {
  const { errors } = v();
  if (!isObj(x)) return finish(["suppression: not an object"]);
  reqDedupeKey(x, errors, "suppression");
  reqStr(x, "reason", errors, "suppression");
  reqDate(x, "expires", errors, "suppression");
  reqStr(x, "approved_by", errors, "suppression");
  return finish(errors);
}

export function validateRunMetrics(x: unknown): ValidationResult {
  const { errors } = v();
  if (!isObj(x)) return finish(["run-metrics: not an object"]);
  reqStr(x, "run_id", errors, "run-metrics");
  reqStr(x, "ts", errors, "run-metrics");
  reqDate(x, "date", errors, "run-metrics");
  reqEnum(x, "lane", LANES, errors, "run-metrics");
  reqStr(x, "pack_sha", errors, "run-metrics");
  for (const k of [
    "selected",
    "reviewed",
    "findings_created",
    "confirmed",
    "rejected_tier1",
    "rejected_tier2",
    "suppressed",
  ])
    reqNum(x, k, errors, "run-metrics");
  if (!isObj(x.usage_by_model)) errors.push("run-metrics: usage_by_model must be an object");
  return finish(errors);
}

export function validateDailyMetrics(x: unknown): ValidationResult {
  const { errors } = v();
  if (!isObj(x)) return finish(["daily-metrics: not an object"]);
  reqDate(x, "date", errors, "daily-metrics");
  reqEnum(x, "lane", LANES, errors, "daily-metrics");
  reqStr(x, "ts", errors, "daily-metrics");
  for (const k of [
    "runs",
    "surfaces_total",
    "surfaces_green",
    "surfaces_stale",
    "surfaces_overdue",
    "open_findings",
    "coverage_freshness_pct",
    "median_staleness_ratio",
  ])
    reqNum(x, k, errors, "daily-metrics");
  for (const k of ["fpr_7d", "fpr_30d"])
    if (x[k] !== null && typeof x[k] !== "number")
      errors.push(`daily-metrics: ${k} must be a number or null`);
  return finish(errors);
}

export function validateSurface(x: unknown): ValidationResult {
  const { errors } = v();
  if (!isObj(x)) return finish(["surface: not an object"]);
  reqStr(x, "id", errors, "surface");
  reqEnum(x, "weight", WEIGHTS, errors, "surface");
  reqNum(x, "staleness", errors, "surface");
  reqNum(x, "score", errors, "surface");
  if (x.change_flag !== 0 && x.change_flag !== 1)
    errors.push("surface: change_flag must be 0 or 1");
  return finish(errors);
}

export type SchemaName =
  | "registry-entry"
  | "candidate-finding"
  | "finding"
  | "suppression"
  | "run-metrics"
  | "daily-metrics"
  | "surface";

const VALIDATORS: Record<SchemaName, (x: unknown) => ValidationResult> = {
  "registry-entry": validateRegistryEntry,
  "candidate-finding": validateCandidateFinding,
  finding: validateFinding,
  suppression: validateSuppression,
  "run-metrics": validateRunMetrics,
  "daily-metrics": validateDailyMetrics,
  surface: validateSurface,
};

/**
 * Validate a parsed artifact against a named schema. If the artifact is an array,
 * every element is validated and errors are aggregated (index-prefixed).
 */
export function validateArtifact(schema: SchemaName, data: unknown): ValidationResult {
  const fn = VALIDATORS[schema];
  if (!fn) return { ok: false, errors: [`unknown schema: ${schema}`] };
  if (Array.isArray(data)) {
    const errors: string[] = [];
    data.forEach((item, i) => {
      const r = fn(item);
      if (!r.ok) errors.push(...r.errors.map((e) => `[${i}] ${e}`));
    });
    return finish(errors);
  }
  return fn(data);
}

export const SCHEMA_NAMES = Object.keys(VALIDATORS) as SchemaName[];
