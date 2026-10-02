// Full-branch tests for runMergeCandidates, plus the MANDATORY §9.16 end-to-end
// registry gate: a K=6 fan-out with one crashed reviewer must stamp EXACTLY the
// five surviving surfaces green and leave the crashed one stale for re-selection.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMergeCandidates } from "./merge-candidates-run.js";
import { buildRunMeta } from "./run-meta-build.js";
import { runRecord } from "./record-run.js";
import { readJson, readYaml } from "./io.js";
import type { Decisions } from "./dedupe-run.js";
import type { CandidateFinding, RegistryEntry } from "./types.js";

let dir: string;
let runDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-merge-"));
  runDir = join(dir, ".run", "ns-2026-08-23-sec-01");
  mkdirSync(runDir, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDS = ["s1", "s2", "s3", "s4", "s5", "s6"];

function cand(surface: string, symptom = "sym"): CandidateFinding {
  return {
    dedupe_key: { surface, symptom, root_cause: "rc" },
    severity: "critical",
    confidence: "high",
    needs_human_verification: true,
  };
}

function writeSurfaces(ids: string[], surfacesPath = join(runDir, "surfaces.json")): string {
  const surfaces = ids.map((id, i) => ({
    id,
    title: `Surface ${id}`,
    weight: "high",
    area: [`app/${i}`],
    staleness: 1,
    change_flag: 0,
    score: 4,
    band: "medium",
  }));
  mkdirSync(join(surfacesPath, ".."), { recursive: true });
  writeFileSync(surfacesPath, JSON.stringify(surfaces, null, 2) + "\n");
  return surfacesPath;
}

interface DirParts {
  reviewed?: unknown;
  proposed?: unknown;
  survivors?: unknown;
  /** File basenames to NOT write (simulates a crash mid-fan-out). */
  omit?: string[];
}

function writeSurfaceDir(sid: string, parts: DirParts = {}): string {
  const d = join(runDir, "surfaces", sid);
  mkdirSync(d, { recursive: true });
  const omit = new Set(parts.omit ?? []);
  const files: Array<[string, unknown]> = [
    ["reviewed.json", parts.reviewed ?? [sid]],
    ["candidates.proposed.json", parts.proposed ?? [cand(sid)]],
    ["candidates.json", parts.survivors ?? [cand(sid)]],
  ];
  for (const [name, value] of files) {
    if (omit.has(name)) continue;
    const body = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    writeFileSync(join(d, name), body);
  }
  return d;
}

function outPaths(): string[] {
  return ["reviewed.json", "candidates.proposed.json", "candidates.json"].map((f) =>
    join(runDir, f),
  );
}

function expectNoOutputs(): void {
  for (const p of outPaths()) expect(existsSync(p)).toBe(false);
}

function merge(surfacesPath = join(runDir, "surfaces.json")) {
  return runMergeCandidates({ runDir, surfacesPath });
}

// ---------------------------------------------------------------------------
// §9.16 partial fan-out
// ---------------------------------------------------------------------------

describe("runMergeCandidates: partial fan-out (§9.16)", () => {
  it("K=6 with s3's dir absent merges exactly the other five", () => {
    writeSurfaces(IDS);
    for (const sid of IDS) if (sid !== "s3") writeSurfaceDir(sid);

    const res = merge();
    expect(res.merged).toEqual(["s1", "s2", "s4", "s5", "s6"]);
    expect(res.skipped).toEqual(["s3"]);
    expect(res.reviewedCount).toBe(5);
    expect(res.proposedCount).toBe(5);
    expect(res.survivorsCount).toBe(5);

    const reviewed = readJson<string[]>(join(runDir, "reviewed.json"));
    expect(reviewed).toEqual(["s1", "s2", "s4", "s5", "s6"]);
    expect(reviewed).not.toContain("s3");
  });

  it("a dir missing ONLY candidates.json is skipped entirely — its proposed do not leak", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1");
    // s2's refuter crashed: proposed exist, survivors never written.
    writeSurfaceDir("s2", {
      proposed: [cand("s2", "leak-me")],
      omit: ["candidates.json"],
    });

    const res = merge();
    expect(res.merged).toEqual(["s1"]);
    expect(res.skipped).toEqual(["s2"]);

    const proposed = readJson<CandidateFinding[]>(join(runDir, "candidates.proposed.json"))!;
    expect(proposed).toHaveLength(1);
    expect(proposed.every((c) => c.dedupe_key.surface === "s1")).toBe(true);
    expect(readJson<string[]>(join(runDir, "reviewed.json"))).toEqual(["s1"]);
  });

  it("a dir missing ONLY reviewed.json is skipped", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1");
    writeSurfaceDir("s2", { omit: ["reviewed.json"] });
    const res = merge();
    expect(res.merged).toEqual(["s1"]);
    expect(res.skipped).toEqual(["s2"]);
    expect(res.proposedCount).toBe(1);
  });

  it("a dir missing ONLY candidates.proposed.json is skipped", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1");
    writeSurfaceDir("s2", { omit: ["candidates.proposed.json"] });
    const res = merge();
    expect(res.merged).toEqual(["s1"]);
    expect(res.skipped).toEqual(["s2"]);
    expect(res.survivorsCount).toBe(1);
  });

  it("all K dirs absent yields a well-formed empty no-op run", () => {
    writeSurfaces(IDS);
    const res = merge();
    expect(res.merged).toEqual([]);
    expect(res.skipped).toEqual(IDS);
    expect(res.reviewedCount).toBe(0);
    expect(res.proposedCount).toBe(0);
    expect(res.survivorsCount).toBe(0);
    for (const p of outPaths()) expect(readJson(p)).toEqual([]);
  });

  it("an empty reviewed.json merges the surface's candidates but claims no coverage", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", { reviewed: [] });
    const res = merge();
    expect(res.merged).toEqual(["s1"]);
    expect(res.skipped).toEqual([]);
    expect(res.reviewedCount).toBe(0);
    expect(res.proposedCount).toBe(1);
    expect(readJson<string[]>(join(runDir, "reviewed.json"))).toEqual([]);
  });

  it("preserves surfaces.json order across all three unions", () => {
    writeSurfaces(["s2", "s1"]);
    writeSurfaceDir("s1", { proposed: [cand("s1", "a")], survivors: [cand("s1", "a")] });
    writeSurfaceDir("s2", { proposed: [cand("s2", "b")], survivors: [cand("s2", "b")] });
    const res = merge();
    expect(res.merged).toEqual(["s2", "s1"]);
    expect(readJson<string[]>(join(runDir, "reviewed.json"))).toEqual(["s2", "s1"]);
    const proposed = readJson<CandidateFinding[]>(join(runDir, "candidates.proposed.json"))!;
    expect(proposed.map((c) => c.dedupe_key.surface)).toEqual(["s2", "s1"]);
    const survivors = readJson<CandidateFinding[]>(join(runDir, "candidates.json"))!;
    expect(survivors.map((c) => c.dedupe_key.surface)).toEqual(["s2", "s1"]);
  });

  it("survivors may be a strict subset of proposed (Tier-1 refuted one)", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", {
      proposed: [cand("s1", "a"), cand("s1", "b")],
      survivors: [cand("s1", "a")],
    });
    const res = merge();
    expect(res.proposedCount).toBe(2);
    expect(res.survivorsCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §9.15 candidate-to-surface binding
// ---------------------------------------------------------------------------

describe("runMergeCandidates: candidate-to-surface binding (§9.15)", () => {
  it("throws naming s2 when a proposed candidate in s2's dir claims s1", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1");
    writeSurfaceDir("s2", { proposed: [cand("s2"), cand("s1")] });
    expect(() => merge()).toThrow(
      /surfaces\/s2\/candidates\.proposed\.json \[1\] dedupe_key\.surface "s1" does not match its surface dir "s2"/,
    );
    expectNoOutputs();
  });

  it("throws naming s2 when a survivor in s2's dir claims s1", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1");
    writeSurfaceDir("s2", { proposed: [cand("s2")], survivors: [cand("s1")] });
    expect(() => merge()).toThrow(
      /surfaces\/s2\/candidates\.json \[0\] dedupe_key\.surface "s1" does not match its surface dir "s2"/,
    );
    expectNoOutputs();
  });

  it("throws when a candidate has no dedupe_key at all", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", { proposed: [{ severity: "low" }] });
    expect(() => merge()).toThrow(
      /surfaces\/s1\/candidates\.proposed\.json \[0\] has no well-formed dedupe_key\.surface/,
    );
    expectNoOutputs();
  });

  it("throws when a candidate's dedupe_key.surface is not a string", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", {
      survivors: [{ dedupe_key: { surface: 7, symptom: "s", root_cause: "r" } }],
    });
    expect(() => merge()).toThrow(
      /surfaces\/s1\/candidates\.json \[0\] has no well-formed dedupe_key\.surface/,
    );
    expectNoOutputs();
  });

  it("throws when a candidate is not an object", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", { proposed: ["not-an-object"] });
    expect(() => merge()).toThrow(/has no well-formed dedupe_key\.surface/);
    expectNoOutputs();
  });

  it("throws when a candidate's dedupe_key is an array", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", { proposed: [{ dedupe_key: [] }] });
    expect(() => merge()).toThrow(/has no well-formed dedupe_key\.surface/);
    expectNoOutputs();
  });

  it("throws when s2's reviewed.json claims s1", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1");
    writeSurfaceDir("s2", { reviewed: ["s1"] });
    expect(() => merge()).toThrow(
      /surfaces\/s2\/reviewed\.json \[0\] claims surface "s1": a surface dir may only claim its own id "s2"/,
    );
    expectNoOutputs();
  });

  it("throws when reviewed.json holds a non-string element", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", { reviewed: [42] });
    expect(() => merge()).toThrow(
      /surfaces\/s1\/reviewed\.json \[0\] must be a non-empty string id/,
    );
    expectNoOutputs();
  });

  it("throws when reviewed.json holds an empty-string element", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", { reviewed: [""] });
    expect(() => merge()).toThrow(
      /surfaces\/s1\/reviewed\.json \[0\] must be a non-empty string id/,
    );
    expectNoOutputs();
  });
});

