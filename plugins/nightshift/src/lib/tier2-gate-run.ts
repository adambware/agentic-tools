// Tier-2 is the CONDITIONAL deeper refute pass: after Tier-1 has thinned the
// proposed candidates, only the most consequential survivors are worth a second,
// more expensive refuter. Which survivors those are is a deterministic predicate
// and it lives HERE — never in the workflow sandbox (E4, which owns no decision
// logic) and never in a model prompt (a prompt-chosen gate is unauditable and
// silently drifts the FPR denominator run over run).
//
// Two phases, two files' worth of state:
//   gate     — split Tier-1 survivors into gated (needs Tier-2) vs pass-through.
//   assemble — fold the Tier-2 refuter's per-surface output back into one set.
//
// Data/control split (E2, files-not-text): tier2.json carries ONLY surface ids,
// so the gated set may ride the workflow's structured-output channel; the actual
// finding payloads stay on disk under surfaces/<sid>/, never in agent text.
//
// Both phases fail loud (the CLI maps a throw to exit 2, aborting the run before
// run-meta stamps anything durable). A half-assembled Tier-2 set would understate
// rejected_tier2 and corrupt the FPR denominator permanently.
//
// Assemble TRUSTS NOTHING it did not recompute: the gate split (pass set,
// gated surfaces, pending sets) is re-derived from candidates.json — the same
// input the gate consumed — and tier2.json is only CROSS-CHECKED against that
// recomputation. The A4 adversarial round showed why: an agent with Write that
// shrinks tier2.json between gate and assemble would otherwise silently delete
// a gated critical survivor while its surface still got stamped green. With
// recomputation, tampering with tier2.json, tier2.pass.json, or a
// tier2.pending.json aborts; the only remaining spoofable input is
// candidates.json itself, which is the documented cross-stage integrity
// limitation (CONTRACTS.md E3) shared with the Tier-1 accounting.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./io.js";
import { dedupeKeyString } from "./dedupekey.js";
import { isSafeId } from "./validate.js";
import { assertNoCaseFoldCollision, assertNotSymlink, containedSurfaceDir } from "./contain.js";

// Surface ids reach this module from model-written candidate files and from
// tier2.json, and every one of them becomes a path component. The shared
// isSafeId rule (SAFE_ID_RE plus "."/"..") is the single definition of a usable
// id; this only widens its input type, since the callers hold `unknown`.
function isSafeSurfaceId(id: unknown): id is string {
  return typeof id === "string" && isSafeId(id);
}

export interface Tier2GateOpts {
  runDir: string;
  /** Defaults to <runDir>/candidates.json (bin/merge-candidates' Tier-1 output). */
  survivorsPath?: string;
}

export interface Tier2GateResult {
  /** Sorted unique surface ids that have at least one gated candidate. */
  gatedSurfaces: string[];
  gatedCount: number;
  passCount: number;
}

export interface Tier2AssembleOpts {
  runDir: string;
  /** Defaults to <runDir>/candidates.json — MUST be the same file the gate consumed. */
  survivorsPath?: string;
}

export interface Tier2AssembleResult {
  /** Total Tier-2 survivors across all gated surfaces. */
  survivors: number;
  /** Pass-through candidates that never entered Tier-2. */
  pass: number;
  /** pending - survivors. Informational: run-meta recomputes authoritatively. */
  rejectedTier2: number;
}

/**
 * The Tier-2 gate predicate. A candidate is gated iff it is consequential
 * (severity critical/high — a false negative here is the expensive kind) OR
 * shaky (confidence low — the cheapest place to refute a guess). Union, not
 * intersection: either property alone earns the second pass.
 *
 * Throws when severity/confidence are not strings: an unclassifiable candidate
 * cannot be gated one way or the other, and silently defaulting it to "pass"
 * would route a possibly-critical finding around Tier-2 entirely. bin/validate
 * runs later in the chain, so this gate self-defends rather than assuming it.
 */
