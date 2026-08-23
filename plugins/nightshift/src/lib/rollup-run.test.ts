import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeDailyRollup, type RollupInput } from "./rollup-run.js";
import { runRollup } from "./rollup-cli.js";
import { readJsonl } from "./io.js";
import { MAX_STALENESS } from "./staleness.js";
import type { DailyMetrics, Lane, RegistryEntry, RunMetrics } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: string,
  last_reviewed: string | undefined,
  weight: RegistryEntry["weight"] = "medium",
  interval_days = 30,
): RegistryEntry {
  return {
    id,
    title: id,
    kind: "vector",
    area: [`app/${id}/*`],
    weight,
    interval_days,
    owner: "security",
    ...(last_reviewed !== undefined ? { last_reviewed } : {}),
  };
}

function makeRun(
  date: string,
  lane: Lane,
  findings_created: number,
  rejected_tier1: number,
  rejected_tier2: number,
): RunMetrics {
  return {
    run_id: `run-${date}-${lane}`,
    ts: `${date}T07:00:00Z`,
    date,
    lane,
    pack_sha: "abc",
    selected: 1,
    reviewed: 1,
    findings_created,
    confirmed: findings_created - rejected_tier1 - rejected_tier2,
    rejected_tier1,
    rejected_tier2,
    suppressed: 0,
    usage_by_model: {},
    usage_spent: 0,
    elapsed: 60,
  };
}

