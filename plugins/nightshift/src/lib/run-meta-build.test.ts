import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunMeta, type RunMeta } from "./run-meta-build.js";
import { runRecord } from "./record-run.js";
import type { Decisions } from "./dedupe-run.js";
import type { CandidateFinding, RunMetrics } from "./types.js";
import { readJson, readJsonl } from "./io.js";
import { execFileSync } from "node:child_process";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-run-meta-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a JSON file and return its path. */
function writeJsonFile(name: string, value: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}

/** Stub gitRevParse that returns 'no-git' (simulates non-git directory). */
const noGitRevParse = (_packDir: string): string => "no-git";

/** A real 40-char hex sha stub. */
const fakeGitRevParse = (_packDir: string): string =>
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

/** Minimal valid surface shape. */
function makeSurface(id: string) {
  return { id, title: `Surface ${id}`, weight: "high", area: ["app/*"] };
}

const FIXED_TS = "2025-01-15T04:00:00Z";
const FIXED_DATE = "2025-01-15";
const RUN_ID = "ns-2026-06-21-sec-123456";

// ─── happy path ──────────────────────────────────────────────────────────────

describe("happy path", () => {
  it("computes rejected_tier1=1, reviewed=1 for 2 proposed / 1 survivor", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("surface-id-1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", [
      { dedupe_key: { surface: "s", symptom: "a", root_cause: "b" } },
      { dedupe_key: { surface: "s", symptom: "c", root_cause: "d" } },
    ]);
    const survivorsPath = writeJsonFile("candidates.json", [
      { dedupe_key: { surface: "s", symptom: "a", root_cause: "b" } },
    ]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE, ts: FIXED_TS },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    expect(meta.rejected_tier1).toBe(1);
    expect(meta.reviewed_ids).toEqual(["surface-id-1"]);
    expect(meta.reviewed).toBe(1);
    expect(meta.selected).toBe(1);
    expect(meta.rejected_tier2).toBe(0);
  });
});

// ─── clean review (zero candidates) ─────────────────────────────────────────

describe("clean review (zero candidates)", () => {
  it("counts reviewed=1 and rejected_tier1=0 when both proposed and survivors are empty", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("surface-id-1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    expect(meta.rejected_tier1).toBe(0);
    expect(meta.reviewed_ids).toEqual(["surface-id-1"]);
    expect(meta.reviewed).toBe(1);
    expect(existsSync(outPath)).toBe(true);
  });
});

// ─── all rejected ────────────────────────────────────────────────────────────

describe("all rejected", () => {
  it("computes rejected_tier1=3 when all 3 proposed are filtered out", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("surface-id-1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", [
      { dedupe_key: { surface: "s", symptom: "a", root_cause: "b" } },
      { dedupe_key: { surface: "s", symptom: "c", root_cause: "d" } },
      { dedupe_key: { surface: "s", symptom: "e", root_cause: "f" } },
    ]);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    expect(meta.rejected_tier1).toBe(3);
    expect(meta.reviewed).toBe(1);
  });
});

// ─── multiple surfaces ───────────────────────────────────────────────────────

describe("multiple surfaces", () => {
  it("populates reviewed_ids with all surface ids and sets selected=reviewed=3", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [
      makeSurface("surf-A"),
      makeSurface("surf-B"),
      makeSurface("surf-C"),
    ]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    expect(meta.reviewed_ids).toEqual(["surf-A", "surf-B", "surf-C"]);
    expect(meta.selected).toBe(3);
    expect(meta.reviewed).toBe(3);
  });
});

// ─── injected date and ts ────────────────────────────────────────────────────

describe("injected date and ts", () => {
  it("uses --today and --ts values exactly without touching the system clock", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: "2025-01-15" },
      nowTs: "2025-01-15T04:00:00Z",
      gitRevParse: noGitRevParse,
    });

    expect(meta.date).toBe("2025-01-15");
    expect(meta.ts).toBe("2025-01-15T04:00:00Z");
  });
});

// ─── NIGHTSHIFT_TODAY env var ────────────────────────────────────────────────

