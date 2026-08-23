// Rejection-branch tests for the v3 A2 validator surface. The happy paths are
// already covered in record-cost-run.test.ts (every record built by
// buildCostRecord asserts .ok === true); this suite is the other half — it
// proves the validators actually REJECT, so a malformed cost row can never
// enter the stateful path unnoticed.
import { describe, it, expect } from "vitest";
import { validateCostRecord, validateDailyMetrics, validateArtifact } from "./validate.js";
import type { CostRecord, DailyMetrics } from "./types.js";

const OK_COST: CostRecord = {
  run_id: "ns-2026-06-21-sec-01",
  lane: "security",
  date: "2026-06-21",
  ts: "2026-06-21T07:00:00Z",
  usd: 1.25,
  input_tokens: 100,
  output_tokens: 200,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  source: "cli-json",
  status: "ok",
};

const OK_DAILY: DailyMetrics = {
  date: "2026-06-21",
  lane: "security",
  ts: "2026-06-21T07:00:00Z",
  runs: 3,
  surfaces_total: 10,
  surfaces_green: 7,
  surfaces_stale: 2,
  surfaces_overdue: 1,
  open_findings: 4,
  coverage_freshness_pct: 70,
  median_staleness_ratio: 0.5,
  fpr_7d: null,
  fpr_30d: null,
};

/** Spread-then-override so each case differs from the valid baseline by one field. */
function cost(patch: Record<string, unknown>): unknown {
  return { ...OK_COST, ...patch };
}
function daily(patch: Record<string, unknown>): unknown {
  return { ...OK_DAILY, ...patch };
}

describe("validateCostRecord — non-object input", () => {
  it.each([
    ["null", null],
    ["a string", "not a record"],
    ["an array", [OK_COST]],
  ])("rejects %s without throwing", (_label, input) => {
    const result = validateCostRecord(input);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["cost-record: not an object"]);
  });
});

describe("validateCostRecord — required fields", () => {
  it("the baseline record is valid (guards the negative cases below)", () => {
    expect(validateCostRecord(OK_COST)).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ["run_id", { run_id: "" }, /run_id/],
    ["lane", { lane: "marketing" }, /lane/],
    ["date", { date: "21-06-2026" }, /date/],
    ["ts", { ts: 1750000000 }, /ts/],
    ["usd", { usd: "1.25" }, /usd/],
    ["input_tokens", { input_tokens: null }, /input_tokens/],
    ["output_tokens", { output_tokens: Number.NaN }, /output_tokens/],
    ["cache_read_tokens", { cache_read_tokens: Number.POSITIVE_INFINITY }, /cache_read_tokens/],
    ["cache_creation_tokens", { cache_creation_tokens: undefined }, /cache_creation_tokens/],
    ["source", { source: "guessed" }, /source/],
    ["status", { status: "warn" }, /status/],
  ])("rejects a bad %s", (_field, patch, pattern) => {
    const result = validateCostRecord(cost(patch));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => pattern.test(e))).toBe(true);
  });

  it("reports every bad field at once rather than stopping at the first", () => {
    const result = validateCostRecord(cost({ run_id: "", lane: "marketing", usd: "free" }));
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateCostRecord — terminal_reason is bound to status", () => {
  it("status:'error' without terminal_reason is rejected", () => {
    const result = validateCostRecord(cost({ status: "error" }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("cost-record: terminal_reason must be a non-empty string");
  });

  it("status:'error' with an empty terminal_reason is rejected", () => {
    const result = validateCostRecord(cost({ status: "error", terminal_reason: "" }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /terminal_reason/.test(e))).toBe(true);
  });

  it("status:'error' with a terminal_reason is accepted", () => {
    expect(
      validateCostRecord(cost({ status: "error", usd: 0, terminal_reason: "api_error" })).ok,
    ).toBe(true);
  });

  it("status:'ok' carrying a terminal_reason is rejected — a clean run has no failure reason", () => {
    const result = validateCostRecord(cost({ terminal_reason: "api_error" }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "cost-record: terminal_reason only allowed when status=error",
    );
  });
});

describe("validateDailyMetrics — additive cost_* fields (v3 A2)", () => {
  it("a rollup with no cost_* fields at all stays valid — the fields are optional", () => {
    expect(validateDailyMetrics(OK_DAILY)).toEqual({ ok: true, errors: [] });
  });

  it("accepts a fully populated cost window", () => {
    expect(
      validateDailyMetrics(
        daily({ cost_usd_7d: 1.97, cost_usd_30d: 5.5, cost_usd_avg_per_run_30d: 1.375 }),
      ).ok,
    ).toBe(true);
  });

  it.each([
    ["cost_usd_7d", "1.97"],
    ["cost_usd_30d", null],
    ["cost_usd_7d", Number.NaN],
    ["cost_usd_30d", Number.POSITIVE_INFINITY],
  ])("rejects a non-finite %s", (field, value) => {
    const result = validateDailyMetrics(daily({ [field]: value }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`daily-metrics: ${field} must be a finite number`);
  });

  it("cost_usd_avg_per_run_30d accepts null — no runs in the window is not an error", () => {
    expect(validateDailyMetrics(daily({ cost_usd_avg_per_run_30d: null })).ok).toBe(true);
  });

  it("rejects a non-numeric cost_usd_avg_per_run_30d", () => {
    const result = validateDailyMetrics(daily({ cost_usd_avg_per_run_30d: "1.375" }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "daily-metrics: cost_usd_avg_per_run_30d must be a number or null",
    );
  });
});

describe("validateArtifact routes the cost-record schema name", () => {
  it("dispatches 'cost-record' to validateCostRecord", () => {
    expect(validateArtifact("cost-record", OK_COST).ok).toBe(true);
    expect(validateArtifact("cost-record", cost({ status: "error" })).ok).toBe(false);
  });
});

describe("validateCostRecord — physically impossible values", () => {
  it("rejects negative spend — `--usd -100` must not file as valid", () => {
    const result = validateCostRecord(cost({ usd: -100 }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("cost-record: usd must be >= 0");
  });

  it("accepts usd 0 — a failed or free run is legitimate", () => {
    expect(validateCostRecord(cost({ usd: 0 })).ok).toBe(true);
  });

  it.each(["input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens"])(
    "rejects a negative %s",
    (field) => {
      const result = validateCostRecord(cost({ [field]: -1 }));
      expect(result.ok).toBe(false);
      expect(result.errors).toContain(`cost-record: ${field} must be a nonnegative integer`);
    },
  );

  it("rejects fractional token counts", () => {
    const result = validateCostRecord(cost({ input_tokens: 1.5 }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("cost-record: input_tokens must be a nonnegative integer");
  });

  it.each(["2026-99-99", "2026-13-01", "2026-02-30", "2026-00-10"])(
    "rejects the impossible date %s — shape alone is not a date",
    (bad) => {
      const result = validateCostRecord(cost({ date: bad }));
      expect(result.ok).toBe(false);
      expect(result.errors).toContain("cost-record: date must be a YYYY-MM-DD date");
    },
  );

  it("accepts a real leap day", () => {
    expect(validateCostRecord(cost({ date: "2028-02-29" })).ok).toBe(true);
  });

  it("rejects a non-leap-year Feb 29", () => {
    expect(validateCostRecord(cost({ date: "2026-02-29" })).ok).toBe(false);
  });
});