export function needsTier2(c: unknown, where = "candidate"): boolean {
  if (typeof c !== "object" || c === null || Array.isArray(c)) {
    throw new Error(`${where}: must be an object with severity and confidence`);
  }
  const { severity, confidence } = c as Record<string, unknown>;
  if (typeof severity !== "string") {
    throw new Error(`${where}: severity must be a string (cannot classify for Tier-2)`);
  }
  if (typeof confidence !== "string") {
    throw new Error(`${where}: confidence must be a string (cannot classify for Tier-2)`);
  }
  return severity === "critical" || severity === "high" || confidence === "low";
}

/**
 * Canonical dedupe_key string for a candidate, or null when it lacks a
 * well-formed `dedupe_key {surface, symptom, root_cause}` (all strings).
 * Identity is the SAME canonicalization run-meta-build's `candidateKey` and
 * bin/dedupe use — the Tier-2 subset check must not invent a second notion of
 * "the same finding" or the two accountings would disagree.
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

/** `dedupe_key.surface` of a candidate, or undefined if absent/not a string. */
function surfaceOf(x: unknown): string | undefined {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
  const dk = (x as Record<string, unknown>).dedupe_key;
  if (typeof dk !== "object" || dk === null || Array.isArray(dk)) return undefined;
  const s = (dk as Record<string, unknown>).surface;
  return typeof s === "string" ? s : undefined;
}

/**
 * Directory for one surface's Tier-2 state, with containment enforced.
 * Defense in depth: the id already passed isSafeId, but a path check is what
 * actually stops a write outside the run dir, so it is never skipped. The
 * check is PHYSICAL (lstat + realpath via containedSurfaceDir), not just
 * lexical: resolve() alone let a symlinked surfaces/<sid> route the
 * tier2.pending.json write outside the run dir in the A4 adversarial round.
 */
function surfaceDir(runDir: string, sid: string, where: string): string {
  if (!isSafeSurfaceId(sid)) {
    throw new Error(`${where}: unsafe surface id: ${JSON.stringify(sid)}`);
  }
  return containedSurfaceDir(runDir, sid, where);
}

/**
 * The gate split, computed from the Tier-1 survivor set. Used by BOTH phases:
 * the gate to produce its artifacts, and assemble to recompute the split it
 * refuses to take on trust (see module header). Deterministic by construction
 * — same input file, same predicate, same ordering — so a mismatch between a
 * stored artifact and this recomputation is always tampering or a crashed
 * gate, never drift.
 */
function splitSurvivors(
  runDir: string,
  survivorsPath: string,
): { pass: unknown[]; gatedBySurface: Map<string, unknown[]>; gatedSurfaces: string[]; gatedCount: number } {
  if (!existsSync(survivorsPath)) {
    throw new Error(`survivors file not found: ${survivorsPath}`);
  }
  assertNotSymlink(survivorsPath, "survivors file");
  const survivors = readJson<unknown[]>(survivorsPath);
  if (!Array.isArray(survivors)) {
    throw new Error(`survivors file must be a JSON array: ${survivorsPath}`);
  }

  const pass: unknown[] = [];
  // Insertion-ordered so tier2.pending.json preserves survivor order.
  const gatedBySurface = new Map<string, unknown[]>();
  let gatedCount = 0;

  survivors.forEach((c, i) => {
    const where = `survivor [${i}]`;
    if (!needsTier2(c, where)) {
      pass.push(c);
      return;
    }
    const sid = surfaceOf(c);
    if (sid === undefined) {
      throw new Error(`${where}: dedupe_key.surface must be a string to route Tier-2`);
    }
    surfaceDir(runDir, sid, where); // validates id + containment
    const bucket = gatedBySurface.get(sid);
    if (bucket === undefined) {
      gatedBySurface.set(sid, [c]);
    } else {
      bucket.push(c);
    }
    gatedCount++;
  });

  // Sorted so the control-plane list is deterministic run over run (it is
  // compared in tests, echoed into the workflow's structured output, and
  // re-derived byte-identically by assemble).
  const gatedSurfaces = [...gatedBySurface.keys()].sort();
  // Gated sids become directories: two ids differing only in case are one
  // directory on darwin/APFS, so the second pending write would clobber the
  // first while the gate still reported both as dispatched.
  const seenFolded = new Map<string, string>();
  for (const sid of gatedSurfaces) {
    assertNoCaseFoldCollision(seenFolded, sid, "tier2 gate");
  }

  return { pass, gatedBySurface, gatedSurfaces, gatedCount };
}

