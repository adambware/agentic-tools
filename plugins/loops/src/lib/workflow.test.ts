import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyCounters } from "./session.js";
import { collectWorkflows, parseWorkflow } from "./workflow.js";

const agent = (model: string, state: string, tokens?: unknown) => ({ type: "workflow_agent", model, state, tokens });
/** The run-level fields every real record has; a test overrides only what it exercises. */
const FULL = { runId: "run-1", status: "completed", durationMs: 1, totalTokens: 0, phases: [], workflowProgress: [] };

describe("parseWorkflow", () => {
  it("reads a completed run", () => {
    const p = parseWorkflow({
      runId: "r",
      startTime: 1000,
      durationMs: 60_000,
      status: "completed",
      totalTokens: 300,
      phases: [{}, {}],
      workflowProgress: [{ type: "workflow_phase" }, agent("haiku", "done", 100), agent("sonnet", "done", 200)],
    });
    expect(p).toEqual({
      ok: true,
      runId: "r",
      badRecords: 0,
      run: {
        startMs: 1000,
        durationMs: 60_000,
        status: "completed",
        phases: 2,
        tokens: 300,
        agents: 2,
        agentsErrored: 0,
        agentsKilled: 0,
        byModel: { haiku: { agents: 1, tokens: 100 }, sonnet: { agents: 1, tokens: 200 } },
      },
    });
  });

  it("counts agents still running in a killed run as killed, and errored agents with no tokens as 0", () => {
    const p = parseWorkflow({
      runId: "k",
      startTime: 1000,
      status: "killed",
      totalTokens: 50,
      phases: [{}],
      workflowProgress: [
        agent("sonnet", "done", 50),
        agent("sonnet", "progress"),
        agent("sonnet", "start"),
        agent("haiku", "error"),
      ],
    });
    if (!p.ok) throw new Error("expected ok");
    expect(p.badRecords).toBe(1); // no durationMs: null, and counted
    expect(p.run.agentsKilled).toBe(2);
    expect(p.run.agentsErrored).toBe(1);
    expect(p.run.byModel).toEqual({ sonnet: { agents: 3, tokens: 50 }, haiku: { agents: 1, tokens: 0 } });
    expect(p.run.durationMs).toBeNull();
  });

  it("does not count running agents as killed in a failed run", () => {
    const p = parseWorkflow({ startTime: 1, status: "failed", workflowProgress: [agent("m", "progress")] });
    if (!p.ok) throw new Error("expected ok");
    expect(p.run.agentsKilled).toBe(0);
  });

  it("counts a run with no phases as 0 phases", () => {
    const p = parseWorkflow({ startTime: 1, status: "completed", totalTokens: 5 });
    if (!p.ok) throw new Error("expected ok");
    expect(p.run.phases).toBe(0);
    expect(p.run.agents).toBe(0);
  });

  it("rejects a non-numeric startTime; reads a string token count as 0 and bad", () => {
    expect(parseWorkflow({ startTime: "1000", status: "completed" })).toEqual({ ok: false });
    expect(parseWorkflow([1, 2])).toEqual({ ok: false });
    const p = parseWorkflow({ ...FULL, startTime: 1, totalTokens: "9", workflowProgress: [agent("m", "done", "4")] });
    if (!p.ok) throw new Error("expected ok");
    expect(p.run.tokens).toBe(0);
    expect(p.run.byModel.m!.tokens).toBe(0);
    expect(p.badRecords).toBe(2);
  });

  it("rejects null and non-objects; defaults a missing status and model to unknown; counts non-object progress entries", () => {
    expect(parseWorkflow(null)).toEqual({ ok: false });
    expect(parseWorkflow("wf")).toEqual({ ok: false });
    expect(parseWorkflow({ status: "completed" })).toEqual({ ok: false });
    const p = parseWorkflow({
      ...FULL,
      startTime: 1,
      status: 7,
      durationMs: "60",
      workflowProgress: [null, 3, "x", { type: "workflow_agent", state: "done", tokens: 5 }, agent("", "done", 1)],
    });
    if (!p.ok) throw new Error("expected ok");
    expect(p.run.status).toBe("unknown");
    expect(p.run.durationMs).toBeNull();
    expect(p.run.agents).toBe(2);
    expect(p.run.byModel).toEqual({ unknown: { agents: 2, tokens: 6 } });
    expect(p.badRecords).toBe(5); // the non-string status and durationMs, and the 3 non-object entries
  });

  it("counts an unknown workflowProgress entry type as drift, and skips it", () => {
    const p = parseWorkflow({
      ...FULL,
      startTime: 1,
      workflowProgress: [{ type: "workflow_phase" }, { type: "workflow_subagent", tokens: 9 }, { tokens: 1 }, agent("m", "done", 2)],
    });
    if (!p.ok) throw new Error("expected ok");
    expect([p.run.agents, p.run.byModel.m!.tokens, p.badRecords]).toEqual([1, 2, 2]);
  });

  it("reads a token count that is not a non-negative safe integer as 0 and bad, so sums stay finite", () => {
    const p = parseWorkflow({
      ...FULL,
      startTime: 1,
      totalTokens: 1e308,
      workflowProgress: [agent("m", "done", 1e308), agent("m", "done", 1.5), agent("m", "done", 2 ** 53), agent("m", "done", 7)],
    });
    if (!p.ok) throw new Error("expected ok");
    expect([p.run.tokens, p.run.byModel.m!.tokens, p.badRecords]).toEqual([0, 7, 4]);
  });

  it("counts each missing run-level field as a bad record, so a renamed field trips the counter", () => {
    const p = parseWorkflow({ startTime: 1, total_tokens: 9, phaseList: [{}], progress: [] });
    if (!p.ok) throw new Error("expected ok");
    expect(p.run.tokens).toBe(0);
    expect(p.run.status).toBe("unknown");
    expect(p.badRecords).toBe(6); // totalTokens, phases, workflowProgress, status, durationMs, runId
    const agentOnly = parseWorkflow({ ...FULL, startTime: 1, workflowProgress: [agent("m", "error")] });
    if (!agentOnly.ok) throw new Error("expected ok");
    // An errored agent legitimately has no tokens.
    expect(agentOnly.badRecords).toBe(0);
    const renamedState = parseWorkflow({ ...FULL, startTime: 1, workflowProgress: [agent("m", "failed", 3)] });
    if (!renamedState.ok) throw new Error("expected ok");
    expect(renamedState.badRecords).toBe(1);
    const negative = parseWorkflow({ ...FULL, startTime: 1, totalTokens: -5, workflowProgress: [agent("m", "done", -1)] });
    if (!negative.ok) throw new Error("expected ok");
    expect([negative.run.tokens, negative.run.byModel.m!.tokens, negative.badRecords]).toEqual([0, 0, 2]);
  });

  it("keys a model named __proto__ as a plain key, not the prototype", () => {
    const p = parseWorkflow({ ...FULL, startTime: 1, workflowProgress: [agent("__proto__", "done", 7)] });
    if (!p.ok) throw new Error("expected ok");
    expect(Object.entries(p.run.byModel)).toEqual([["__proto__", { agents: 1, tokens: 7 }]]);
    expect(({} as Record<string, unknown>).agents).toBeUndefined();
  });

  it("treats a non-array workflowProgress or phases as empty", () => {
    const p = parseWorkflow({ startTime: 1, status: "completed", phases: { a: 1 }, workflowProgress: { a: 1 } });
    if (!p.ok) throw new Error("expected ok");
    expect(p.run.phases).toBe(0);
    expect(p.run.agents).toBe(0);
  });
});