// ---------------------------------------------------------------------------
// Identity gate on surfaces.json
// ---------------------------------------------------------------------------

describe("runMergeCandidates: surface id gate", () => {
  it('throws on a "../escape" sid BEFORE writing any output', () => {
    const p = writeSurfaces(["s1", "../escape"]);
    writeSurfaceDir("s1");
    expect(() => merge(p)).toThrow(/unsafe surface id "\.\.\/escape"/);
    expectNoOutputs();
  });

  it("throws on an absolute-path sid", () => {
    const p = writeSurfaces(["/etc/passwd"]);
    expect(() => merge(p)).toThrow(/unsafe surface id/);
    expectNoOutputs();
  });

  it("throws on a sid with an unsafe character", () => {
    const p = writeSurfaces(["s 1"]);
    expect(() => merge(p)).toThrow(/unsafe surface id "s 1"/);
    expectNoOutputs();
  });

  it("throws on a glob-metacharacter sid", () => {
    const p = writeSurfaces(["s*"]);
    expect(() => merge(p)).toThrow(/unsafe surface id "s\*"/);
    expectNoOutputs();
  });

  it('throws on sid "." and sid ".."', () => {
    for (const bad of [".", ".."]) {
      rmSync(runDir, { recursive: true, force: true });
      mkdirSync(runDir, { recursive: true });
      const p = writeSurfaces([bad]);
      expect(() => merge(p)).toThrow(/unsafe surface id/);
      expectNoOutputs();
    }
  });

  it("accepts a safe id containing dots, hyphens and underscores", () => {
    const p = writeSurfaces(["ok-id_1.2"]);
    writeSurfaceDir("ok-id_1.2");
    const res = merge(p);
    expect(res.merged).toEqual(["ok-id_1.2"]);
  });

  it("throws on duplicate sids", () => {
    const p = writeSurfaces(["s1", "s1"]);
    writeSurfaceDir("s1");
    expect(() => merge(p)).toThrow(/duplicate surface id: s1/);
    expectNoOutputs();
  });
});

