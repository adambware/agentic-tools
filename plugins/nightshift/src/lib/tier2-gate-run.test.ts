import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson } from "./io.js";
import { needsTier2, runTier2Gate, runTier2Assemble } from "./tier2-gate-run.js";
import type { Confidence, Severity } from "./types.js";

let runDir: string;
/** A sibling dir OUTSIDE the run dir, for symlink-escape probes. */
let outsideDir: string;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "ns-tier2-"));
  outsideDir = mkdtempSync(join(tmpdir(), "ns-tier2-outside-"));
});

afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CandOpts {
  surface?: string;
  symptom?: string;
  root_cause?: string;
  severity?: string;
  confidence?: string;
}

/** A minimally-shaped candidate: gated iff severity critical/high or conf low. */
function cand(o: CandOpts = {}): Record<string, unknown> {
  return {
    dedupe_key: {
      surface: o.surface ?? "s1",
      symptom: o.symptom ?? "sym",
      root_cause: o.root_cause ?? "rc",
    },
    severity: o.severity ?? "medium",
    confidence: o.confidence ?? "high",
    needs_human_verification: false,
  };
}

function writeSurvivors(value: unknown, name = "candidates.json"): string {
  const p = join(runDir, name);
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}

/** Write a per-surface Tier-2 refuter output file. */
function writeSurfaceFile(sid: string, name: string, value: unknown): string {
  const dir = join(runDir, "surfaces", sid);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}

function readArr(path: string): unknown[] {
  return readJson<unknown[]>(path) as unknown[];
}

// ---------------------------------------------------------------------------
// needsTier2 — the predicate, every branch
// ---------------------------------------------------------------------------

describe("needsTier2 predicate table", () => {
  const severities: Severity[] = ["critical", "high", "medium", "low"];
  const confidences: Confidence[] = ["low", "medium", "high"];

  for (const severity of severities) {
    for (const confidence of confidences) {
      const expected = severity === "critical" || severity === "high" || confidence === "low";
      it(`severity=${severity} confidence=${confidence} -> ${expected}`, () => {
        expect(needsTier2(cand({ severity, confidence }))).toBe(expected);
      });
    }
  }

  it("is a union, not an intersection: high severity gates even at high confidence", () => {
    expect(needsTier2(cand({ severity: "high", confidence: "high" }))).toBe(true);
  });

  it("is a union, not an intersection: low confidence gates even at low severity", () => {
    expect(needsTier2(cand({ severity: "low", confidence: "low" }))).toBe(true);
  });
});

describe("needsTier2 rejects unclassifiable candidates", () => {
  it("throws when severity is missing", () => {
    const c = cand();
    delete (c as Record<string, unknown>).severity;
    expect(() => needsTier2(c)).toThrow(/severity must be a string/);
  });

  it("throws when severity is not a string", () => {
    expect(() => needsTier2({ ...cand(), severity: 3 })).toThrow(/severity must be a string/);
  });

  it("throws when confidence is missing", () => {
    const c = cand();
    delete (c as Record<string, unknown>).confidence;
    expect(() => needsTier2(c)).toThrow(/confidence must be a string/);
  });

  it("throws when confidence is not a string", () => {
    expect(() => needsTier2({ ...cand(), confidence: null })).toThrow(
      /confidence must be a string/,
    );
  });

  it("throws when the candidate is not an object", () => {
    expect(() => needsTier2("nope")).toThrow(/must be an object/);
    expect(() => needsTier2(null)).toThrow(/must be an object/);
    expect(() => needsTier2([cand()])).toThrow(/must be an object/);
  });

  it("names the caller-supplied location in the message", () => {
    expect(() => needsTier2({}, "survivor [7]")).toThrow(/survivor \[7\]/);
  });
});

// ---------------------------------------------------------------------------
// runTier2Gate
// ---------------------------------------------------------------------------

