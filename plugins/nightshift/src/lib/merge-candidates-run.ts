// bin/merge-candidates logic (v3 plan §9.16 + §9.15). The K-way review fan-out
// writes .run/<run_id>/surfaces/<sid>/{reviewed,candidates.proposed,candidates}.json;
// this folds those per-surface artifacts into the three run-level files the rest
// of the pipeline (run-meta -> dedupe -> record) consumes.
//
// Two invariants, both of which exist because the fan-out is K independent
// agents that can each die independently:
//
//  1. ALL-OR-NOTHING PER SURFACE (§9.16). A surface dir counts only when all
//     three files are present AND each parses as a JSON array. A reviewer that
//     crashed after writing reviewed.json but before its refuter produced
//     candidates.json would otherwise contribute a claim of coverage with no
//     refuted candidate set: bin/record would stamp last_reviewed/green on a
//     surface nobody finished reviewing. The mirror case is just as bad —
//     merging a dir that has candidates.proposed.json but no candidates.json
//     injects unrefuted candidates into the survivor set, inflating
//     findings_created and corrupting the FPR denominator. A zero-byte,
//     truncated, or non-array artifact is the SAME crash shape one write
//     earlier (a killed writer most often leaves a partial file, not a missing
//     one), so it too makes the dir incomplete — that one surface is skipped
//     and stays stale instead of aborting the other K-1 surfaces' union.
//     Incomplete => the surface contributes NOTHING and is re-selected next run.
//
//  2. CANDIDATE-TO-SURFACE BINDING (§9.15). Every candidate found under
//     surfaces/<sid>/ must carry dedupe_key.surface === sid, and every id in
//     that dir's reviewed.json must equal sid. At K=6 nothing else stops
//     reviewer 3's output from claiming surface 1 and stamping the wrong
//     registry entry — the dir it was written into is the only provenance the
//     engine has. A violation aborts the whole merge (exit 2) rather than
//     dropping the offending element: a misbound candidate means the fan-out
//     wiring is wrong, and a run that silently continues writes durable state
//     from an unknown source.
//
// Every check runs before any output is written, so a REJECTED run leaves the
// run dir byte-identical. (The three closing writes are individually atomic
// but not atomic as a set: a filesystem error mid-sequence can leave a fresh
// reviewed.json beside a stale candidates.json — tolerable only because the
// exit-2 abort stops anything downstream from consuming them.)
//
// LAUNCHER CONTRACT (A7): the run dir must be fresh per attempt. This module
// has no notion of artifact freshness or ownership — completeness is "the
// files parse" — so re-running inside a kept-for-diagnosis run dir from an
// earlier aborted attempt would resurrect that attempt's artifacts as this
// run's coverage. The launcher mints a new run_id (and therefore a new dir)
// for every attempt; bin/record's claim marker refuses re-recorded ids.
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { readJson, writeJson } from "./io.js";
import { isSafeId, SAFE_ID_RE } from "./validate.js";
import { assertNoCaseFoldCollision, assertNotSymlink, containedSurfaceDir } from "./contain.js";

export interface MergeCandidatesOpts {
  runDir: string;
  surfacesPath: string;
}

export interface MergeCandidatesResult {
  /** Surface ids whose dir was complete and was folded in, in surfaces.json order. */
  merged: string[];
  /** Surface ids whose dir was absent or incomplete, in surfaces.json order. */
  skipped: string[];
  reviewedCount: number;
  proposedCount: number;
  survivorsCount: number;
}

interface MinimalSurface {
  id: string;
  [key: string]: unknown;
}

/**
 * dedupe_key.surface for a candidate, or null when it is absent/not a string.
 * Same extraction shape run-meta-build's candidateKey uses; only the surface
 * component matters here because binding is all this module decides. A
 * candidate with no well-formed surface string cannot be bound to the dir it
 * was found in, so it is a hard error rather than a skip.
 */
function candidateSurface(x: unknown): string | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const dk = (x as Record<string, unknown>).dedupe_key;
  if (typeof dk !== "object" || dk === null || Array.isArray(dk)) return null;
  const surface = (dk as Record<string, unknown>).surface;
  return typeof surface === "string" ? surface : null;
}