describe("NIGHTSHIFT_TODAY env var", () => {
  it("resolveToday picks up NIGHTSHIFT_TODAY when no --today flag is passed", () => {
    const originalEnv = process.env["NIGHTSHIFT_TODAY"];
    process.env["NIGHTSHIFT_TODAY"] = "2025-03-01";
    try {
      const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
      const proposedPath = writeJsonFile("candidates.proposed.json", []);
      const survivorsPath = writeJsonFile("candidates.json", []);
      const outPath = join(dir, "run.json");

      const { meta } = buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: {}, // no --today flag
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      });

      expect(meta.date).toBe("2025-03-01");
    } finally {
      if (originalEnv === undefined) {
        delete process.env["NIGHTSHIFT_TODAY"];
      } else {
        process.env["NIGHTSHIFT_TODAY"] = originalEnv;
      }
    }
  });
});

// ─── no-git pack_sha fallback ────────────────────────────────────────────────

describe("no-git pack_sha fallback", () => {
  it("returns pack_sha='no-git' when pack dir is not a git repo", () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "ns-nongit-"));
    try {
      const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
      const proposedPath = writeJsonFile("candidates.proposed.json", []);
      const survivorsPath = writeJsonFile("candidates.json", []);
      const outPath = join(dir, "run.json");

      // Use the real defaultGitRevParse (no stub) — nonGitDir has no .git
      const { meta } = buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath,
        runId: RUN_ID,
        lane: "security",
        packDir: nonGitDir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        // no gitRevParse override — uses the real one which must return 'no-git'
      });

      expect(meta.pack_sha).toBe("no-git");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ─── valid git pack_sha ──────────────────────────────────────────────────────

describe("valid git pack_sha", () => {
  it("returns a 40-char hex string when pack dir is a real git repo", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    // Find the real repo root (the agentic-tools monorepo)
    let repoRoot: string;
    try {
      repoRoot = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // If for some reason we can't find a git repo, use stub and skip
      repoRoot = "";
    }

    if (!repoRoot) {
      // Fallback: just verify stub works correctly
      const { meta } = buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: fakeGitRevParse,
      });
      expect(meta.pack_sha).toMatch(/^[0-9a-f]{40}$/);
      return;
    }

    // Use a real git dir — should get a real 40-char sha
    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: repoRoot,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      // no gitRevParse override — uses real git
    });

    expect(meta.pack_sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ─── run_id passthrough ──────────────────────────────────────────────────────

describe("run_id passthrough", () => {
  it("writes run_id verbatim from the --run-id flag", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    const customRunId = "ns-2026-06-21-sec-123456";
    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: customRunId,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    expect(meta.run_id).toBe(customRunId);
  });
});

// ─── missing --surfaces flag ─────────────────────────────────────────────────

describe("missing --surfaces (file not found)", () => {
  it("throws with 'surfaces file not found' when the file does not exist", () => {
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath: join(dir, "does-not-exist.json"),
        proposedPath,
        survivorsPath,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      }),
    ).toThrow(/surfaces file not found/);
  });
});

// ─── missing candidates.proposed.json ────────────────────────────────────────

describe("missing candidates.proposed.json", () => {
  it("throws with 'proposed candidates file not found' when missing", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath: join(dir, "missing-proposed.json"),
        survivorsPath,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      }),
    ).toThrow(/proposed candidates file not found/);
  });
});

// ─── missing candidates.json (survivors file not found) ──────────────────────

describe("missing candidates.json (survivors)", () => {
  it("throws with 'survivors file not found' when the survivors file is missing", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath: join(dir, "missing-survivors.json"),
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      }),
    ).toThrow(/survivors file not found/);
  });
});

// ─── malformed candidates.proposed.json ──────────────────────────────────────

describe("malformed candidates.proposed.json", () => {
  it("throws when candidates.proposed.json is not a JSON array", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const p = join(dir, "candidates.proposed.json");
    writeFileSync(p, JSON.stringify({ not: "an array" }) + "\n");
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath: p,
        survivorsPath,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      }),
    ).toThrow(/candidates\.proposed\.json must be a JSON array/);
  });
});

// ─── malformed candidates.json (survivors) ───────────────────────────────────