function baseInput(overrides: Partial<RollupInput> = {}): RollupInput {
  return {
    date: "2026-06-21",
    lane: "security",
    ts: "2026-06-21T07:00:00Z",
    entries: [],
    openFindingsCount: 0,
    runRecords: [],
    today: "2026-06-21",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeDailyRollup — core unit tests
// ---------------------------------------------------------------------------

describe("computeDailyRollup", () => {
  describe("surfaces_total === 0", () => {
    it("returns coverage_freshness_pct=100 and median_staleness_ratio=0", () => {
      const result = computeDailyRollup(baseInput({ entries: [] }));
      expect(result.surfaces_total).toBe(0);
      expect(result.surfaces_green).toBe(0);
      expect(result.surfaces_stale).toBe(0);
      expect(result.surfaces_overdue).toBe(0);
      expect(result.coverage_freshness_pct).toBe(100);
      expect(result.median_staleness_ratio).toBe(0);
    });
  });

  describe("freshness math and surfaces_* counts", () => {
    it("correctly bins entries into green/stale/overdue and sums to total", () => {
      // today = 2026-06-21
      // green: reviewed 10 days ago with 30-day interval → staleness = 10/30 = 0.33
      // stale: reviewed 40 days ago with 30-day interval → staleness = 40/30 = 1.33
      // overdue: reviewed 70 days ago with 30-day interval → staleness = 70/30 = 2.33
      const entries = [
        makeEntry("green-1", "2026-06-11", "medium", 30),
        makeEntry("stale-1", "2026-05-12", "medium", 30),
        makeEntry("overdue-1", "2026-04-12", "medium", 30),
      ];
      const result = computeDailyRollup(baseInput({ entries, today: "2026-06-21" }));
      expect(result.surfaces_total).toBe(3);
      expect(result.surfaces_green).toBe(1);
      expect(result.surfaces_stale).toBe(1);
      expect(result.surfaces_overdue).toBe(1);
      expect(result.surfaces_green + result.surfaces_stale + result.surfaces_overdue).toBe(
        result.surfaces_total,
      );
      // freshness: 1/3 = 33.3%
      expect(result.coverage_freshness_pct).toBe(33.3);
    });

    it("all green entries → freshness 100%", () => {
      const entries = [
        makeEntry("a", "2026-06-20", "medium", 30),
        makeEntry("b", "2026-06-19", "medium", 30),
      ];
      const result = computeDailyRollup(baseInput({ entries, today: "2026-06-21" }));
      expect(result.surfaces_green).toBe(2);
      expect(result.surfaces_stale).toBe(0);
      expect(result.surfaces_overdue).toBe(0);
      expect(result.coverage_freshness_pct).toBe(100);
    });

    it("boundary at staleness exactly 1.0 → green", () => {
      // reviewed exactly interval_days ago → staleness = 1.0 → green
      const entries = [makeEntry("exact", "2026-05-22", "medium", 30)]; // 30 days ago
      const result = computeDailyRollup(baseInput({ entries, today: "2026-06-21" }));
      expect(result.surfaces_green).toBe(1);
      expect(result.surfaces_stale).toBe(0);
    });

    it("boundary at staleness exactly 2.0 → stale (not overdue)", () => {
      // reviewed exactly 2 * interval_days ago → staleness = 2.0 → stale
      const entries = [makeEntry("exact2", "2026-05-22", "medium", 15)]; // 30 days ago, interval 15 → staleness 2.0
      const result = computeDailyRollup(baseInput({ entries, today: "2026-06-21" }));
      expect(result.surfaces_stale).toBe(1);
      expect(result.surfaces_overdue).toBe(0);
    });
  });

  describe("never-reviewed entry", () => {
    it("counts as overdue and pulls freshness down", () => {
      const entries = [
        makeEntry("reviewed", "2026-06-20", "medium", 30), // green
        makeEntry("never", undefined, "medium", 30), // no last_reviewed → MAX_STALENESS → overdue
      ];
      const result = computeDailyRollup(baseInput({ entries, today: "2026-06-21" }));
      expect(result.surfaces_green).toBe(1);
      expect(result.surfaces_overdue).toBe(1);
      expect(result.surfaces_stale).toBe(0);
      // freshness: 1/2 = 50%
      expect(result.coverage_freshness_pct).toBe(50);
    });
  });

  describe("median staleness", () => {
    it("computes median for odd number of entries", () => {
      // staleness values: [0.33, 1.33, 2.33]
      // sorted: [0.33, 1.33, 2.33] → median = 1.33
      const entries = [
        makeEntry("a", "2026-06-11", "medium", 30), // 10/30 = 0.33
        makeEntry("b", "2026-05-12", "medium", 30), // 40/30 = 1.33
        makeEntry("c", "2026-04-12", "medium", 30), // 70/30 = 2.33
      ];
      const result = computeDailyRollup(baseInput({ entries, today: "2026-06-21" }));
      expect(result.median_staleness_ratio).toBe(1.33);
    });

    it("computes median for even number of entries (average of two middle)", () => {
      // staleness: [0.33, 1.33] → median = (0.33 + 1.33) / 2 = 0.83
      const entries = [
        makeEntry("a", "2026-06-11", "medium", 30), // 10/30 = 0.333...
        makeEntry("b", "2026-05-12", "medium", 30), // 40/30 = 1.333...
      ];
      const result = computeDailyRollup(baseInput({ entries, today: "2026-06-21" }));
      // (0.3333 + 1.3333) / 2 = 0.8333 → rounded to 2dp = 0.83
      expect(result.median_staleness_ratio).toBe(0.83);
    });

    it("includes MAX_STALENESS value in median sort (never-reviewed)", () => {
      // Two entries: one green (staleness ~0.33), one never-reviewed (MAX_STALENESS)
      // sorted: [0.33, MAX_STALENESS] → median = (0.33 + MAX_STALENESS) / 2 (very large)
      const entries = [
        makeEntry("a", "2026-06-11", "medium", 30),
        makeEntry("b", undefined, "medium", 30),
      ];
      const result = computeDailyRollup(baseInput({ entries, today: "2026-06-21" }));
      // median will be enormous due to MAX_STALENESS, just verify it's >> 1
      expect(result.median_staleness_ratio).toBeGreaterThan(1e8);
    });
  });

  describe("runs count", () => {
    it("counts only run records matching the exact (date, lane)", () => {
      const runs: RunMetrics[] = [
        makeRun("2026-06-21", "security", 1, 0, 0),
        makeRun("2026-06-21", "security", 2, 1, 0), // same date+lane = 2 runs
        makeRun("2026-06-20", "security", 1, 0, 0), // wrong date
        makeRun("2026-06-21", "design", 1, 0, 0), // wrong lane
      ];
      const result = computeDailyRollup(baseInput({ runRecords: runs }));
      expect(result.runs).toBe(2);
    });

    it("returns runs=0 when no records match", () => {
      const runs: RunMetrics[] = [makeRun("2026-06-20", "security", 1, 0, 0)];
      const result = computeDailyRollup(baseInput({ runRecords: runs }));
      expect(result.runs).toBe(0);
    });
  });

  describe("FPR computation", () => {
    it("returns null for fpr_7d and fpr_30d when findings_created=0", () => {
      const runs: RunMetrics[] = [makeRun("2026-06-21", "security", 0, 0, 0)];
      const result = computeDailyRollup(baseInput({ runRecords: runs }));
      expect(result.fpr_7d).toBeNull();
      expect(result.fpr_30d).toBeNull();
    });

    it("computes correct FPR integer percentage when rejected and created > 0", () => {
      // 3 rejected out of 4 created = 75%
      const runs: RunMetrics[] = [makeRun("2026-06-21", "security", 4, 2, 1)];
      const result = computeDailyRollup(baseInput({ runRecords: runs }));
      expect(result.fpr_7d).toBe(75);
      expect(result.fpr_30d).toBe(75);
    });

    it("fpr_7d is null when all runs have findings_created=0 but fpr_30d is not", () => {
      // A run 10 days ago (outside 7d window, inside 30d window) with created>0
      // A run today with created=0
      const today = "2026-06-21";
      const runs: RunMetrics[] = [
        makeRun("2026-06-11", "security", 4, 1, 1), // 10 days ago → outside 7d, inside 30d
        makeRun("2026-06-21", "security", 0, 0, 0), // today, but created=0
      ];
      const result = computeDailyRollup(
        baseInput({ runRecords: runs, date: today, today }),
      );
      // 7d window: only today's run (created=0) → null
      expect(result.fpr_7d).toBeNull();
      // 30d window: both runs → created=4, rejected=2 → 50%
      expect(result.fpr_30d).toBe(50);
    });

    describe("FPR window boundary", () => {
      it("includes a run exactly N-1 days before endDate (inside window)", () => {
        // 7-day window: [date-6, date]. A run 6 days ago should be included.
        const runs: RunMetrics[] = [makeRun("2026-06-15", "security", 4, 2, 0)]; // 6 days before 2026-06-21
        const result = computeDailyRollup(
          baseInput({ runRecords: runs, date: "2026-06-21", today: "2026-06-21" }),
        );
        expect(result.fpr_7d).toBe(50); // 2/4 = 50%
      });

      it("excludes a run exactly N days before endDate (outside 7d window)", () => {
        // A run 7 days ago is outside the window (window is [date-6, date])
        const runs: RunMetrics[] = [makeRun("2026-06-14", "security", 4, 2, 0)]; // 7 days before 2026-06-21
        const result = computeDailyRollup(
          baseInput({ runRecords: runs, date: "2026-06-21", today: "2026-06-21" }),
        );
        expect(result.fpr_7d).toBeNull(); // excluded → created=0 → null
      });

      it("includes today's run (d=0, inside every window)", () => {
        const runs: RunMetrics[] = [makeRun("2026-06-21", "security", 2, 1, 0)];
        const result = computeDailyRollup(baseInput({ runRecords: runs }));
        expect(result.fpr_7d).toBe(50);
        expect(result.fpr_30d).toBe(50);
      });

      it("includes a run exactly 29 days before endDate (inside 30d window)", () => {
        const runs: RunMetrics[] = [makeRun("2026-05-23", "security", 2, 2, 0)]; // 29 days before 2026-06-21
        const result = computeDailyRollup(
          baseInput({ runRecords: runs, date: "2026-06-21", today: "2026-06-21" }),
        );
        expect(result.fpr_30d).toBe(100); // 2/2 = 100%
        expect(result.fpr_7d).toBeNull(); // outside 7d
      });

      it("excludes a run exactly 30 days before endDate (outside 30d window)", () => {
        const runs: RunMetrics[] = [makeRun("2026-05-22", "security", 2, 2, 0)]; // 30 days before 2026-06-21
        const result = computeDailyRollup(
          baseInput({ runRecords: runs, date: "2026-06-21", today: "2026-06-21" }),
        );
        expect(result.fpr_30d).toBeNull();
      });
    });

    it("aggregates multiple runs within the window for FPR", () => {
      const runs: RunMetrics[] = [
        makeRun("2026-06-21", "security", 3, 1, 0), // today: 3 created, 1 rejected
        makeRun("2026-06-19", "security", 5, 2, 1), // 2 days ago: 5 created, 3 rejected
      ];
      const result = computeDailyRollup(baseInput({ runRecords: runs }));
      // total: 8 created, 4 rejected → 50%
      expect(result.fpr_7d).toBe(50);
    });

    it("sums both rejected_tier1 and rejected_tier2 for FPR", () => {
      const runs: RunMetrics[] = [makeRun("2026-06-21", "security", 10, 3, 2)];
      const result = computeDailyRollup(baseInput({ runRecords: runs }));
      // (3 + 2) / 10 = 50%
      expect(result.fpr_7d).toBe(50);
    });
  });

  describe("output shape", () => {
    it("returns all required DailyMetrics fields", () => {
      const result = computeDailyRollup(
        baseInput({
          date: "2026-06-21",
          lane: "security",
          ts: "2026-06-21T07:00:00Z",
          openFindingsCount: 3,
        }),
      );
      expect(result.date).toBe("2026-06-21");
      expect(result.lane).toBe("security");
      expect(result.ts).toBe("2026-06-21T07:00:00Z");
      expect(result.open_findings).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// rollup-cli happy-path: writes and reads back from daily.jsonl
// ---------------------------------------------------------------------------

describe("runRollup (cli integration)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ns-rollup-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends a line to daily.jsonl and returns DailyMetrics", () => {
    const registryPath = join(dir, "vectors.yml");
    writeFileSync(
      registryPath,
      `vectors:
  - id: SEC-01
    title: Auth
    kind: vector
    area: ["app/auth/*"]
    weight: critical
    interval_days: 7
    owner: security
    last_reviewed: 2026-06-20
`,
    );

    const metricsDir = join(dir, "metrics");
    mkdirSync(metricsDir, { recursive: true });
    const dailyPath = join(metricsDir, "daily.jsonl");

    const result = runRollup({
      registryPath,
      metricsDir,
      lane: "security",
      today: "2026-06-21",
      date: "2026-06-21",
      ts: "2026-06-21T07:00:00Z",
      outPath: dailyPath,
    });

    expect(result.date).toBe("2026-06-21");
    expect(result.lane).toBe("security");
    expect(result.surfaces_total).toBe(1);
    expect(result.surfaces_green).toBe(1); // 1/7 = 0.14, within interval

    const lines = readJsonl<DailyMetrics>(dailyPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.date).toBe("2026-06-21");
    expect(lines[0]!.surfaces_total).toBe(1);
  });

  it("appends a second line without overwriting the first", () => {
    const registryPath = join(dir, "vectors.yml");
    writeFileSync(
      registryPath,
      `vectors:
  - id: SEC-01
    title: Auth
    kind: vector
    area: ["app/auth/*"]
    weight: critical
    interval_days: 7
    owner: security
    last_reviewed: 2026-06-20
`,
    );

    const metricsDir = join(dir, "metrics");
    mkdirSync(metricsDir, { recursive: true });
    const dailyPath = join(metricsDir, "daily.jsonl");

    runRollup({
      registryPath,
      metricsDir,
      lane: "security",
      today: "2026-06-21",
      ts: "2026-06-21T07:00:00Z",
      outPath: dailyPath,
    });
    runRollup({
      registryPath,
      metricsDir,
      lane: "security",
      today: "2026-06-21",
      ts: "2026-06-21T08:00:00Z",
      outPath: dailyPath,
    });

    const lines = readJsonl<DailyMetrics>(dailyPath);
    // both lines present (append-only; reader uses max-ts dedup)
    expect(lines).toHaveLength(2);
    expect(lines[0]!.ts).toBe("2026-06-21T07:00:00Z");
    expect(lines[1]!.ts).toBe("2026-06-21T08:00:00Z");
  });

  it("throws when registry file is missing", () => {
    const metricsDir = join(dir, "metrics");
    mkdirSync(metricsDir, { recursive: true });
    expect(() =>
      runRollup({
        registryPath: join(dir, "nope.yml"),
        metricsDir,
        lane: "security",
        today: "2026-06-21",
        ts: "2026-06-21T07:00:00Z",
      }),
    ).toThrow(/registry not found/);
  });
});

// ---------------------------------------------------------------------------
// Cost windows (v3 A2) — cost_usd_7d / cost_usd_30d / cost_usd_avg_per_run_30d
// ---------------------------------------------------------------------------

function makeCost(
  date: string,
  usd: number,
  status: "ok" | "error" = "ok",
  lane: Lane = "security",
): import("./types.js").CostRecord {
  return {
    run_id: `run-${date}-${lane}-${usd}`,
    lane,
    date,
    ts: `${date}T07:00:00Z`,
    usd,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    source: "cli-json",
    status,
    ...(status === "error" ? { terminal_reason: "api_error" } : {}),
  };
}

describe("computeDailyRollup — cost windows", () => {
  it("omitted costRecords yields zero sums and a null average (additive default)", () => {
    const result = computeDailyRollup(baseInput());
    expect(result.cost_usd_7d).toBe(0);
    expect(result.cost_usd_30d).toBe(0);
    expect(result.cost_usd_avg_per_run_30d).toBeNull();
  });

  it("windows are trailing and inclusive: day-6 is in the 7d window, day-7 is out", () => {
    const result = computeDailyRollup(
      baseInput({
        date: "2026-06-21",
        costRecords: [
          makeCost("2026-06-15", 1.0), // 6 days back -> in 7d
          makeCost("2026-06-14", 2.0), // 7 days back -> out of 7d, in 30d
          makeCost("2026-05-23", 4.0), // 29 days back -> in 30d
          makeCost("2026-05-22", 8.0), // 30 days back -> out of 30d
          makeCost("2026-06-22", 16.0), // future -> out of every window
        ],
      }),
    );
    expect(result.cost_usd_7d).toBeCloseTo(1.0, 4);
    expect(result.cost_usd_30d).toBeCloseTo(7.0, 4);
    expect(result.cost_usd_avg_per_run_30d).toBeCloseTo(7.0 / 3, 4);
  });

  it("error rows count in the sums but are excluded from the per-run average", () => {
    const result = computeDailyRollup(
      baseInput({
        date: "2026-06-21",
        costRecords: [
          makeCost("2026-06-20", 1.5),
          makeCost("2026-06-19", 0, "error"),
          makeCost("2026-06-18", 2.5),
        ],
      }),
    );
    // Sums include the error row's usd (honest total spend).
    expect(result.cost_usd_7d).toBeCloseTo(4.0, 4);
    expect(result.cost_usd_30d).toBeCloseTo(4.0, 4);
    // Average is over ok rows only: (1.5 + 2.5) / 2 — the $0 error row must not
    // drag it down to 1.33.
    expect(result.cost_usd_avg_per_run_30d).toBeCloseTo(2.0, 4);
  });

  it("a window with only error rows averages to null, not 0", () => {
    const result = computeDailyRollup(
      baseInput({ date: "2026-06-21", costRecords: [makeCost("2026-06-20", 0, "error")] }),
    );
    expect(result.cost_usd_7d).toBe(0);
    expect(result.cost_usd_avg_per_run_30d).toBeNull();
  });

  it("filters cost records to the rollup's lane", () => {
    const result = computeDailyRollup(
      baseInput({
        lane: "security",
        date: "2026-06-21",
        costRecords: [
          makeCost("2026-06-20", 1.0, "ok", "security"),
          makeCost("2026-06-20", 100.0, "ok", "design"),
        ],
      }),
    );
    expect(result.cost_usd_7d).toBeCloseTo(1.0, 4);
    expect(result.cost_usd_avg_per_run_30d).toBeCloseTo(1.0, 4);
  });
});
