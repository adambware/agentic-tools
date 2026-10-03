// gstack review logs: ~/.gstack/projects/<repo>/*-reviews.jsonl, one JSON record per line.
// Read-only, and only `skill: "review"` records: they alone carry the review army's per-lens
// `specialists` block and the per-finding `findings[]` list ({fingerprint, severity, action}).
//
// Rules (mirroring the transcript parser's):
//   1. Only lens names, counts, severities and actions are read; finding text never is.
//   2. Malformed input is counted in the lens parse counters, never fatal.
//   3. An identical line seen twice (a copied log) counts once.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { emptyCounters, type ParseCounters } from "./session.js";
import { parseIso } from "./time.js";

/** gstack's review-army lenses. A finding whose fingerprint category is not one of these is
 * counted in `other` (categories like "stale-comment" name a defect, not the lens that found it). */
export const KNOWN_LENSES = new Set([
  "api-contract",
  "data-migration",
  "design",
  "maintainability",
  "performance",
  "red-team",
  "security",
  "simplification",
  "testing",
]);

/** Every action seen in real logs. fixed/auto-fixed/skipped get their own counter. */
const OTHER_ACTIONS = new Set(["deferred", "unresolved", "pending", "asked"]);

const LENS_NAME = /^[a-z0-9][a-z0-9-]*$/;

type Rec = Record<string, unknown>;

export interface SpecialistStats {
  lens: string;
  dispatched: boolean;
  reported: number;
  reportedCritical: number;
}

export type Action = "fixed" | "auto-fixed" | "skipped" | "other";

export interface FindingStats {
  /** A known lens, or null when the category is not a lens or there is no fingerprint. */
  lens: string | null;
  action: Action;
  critical: boolean;
}

export interface ReviewStats {
  ts: number;
  /** null when the record has no specialists block (an empty block is []). */
  specialists: SpecialistStats[] | null;
  /** null when the record has no findings list (old logs store a count instead). */
  findings: FindingStats[] | null;
}

export type ParsedReview = { ok: true; review: ReviewStats; badRecords: number } | { ok: false; badRecords: number };

/** "red_team", " Red-Team " -> "red-team". */
export function normalizeLens(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, "-");
}

/** A non-negative safe integer, or undefined. */
function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

/**
 * Parse one review record. `ok: false` for a record that is not a review, or a review with no
 * valid timestamp (counted: it cannot be put in a window).
 */
export function parseReview(rec: Rec): ParsedReview {
  if (rec.skill !== "review") return { ok: false, badRecords: 0 };
  const ts = typeof rec.timestamp === "string" ? parseIso(rec.timestamp) : undefined;
  if (ts === undefined) return { ok: false, badRecords: 1 };

  let badRecords = 0;
  let specialists: SpecialistStats[] | null = null;
  const sp = rec.specialists;
  if (Array.isArray(sp) && sp.length === 0) {
    // Some gstack versions write an empty array where the army dispatched nothing.
    specialists = [];
  } else if (sp !== undefined && sp !== null) {
    if (typeof sp !== "object" || Array.isArray(sp)) {
      badRecords++;
    } else {
      specialists = [];
      for (const [key, value] of Object.entries(sp as Rec)) {
        const lens = normalizeLens(key);
        if (!LENS_NAME.test(lens) || value === null || typeof value !== "object" || Array.isArray(value)) {
          badRecords++;
          continue;
        }
        const v = value as Rec;
        if (typeof v.dispatched !== "boolean") {
          badRecords++;
          continue;
        }
        let reported = 0;
        let reportedCritical = 0;
        if (v.dispatched) {
          // `findings` is on every dispatched lens in real logs; a few old ones lack `critical`.
          const f = count(v.findings);
          if (f === undefined) badRecords++;
          reported = f ?? 0;
          const c = v.critical === undefined ? 0 : count(v.critical);
          if (c === undefined) badRecords++;
          reportedCritical = c ?? 0;
        }
        specialists.push({ lens, dispatched: v.dispatched, reported, reportedCritical });
      }
    }
  }

  let findings: FindingStats[] | null = null;
  if (Array.isArray(rec.findings)) {
    findings = [];
    for (const entry of rec.findings) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        badRecords++;
        continue;
      }
      const f = entry as Rec;
      let action: Action = "other";
      if (f.action === "fixed" || f.action === "auto-fixed" || f.action === "skipped") action = f.action;
      else if (!OTHER_ACTIONS.has(f.action as string)) badRecords++; // a renamed or missing action
      const sev = typeof f.severity === "string" ? f.severity.trim().toUpperCase() : "";
      let lens: string | null = null;
      if (typeof f.fingerprint === "string") {
        const category = normalizeLens(f.fingerprint.slice(f.fingerprint.lastIndexOf(":") + 1));
        if (KNOWN_LENSES.has(category)) lens = category;
      }
      findings.push({ lens, action, critical: sev === "CRITICAL" || sev === "P1" });
    }
  }
  return { ok: true, review: { ts, specialists, findings }, badRecords };
}

export interface LensCollection {
  reviews: ReviewStats[];
  parse: ParseCounters;
}

/**
 * Every review in <gstackDir>/<repo>/*-reviews.jsonl modified at or after sinceMs. Throws when
 * gstackDir itself is unreadable; the caller decides whether that is fatal.
 */
export function collectReviews(gstackDir: string, sinceMs: number): LensCollection {
  const parse = emptyCounters();
  const reviews: ReviewStats[] = [];
  const seen = new Set<string>();
  const repos = readdirSync(gstackDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const repo of repos) {
    let names: string[];
    try {
      names = readdirSync(join(gstackDir, repo)).sort();
    } catch {
      parse.bad_files++;
      continue;
    }
    for (const name of names) {
      if (!name.endsWith("-reviews.jsonl")) continue;
      const path = join(gstackDir, repo, name);
      let text: string;
      try {
        const st = statSync(path);
        if (!st.isFile() || st.mtimeMs < sinceMs) continue;
        text = readFileSync(path, "utf8");
      } catch {
        parse.bad_files++;
        continue;
      }
      // Split on "\n" only: U+2028/U+2029 are legal inside JSON strings.
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line === "") continue;
        let rec: unknown;
        try {
          rec = JSON.parse(line);
        } catch {
          parse.bad_lines++;
          continue;
        }
        if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
          parse.bad_lines++;
          continue;
        }
        if (seen.has(line)) {
          parse.dup_records++;
          continue;
        }
        seen.add(line);
        const parsed = parseReview(rec as Rec);
        parse.bad_records += parsed.badRecords;
        if (parsed.ok) reviews.push(parsed.review);
      }
    }
  }
  return { reviews, parse };
}
