import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Write reviewed.json (the ids the review phase actually covered). */
function writeReviewed(ids: unknown): string {
  return writeJsonFile("reviewed.json", ids);
}

/** Stub gitRevParse that returns 'no-git' (simulates non-git directory). */
const noGitRevParse = (_packDir: string): string => "no-git";

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
    const reviewedPath = writeReviewed(["surface-id-1"]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed(["surface-id-1"]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed(["surface-id-1"]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed(["surf-A", "surf-B", "surf-C"]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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

// ─── reviewed.json (surfaces ACTUALLY reviewed) ──────────────────────────────
// reviewed_ids must come from the review phase's reviewed.json, never from
// "all selected": bin/record stamps last_reviewed/status=green for every
// reviewed id, so assuming all-selected silently marks unreviewed surfaces
// fresh whenever K > 1. The file is model-written, so every id is gated:
// non-empty string, unique, and a member of the selected surfaces.

describe("reviewed.json gate", () => {
  function buildWithReviewed(reviewed: unknown, surfaceIds = ["surf-A", "surf-B", "surf-C"]) {
    const surfacesPath = writeJsonFile("surfaces.json", surfaceIds.map(makeSurface));
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const reviewedPath =
      reviewed === undefined ? join(dir, "no-reviewed.json") : writeReviewed(reviewed);
    const outPath = join(dir, "run.json");
    return () =>
      buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath,
        reviewedPath,
        runId: RUN_ID,
        lane: "security",
        packDir: dir,
        outPath,
        args: { today: FIXED_DATE },
        nowTs: FIXED_TS,
        gitRevParse: noGitRevParse,
      });
  }

  it("partial review: selected=3 but reviewed=1 when reviewed.json lists one id (K>1)", () => {
    const { meta } = buildWithReviewed(["surf-B"])();
    expect(meta.selected).toBe(3);
    expect(meta.reviewed).toBe(1);
    expect(meta.reviewed_ids).toEqual(["surf-B"]);
  });

  it("empty reviewed.json is honest: reviewed=0, nothing stamped, selected preserved", () => {
    const { meta } = buildWithReviewed([])();
    expect(meta.selected).toBe(3);
    expect(meta.reviewed).toBe(0);
    expect(meta.reviewed_ids).toEqual([]);
  });

  it("throws when reviewed.json is missing", () => {
    expect(buildWithReviewed(undefined)).toThrow(/reviewed file not found/);
  });

  it("throws when reviewed.json is not an array", () => {
    expect(buildWithReviewed({ reviewed: ["surf-A"] })).toThrow(
      /reviewed\.json must be a JSON array/,
    );
  });

  it("throws on a non-string or empty-string id", () => {
    expect(buildWithReviewed([42])).toThrow(/\[0\] must be a non-empty string surface id/);
    expect(buildWithReviewed(["surf-A", ""])).toThrow(
      /\[1\] must be a non-empty string surface id/,
    );
  });

  it("throws on a duplicate id", () => {
    expect(buildWithReviewed(["surf-A", "surf-A"])).toThrow(/\[1\] duplicate surface id: surf-A/);
  });

  it("throws when an id is not among the selected surfaces", () => {
    expect(buildWithReviewed(["surf-A", "not-selected"])).toThrow(
      /\[1\] id not among the selected surfaces: not-selected/,
    );
  });
});

// ─── cross-module: only ACTUALLY-reviewed ids get stamped in the registry ─────
// The P1 staleness-corruption bug: with K>1 and a review phase that covered
// only one surface, record must stamp last_reviewed/status on that surface
// alone — the unreviewed selected surfaces stay stale and reselect next run.

describe("cross-module registry stamping (run-meta → record)", () => {
  it("stamps last_reviewed only for reviewed.json ids, not all selected", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [
      makeSurface("surf-A"),
      makeSurface("surf-B"),
      makeSurface("surf-C"),
    ]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const reviewedPath = writeReviewed(["surf-B"]);
    const outPath = join(dir, "run.json");
    const registryPath = join(dir, "vectors.yml");
    writeFileSync(
      registryPath,
      [
        "vectors:",
        "  - id: surf-A",
        "    title: A",
        "  - id: surf-B",
        "    title: B",
        "  - id: surf-C",
        "    title: C",
        "",
      ].join("\n"),
    );

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
      runId: RUN_ID,
      lane: "security",
      packDir: dir,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
      gitRevParse: noGitRevParse,
    });

    runRecord({
      decisions: {
        run_id: meta.run_id,
        lane: "security",
        date: meta.date,
        decisions: [],
        counts: { confirmed: 0, recurring: 0, suppressed: 0 },
      },
      metricsDir: join(dir, "metrics"),
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
      usageByModel: meta.usage_by_model,
      usageSpent: 0,
      elapsed: 0,
    });

    const registry = readFileSync(registryPath, "utf8");
    // Exactly ONE entry stamped — the actually-reviewed surf-B.
    expect(registry.match(/last_reviewed/g)).toHaveLength(1);
    expect(registry).toMatch(/id: surf-B[\s\S]*?last_reviewed: 2025-01-15/);
    expect(registry).toMatch(/id: surf-B[\s\S]*?status: green/);
    // surf-A and surf-C blocks are byte-identical to the seed — no stamp added.
    expect(registry).toContain("- id: surf-A\n    title: A\n  - id: surf-B");
    expect(registry.trimEnd().endsWith("title: C")).toBe(true);
  });
});

// ─── injected date and ts ────────────────────────────────────────────────────

