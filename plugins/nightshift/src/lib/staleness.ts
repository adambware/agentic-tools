// Pure selection math (run-loop.md steps 1–2). No I/O, no git — every branch is
// unit-testable. `today` is injected so staleness is deterministic under test.
import type { RegistryEntry, Surface, Weight, Band } from "./types.js";
import { WEIGHT_MULTIPLIER, DEFAULT_INTERVAL_DAYS } from "./types.js";
import { anyGlobMatch } from "./glob.js";

// Never-reviewed entries are "maximally stale". A large FINITE sentinel (not
// Infinity) so it sorts to the top yet still round-trips through JSON.
export const MAX_STALENESS = 1e9;

/** Whole days from `from` to `to` (both YYYY-MM-DD), can be negative. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** interval_days from the entry, falling back to the weight-derived default. */
export function intervalDays(entry: RegistryEntry): number {
  const n = entry.interval_days;
  if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
  return DEFAULT_INTERVAL_DAYS[entry.weight];
}

/** staleness = (today - last_reviewed) / interval_days; MAX_STALENESS if unset. */
export function computeStaleness(entry: RegistryEntry, today: string): number {
  if (!entry.last_reviewed) return MAX_STALENESS;
  const elapsed = daysBetween(entry.last_reviewed, today);
  return elapsed / intervalDays(entry);
}

/** Fan-out compute band: weight, upgraded to `critical` for changed crit/high entries. */
export function computeBand(weight: Weight, changeFlag: 0 | 1): Band {
  if (changeFlag === 1 && (weight === "critical" || weight === "high")) return "critical";
  return weight as Band;
}

/** score = max(staleness, change_flag) * weight_multiplier (run-loop.md step 2). */
export function computeScore(staleness: number, changeFlag: 0 | 1, weight: Weight): number {
  return Math.max(staleness, changeFlag) * WEIGHT_MULTIPLIER[weight];
}

export interface SelectOpts {
  today: string;
  k: number;
  /** Changed files for an entry since its last_reviewed. Default: none (no-git). */
  changedFilesFor?: (entry: RegistryEntry) => string[];
}

/**
 * Sort entries by score desc (weight breaks ties, then id for total order) and
 * return the top-K as Surface records. K<=0 -> []; K>size -> all.
 */
export function selectSurfaces(entries: RegistryEntry[], opts: SelectOpts): Surface[] {
  const changedFilesFor = opts.changedFilesFor ?? (() => []);
  const surfaces: Surface[] = entries.map((entry) => {
    const staleness = computeStaleness(entry, opts.today);
    const changed = changedFilesFor(entry);
    const change_flag: 0 | 1 = anyGlobMatch(entry.area, changed) ? 1 : 0;
    const score = computeScore(staleness, change_flag, entry.weight);
    return {
      id: entry.id,
      title: entry.title,
      weight: entry.weight,
      area: entry.area,
      staleness,
      change_flag,
      score,
      band: computeBand(entry.weight, change_flag),
      ...(entry.asvs_ref ? { asvs_ref: entry.asvs_ref } : {}),
      ...(entry.persona ? { persona: entry.persona } : {}),
    };
  });

  surfaces.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const wm = WEIGHT_MULTIPLIER[b.weight] - WEIGHT_MULTIPLIER[a.weight];
    if (wm !== 0) return wm;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  if (opts.k <= 0) return [];
  return surfaces.slice(0, opts.k);
}
