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
/** Every workflowProgress entry type seen in real records; another one is format drift. */
const PROGRESS_TYPES = new Set(["workflow_phase", "workflow_agent"]);

/** Parse one run record. A non-object or a non-numeric startTime is a bad file. */
export function parseWorkflow(json: unknown): ParsedWorkflow {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return { ok: false };
  const rec = json as Rec;
  if (typeof rec.startTime !== "number" || !Number.isFinite(rec.startTime)) return { ok: false };

  let badRecords = 0;
  const num = (v: unknown): number => {
    if (v === undefined || v === null) return 0;
    // Safe integers only: summing huge floats can overflow to Infinity, which JSON writes as null.
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
    badRecords++;
    return 0;
  };

  // A missing run-level field still reads as 0 or empty, but it is counted: every real record
  // has these, so their absence is the format drift the parse counters exist to catch.
  if (rec.totalTokens === undefined || rec.totalTokens === null) badRecords++;
  if (!Array.isArray(rec.phases)) badRecords++;
  if (!Array.isArray(rec.workflowProgress)) badRecords++;
  if (typeof rec.status !== "string") badRecords++;
  const runId = typeof rec.runId === "string" && rec.runId !== "" ? rec.runId : undefined;
  if (runId === undefined) badRecords++;
  // Safe integer like the counts: two huge durations would overflow the median to Infinity (null).
  const durationOk = typeof rec.durationMs === "number" && Number.isSafeInteger(rec.durationMs) && rec.durationMs >= 0;
  if (!durationOk) badRecords++;

  const status = typeof rec.status === "string" ? rec.status : "unknown";
  const run: RunStats = {
    startMs: rec.startTime,
    durationMs: durationOk ? (rec.durationMs as number) : null,
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
    if (entry === null || typeof entry !== "object" || !PROGRESS_TYPES.has((entry as Rec).type as string)) {
      badRecords++;
      continue;
    }
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
  return { ok: true, run, runId, badRecords };
}

/** Every wf_*.json under <projectsDir>/<project>/<session>/workflows/, mtime >= sinceMs. */
export function collectWorkflows(projectsDir: string, sinceMs: number, parse: ParseCounters): RunStats[] {
  // runId -> the copy kept so far. A run copied into another session's workflows/ (as a fork
  // copies transcripts) counts once; see `better` for which copy wins.
  const kept = new Map<string, { run: RunStats; path: string; badRecords: number }>();
  for (const project of subdirs(projectsDir, parse)) {
    // An unreadable project dir is already counted by the session scan.
    for (const session of subdirs(join(projectsDir, project))) {
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
        const key = parsed.runId ?? path;
        const prev = kept.get(key);
        if (prev !== undefined) parse.dup_records++;
        if (prev === undefined || better({ run: parsed.run, path }, prev)) {
          kept.set(key, { run: parsed.run, path, badRecords: parsed.badRecords });
        }
      }
    }
  }
  // Drift is counted once per run, from the copy that is kept.
  for (const k of kept.values()) parse.bad_records += k.badRecords;
  return [...kept.values()].map((k) => k.run);
}

/** The statuses of a finished run; anything else is a run in progress or a renamed status. */
export const TERMINAL_STATUSES = new Set(["completed", "killed", "failed"]);

/**
 * Of two copies of one run, keep the finished one (a copy taken mid-run is a stale snapshot),
 * then the one that ran longer, then the first by path, so the choice never depends on
 * directory order.
 */
function better(a: { run: RunStats; path: string }, b: { run: RunStats; path: string }): boolean {
  const done = Number(TERMINAL_STATUSES.has(a.run.status)) - Number(TERMINAL_STATUSES.has(b.run.status));
  if (done !== 0) return done > 0;
  const dur = (a.run.durationMs ?? -1) - (b.run.durationMs ?? -1);
  if (dur !== 0) return dur > 0;
  return a.path < b.path;
}

function subdirs(dir: string, parse?: ParseCounters): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (e) {
    if (parse !== undefined && !isMissing(e)) parse.bad_files++;
    return [];
  }
}

function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