describe("runTier2Gate: input guards", () => {
  it("throws when the survivors file is missing", () => {
    expect(() => runTier2Gate({ runDir })).toThrow(/survivors file not found/);
  });

  it("throws when the survivors file is not a JSON array", () => {
    writeSurvivors({ nope: true });
    expect(() => runTier2Gate({ runDir })).toThrow(/must be a JSON array/);
  });

  it("throws on an empty runDir instead of resolving to cwd", () => {
    expect(() => runTier2Gate({ runDir: "   " })).toThrow(/runDir must not be empty/);
  });

  it("honors an explicit survivorsPath over the default candidates.json", () => {
    writeSurvivors([cand({ severity: "critical" })], "candidates.json");
    const alt = writeSurvivors([], "merged.json");
    const res = runTier2Gate({ runDir, survivorsPath: alt });
    expect(res.gatedCount).toBe(0);
    expect(res.passCount).toBe(0);
  });
});

describe("runTier2Gate: empty survivor set", () => {
  it("writes empty artifacts, no pending files, and zeroed counts", () => {
    writeSurvivors([]);
    const res = runTier2Gate({ runDir });
    expect(res).toEqual({ gatedSurfaces: [], gatedCount: 0, passCount: 0 });
    expect(readArr(join(runDir, "tier2.json"))).toEqual([]);
    expect(readArr(join(runDir, "tier2.pass.json"))).toEqual([]);
    expect(existsSync(join(runDir, "surfaces"))).toBe(false);
  });
});

describe("runTier2Gate: split", () => {
  it("routes gated candidates to per-surface pending files and the rest to pass", () => {
    const gatedA = cand({ surface: "a", symptom: "crit", severity: "critical" });
    const gatedB = cand({ surface: "b", symptom: "shaky", confidence: "low" });
    const passOne = cand({ surface: "a", symptom: "meh" });
    writeSurvivors([gatedA, passOne, gatedB]);

    const res = runTier2Gate({ runDir });

    expect(res.gatedSurfaces).toEqual(["a", "b"]);
    expect(res.gatedCount).toBe(2);
    expect(res.passCount).toBe(1);
    expect(readArr(join(runDir, "tier2.json"))).toEqual(["a", "b"]);
    // pass-through is verbatim, not reshaped
    expect(readArr(join(runDir, "tier2.pass.json"))).toEqual([passOne]);
    expect(readArr(join(runDir, "surfaces", "a", "tier2.pending.json"))).toEqual([gatedA]);
    expect(readArr(join(runDir, "surfaces", "b", "tier2.pending.json"))).toEqual([gatedB]);
  });

  it("emits tier2.json sorted and unique with multiple gated candidates per surface", () => {
    const c1 = cand({ surface: "zeta", symptom: "one", severity: "high" });
    const c2 = cand({ surface: "alpha", symptom: "two", severity: "critical" });
    const c3 = cand({ surface: "zeta", symptom: "three", confidence: "low" });
    writeSurvivors([c1, c2, c3]);

    const res = runTier2Gate({ runDir });

    expect(res.gatedSurfaces).toEqual(["alpha", "zeta"]);
    expect(res.gatedCount).toBe(3);
    // pending preserves survivor order within the surface
    expect(readArr(join(runDir, "surfaces", "zeta", "tier2.pending.json"))).toEqual([c1, c3]);
  });

  it("writes tier2.pass.json even when every survivor is gated", () => {
    writeSurvivors([cand({ severity: "critical" })]);
    const res = runTier2Gate({ runDir });
    expect(res.passCount).toBe(0);
    expect(existsSync(join(runDir, "tier2.pass.json"))).toBe(true);
    expect(readArr(join(runDir, "tier2.pass.json"))).toEqual([]);
  });

  it("writes an empty tier2.json when nothing is gated", () => {
    writeSurvivors([cand(), cand({ symptom: "other" })]);
    const res = runTier2Gate({ runDir });
    expect(res.gatedSurfaces).toEqual([]);
    expect(res.passCount).toBe(2);
    expect(readArr(join(runDir, "tier2.json"))).toEqual([]);
    expect(existsSync(join(runDir, "surfaces"))).toBe(false);
  });
});