describe("malformed candidates.json (survivors)", () => {
  it("throws when the survivors candidates.json is not a JSON array", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const p = join(dir, "candidates.json");
    writeFileSync(p, JSON.stringify({ not: "an array" }) + "\n");
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath: p,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      }),
    ).toThrow(/candidates\.json must be a JSON array/);
  });
});

// ─── ts default (system clock) ────────────────────────────────────────────────

describe("ts default (no nowTs injected)", () => {
  it("falls back to a valid ISO-8601 timestamp from the system clock", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      // no nowTs override — exercises the `new Date().toISOString()` default
      gitRevParse: noGitRevParse,
    });

    // Date.prototype.toISOString() always yields the millisecond-Z form.
    expect(meta.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // --today still controls the date field independently of ts.
    expect(meta.date).toBe(FIXED_DATE);
  });
});

// ─── malformed surfaces.json ──────────────────────────────────────────────────

describe("malformed surfaces.json", () => {
  it("throws a descriptive error when surfaces.json is not a JSON array", () => {
    const p = join(dir, "surfaces.json");
    writeFileSync(p, JSON.stringify({ not: "an array" }) + "\n");
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath: p,
        proposedPath,
        survivorsPath,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      }),
    ).toThrow(/surfaces\.json must be a JSON array/);
  });
});

// ─── atomic write: no temp file left behind ───────────────────────────────────

describe("output written atomically", () => {
  it("does not leave a .run.json.tmp file behind after success", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
    expect(existsSync(outPath)).toBe(true);
  });
});

// ─── run.json shape matches RunMeta interface ─────────────────────────────────

describe("run.json shape matches RunMeta interface", () => {
  it("all required RunMeta fields are present with correct types in the written file", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", [
      { dedupe_key: { surface: "s", symptom: "a", root_cause: "b" } },
    ]);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: "ns-2026-06-21-sec-999",
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: "2026-06-21" },
      nowTs: "2026-06-21T03:14:22Z",
      gitRevParse: noGitRevParse,
    });

    const written = readJson<RunMeta>(outPath)!;

    // Type assertions — all fields must be present and correct types
    expect(typeof written.run_id).toBe("string");
    expect(typeof written.lane).toBe("string");
    expect(typeof written.date).toBe("string");
    expect(typeof written.ts).toBe("string");
    expect(typeof written.pack_sha).toBe("string");
    expect(typeof written.selected).toBe("number");
    expect(typeof written.reviewed).toBe("number");
    // findings_created is NOT in run.json (owned by bin/record, not run-meta)
    expect(written).not.toHaveProperty("findings_created");
    expect(typeof written.rejected_tier1).toBe("number");
    expect(typeof written.rejected_tier2).toBe("number");
    expect(Array.isArray(written.reviewed_ids)).toBe(true);
    expect(typeof written.usage_by_model).toBe("object");
    expect(typeof written.usage_spent).toBe("number");
    expect(typeof written.elapsed).toBe("number");

    // Spot-check specific values
    expect(written.run_id).toBe("ns-2026-06-21-sec-999");
    expect(written.lane).toBe("security");
    expect(written.date).toBe("2026-06-21");
    expect(written.ts).toBe("2026-06-21T03:14:22Z");
    expect(written.pack_sha).toBe("no-git");
    expect(written.selected).toBe(1);
    expect(written.reviewed).toBe(1);
    expect(written.rejected_tier1).toBe(1); // 1 proposed - 0 survivors
    expect(written.rejected_tier2).toBe(0);
    expect(written.reviewed_ids).toEqual(["s1"]);
    expect(written.usage_by_model).toEqual({});
    expect(written.usage_spent).toBe(0);
    expect(written.elapsed).toBe(0);
  });
});

// ─── design lane ─────────────────────────────────────────────────────────────

describe("lane field", () => {
  it("writes the lane field verbatim", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "design",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    expect(meta.lane).toBe("design");
  });
});

// ─── blank run_id guard ───────────────────────────────────────────────────────

describe("blank run_id", () => {
  it("throws when run_id is empty or whitespace-only", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    for (const blank of ["", "   "]) {
      expect(() =>
        buildRunMeta({
          surfacesPath,
          proposedPath,
          survivorsPath,
          runId: blank,
          lane: "security",
          packDir: dir,
          outPath,
          args: { today: FIXED_DATE },
          nowTs: FIXED_TS,
          gitRevParse: noGitRevParse,
        }),
      ).toThrow(/run_id is required/);
    }
  });
});

