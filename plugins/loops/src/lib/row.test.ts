import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRow, DAY_MS, median, VERSION } from "./row.js";
import { emptyCounters, type SessionStats } from "./session.js";
import type { RunStats } from "./workflow.js";

const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const ago = (days: number) => NOW - days * DAY_MS;

function session(p: Partial<SessionStats>): SessionStats {
  const messages = p.messages ?? [];
  const compactions = p.compactions ?? [];
  return {
    file: "s.jsonl",
    recordTimes: p.recordTimes ?? [...messages.map(([t]) => t), ...compactions],
    messages,
    compactions,
    naive: { usage_records: 0, compact_records: 0 },
  };
}

function run(p: Partial<RunStats>): RunStats {
  return {
    startMs: ago(1),
    durationMs: 1000,
    status: "completed",
    phases: 1,
    tokens: 10,
    agents: 0,
    agentsErrored: 0,
    agentsKilled: 0,
    byModel: {},
    ...p,
  };
}

describe("VERSION", () => {
  it("matches package.json, and every row carries it", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
    expect(buildRow([], [], emptyCounters(), 0).version).toBe(VERSION);
  });
});

describe("median", () => {
  it("is null for an empty set and averages the middle pair", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("buildRow", () => {
  it("gives zero counts and null medians for no data", () => {
    const row = buildRow([], [], emptyCounters(), NOW);
    expect(row.schema).toBe(1);
    expect(row.generated_at).toBe("2026-09-01T00:00:00.000Z");
    expect(row.window_end).toBe(row.generated_at);
    expect(row.w7.sessions).toEqual({
      n: 0,
      with_usage: 0,
      context_peak_median: null,
      context_peak_max: null,
      compactions_total: 0,
      compacted: 0,
      compacted_10plus: 0,
    });
    expect(row.w30.workflows).toMatchObject({
      runs: 0,
      phases_median: null,
      phases_max: null,
      tokens_sum: 0,
      tokens_median: null,
      duration_ms_median: null,
      by_model: {},
    });
  });

  it("counts a session with no usage in n but not with_usage", () => {
    const row = buildRow([session({ recordTimes: [ago(1)] })], [], emptyCounters(), NOW);
    expect(row.w7.sessions.n).toBe(1);
    expect(row.w7.sessions.with_usage).toBe(0);
    expect(row.w7.sessions.context_peak_median).toBeNull();
  });

  it("splits one session's peak and compactions between w7 and w30 by record time", () => {
    const s = session({
      messages: [
        [ago(3), 1000],
        [ago(20), 9000],
      ],
      compactions: [ago(3), ago(20), ago(20)],
    });
    const row = buildRow([s], [], emptyCounters(), NOW);
    expect(row.w7.sessions).toMatchObject({ n: 1, context_peak_max: 1000, compactions_total: 1, compacted: 1 });
    expect(row.w30.sessions).toMatchObject({ n: 1, context_peak_max: 9000, compactions_total: 3, compacted: 1 });
  });

  it("counts compacted_10plus at ten compactions in the window", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ago(1) + i);
    const row = buildRow([session({ compactions: ten }), session({ compactions: ten.slice(1) })], [], emptyCounters(), NOW);
    expect(row.w7.sessions).toMatchObject({ n: 2, compactions_total: 19, compacted: 2, compacted_10plus: 1 });
  });

  it("windows are (now - N days, now]: the start is excluded, 1 ms after is included", () => {
    const edge = ago(7);
    const sessions = [session({ recordTimes: [edge] }), session({ recordTimes: [edge + 1] })];
    const runs = [run({ startMs: edge }), run({ startMs: edge + 1 }), run({ startMs: NOW + 1 })];
    const row = buildRow(sessions, runs, emptyCounters(), NOW);
    expect(row.w7.sessions.n).toBe(1);
    expect(row.w7.workflows.runs).toBe(1);
    expect(row.w30.sessions.n).toBe(2);
    expect(row.w30.workflows.runs).toBe(2);
  });

  it("aggregates workflow runs", () => {
    const runs = [
      run({ phases: 2, tokens: 300, durationMs: 60_000, agents: 2, byModel: { h: { agents: 1, tokens: 100 }, s: { agents: 1, tokens: 200 } } }),
      run({ status: "killed", phases: 1, tokens: 50, durationMs: null, agents: 3, agentsKilled: 1, agentsErrored: 1, byModel: { s: { agents: 3, tokens: 50 } } }),
      run({ status: "failed", phases: 5, tokens: 0, durationMs: 10 }),
    ];
    const row = buildRow([], runs, emptyCounters(), NOW);
    expect(row.w7.workflows).toEqual({
      runs: 3,
      completed: 1,
      killed: 1,
      failed: 1,
      other: 0,
      phases_median: 2,
      phases_max: 5,
      tokens_sum: 350,
      tokens_median: 50,
      duration_ms_median: 30_005,
      agents: 5,
      agents_errored: 1,
      agents_killed: 1,
      by_model: { h: { agents: 1, tokens: 100 }, s: { agents: 4, tokens: 250 } },
    });
  });

  it("counts a running or renamed status as other, so runs = completed + killed + failed + other", () => {
    const runs = [run({}), run({ status: "running" }), run({ status: "cancelled" }), run({ status: "unknown" })];
    const w = buildRow([], runs, emptyCounters(), NOW).w7.workflows;
    expect([w.runs, w.completed, w.killed, w.failed, w.other]).toEqual([4, 1, 0, 0, 3]);
  });

  it("merges a model named __proto__ as a plain key, not the prototype", () => {
    const byModel = Object.fromEntries([["__proto__", { agents: 1, tokens: 2 }]]);
    const w = buildRow([], [run({ byModel }), run({ byModel })], emptyCounters(), NOW).w7.workflows;
    expect(Object.entries(w.by_model)).toEqual([["__proto__", { agents: 2, tokens: 4 }]]);
    expect(({} as Record<string, unknown>).agents).toBeUndefined();
  });

  it("sorts by_model keys regardless of the order runs report them", () => {
    const runs = [run({ byModel: { zeta: { agents: 1, tokens: 1 }, alpha: { agents: 1, tokens: 2 } } }), run({ byModel: { mid: { agents: 1, tokens: 3 } } })];
    const row = buildRow([], runs, emptyCounters(), NOW);
    expect(Object.keys(row.w7.workflows.by_model)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("excludes session records after now and counts usage only from in-window messages", () => {
    const future = session({ recordTimes: [NOW + 1], messages: [[NOW + 1, 50]], compactions: [NOW + 1] });
    const oldUsage = session({ recordTimes: [ago(1), ago(40)], messages: [[ago(40), 700]] });
    const row = buildRow([future, oldUsage], [], emptyCounters(), NOW);
    expect(row.w30.sessions).toMatchObject({ n: 1, with_usage: 0, context_peak_max: null, compactions_total: 0 });
  });

  it("copies parse counters instead of aliasing them", () => {
    const parse = emptyCounters();
    const row = buildRow([], [], parse, NOW);
    parse.bad_lines = 9;
    expect(row.parse.bad_lines).toBe(0);
  });
});
