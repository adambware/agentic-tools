// Workflow run records: ~/.claude/projects/<project>/<session>/workflows/wf_*.json,
// one JSON document per run.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ParseCounters } from "./session.js";

export interface RunStats {
  startMs: number;
  /** null when the record has no numeric durationMs (excluded from the median). */
  durationMs: number | null;
  status: string;
  phases: number;
  tokens: number;
  agents: number;
  agentsErrored: number;
  agentsKilled: number;
  byModel: Record<string, { agents: number; tokens: number }>;
}

export type ParsedWorkflow =
  | { ok: true; run: RunStats; runId: string | undefined; badRecords: number }
  | { ok: false };

type Rec = Record<string, unknown>;

/** Every agent state seen in real records; another one is a renamed state (format drift). */
const AGENT_STATES = new Set(["start", "progress", "done", "error"]);

/** Parse one run record. A non-object or a non-numeric startTime is a bad file. */
export function parseWorkflow(json: unknown): ParsedWorkflow {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return { ok: false };
  const rec = json as Rec;
  if (typeof rec.startTime !== "number" || !Number.isFinite(rec.startTime)) return { ok: false };

  let badRecords = 0;
  const num = (v: unknown): number => {
    if (v === undefined || v === null) return 0;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    badRecords++;
    return 0;
  };

  // A missing run-level field still reads as 0 or empty, but it is counted: every real record
  // has these, so their absence is the format drift the parse counters exist to catch.
  if (rec.totalTokens === undefined || rec.totalTokens === null) badRecords++;
  if (!Array.isArray(rec.phases)) badRecords++;
  if (!Array.isArray(rec.workflowProgress)) badRecords++;
  if (typeof rec.status !== "string") badRecords++;
  if (typeof rec.runId !== "string") badRecords++;
  if (typeof rec.durationMs !== "number" || !Number.isFinite(rec.durationMs)) badRecords++;

  const status = typeof rec.status === "string" ? rec.status : "unknown";
  const run: RunStats = {
    startMs: rec.startTime,
    durationMs: typeof rec.durationMs === "number" && Number.isFinite(rec.durationMs) ? rec.durationMs : null,
    status,
    phases: Array.isArray(rec.phases) ? rec.phases.length : 0,
    tokens: num(rec.totalTokens),
    agents: 0,
    agentsErrored: 0,
    agentsKilled: 0,
    // Null prototype: model names come from untrusted files ("__proto__" must be a plain key).
    byModel: Object.create(null) as RunStats["byModel"],
  };

  const progress = Array.isArray(rec.workflowProgress) ? rec.workflowProgress : [];
  for (const entry of progress) {
    if (entry === null || typeof entry !== "object") continue;
    const agent = entry as Rec;
    if (agent.type !== "workflow_agent") continue;
    run.agents++;
    if (!AGENT_STATES.has(agent.state as string)) badRecords++;
    if (agent.state === "error") run.agentsErrored++;
    // An agent still running when its run was killed was killed with it.
    if (status === "killed" && (agent.state === "progress" || agent.state === "start")) run.agentsKilled++;
    const model = typeof agent.model === "string" && agent.model !== "" ? agent.model : "unknown";
    const slot = (run.byModel[model] ??= { agents: 0, tokens: 0 });
    slot.agents++;
    slot.tokens += num(agent.tokens);
  }
  return { ok: true, run, runId: typeof rec.runId === "string" ? rec.runId : undefined, badRecords };
}

/** Every wf_*.json under <projectsDir>/<project>/<session>/workflows/, mtime >= sinceMs. */
export function collectWorkflows(projectsDir: string, sinceMs: number, parse: ParseCounters): RunStats[] {
  const runs: RunStats[] = [];
  const seenRuns = new Set<string>();
  for (const project of subdirs(projectsDir, parse)) {
    for (const session of subdirs(join(projectsDir, project), parse)) {
      const dir = join(projectsDir, project, session, "workflows");
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch (e) {
        // Most sessions have no workflows dir; an unreadable one must not look like a quiet week.
        if (!isMissing(e)) parse.bad_files++;
        continue;
      }
      for (const name of names) {
        if (!name.startsWith("wf_") || !name.endsWith(".json")) continue;
        const path = join(dir, name);
        let parsed: ParsedWorkflow;
        try {
          if (statSync(path).mtimeMs < sinceMs) continue;
          parsed = parseWorkflow(JSON.parse(readFileSync(path, "utf8")));
        } catch {
          parse.bad_files++;
          continue;
        }
        if (!parsed.ok) {
          parse.bad_files++;
          continue;
        }
        parse.bad_records += parsed.badRecords;
        // A run copied into another session's workflows/ (as a fork copies transcripts) counts once.
        const key = parsed.runId ?? path;
        if (seenRuns.has(key)) {
          parse.dup_records++;
          continue;
        }
        seenRuns.add(key);
        runs.push(parsed.run);
      }
    }
  }
  return runs;
}

function subdirs(dir: string, parse: ParseCounters): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (e) {
    if (!isMissing(e)) parse.bad_files++;
    return [];
  }
}

function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
