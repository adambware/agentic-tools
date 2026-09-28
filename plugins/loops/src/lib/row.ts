// Pure row builder: windows, counts, medians. No I/O.
import type { ParseCounters, SessionStats } from "./session.js";
import type { RunStats } from "./workflow.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_DAYS = [7, 30] as const;
/** The widest window: files last modified before now - this are skipped. */
export const WIDEST_WINDOW_MS = Math.max(...WINDOW_DAYS) * DAY_MS;

export interface WorkflowWindow {
  runs: number;
  completed: number;
  killed: number;
  failed: number;
  phases_median: number | null;
  phases_max: number | null;
  tokens_sum: number;
  tokens_median: number | null;
  duration_ms_median: number | null;
  agents: number;
  agents_errored: number;
  agents_killed: number;
  by_model: Record<string, { agents: number; tokens: number }>;
}

export interface SessionWindow {
  n: number;
  with_usage: number;
  context_peak_median: number | null;
  context_peak_max: number | null;
  compactions_total: number;
  compacted: number;
  compacted_10plus: number;
}

export interface Window {
  workflows: WorkflowWindow;
  sessions: SessionWindow;
}

export interface Row {
  schema: 1;
  generated_at: string;
  window_end: string;
  w7: Window;
  w30: Window;
  parse: ParseCounters;
}

export function buildRow(sessions: SessionStats[], runs: RunStats[], parse: ParseCounters, now: number): Row {
  const iso = new Date(now).toISOString();
  const window = (days: number): Window => {
    const start = now - days * DAY_MS;
    const inWindow = (t: number) => t > start && t <= now;
    return { workflows: workflowWindow(runs, inWindow), sessions: sessionWindow(sessions, inWindow) };
  };
  return {
    schema: 1,
    generated_at: iso,
    window_end: iso,
    w7: window(7),
    w30: window(30),
    parse: { ...parse },
  };
}

function workflowWindow(all: RunStats[], inWindow: (t: number) => boolean): WorkflowWindow {
  const runs = all.filter((r) => inWindow(r.startMs));
  const byModel: Record<string, { agents: number; tokens: number }> = {};
  for (const r of runs) {
    for (const [model, m] of Object.entries(r.byModel)) {
      const slot = (byModel[model] ??= { agents: 0, tokens: 0 });
      slot.agents += m.agents;
      slot.tokens += m.tokens;
    }
  }
  const phases = runs.map((r) => r.phases);
  return {
    runs: runs.length,
    completed: runs.filter((r) => r.status === "completed").length,
    killed: runs.filter((r) => r.status === "killed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    phases_median: median(phases),
    phases_max: max(phases),
    tokens_sum: sum(runs.map((r) => r.tokens)),
    tokens_median: median(runs.map((r) => r.tokens)),
    duration_ms_median: median(runs.flatMap((r) => (r.durationMs === null ? [] : [r.durationMs]))),
    agents: sum(runs.map((r) => r.agents)),
    agents_errored: sum(runs.map((r) => r.agentsErrored)),
    agents_killed: sum(runs.map((r) => r.agentsKilled)),
    by_model: sortKeys(byModel),
  };
}

function sessionWindow(all: SessionStats[], inWindow: (t: number) => boolean): SessionWindow {
  let n = 0;
  let compactionsTotal = 0;
  let compacted = 0;
  let compacted10 = 0;
  const peaks: number[] = [];
  for (const s of all) {
    if (!s.recordTimes.some(inWindow)) continue;
    n++;
    const ctx = s.messages.filter(([t]) => inWindow(t)).map(([, c]) => c);
    if (ctx.length > 0) peaks.push(max(ctx)!);
    const compactions = s.compactions.filter(inWindow).length;
    compactionsTotal += compactions;
    if (compactions >= 1) compacted++;
    if (compactions >= 10) compacted10++;
  }
  return {
    n,
    with_usage: peaks.length,
    context_peak_median: median(peaks),
    context_peak_max: max(peaks),
    compactions_total: compactionsTotal,
    compacted,
    compacted_10plus: compacted10,
  };
}

/** Median of an empty set is null, never 0. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function max(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => (b > a ? b : a));
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