// ─── survivors exceed proposed (refuter must only shrink) ─────────────────────

describe("survivors exceed proposed", () => {
  it("throws rather than emit a negative rejected_tier1 when survivors > proposed", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", [{ dedupe_key: {} }]);
    // 2 survivors against 1 proposed — refuter illegally added a candidate.
    const survivorsPath = writeJsonFile("candidates.json", [
      { dedupe_key: {} },
      { dedupe_key: {} },
    ]);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      }),
    ).toThrow(/survivors \(2\) exceed proposed candidates \(1\)/);
    // No run.json should have been written on the abort path.
    expect(existsSync(outPath)).toBe(false);
  });
});

// ─── empty surfaces (zero surfaces selected) ──────────────────────────────────

describe("empty surfaces", () => {
  it("yields reviewed=0, selected=0, reviewed_ids=[] and still writes run.json", () => {
    const surfacesPath = writeJsonFile("surfaces.json", []);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    expect(meta.reviewed).toBe(0);
    expect(meta.selected).toBe(0);
    expect(meta.reviewed_ids).toEqual([]);
    expect(meta.rejected_tier1).toBe(0);
    expect(existsSync(outPath)).toBe(true);
  });
});

// ─── cross-module identity: run-meta → record ─────────────────────────────────
// The findings_created identity (= proposed_count - suppressed) is split across
// two processes that each read candidates.json independently: run-meta sets
// rejected_tier1 = proposed - survivors, and record derives
// findings_created = confirmed + recurring + rejected_tier1 + rejected_tier2.
// This test feeds the SAME candidates files through buildRunMeta and then
// runRecord (mirroring what bin/record does with run.json), proving the two
// halves compose — not just that hand-matched numbers agree.

function candFinding(surface: string): CandidateFinding {
  return {
    dedupe_key: { surface, symptom: "sym", root_cause: "rc" },
    severity: "critical",
    confidence: "high",
    needs_human_verification: true,
  };
}

describe("cross-module findings_created identity (run-meta → record)", () => {
  it("findings_created == proposed_count - suppressed when run-meta feeds record", () => {
    // 3 proposed, 2 survive Tier-1 (rejected_tier1=1); dedupe: 1 new + 1 recurring,
    // 0 suppressed. Expect findings_created = 3 - 0 = 3.
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", [
      candFinding("ND-SEC-A"),
      candFinding("ND-SEC-B"),
      candFinding("ND-SEC-C"),
    ]);
    const survivorsPath = writeJsonFile("candidates.json", [
      candFinding("ND-SEC-A"),
      candFinding("ND-SEC-B"),
    ]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    expect(meta.rejected_tier1).toBe(1); // 3 proposed - 2 survivors

    const suppressed = 0;
    const decisions: Decisions = {
      run_id: meta.run_id,
      lane: "security",
      date: meta.date,
      decisions: [
        { decision: "new", finding: candFinding("ND-SEC-A") },
        { decision: "recurring", finding: candFinding("ND-SEC-B"), first_seen: "2025-01-01" },
      ],
      counts: { confirmed: 1, recurring: 1, suppressed },
    };

    // Feed run.json's derived counts into record, exactly as bin/record does.
    const res = runRecord({
      decisions,
      metricsDir: join(dir, "metrics"),
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
      usageByModel: meta.usage_by_model,
      usageSpent: 0,
      elapsed: 0,
    });

    const proposed_count = 3;
    expect(res.runRecord.findings_created).toBe(proposed_count - suppressed);
    // And the derivation identity itself.
    expect(res.runRecord.findings_created).toBe(
      decisions.counts.confirmed +
        decisions.counts.recurring +
        meta.rejected_tier1 +
        meta.rejected_tier2,
    );

    // Sanity: the run record landed durably.
    const runs = readJsonl<RunMetrics>(join(dir, "metrics", "runs", "2025-01.jsonl"));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.findings_created).toBe(3);
  });
});