/**
 * Read a per-surface artifact as a JSON array, or null when it is a CRASH
 * shape: missing, unreadable (EISDIR, permissions), unparseable (zero-byte,
 * truncated mid-write), or not an array. null makes the caller treat the whole
 * dir as incomplete (§9.16 — that surface stays stale) instead of aborting the
 * other K-1 surfaces. A symlink is NOT a crash shape — no writer in this
 * pipeline produces one — so it stays a hard error (see assertNotSymlink).
 */
function readArrayOrIncomplete(path: string): unknown[] | null {
  let data: unknown;
  try {
    data = readJson<unknown>(path);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  return data;
}

export function runMergeCandidates(opts: MergeCandidatesOpts): MergeCandidatesResult {
  // An empty/blank runDir resolves to cwd via node:path's resolve(), which would
  // both neuter the containment check below (everything is "inside" cwd) and
  // write the three run-level artifacts into the repo working tree. Reject
  // before any resolve/read touches the filesystem — same guard as clean-run.ts.
  if (opts.runDir.trim() === "") {
    throw new Error("runDir must not be empty");
  }
  if (!existsSync(opts.surfacesPath)) {
    throw new Error(`surfaces file not found: ${opts.surfacesPath}`);
  }
  const surfaces = readJson<unknown>(opts.surfacesPath);
  if (!Array.isArray(surfaces)) {
    throw new Error(`surfaces.json must be a JSON array: ${opts.surfacesPath}`);
  }

  // --- Identity gate over every sid, BEFORE any dir is touched or written ---
  const runDirResolved = resolve(opts.runDir);
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const seenFolded = new Map<string, string>();
  surfaces.forEach((s, i) => {
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      throw new Error(`surfaces.json [${i}] must be an object with a string id`);
    }
    const id = (s as MinimalSurface).id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`surfaces.json [${i}] id must be a non-empty string`);
    }
    // A duplicate id would let one dir be merged twice (double-counted
    // candidates, a duplicate reviewed id) — and it means select emitted a
    // registry with two entries of the same name, which is a pack bug.
    if (seenIds.has(id)) {
      throw new Error(`surfaces.json [${i}] duplicate surface id: ${id}`);
    }
    seenIds.add(id);
    // Two ids differing only in case are distinct to the engine but ONE
    // directory on a case-insensitive filesystem (darwin/APFS) — the second
    // surface's artifacts would silently read/clobber the first's.
    assertNoCaseFoldCollision(seenFolded, id, `surfaces.json [${i}]`);
    if (!isSafeId(id)) {
      throw new Error(
        `surfaces.json [${i}] unsafe surface id "${id}": must match ${SAFE_ID_RE.source} ` +
          `and not be "." or ".."`,
      );
    }
    // Containment, never the regex alone: the charset check and the resolved
    // path check fail independently, so a gap in either one is not a breach.
    const dir = resolve(opts.runDir, "surfaces", id);
    if (!dir.startsWith(runDirResolved + sep)) {
      throw new Error(`surfaces.json [${i}] surface id escapes the run dir: ${id}`);
    }
    ids.push(id);
  });

  // --- Fold, in surfaces.json order ---
  const merged: string[] = [];
  const skipped: string[] = [];
  const reviewed: string[] = [];
  const reviewedSeen = new Set<string>();
  const proposed: unknown[] = [];
  const survivors: unknown[] = [];

  for (const sid of ids) {
    // Physical containment (lstat + realpath), not just the lexical check
    // above: a symlink at surfaces/ or surfaces/<sid> would pass resolve()
    // while its content lives outside the run dir — the A4 adversarial round
    // used exactly that to stamp a never-reviewed surface green. A symlink is
    // a hard abort, not a skip: no writer in this pipeline creates one, so it
    // is tampering or operator error, never a crash shape.
    const dir = containedSurfaceDir(opts.runDir, sid, `surfaces/${sid}`);
    const reviewedPath = join(dir, "reviewed.json");
    const proposedPath = join(dir, "candidates.proposed.json");
    const survivorsPath = join(dir, "candidates.json");

    // Invariant 1: all three or nothing.
    if (!existsSync(reviewedPath) || !existsSync(proposedPath) || !existsSync(survivorsPath)) {
      skipped.push(sid);
      continue;
    }

    // Same physical rule for the artifact files themselves: readJson follows a
    // file symlink, which would ingest content from outside the run dir.
    assertNotSymlink(reviewedPath, `surfaces/${sid}/reviewed.json`);
    assertNotSymlink(proposedPath, `surfaces/${sid}/candidates.proposed.json`);
    assertNotSymlink(survivorsPath, `surfaces/${sid}/candidates.json`);

    // Crash-shape gate: a file that fails to load as a JSON array marks the
    // whole dir incomplete (skip; surface stays stale). Element-level
    // violations below stay hard errors — a PARSED artifact with a misbound
    // candidate is a wiring/tampering signal, not a died-mid-write signal.
    const reviewedRaw = readArrayOrIncomplete(reviewedPath);
    const proposedRaw = readArrayOrIncomplete(proposedPath);
    const survivorsRaw = readArrayOrIncomplete(survivorsPath);
    if (reviewedRaw === null || proposedRaw === null || survivorsRaw === null) {
      skipped.push(sid);
      continue;
    }

    // Invariant 2a: reviewed.json may only claim its OWN surface. An empty
    // array is legitimate — the reviewer ran but declined to claim coverage, so
    // the surface stays unstamped while its (already refuted) candidates still
    // count toward the run's FPR denominator.
    reviewedRaw.forEach((r, i) => {
      if (typeof r !== "string" || r.length === 0) {
        throw new Error(`surfaces/${sid}/reviewed.json [${i}] must be a non-empty string id`);
      }
      if (r !== sid) {
        throw new Error(
          `surfaces/${sid}/reviewed.json [${i}] claims surface "${r}": a surface dir may ` +
            `only claim its own id "${sid}"`,
        );
      }
      // Unreachable while r === sid holds and each sid is visited once; asserted
      // anyway so a future refactor that relaxes either cannot silently
      // double-stamp a registry entry.
      if (reviewedSeen.has(r)) {
        throw new Error(`reviewed union: duplicate surface id: ${r}`);
      }
      reviewedSeen.add(r);
      reviewed.push(r);
    });

    // Invariant 2b: every candidate on both sides is bound to this dir's sid.
    proposedRaw.forEach((c, i) => {
      const surface = candidateSurface(c);
      if (surface === null) {
        throw new Error(
          `surfaces/${sid}/candidates.proposed.json [${i}] has no well-formed ` +
            `dedupe_key.surface string: it cannot be bound to a surface`,
        );
      }
      if (surface !== sid) {
        throw new Error(
          `surfaces/${sid}/candidates.proposed.json [${i}] dedupe_key.surface "${surface}" ` +
            `does not match its surface dir "${sid}"`,
        );
      }
    });
    survivorsRaw.forEach((c, i) => {
      const surface = candidateSurface(c);
      if (surface === null) {
        throw new Error(
          `surfaces/${sid}/candidates.json [${i}] has no well-formed dedupe_key.surface ` +
            `string: it cannot be bound to a surface`,
        );
      }
      if (surface !== sid) {
        throw new Error(
          `surfaces/${sid}/candidates.json [${i}] dedupe_key.surface "${surface}" does not ` +
            `match its surface dir "${sid}"`,
        );
      }
    });

    proposed.push(...proposedRaw);
    survivors.push(...survivorsRaw);
    merged.push(sid);
  }

  // Empty unions are valid: K surfaces all crashed still yields a well-formed
  // no-op run (run-meta reads three empty arrays, record stamps nothing).
  writeJson(join(opts.runDir, "reviewed.json"), reviewed);
  writeJson(join(opts.runDir, "candidates.proposed.json"), proposed);
  writeJson(join(opts.runDir, "candidates.json"), survivors);

  return {
    merged,
    skipped,
    reviewedCount: reviewed.length,
    proposedCount: proposed.length,
    survivorsCount: survivors.length,
  };
}