function requireRunDir(runDir: string): void {
  // An empty/blank runDir resolves to cwd, which would turn every containment
  // check below into a guard against writing into the process's own directory.
  if (!runDir || runDir.trim() === "") {
    throw new Error("runDir must not be empty");
  }
}

/**
 * Phase 1 — split Tier-1 survivors by `needsTier2`.
 *
 * Writes:
 *   <runDir>/tier2.json                       gated surface ids (control plane;
 *                                             the ONLY output assemble reads back)
 *   <runDir>/tier2.pass.json                  non-gated survivors — DIAGNOSTIC
 *                                             only (assemble recomputes them)
 *   <runDir>/surfaces/<sid>/tier2.pending.json gated candidates for that surface
 *                                             — the Tier-2 refuter's prompt input
 *                                             (assemble recomputes; never reads it)
 */
export function runTier2Gate(opts: Tier2GateOpts): Tier2GateResult {
  requireRunDir(opts.runDir);
  const survivorsPath = opts.survivorsPath ?? join(opts.runDir, "candidates.json");
  const { pass, gatedBySurface, gatedSurfaces, gatedCount } = splitSurvivors(
    opts.runDir,
    survivorsPath,
  );

  for (const sid of gatedSurfaces) {
    const dir = surfaceDir(opts.runDir, sid, `tier2 surface ${sid}`);
    writeJson(join(dir, "tier2.pending.json"), gatedBySurface.get(sid) ?? []);
  }
  writeJson(join(opts.runDir, "tier2.json"), gatedSurfaces);
  writeJson(join(opts.runDir, "tier2.pass.json"), pass);

  return { gatedSurfaces, gatedCount, passCount: pass.length };
}

/**
 * Phase 2 — fold each gated surface's Tier-2 survivors back together with the
 * pass-through set into <runDir>/candidates.tier2.json.
 *
 * The split is RECOMPUTED from candidates.json (see module header); tier2.json
 * is read only to cross-check that the control plane the workflow dispatched
 * refuters over is the same split this assembly is folding — any drift
 * (shrunk, extended, duplicated, reordered-by-hand) aborts. tier2.pass.json
 * and the tier2.pending.json files are gate DEBUG output for humans and the
 * refuters' prompt inputs; assemble never consumes them, so tampering with
 * them cannot alter the assembled set.
 *
 * A missing surfaces/<sid>/tier2.survivors.json ABORTS the run. Unlike the
 * reviewer fan-out there is no safe partial union here: that surface's
 * pass-through candidates are already in the recomputed pass set, so treating
 * a crashed Tier-2 refuter as "everything rejected" would silently delete real
 * findings, and treating it as "everything survived" would silently skip the
 * refute. The only correct move is to fail before run-meta stamps
 * rejected_tier2.
 */