describe("collectWorkflows", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loops-wf-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads wf_*.json under <project>/<session>/workflows and counts bad files", () => {
    const wf = join(dir, "proj", "sess", "workflows");
    mkdirSync(wf, { recursive: true });
    writeFileSync(join(wf, "wf_ok.json"), JSON.stringify({ startTime: 5, status: "completed" }));
    writeFileSync(join(wf, "wf_badjson.json"), "{");
    writeFileSync(join(wf, "wf_badstart.json"), JSON.stringify({ startTime: "5" }));
    writeFileSync(join(wf, "notes.json"), "{");
    const parse = emptyCounters();
    const runs = collectWorkflows(dir, 0, parse);
    expect(runs).toHaveLength(1);
    expect(parse.bad_files).toBe(2);
  });

  it("sums per-run bad records into parse.bad_records", () => {
    const wf = join(dir, "proj", "sess", "workflows");
    mkdirSync(wf, { recursive: true });
    writeFileSync(join(wf, "wf_1.json"), JSON.stringify({ ...FULL, runId: "a", startTime: 5, totalTokens: "x" }));
    writeFileSync(join(wf, "wf_2.json"), JSON.stringify({ ...FULL, runId: "b", startTime: 6, workflowProgress: [agent("m", "done", "y")] }));
    const parse = emptyCounters();
    expect(collectWorkflows(dir, 0, parse)).toHaveLength(2);
    expect(parse.bad_records).toBe(2);
    expect(parse.bad_files).toBe(0);
  });

  it("skips runs modified before sinceMs, sessions without workflows/, and non-directory entries", () => {
    const wf = join(dir, "proj", "sess", "workflows");
    mkdirSync(wf, { recursive: true });
    mkdirSync(join(dir, "proj", "no-workflows"), { recursive: true });
    writeFileSync(join(dir, "proj", "sess.jsonl"), "");
    writeFileSync(join(dir, "stray.json"), "{");
    writeFileSync(join(wf, "wf_old.json"), JSON.stringify({ ...FULL, startTime: 1 }));
    writeFileSync(join(wf, "wf_new.json"), JSON.stringify({ ...FULL, startTime: 2 }));
    const old = new Date(Date.UTC(2020, 0, 1));
    utimesSync(join(wf, "wf_old.json"), old, old);
    const parse = emptyCounters();
    const runs = collectWorkflows(dir, Date.UTC(2021, 0, 1), parse);
    expect(runs.map((r) => r.startMs)).toEqual([2]);
    expect(parse).toEqual(emptyCounters());
  });

  it("counts a run copied into another session's workflows/ once, by runId", () => {
    for (const sess of ["orig", "fork"]) {
      mkdirSync(join(dir, "proj", sess, "workflows"), { recursive: true });
      writeFileSync(join(dir, "proj", sess, "workflows", "wf_x.json"), JSON.stringify({ ...FULL, startTime: 5 }));
    }
    const parse = emptyCounters();
    expect(collectWorkflows(dir, 0, parse)).toHaveLength(1);
    expect(parse.dup_records).toBe(1);
  });

  it("keeps the finished copy of a duplicated run, whatever the directory order, and counts its drift once", () => {
    const copies: Array<[string, object]> = [
      ["a-stale", { ...FULL, startTime: 5, status: "running", durationMs: "x", totalTokens: 10 }],
      ["b-done", { ...FULL, startTime: 5, durationMs: 90, totalTokens: 400, phases: "x" }],
      ["c-short", { ...FULL, startTime: 5, durationMs: 30, totalTokens: 100 }],
    ];
    for (const [sess, rec] of copies) {
      mkdirSync(join(dir, "proj", sess, "workflows"), { recursive: true });
      writeFileSync(join(dir, "proj", sess, "workflows", "wf_x.json"), JSON.stringify(rec));
    }
    const parse = emptyCounters();
    const runs = collectWorkflows(dir, 0, parse);
    expect(runs.map((r) => [r.status, r.tokens])).toEqual([["completed", 400]]);
    expect(parse.dup_records).toBe(2);
    expect(parse.bad_records).toBe(1); // only the kept copy's non-array phases
  });

  it("breaks a tie between equally finished, equally long copies by path, never by directory order", () => {
    // Same status and duration: only the path decides. Write the later path first, then the
    // earlier, so neither creation nor readdir order can be what picks the winner.
    for (const [sess, tokens] of [["z-copy", 2], ["a-orig", 1]] as const) {
      mkdirSync(join(dir, "proj", sess, "workflows"), { recursive: true });
      writeFileSync(join(dir, "proj", sess, "workflows", "wf_x.json"), JSON.stringify({ ...FULL, startTime: 5, totalTokens: tokens }));
    }
    const parse = emptyCounters();
    expect(collectWorkflows(dir, 0, parse).map((r) => r.tokens)).toEqual([1]);
    expect(parse.dup_records).toBe(1);
    // A different project dir sorts the same way: the full path decides, not the session name.
    mkdirSync(join(dir, "0proj", "zz", "workflows"), { recursive: true });
    writeFileSync(join(dir, "0proj", "zz", "workflows", "wf_x.json"), JSON.stringify({ ...FULL, startTime: 5, totalTokens: 3 }));
    expect(collectWorkflows(dir, 0, emptyCounters()).map((r) => r.tokens)).toEqual([3]);
  });

  it("reads a durationMs that is not a non-negative safe integer as bad and null, so the median stays finite", () => {
    for (const durationMs of [1e308, 1.5]) {
      const p = parseWorkflow({ ...FULL, startTime: 1, durationMs });
      if (!p.ok) throw new Error("expected ok");
      expect([p.run.durationMs, p.badRecords]).toEqual([null, 1]);
    }
  });

  it("treats an empty runId as missing, and a negative durationMs as bad and null", () => {
    const p = parseWorkflow({ ...FULL, runId: "", startTime: 1, durationMs: -3 });
    if (!p.ok) throw new Error("expected ok");
    expect([p.runId, p.run.durationMs, p.badRecords]).toEqual([undefined, null, 2]);
  });

  it.skipIf(process.getuid?.() === 0)("counts an unreadable workflows dir as a bad file, not an empty one", () => {
    const wf = join(dir, "proj", "sess", "workflows");
    mkdirSync(wf, { recursive: true });
    writeFileSync(join(wf, "wf_1.json"), JSON.stringify({ ...FULL, startTime: 5 }));
    chmodSync(wf, 0o000);
    try {
      const parse = emptyCounters();
      expect(collectWorkflows(dir, 0, parse)).toEqual([]);
      expect(parse.bad_files).toBe(1);
    } finally {
      chmodSync(wf, 0o755);
    }
  });

  it("returns no runs for a missing projects dir", () => {
    const parse = emptyCounters();
    expect(collectWorkflows(join(dir, "nope"), 0, parse)).toEqual([]);
    expect(parse).toEqual(emptyCounters());
  });
});