describe("runTier2Gate: surface id safety", () => {
  it("throws when a gated candidate carries a path-traversing surface id", () => {
    writeSurvivors([cand({ surface: "../escape", severity: "critical" })]);
    expect(() => runTier2Gate({ runDir })).toThrow(/unsafe surface id/);
    expect(existsSync(join(runDir, "tier2.json"))).toBe(false);
  });

  it("throws when a gated candidate's surface id contains a separator", () => {
    writeSurvivors([cand({ surface: "a/b", severity: "high" })]);
    expect(() => runTier2Gate({ runDir })).toThrow(/unsafe surface id/);
  });

  it("throws on the '..' surface id", () => {
    writeSurvivors([cand({ surface: "..", confidence: "low" })]);
    expect(() => runTier2Gate({ runDir })).toThrow(/unsafe surface id/);
  });

  it("throws on the '.' surface id", () => {
    writeSurvivors([cand({ surface: ".", confidence: "low" })]);
    expect(() => runTier2Gate({ runDir })).toThrow(/unsafe surface id/);
  });

  it("throws when a gated candidate has no string dedupe_key.surface", () => {
    writeSurvivors([{ severity: "critical", confidence: "high" }]);
    expect(() => runTier2Gate({ runDir })).toThrow(/dedupe_key.surface must be a string/);
  });

  it("does NOT reject an unsafe surface id on a NON-gated candidate", () => {
    // Only gated candidates become a path component, so the id gate applies
    // only to them; a pass-through candidate is copied verbatim.
    const c = cand({ surface: "../weird" });
    writeSurvivors([c]);
    const res = runTier2Gate({ runDir });
    expect(res.passCount).toBe(1);
    expect(readArr(join(runDir, "tier2.pass.json"))).toEqual([c]);
  });

  it("throws (before any write) when a survivor cannot be classified", () => {
    writeSurvivors([cand({ severity: "critical" }), { dedupe_key: { surface: "b" } }]);
    expect(() => runTier2Gate({ runDir })).toThrow(/survivor \[1\]: severity must be a string/);
    expect(existsSync(join(runDir, "tier2.json"))).toBe(false);
  });

  // Adversarial round: a symlink at surfaces/<sid> passed the lexical
  // resolve() check and routed the tier2.pending.json WRITE outside the run
  // dir with exit 0. The physical (lstat+realpath) layer must refuse it, and
  // the planted target must stay untouched.
  it("throws on a symlinked surface dir instead of writing pending outside the run dir", () => {
    const outside = join(outsideDir, "OUTSIDE");
    mkdirSync(outside, { recursive: true });
    writeSurvivors([cand({ surface: "auth", severity: "critical" })]);
    mkdirSync(join(runDir, "surfaces"), { recursive: true });
    symlinkSync(outside, join(runDir, "surfaces", "auth"));
    expect(() => runTier2Gate({ runDir })).toThrow(/is a symlink/);
    expect(existsSync(join(outside, "tier2.pending.json"))).toBe(false);
    expect(existsSync(join(runDir, "tier2.json"))).toBe(false);
  });

  it("throws when two gated surface ids collide case-insensitively", () => {
    // "AUTH" and "auth" are one directory on darwin/APFS: the second pending
    // write would clobber the first while the gate still reported both.
    writeSurvivors([
      cand({ surface: "AUTH", symptom: "a1", severity: "critical" }),
      cand({ surface: "auth", symptom: "a2", severity: "critical" }),
    ]);
    expect(() => runTier2Gate({ runDir })).toThrow(/collide case-insensitively/);
    expect(existsSync(join(runDir, "tier2.json"))).toBe(false);
  });

  it("throws on a symlinked survivors input file instead of reading through it", () => {
    const outsideFile = join(outsideDir, "planted.json");
    writeFileSync(outsideFile, JSON.stringify([cand()]) + "\n");
    const link = join(runDir, "candidates.json");
    symlinkSync(outsideFile, link);
    expect(() => runTier2Gate({ runDir })).toThrow(/is a symlink/);
  });
});

// ---------------------------------------------------------------------------
// runTier2Assemble
// ---------------------------------------------------------------------------

