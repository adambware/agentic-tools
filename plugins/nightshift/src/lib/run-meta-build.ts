// Pure logic for bin/run-meta: assemble the run.json (RunMeta) object from inputs.
// No process.argv; no process.exit. Fully testable (E7 full-branch coverage).
// The CLI shell (src/bin/run-meta.ts) only parses args and calls this.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Lane, RunMeta } from "./types.js";
import { readJson, writeJson } from "./io.js";
import { resolveToday } from "./args.js";
import { dedupeKeyString } from "./dedupekey.js";

// Re-export the canonical type so callers can import from this module as before.
export type { RunMeta };

// Minimal shape run-meta needs from each surface — only the id is read here.
// Named distinctly so it does not shadow the canonical `Surface` in types.ts
// (which carries the full schema'd shape consumed by select/validate/staleness).
export interface MinimalSurface {
  id: string;
  [key: string]: unknown;
}

export interface RunMetaBuildOpts {
  surfacesPath: string;
  proposedPath: string;
  survivorsPath: string;
  /** reviewed.json — the surface ids the review phase ACTUALLY covered. */
  reviewedPath: string;
  runId: string;
  lane: Lane;
  packDir: string;
  outPath: string;
  /** Injectable for tests: NIGHTSHIFT_TODAY / --today resolution. Pass args dict or {} */
  args: Record<string, string>;
  /** Injectable for tests: override the full ISO-8601 timestamp string. */
  nowTs?: string;
  /** Injectable for tests: override pack_sha derivation. */
  gitRevParse?: (packDir: string) => string;
}

export interface RunMetaBuildResult {
  meta: RunMeta;
}

/**
 * Canonical dedupe_key string for a candidate, or null if it lacks a
 * well-formed `dedupe_key {surface, symptom, root_cause}` (all strings).
 * Identity here is the SAME canonicalization bin/dedupe uses (dedupeKeyString):
 * strict equality on the string triple.
 */
function candidateKey(x: unknown): string | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const dk = (x as Record<string, unknown>).dedupe_key;
  if (typeof dk !== "object" || dk === null || Array.isArray(dk)) return null;
  const { surface, symptom, root_cause } = dk as Record<string, unknown>;
  if (typeof surface !== "string" || typeof symptom !== "string" || typeof root_cause !== "string")
    return null;
  return dedupeKeyString({ surface, symptom, root_cause });
}