// ---------------------------------------------------------------------------
// Malformed inputs
// ---------------------------------------------------------------------------

describe("runMergeCandidates: malformed inputs", () => {
  it("throws when surfaces.json does not exist", () => {
    expect(() => merge(join(runDir, "nope.json"))).toThrow(/surfaces file not found/);
    expectNoOutputs();
  });

  it("throws when runDir is empty instead of resolving to cwd", () => {
    expect(() => runMergeCandidates({ runDir: "", surfacesPath: writeSurfaces(["s1"]) })).toThrow(
      /runDir must not be empty/,
    );
  });

  it("throws when runDir is whitespace-only", () => {
    expect(() =>
      runMergeCandidates({ runDir: "   ", surfacesPath: writeSurfaces(["s1"]) }),
    ).toThrow(/runDir must not be empty/);
  });

  it("throws when surfaces.json is not an array", () => {
    const p = join(runDir, "surfaces.json");
    writeFileSync(p, JSON.stringify({ surfaces: [] }) + "\n");
    expect(() => merge(p)).toThrow(/surfaces\.json must be a JSON array/);
    expectNoOutputs();
  });

  it("throws when a surfaces.json element is not an object", () => {
    const p = join(runDir, "surfaces.json");
    writeFileSync(p, JSON.stringify(["s1"]) + "\n");
    expect(() => merge(p)).toThrow(/surfaces\.json \[0\] must be an object with a string id/);
    expectNoOutputs();
  });

  it("throws when a surfaces.json element is null", () => {
    const p = join(runDir, "surfaces.json");
    writeFileSync(p, JSON.stringify([null]) + "\n");
    expect(() => merge(p)).toThrow(/surfaces\.json \[0\] must be an object with a string id/);
  });

  it("throws when a surfaces.json element id is not a string", () => {
    const p = join(runDir, "surfaces.json");
    writeFileSync(p, JSON.stringify([{ id: 3 }]) + "\n");
    expect(() => merge(p)).toThrow(/surfaces\.json \[0\] id must be a non-empty string/);
  });

  it("throws when a surfaces.json element id is empty", () => {
    const p = join(runDir, "surfaces.json");
    writeFileSync(p, JSON.stringify([{ id: "" }]) + "\n");
    expect(() => merge(p)).toThrow(/surfaces\.json \[0\] id must be a non-empty string/);
  });

  // A per-surface artifact that fails to LOAD as a JSON array is a crash shape
  // (a killed writer most often leaves a partial file, not a missing one), so
  // it marks that ONE dir incomplete — the surface is skipped and stays stale,
  // and the other K-1 surfaces still merge (§9.16). Adversarial round: the
  // pre-fix behavior aborted all K on one truncated file, degrading "exactly 5
  // stamped" to 0-of-6 whenever a reviewer died mid-write.
  it("skips a surface whose reviewed.json is not an array; the rest still merge", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1", { reviewed: { ok: true } });
    writeSurfaceDir("s2");
    const res = merge();
    expect(res.merged).toEqual(["s2"]);
    expect(res.skipped).toEqual(["s1"]);
    expect(readJson<string[]>(join(runDir, "reviewed.json"))).toEqual(["s2"]);
  });

  it("skips a surface whose candidates.proposed.json is not an array", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1", { proposed: { ok: true } });
    writeSurfaceDir("s2");
    const res = merge();
    expect(res.merged).toEqual(["s2"]);
    expect(res.skipped).toEqual(["s1"]);
    // The skipped dir's (well-formed) survivors must not leak either.
    expect(res.survivorsCount).toBe(1);
  });

  it("skips a surface whose candidates.json is not an array", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1", { survivors: { ok: true } });
    writeSurfaceDir("s2");
    const res = merge();
    expect(res.merged).toEqual(["s2"]);
    expect(res.skipped).toEqual(["s1"]);
  });

  it("skips a surface with unparseable JSON (died mid-write) instead of aborting the run", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1", { survivors: "{not json" });
    writeSurfaceDir("s2");
    const res = merge();
    expect(res.merged).toEqual(["s2"]);
    expect(res.skipped).toEqual(["s1"]);
  });

  it("skips a surface with a zero-byte artifact", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1", { reviewed: "" });
    writeSurfaceDir("s2");
    const res = merge();
    expect(res.merged).toEqual(["s2"]);
    expect(res.skipped).toEqual(["s1"]);
  });

  it("skips a surface whose artifact path is a directory (unreadable)", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1", { omit: ["candidates.json"] });
    mkdirSync(join(runDir, "surfaces", "s1", "candidates.json"));
    writeSurfaceDir("s2");
    const res = merge();
    expect(res.merged).toEqual(["s2"]);
    expect(res.skipped).toEqual(["s1"]);
  });
});