describe("runTier2Assemble: input guards", () => {
  it("throws when the survivors source is missing (nothing to recompute from)", () => {
    expect(() => runTier2Assemble({ runDir })).toThrow(/survivors file not found/);
  });

  it("throws when tier2.json is missing (gate never ran)", () => {
    writeSurvivors([]);
    expect(() => runTier2Assemble({ runDir })).toThrow(/tier2\.json not found/);
  });

  it("throws when tier2.json is not a JSON array", () => {
    writeSurvivors([]);
    writeFileSync(join(runDir, "tier2.json"), '{"a":1}\n');
    expect(() => runTier2Assemble({ runDir })).toThrow(/tier2\.json must be a JSON array/);
  });

  it("throws on an empty runDir", () => {
    expect(() => runTier2Assemble({ runDir: "" })).toThrow(/runDir must not be empty/);
  });
});

// Adversarial round: assemble originally TRUSTED tier2.json (and the on-disk
// pending/pass files). A Write-bearing agent that shrank tier2.json between
// gate and assemble silently deleted a gated critical survivor while its
// surface still got stamped green; a duplicated sid double-counted survivors;
// a forged extra sid smuggled a never-gated candidate. Assemble now recomputes
// the split from candidates.json and cross-checks tier2.json against it, so
// every one of those divergences aborts before run-meta.
describe("runTier2Assemble: control-plane cross-check (recomputed split)", () => {
  it("throws when tier2.json was SHRUNK after the gate (silent-loss attack)", () => {
    const gatedA = cand({ surface: "a", symptom: "a1", severity: "high" });
    const gatedB = cand({ surface: "b", symptom: "crit", severity: "critical" });
    writeSurvivors([gatedA, gatedB]);
    runTier2Gate({ runDir });
    writeSurfaceFile("a", "tier2.survivors.json", [gatedA]);
    writeSurfaceFile("b", "tier2.survivors.json", [gatedB]);
    // Tamper: drop b from the control-plane list.
    writeFileSync(join(runDir, "tier2.json"), JSON.stringify(["a"]) + "\n");
    expect(() => runTier2Assemble({ runDir })).toThrow(/does not match the gate split/);
    expect(existsSync(join(runDir, "candidates.tier2.json"))).toBe(false);
  });

  it("throws when tier2.json carries a FORGED extra sid", () => {
    const gatedA = cand({ surface: "a", symptom: "a1", severity: "high" });
    writeSurvivors([gatedA]);
    runTier2Gate({ runDir });
    writeSurfaceFile("a", "tier2.survivors.json", [gatedA]);
    writeFileSync(join(runDir, "tier2.json"), JSON.stringify(["a", "z"]) + "\n");
    expect(() => runTier2Assemble({ runDir })).toThrow(/does not match the gate split/);
  });

  it("throws when tier2.json duplicates a sid (double-count attack)", () => {
    const gatedA = cand({ surface: "a", symptom: "a1", severity: "high" });
    writeSurvivors([gatedA]);
    runTier2Gate({ runDir });
    writeSurfaceFile("a", "tier2.survivors.json", [gatedA]);
    writeFileSync(join(runDir, "tier2.json"), JSON.stringify(["a", "a"]) + "\n");
    expect(() => runTier2Assemble({ runDir })).toThrow(/does not match the gate split/);
  });

  it("throws when tier2.json holds a non-string / hostile entry", () => {
    writeSurvivors([]);
    writeFileSync(join(runDir, "tier2.json"), JSON.stringify([42]) + "\n");
    expect(() => runTier2Assemble({ runDir })).toThrow(/does not match the gate split/);
    writeFileSync(join(runDir, "tier2.json"), JSON.stringify(["../evil"]) + "\n");
    expect(() => runTier2Assemble({ runDir })).toThrow(/does not match the gate split/);
  });

  it("ignores a tampered tier2.pass.json: the pass set is recomputed, not read", () => {
    const passThrough = cand({ symptom: "keep" });
    const gatedA = cand({ surface: "a", symptom: "a1", severity: "high" });
    writeSurvivors([passThrough, gatedA]);
    runTier2Gate({ runDir });
    writeSurfaceFile("a", "tier2.survivors.json", [gatedA]);
    // Tamper: replace the pass file with garbage and a smuggled candidate.
    writeFileSync(
      join(runDir, "tier2.pass.json"),
      JSON.stringify([cand({ surface: "z", symptom: "smuggled", severity: "critical" })]) + "\n",
    );
    const res = runTier2Assemble({ runDir });
    expect(res).toEqual({ survivors: 1, pass: 1, rejectedTier2: 0 });
    expect(readArr(join(runDir, "candidates.tier2.json"))).toEqual([passThrough, gatedA]);
  });
});

