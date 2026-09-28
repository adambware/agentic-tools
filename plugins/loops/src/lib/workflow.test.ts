import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyCounters } from "./session.js";
import { collectWorkflows, parseWorkflow } from "./workflow.js";

const agent = (model: string, state: string, tokens?: unknown) => ({ type: "workflow_agent", model, state, tokens });
/** The run-level fields every real record has; a test overrides only what it exercises. */
const FULL = { status: "completed", totalTokens: 0, phases: [], workflowProgress: [] };

describe("parseWorkflow", () => {
  it("reads a completed run", () => {
    const p = parseWorkflow({
      startTime: 1000,
      durationMs: 60_000,
      status: "completed",
      totalTokens: 300,
      phases: [{}, {}],
      workflowProgress: [{ type: "workflow_phase" }, agent("haiku", "done", 100), agent("sonnet", "done", 200)],
    });
    expect(p).toEqual({
      ok: true,
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
    expect(p.badRecords).toBe(0);
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

  it("rejects null and non-objects; defaults a missing status and model to unknown; skips non-object progress entries", () => {
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
    expect(p.badRecords).toBe(1); // the non-string status
  });

  it("counts each missing run-level field as a bad record, so a renamed field trips the counter", () => {
    const p = parseWorkflow({ startTime: 1, total_tokens: 9, phaseList: [{}], progress: [] });
    if (!p.ok) throw new Error("expected ok");
    expect(p.run.tokens).toBe(0);
    expect(p.run.status).toBe("unknown");
    expect(p.badRecords).toBe(4);
    const agentOnly = parseWorkflow({ ...FULL, startTime: 1, workflowProgress: [agent("m", "error")] });
    if (!agentOnly.ok) throw new Error("expected ok");
    // An errored agent legitimately has no tokens.
    expect(agentOnly.badRecords).toBe(0);
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
    writeFileSync(join(wf, "wf_1.json"), JSON.stringify({ ...FULL, startTime: 5, totalTokens: "x" }));
    writeFileSync(join(wf, "wf_2.json"), JSON.stringify({ ...FULL, startTime: 6, workflowProgress: [agent("m", "done", "y")] }));
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

  it("returns no runs for a missing projects dir", () => {
    const parse = emptyCounters();
    expect(collectWorkflows(join(dir, "nope"), 0, parse)).toEqual([]);
    expect(parse).toEqual(emptyCounters());
  });
});