// ---------------------------------------------------------------------------
// Physical containment (adversarial round: symlink escape / case-fold clobber)
// ---------------------------------------------------------------------------

describe("runMergeCandidates: physical containment", () => {
  it("throws on a symlinked surface dir instead of ingesting outside content", () => {
    // The adversarial probe that motivated this: a complete artifact set for a
    // CRASHED surface planted outside the run dir and symlinked in passed the
    // lexical resolve() check, merged as coverage, and stamped the surface
    // green end to end. resolve() never touches the filesystem; the physical
    // layer must.
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s2");
    const outside = join(dir, "outside", "s1");
    mkdirSync(outside, { recursive: true });
    for (const [name, value] of [
      ["reviewed.json", ["s1"]],
      ["candidates.proposed.json", [cand("s1")]],
      ["candidates.json", [cand("s1")]],
    ] as const) {
      writeFileSync(join(outside, name), JSON.stringify(value) + "\n");
    }
    mkdirSync(join(runDir, "surfaces"), { recursive: true });
    symlinkSync(outside, join(runDir, "surfaces", "s1"));
    expect(() => merge()).toThrow(/is a symlink/);
    expectNoOutputs();
  });

  it("throws when surfaces/ itself is a symlink", () => {
    const surfacesPath = writeSurfaces(["s1"], join(dir, "elsewhere", "surfaces.json"));
    const emptyRun = join(dir, ".run", "empty-run");
    mkdirSync(emptyRun, { recursive: true });
    const outside = join(dir, "outside-surfaces");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(emptyRun, "surfaces"));
    expect(() => runMergeCandidates({ runDir: emptyRun, surfacesPath })).toThrow(/is a symlink/);
  });

  it("throws on a symlinked per-surface artifact file", () => {
    writeSurfaces(["s1"]);
    writeSurfaceDir("s1", { omit: ["candidates.json"] });
    const outsideFile = join(dir, "planted-survivors.json");
    writeFileSync(outsideFile, JSON.stringify([cand("s1")]) + "\n");
    symlinkSync(outsideFile, join(runDir, "surfaces", "s1", "candidates.json"));
    expect(() => merge()).toThrow(/candidates\.json is a symlink/);
    expectNoOutputs();
  });

  it("throws on surface ids that collide case-insensitively", () => {
    // "AUTH" and "auth" are two ids to the engine but ONE directory on
    // darwin/APFS — the second surface's artifacts would silently read the
    // first's. Rejected on every platform for portability determinism.
    writeSurfaces(["AUTH", "auth"]);
    expect(() => merge()).toThrow(/collide case-insensitively/);
    expectNoOutputs();
  });
});