describe("runTier2Assemble: empty gate output", () => {
  it("assembles the pass-through set alone with rejected_tier2 = 0", () => {
    writeSurvivors([]);
    runTier2Gate({ runDir });
    const res = runTier2Assemble({ runDir });
    expect(res).toEqual({ survivors: 0, pass: 0, rejectedTier2: 0 });
    expect(readArr(join(runDir, "candidates.tier2.json"))).toEqual([]);
  });

  it("passes everything through untouched when nothing was gated", () => {
    const a = cand({ symptom: "a" });
    const b = cand({ symptom: "b" });
    writeSurvivors([a, b]);
    runTier2Gate({ runDir });
    const res = runTier2Assemble({ runDir });
    expect(res).toEqual({ survivors: 0, pass: 2, rejectedTier2: 0 });
    expect(readArr(join(runDir, "candidates.tier2.json"))).toEqual([a, b]);
  });
});

describe("runTier2Assemble: happy path", () => {
  it("orders pass-through first, then survivors grouped in tier2.json order", () => {
    const passOne = cand({ surface: "b", symptom: "pass" });
    const gatedA1 = cand({ surface: "a", symptom: "a1", severity: "critical" });
    const gatedA2 = cand({ surface: "a", symptom: "a2", severity: "high" });
    const gatedB1 = cand({ surface: "b", symptom: "b1", confidence: "low" });
    writeSurvivors([gatedB1, passOne, gatedA1, gatedA2]);
    runTier2Gate({ runDir });

    // Tier-2 refuter kills a2, keeps a1 and b1.
    writeSurfaceFile("a", "tier2.survivors.json", [gatedA1]);
    writeSurfaceFile("b", "tier2.survivors.json", [gatedB1]);

    const res = runTier2Assemble({ runDir });

    expect(res).toEqual({ survivors: 2, pass: 1, rejectedTier2: 1 });
    // tier2.json is sorted ["a","b"], so survivors follow that grouping.
    expect(readArr(join(runDir, "candidates.tier2.json"))).toEqual([passOne, gatedA1, gatedB1]);
  });

  it("counts rejected_tier2 across surfaces when a refuter kills everything", () => {
    const g1 = cand({ surface: "a", symptom: "one", severity: "critical" });
    const g2 = cand({ surface: "a", symptom: "two", severity: "critical" });
    writeSurvivors([g1, g2]);
    runTier2Gate({ runDir });
    writeSurfaceFile("a", "tier2.survivors.json", []);

    const res = runTier2Assemble({ runDir });

    expect(res).toEqual({ survivors: 0, pass: 0, rejectedTier2: 2 });
    expect(readArr(join(runDir, "candidates.tier2.json"))).toEqual([]);
  });
});

