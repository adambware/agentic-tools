import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyCounters } from "./session.js";
import { collectWorkflows, parseWorkflow } from "./workflow.js";

const agent = (model: string, state: string, tokens?: unknown) => ({ type: "workflow_agent", model, state, tokens });

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
    const p = parseWorkflow({ startTime: 1, totalTokens: "9", workflowProgress: [agent("m", "done", "4")] });
    if (!p.ok) throw new Error("expected ok");
    expect(p.run.tokens).toBe(0);
    expect(p.run.byModel.m!.tokens).toBe(0);
    expect(p.badRecords).toBe(2);
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
});