// ---------------------------------------------------------------------------
// §9.16 END-TO-END REGISTRY GATE
// ---------------------------------------------------------------------------

describe("§9.16 end-to-end: a crashed reviewer leaves its registry entry stale", () => {
  const TODAY = "2026-08-23";
  const RUN_ID = "ns-2026-08-23-sec-01";
  const REG_IDS = [
    "ND-SEC-01",
    "ND-SEC-02",
    "ND-SEC-03",
    "ND-SEC-04",
    "ND-SEC-05",
    "ND-SEC-06",
  ];
  const CRASHED = "ND-SEC-03";

  function writeRegistry(): string {
    const p = join(dir, "pack", "security", "vectors.yml");
    mkdirSync(join(p, ".."), { recursive: true });
    const body =
      "# NovuDesk security vectors — hand-seeded, engine stamps last_reviewed.\nvectors:\n" +
      REG_IDS.map(
        (id, i) =>
          `  - id: ${id}\n` +
          `    title: Vector ${i + 1}\n` +
          `    kind: vector\n` +
          `    area: ["app/mod-${i + 1}/**"]\n` +
          `    weight: high\n` +
          `    interval_days: 14\n` +
          `    owner: security\n`,
      ).join("");
    writeFileSync(p, body);
    return p;
  }

  it("stamps EXACTLY the five completed surfaces and leaves the crashed one unstamped", () => {
    const registryPath = writeRegistry();
    const surfacesPath = writeSurfaces(REG_IDS);
    // Five reviewers completed; ND-SEC-03's agent died before writing anything.
    for (const sid of REG_IDS) if (sid !== CRASHED) writeSurfaceDir(sid);

    // 1. merge the fan-out
    const merged = runMergeCandidates({ runDir, surfacesPath });
    expect(merged.merged).toHaveLength(5);
    expect(merged.skipped).toEqual([CRASHED]);

    // 2. run-meta over the merged artifacts
    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath: join(runDir, "candidates.proposed.json"),
      survivorsPath: join(runDir, "candidates.json"),
      reviewedPath: join(runDir, "reviewed.json"),
      runId: RUN_ID,
      lane: "security",
      packDir: join(dir, "pack"),
      outPath: join(runDir, "run.json"),
      args: { today: TODAY },
      nowTs: `${TODAY}T07:00:00Z`,
      gitRevParse: () => "deadbeef",
    });
    expect(meta.selected).toBe(6);
    expect(meta.reviewed).toBe(5);
    expect(meta.reviewed_ids).not.toContain(CRASHED);

    // 3. record: durable metrics + registry stamps, driven ONLY by reviewed_ids
    const survivors = readJson<CandidateFinding[]>(join(runDir, "candidates.json"))!;
    const decisions: Decisions = {
      run_id: meta.run_id,
      lane: meta.lane,
      date: meta.date,
      decisions: survivors.map((f) => ({ decision: "new" as const, finding: f })),
      counts: { confirmed: survivors.length, recurring: 0, suppressed: 0 },
    };
    const rec = runRecord({
      decisions,
      metricsDir: join(dir, "pack", "metrics"),
      registryPath,
      reviewedIds: meta.reviewed_ids,
      runId: meta.run_id,
      lane: meta.lane,
      date: meta.date,
      ts: meta.ts,
      packSha: meta.pack_sha,
      selected: meta.selected,
      reviewed: meta.reviewed,
      rejectedTier1: meta.rejected_tier1,
      rejectedTier2: meta.rejected_tier2,
      usageByModel: {},
      usageSpent: 0,
      elapsed: 0,
    });
    expect(rec.findingsAppended).toBe(5);

    // 4. THE GATE: re-read the registry.
    const doc = readYaml<{ vectors: RegistryEntry[] }>(registryPath)!;
    const stamped = doc.vectors.filter((e) => e.last_reviewed === TODAY);
    expect(stamped).toHaveLength(5);
    expect(stamped.map((e) => e.id).sort()).toEqual(
      REG_IDS.filter((id) => id !== CRASHED).sort(),
    );

    const crashed = doc.vectors.find((e) => e.id === CRASHED)!;
    expect(crashed).toBeDefined();
    expect(crashed.last_reviewed).toBeUndefined();
    expect(crashed.status).toBeUndefined();
    // ...and the five that did complete carry a status the dashboard can read.
    expect(stamped.every((e) => e.status === "open-findings")).toBe(true);
  });
});