describe("runTier2Assemble: refuter-output invariants", () => {
  function gateOne(extra: Record<string, unknown>[] = []): Record<string, unknown> {
    const gated = cand({ surface: "a", symptom: "one", severity: "critical" });
    writeSurvivors([gated, ...extra]);
    runTier2Gate({ runDir });
    return gated;
  }

  it("throws naming the sid when tier2.survivors.json is missing", () => {
    gateOne();
    expect(() => runTier2Assemble({ runDir })).toThrow(
      /tier2\.survivors\.json missing for gated surface a/,
    );
    expect(existsSync(join(runDir, "candidates.tier2.json"))).toBe(false);
  });

  it("ignores a REMOVED tier2.pending.json: pending is recomputed, not read", () => {
    const gated = gateOne();
    rmSync(join(runDir, "surfaces", "a", "tier2.pending.json"));
    writeSurfaceFile("a", "tier2.survivors.json", [gated]);
    const res = runTier2Assemble({ runDir });
    expect(res).toEqual({ survivors: 1, pass: 0, rejectedTier2: 0 });
  });

  it("throws when tier2.survivors.json is not a JSON array", () => {
    gateOne();
    writeSurfaceFile("a", "tier2.survivors.json", { nope: 1 });
    expect(() => runTier2Assemble({ runDir })).toThrow(
      /tier2\.survivors\.json must be a JSON array/,
    );
  });

  it("ignores a TAMPERED tier2.pending.json: a fabricated pending entry cannot launder a survivor", () => {
    gateOne();
    const fabricated = cand({ surface: "a", symptom: "laundered", severity: "critical" });
    // Attack: expand the on-disk pending so a never-gated candidate looks
    // legitimate, then return it as a "survivor". The recomputed pending
    // (from candidates.json) does not contain it, so assemble aborts.
    writeSurfaceFile("a", "tier2.pending.json", [
      cand({ surface: "a", symptom: "one", severity: "critical" }),
      fabricated,
    ]);
    writeSurfaceFile("a", "tier2.survivors.json", [fabricated]);
    expect(() => runTier2Assemble({ runDir })).toThrow(/does not match any pending candidate/);
  });

  it("throws on a binding violation: survivor bound to another surface", () => {
    gateOne();
    writeSurfaceFile("a", "tier2.survivors.json", [
      cand({ surface: "b", symptom: "one", severity: "critical" }),
    ]);
    expect(() => runTier2Assemble({ runDir })).toThrow(
      /tier2 survivor \[0\] of surface a is bound to b/,
    );
  });

  it("throws on a binding violation: survivor with no dedupe_key at all", () => {
    gateOne();
    writeSurfaceFile("a", "tier2.survivors.json", [{ severity: "critical" }]);
    expect(() => runTier2Assemble({ runDir })).toThrow(
      /tier2 survivor \[0\] of surface a is bound to no surface/,
    );
  });

  it("throws on substitution: a survivor key absent from pending", () => {
    gateOne();
    writeSurfaceFile("a", "tier2.survivors.json", [
      cand({ surface: "a", symptom: "swapped-in", severity: "critical" }),
    ]);
    expect(() => runTier2Assemble({ runDir })).toThrow(
      /does not match any pending candidate: the Tier-2 refuter must only remove candidates/,
    );
  });

  it("throws on a duplicated survivor key outnumbering its pending occurrence", () => {
    const gated = gateOne();
    // pending has this key ONCE; the refuter returns it twice.
    writeSurfaceFile("a", "tier2.survivors.json", [gated, gated]);
    expect(() => runTier2Assemble({ runDir })).toThrow(/does not match any pending candidate/);
  });

  it("allows a duplicated survivor key when pending carries the same duplicate", () => {
    const g = cand({ surface: "a", symptom: "one", severity: "critical" });
    writeSurvivors([g, { ...g }]);
    runTier2Gate({ runDir });
    writeSurfaceFile("a", "tier2.survivors.json", [g, { ...g }]);
    const res = runTier2Assemble({ runDir });
    expect(res).toEqual({ survivors: 2, pass: 0, rejectedTier2: 0 });
  });

  it("throws when a survivor has a well-formed surface but a malformed dedupe_key", () => {
    gateOne();
    writeSurfaceFile("a", "tier2.survivors.json", [
      { dedupe_key: { surface: "a", symptom: 3, root_cause: "rc" }, severity: "critical" },
    ]);
    expect(() => runTier2Assemble({ runDir })).toThrow(
      /tier2 survivor \[0\] of surface a has no well-formed dedupe_key/,
    );
  });

  it("identity is the dedupe_key alone: a re-scored survivor still matches", () => {
    const gated = gateOne();
    writeSurfaceFile("a", "tier2.survivors.json", [{ ...gated, confidence: "low" }]);
    const res = runTier2Assemble({ runDir });
    expect(res.survivors).toBe(1);
    expect(res.rejectedTier2).toBe(0);
  });
});