export function runTier2Assemble(opts: Tier2AssembleOpts): Tier2AssembleResult {
  requireRunDir(opts.runDir);
  const survivorsSrc = opts.survivorsPath ?? join(opts.runDir, "candidates.json");
  const { pass, gatedBySurface, gatedSurfaces } = splitSurvivors(opts.runDir, survivorsSrc);

  // Cross-check the stored control-plane list against the recomputation. The
  // strict deep-equality (same ids, same sorted order, no duplicates, no
  // extras) is the whole defense: every divergence class maps to an attack
  // the adversarial round actually landed (shrunk list -> silent loss of a
  // gated critical; duplicate sid -> double-counted survivors; forged extra
  // sid -> smuggled non-survivor candidate).
  const tier2Path = join(opts.runDir, "tier2.json");
  if (!existsSync(tier2Path)) {
    throw new Error(`tier2.json not found: ${tier2Path} (run the gate before --assemble)`);
  }
  assertNotSymlink(tier2Path, "tier2.json");
  const stored = readJson<unknown[]>(tier2Path);
  if (!Array.isArray(stored)) {
    throw new Error(`tier2.json must be a JSON array of surface ids: ${tier2Path}`);
  }
  const same =
    stored.length === gatedSurfaces.length &&
    stored.every((v, i) => typeof v === "string" && v === gatedSurfaces[i]);
  if (!same) {
    throw new Error(
      `tier2.json does not match the gate split recomputed from ${survivorsSrc}: ` +
        `expected ${JSON.stringify(gatedSurfaces)}, found ${JSON.stringify(stored)} — ` +
        `the control-plane list was altered after the gate; aborting before run-meta`,
    );
  }

  // Pass-through candidates first, then each gated surface's survivors in
  // gated-sid (sorted) order — a deterministic assembly order so the
  // downstream dedupe/record diff is stable across reruns of the same run dir.
  const out: unknown[] = [...pass];
  let pendingTotal = 0;
  let survivorTotal = 0;

  gatedSurfaces.forEach((sid) => {
    const where = `gated surface ${sid}`;
    const dir = surfaceDir(opts.runDir, sid, where);
    const survivorsPath = join(dir, "tier2.survivors.json");

    if (!existsSync(survivorsPath)) {
      throw new Error(
        `tier2.survivors.json missing for gated surface ${sid}: ${survivorsPath} ` +
          `(the Tier-2 refuter did not complete; aborting before run-meta)`,
      );
    }
    assertNotSymlink(survivorsPath, `surfaces/${sid}/tier2.survivors.json`);

    const survivors = readJson<unknown[]>(survivorsPath);
    if (!Array.isArray(survivors)) {
      throw new Error(`tier2.survivors.json must be a JSON array: ${survivorsPath}`);
    }

    // Multiset of RECOMPUTED pending keys (never the on-disk pending file —
    // that is refuter prompt input, not assembly truth). Identity is the same
    // canonicalization run-meta-build and bin/dedupe use.
    const pending = gatedBySurface.get(sid) ?? [];
    const pendingKeys = new Map<string, number>();
    for (const p of pending) {
      const k = candidateKey(p);
      if (k !== null) pendingKeys.set(k, (pendingKeys.get(k) ?? 0) + 1);
    }

    survivors.forEach((s, j) => {
      // Binding: the file lives under surfaces/<sid>/, so every candidate in it
      // must belong to <sid>. Without this a refuter could smuggle another
      // surface's finding through the surface it was not asked to review.
      const sSurface = surfaceOf(s);
      if (sSurface !== sid) {
        throw new Error(
          `tier2 survivor [${j}] of surface ${sid} is bound to ` +
            `${sSurface === undefined ? "no surface" : sSurface}: dedupe_key.surface must equal ${sid}`,
        );
      }
      const k = candidateKey(s);
      if (k === null) {
        throw new Error(
          `tier2 survivor [${j}] of surface ${sid} has no well-formed dedupe_key ` +
            `{surface, symptom, root_cause}`,
        );
      }
      const remaining = pendingKeys.get(k) ?? 0;
      if (remaining === 0) {
        throw new Error(
          `tier2 survivor [${j}] of surface ${sid} dedupe_key ${k} does not match any ` +
            `pending candidate: the Tier-2 refuter must only remove candidates, never substitute them`,
        );
      }
      pendingKeys.set(k, remaining - 1);
      out.push(s);
    });

    pendingTotal += pending.length;
    survivorTotal += survivors.length;
  });

  writeJson(join(opts.runDir, "candidates.tier2.json"), out);

  return {
    survivors: survivorTotal,
    pass: pass.length,
    rejectedTier2: pendingTotal - survivorTotal,
  };
}