/** Default git rev-parse runner. Falls back to 'no-git' on any error. */
export function defaultGitRevParse(packDir: string): string {
  try {
    return execFileSync("git", ["-C", packDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "no-git";
  }
}

export function buildRunMeta(opts: RunMetaBuildOpts): RunMetaBuildResult {
  // --- Validate inputs ---
  // A blank run_id (e.g. `--run-id "$(cat run-id.txt)"` when the file is empty
  // or absent on a resume) must abort: requireArg only rejects an undefined
  // flag, so an empty string would otherwise propagate into the durable runs
  // record and break the join between findings and their originating run.
  if (!opts.runId || !opts.runId.trim()) {
    throw new Error("run_id is required (got empty/blank)");
  }
  if (!existsSync(opts.surfacesPath)) {
    throw new Error(`surfaces file not found: ${opts.surfacesPath}`);
  }
  if (!existsSync(opts.proposedPath)) {
    throw new Error(`proposed candidates file not found: ${opts.proposedPath}`);
  }
  if (!existsSync(opts.survivorsPath)) {
    throw new Error(`survivors file not found: ${opts.survivorsPath}`);
  }
  if (!existsSync(opts.reviewedPath)) {
    throw new Error(`reviewed file not found: ${opts.reviewedPath}`);
  }

  // --- Read surfaces.json ---
  const surfaces = readJson<MinimalSurface[]>(opts.surfacesPath);
  if (!Array.isArray(surfaces)) {
    throw new Error(`surfaces.json must be a JSON array: ${opts.surfacesPath}`);
  }

  // --- Read candidates files ---
  const proposed = readJson<unknown[]>(opts.proposedPath);
  if (!Array.isArray(proposed)) {
    throw new Error(`candidates.proposed.json must be a JSON array: ${opts.proposedPath}`);
  }
  const survivors = readJson<unknown[]>(opts.survivorsPath);
  if (!Array.isArray(survivors)) {
    throw new Error(`candidates.json must be a JSON array: ${opts.survivorsPath}`);
  }

  // The Tier-1 refuter may only SHRINK the candidate set (survivors ⊆ proposed).
  // If survivors exceed proposed, rejected_tier1 would go negative and corrupt
  // the FPR denominator (findings_created in bin/record derives from it), and
  // the extra survivors would be durably logged as phantom findings. Fail loud
  // here — exit 2 aborts the run before any stateful write.
  if (survivors.length > proposed.length) {
    throw new Error(
      `survivors (${survivors.length}) exceed proposed candidates (${proposed.length}): ` +
        `the Tier-1 refuter must only remove candidates, never add them`,
    );
  }

  // Identity, not just count: every survivor must BE one of the proposed
  // candidates, matched by canonical dedupe_key — multiset semantics, so a
  // duplicated survivor key cannot outnumber its proposed occurrences. The
  // length guard alone would let a buggy/hostile refuter SUBSTITUTE different
  // same-count findings: they'd pass schema validation, get durably logged,
  // and keep rejected_tier1 (the FPR denominator) falsely low. Malformed
  // proposed entries contribute no key here; bin/validate rejects them before
  // any durable write, so being lenient on that side changes nothing.
  const proposedKeys = new Map<string, number>();
  for (const c of proposed) {
    const k = candidateKey(c);
    if (k !== null) proposedKeys.set(k, (proposedKeys.get(k) ?? 0) + 1);
  }
  survivors.forEach((s, i) => {
    const k = candidateKey(s);
    if (k === null) {
      throw new Error(
        `survivor [${i}] has no well-formed dedupe_key {surface, symptom, root_cause}`,
      );
    }
    const remaining = proposedKeys.get(k) ?? 0;
    if (remaining === 0) {
      throw new Error(
        `survivor [${i}] dedupe_key ${k} does not match any proposed candidate: ` +
          `the Tier-1 refuter must only remove candidates, never substitute them`,
      );
    }
    proposedKeys.set(k, remaining - 1);
  });

  // --- Derive counts ---
  const proposed_count = proposed.length;
  const survivors_count = survivors.length;
  const rejected_tier1 = proposed_count - survivors_count;
  const rejected_tier2 = 0; // Tier-2 not wired in current scope
  // findings_created is NOT computed here: run-meta runs before dedupe and
  // therefore cannot know how many survivors will be suppressed vs
  // confirmed/recurring. bin/record derives it from its own counts.

  // --- reviewed_ids from reviewed.json (surfaces ACTUALLY reviewed) ---
  // Never assume all-selected: bin/record stamps last_reviewed/status=green for
  // every id listed here, so listing an unreviewed surface silently corrupts
  // registry freshness. The review phase writes the ids it actually covered;
  // a selected-but-unreviewed surface stays stale and is re-selected next run.
  // reviewed.json is model-written, so it is gated here: every id must be a
  // unique member of the selected surfaces.
  const reviewedRaw = readJson<unknown[]>(opts.reviewedPath);
  if (!Array.isArray(reviewedRaw)) {
    throw new Error(`reviewed.json must be a JSON array of surface ids: ${opts.reviewedPath}`);
  }
  const surfaceIds = new Set(surfaces.map((s) => s.id));
  const reviewed_ids: string[] = [];
  const seenReviewed = new Set<string>();
  reviewedRaw.forEach((r, i) => {
    if (typeof r !== "string" || r.length === 0) {
      throw new Error(`reviewed.json [${i}] must be a non-empty string surface id`);
    }
    if (seenReviewed.has(r)) {
      throw new Error(`reviewed.json [${i}] duplicate surface id: ${r}`);
    }
    if (!surfaceIds.has(r)) {
      throw new Error(`reviewed.json [${i}] id not among the selected surfaces: ${r}`);
    }
    seenReviewed.add(r);
    reviewed_ids.push(r);
  });
  const reviewed = reviewed_ids.length;
  const selected = surfaces.length;

  // --- Timestamps ---
  const ts = opts.nowTs ?? new Date().toISOString();
  const date = resolveToday(opts.args);

  // --- pack_sha ---
  const gitRevParse = opts.gitRevParse ?? defaultGitRevParse;
  const pack_sha = gitRevParse(opts.packDir);

  const meta: RunMeta = {
    run_id: opts.runId,
    lane: opts.lane,
    date,
    ts,
    pack_sha,
    selected,
    reviewed,
    rejected_tier1,
    rejected_tier2,
    reviewed_ids,
    usage_by_model: {},
    usage_spent: 0,
    elapsed: 0,
  };

  writeJson(opts.outPath, meta);

  return { meta };
}