describe("injected date and ts", () => {
  it("uses --today and --ts values exactly without touching the system clock", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
      const reviewedPath = writeReviewed(["s1"]);
      const outPath = join(dir, "run.json");

      const { meta } = buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath,
        reviewedPath,
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
      const reviewedPath = writeReviewed(["s1"]);
      const outPath = join(dir, "run.json");

      // Use the real defaultGitRevParse (no stub) — nonGitDir has no .git
      const { meta } = buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath,
        reviewedPath,
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

// The test file always lives inside the agentic-tools git repo, so its own
// directory is a reliable real-git packDir. (The previous version pointed git
// at the throwaway temp `dir`, which is never a git repo, so it always fell
// back to a stub and never exercised the real defaultGitRevParse — Copilot
// PR #9.) Resolve the repo dir + expected HEAD once, here, from a known-in-repo
// path so the real-git branch actually runs.
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
function repoHeadSha(): string | null {
  try {
    return execFileSync("git", ["-C", TEST_DIR, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null; // git binary truly unavailable (not a normal checkout)
  }
}

describe("valid git pack_sha", () => {
  it("derives the real HEAD sha via defaultGitRevParse when packDir is a git repo", () => {
    const expectedSha = repoHeadSha();
    // In any normal checkout this is non-null; only skip if git is absent.
    if (!expectedSha) return;
    expect(expectedSha).toMatch(/^[0-9a-f]{40}$/);

    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    // packDir is the test file's own dir (inside the repo) and NO gitRevParse
    // override — this genuinely exercises defaultGitRevParse against a real repo.
    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
      runId: RUN_ID,
      lane: "security",
      packDir: TEST_DIR,
      outPath,
      args: { today: FIXED_DATE },
      nowTs: FIXED_TS,
    });

    expect(meta.pack_sha).toBe(expectedSha);
    expect(meta.pack_sha).not.toBe("no-git");
  });
});

// ─── run_id passthrough ──────────────────────────────────────────────────────

describe("run_id passthrough", () => {
  it("writes run_id verbatim from the --run-id flag", () => {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    const customRunId = "ns-2026-06-21-sec-123456";
    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed([]);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath: join(dir, "does-not-exist.json"),
        proposedPath,
        survivorsPath,
        reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath: join(dir, "missing-proposed.json"),
        survivorsPath,
        reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath: join(dir, "missing-survivors.json"),
        reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath: p,
        survivorsPath,
        reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath: p,
        reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed([]);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath: p,
        proposedPath,
        survivorsPath,
        reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    for (const blank of ["", "   "]) {
      expect(() =>
        buildRunMeta({
          surfacesPath,
          proposedPath,
          survivorsPath,
          reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    expect(() =>
      buildRunMeta({
        surfacesPath,
        proposedPath,
        survivorsPath,
        reviewedPath,
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

// ─── survivor identity (refuter may remove, never substitute) ─────────────────
// The length guard alone would let a refuter swap proposed candidates for
// DIFFERENT same-count findings — corrupting rejected_tier1 (the FPR
// denominator) with valid-looking data. Identity = canonical dedupe_key string
// (same canonicalization as bin/dedupe), multiset semantics.

describe("survivor identity check", () => {
  function build(proposed: unknown[], survivors: unknown[]) {
    const surfacesPath = writeJsonFile("surfaces.json", [makeSurface("s1")]);
    const proposedPath = writeJsonFile("candidates.proposed.json", proposed);
    const survivorsPath = writeJsonFile("candidates.json", survivors);
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");
    return {
      outPath,
      run: () =>
        buildRunMeta({
          surfacesPath,
          proposedPath,
          survivorsPath,
          reviewedPath,
          runId: RUN_ID,
          lane: "security" as const,
          packDir: dir,
          outPath,
          args: { today: FIXED_DATE },
          nowTs: FIXED_TS,
          gitRevParse: noGitRevParse,
        }),
    };
  }
  const key = (symptom: string) => ({
    dedupe_key: { surface: "s", symptom, root_cause: "rc" },
  });

  it("throws when a survivor's dedupe_key matches no proposed candidate (substitution)", () => {
    const { outPath, run } = build([key("proposed-a")], [key("swapped-in")]);
    expect(run).toThrow(/does not match any proposed candidate/);
    expect(existsSync(outPath)).toBe(false);
  });

  it("throws when a duplicated survivor key outnumbers its proposed occurrences", () => {
    const { run } = build([key("a"), key("b")], [key("a"), key("a")]);
    expect(run).toThrow(/does not match any proposed candidate/);
  });

  it("throws when a survivor lacks a well-formed dedupe_key", () => {
    const { run } = build([key("a")], [{ dedupe_key: {} }]);
    expect(run).toThrow(/survivor \[0\] has no well-formed dedupe_key/);
  });

  it("allows duplicate keys when proposed carries the same duplicates", () => {
    const { run } = build([key("a"), key("a")], [key("a"), key("a")]);
    const { meta } = run();
    expect(meta.rejected_tier1).toBe(0);
  });

  it("differing severity on a matching dedupe_key still matches (identity is the key alone)", () => {
    const { run } = build(
      [{ ...key("a"), severity: "low" }],
      [{ ...key("a"), severity: "critical" }],
    );
    const { meta } = run();
    expect(meta.rejected_tier1).toBe(0);
  });
});

// ─── empty surfaces (zero surfaces selected) ──────────────────────────────────

describe("empty surfaces", () => {
  it("yields reviewed=0, selected=0, reviewed_ids=[] and still writes run.json", () => {
    const surfacesPath = writeJsonFile("surfaces.json", []);
    const proposedPath = writeJsonFile("candidates.proposed.json", []);
    const survivorsPath = writeJsonFile("candidates.json", []);
    const reviewedPath = writeReviewed([]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
    const reviewedPath = writeReviewed(["s1"]);
    const outPath = join(dir, "run.json");

    const { meta } = buildRunMeta({
      surfacesPath,
      proposedPath,
      survivorsPath,
      reviewedPath,
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
