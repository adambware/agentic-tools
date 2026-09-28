#!/usr/bin/env node
import { createRequire as __loops_createRequire } from 'node:module';
const require = __loops_createRequire(import.meta.url);

// src/lib/cli.ts
import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync as readdirSync3,
  readSync,
  statSync as statSync3,
  writeSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join3 } from "node:path";

// src/lib/workflow.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
var AGENT_STATES = /* @__PURE__ */ new Set(["start", "progress", "done", "error"]);
function parseWorkflow(json) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return { ok: false };
  const rec = json;
  if (typeof rec.startTime !== "number" || !Number.isFinite(rec.startTime)) return { ok: false };
  let badRecords = 0;
  const num = (v) => {
    if (v === void 0 || v === null) return 0;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    badRecords++;
    return 0;
  };
  if (rec.totalTokens === void 0 || rec.totalTokens === null) badRecords++;
  if (!Array.isArray(rec.phases)) badRecords++;
  if (!Array.isArray(rec.workflowProgress)) badRecords++;
  if (typeof rec.status !== "string") badRecords++;
  const runId = typeof rec.runId === "string" && rec.runId !== "" ? rec.runId : void 0;
  if (runId === void 0) badRecords++;
  const durationOk = typeof rec.durationMs === "number" && Number.isFinite(rec.durationMs) && rec.durationMs >= 0;
  if (!durationOk) badRecords++;
  const status = typeof rec.status === "string" ? rec.status : "unknown";
  const run = {
    startMs: rec.startTime,
    durationMs: durationOk ? rec.durationMs : null,
    status,
    phases: Array.isArray(rec.phases) ? rec.phases.length : 0,
    tokens: num(rec.totalTokens),
    agents: 0,
    agentsErrored: 0,
    agentsKilled: 0,
    // Null prototype: model names come from untrusted files ("__proto__" must be a plain key).
    byModel: /* @__PURE__ */ Object.create(null)
  };
  const progress = Array.isArray(rec.workflowProgress) ? rec.workflowProgress : [];
  for (const entry of progress) {
    if (entry === null || typeof entry !== "object") continue;
    const agent = entry;
    if (agent.type !== "workflow_agent") continue;
    run.agents++;
    if (!AGENT_STATES.has(agent.state)) badRecords++;
    if (agent.state === "error") run.agentsErrored++;
    if (status === "killed" && (agent.state === "progress" || agent.state === "start")) run.agentsKilled++;
    const model = typeof agent.model === "string" && agent.model !== "" ? agent.model : "unknown";
    const slot = run.byModel[model] ??= { agents: 0, tokens: 0 };
    slot.agents++;
    slot.tokens += num(agent.tokens);
  }
  return { ok: true, run, runId, badRecords };
}
function collectWorkflows(projectsDir, sinceMs, parse) {
  const kept = /* @__PURE__ */ new Map();
  for (const project of subdirs(projectsDir, parse)) {
    for (const session of subdirs(join(projectsDir, project))) {
      const dir = join(projectsDir, project, session, "workflows");
      let names;
      try {
        names = readdirSync(dir);
      } catch (e) {
        if (!isMissing(e)) parse.bad_files++;
        continue;
      }
      for (const name of names) {
        if (!name.startsWith("wf_") || !name.endsWith(".json")) continue;
        const path = join(dir, name);
        let parsed;
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
        if (prev !== void 0) parse.dup_records++;
        if (prev === void 0 || better({ run: parsed.run, path }, prev)) {
          kept.set(key, { run: parsed.run, path, badRecords: parsed.badRecords });
        }
      }
    }
  }
  for (const k of kept.values()) parse.bad_records += k.badRecords;
  return [...kept.values()].map((k) => k.run);
}
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["completed", "killed", "failed"]);
function better(a, b) {
  const done = Number(TERMINAL_STATUSES.has(a.run.status)) - Number(TERMINAL_STATUSES.has(b.run.status));
  if (done !== 0) return done > 0;
  const dur = (a.run.durationMs ?? -1) - (b.run.durationMs ?? -1);
  if (dur !== 0) return dur > 0;
  return a.path < b.path;
}
function subdirs(dir, parse) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    if (parse !== void 0 && !isMissing(e)) parse.bad_files++;
    return [];
  }
}
function isMissing(e) {
  const code = e.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// src/lib/row.ts
var VERSION = "0.1.0";
var DAY_MS = 24 * 60 * 60 * 1e3;
var WINDOW_DAYS = [7, 30];
var WIDEST_WINDOW_MS = Math.max(...WINDOW_DAYS) * DAY_MS;
function buildRow(sessions, runs, parse, now) {
  const iso = new Date(now).toISOString();
  const window = (days) => {
    const start = now - days * DAY_MS;
    const inWindow = (t) => t > start && t <= now;
    return { workflows: workflowWindow(runs, inWindow), sessions: sessionWindow(sessions, inWindow) };
  };
  return {
    schema: 1,
    version: VERSION,
    generated_at: iso,
    window_end: iso,
    w7: window(7),
    w30: window(30),
    parse: { ...parse }
  };
}
function workflowWindow(all, inWindow) {
  const runs = all.filter((r) => inWindow(r.startMs));
  const byModel = /* @__PURE__ */ Object.create(null);
  for (const r of runs) {
    for (const [model, m] of Object.entries(r.byModel)) {
      const slot = byModel[model] ??= { agents: 0, tokens: 0 };
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
    other: runs.filter((r) => !TERMINAL_STATUSES.has(r.status)).length,
    phases_median: median(phases),
    phases_max: max(phases),
    tokens_sum: sum(runs.map((r) => r.tokens)),
    tokens_median: median(runs.map((r) => r.tokens)),
    duration_ms_median: median(runs.flatMap((r) => r.durationMs === null ? [] : [r.durationMs])),
    agents: sum(runs.map((r) => r.agents)),
    agents_errored: sum(runs.map((r) => r.agentsErrored)),
    agents_killed: sum(runs.map((r) => r.agentsKilled)),
    by_model: sortKeys(byModel)
  };
}
function sessionWindow(all, inWindow) {
  let n = 0;
  let compactionsTotal = 0;
  let compacted = 0;
  let compacted10 = 0;
  const peaks = [];
  for (const s of all) {
    if (!s.recordTimes.some(inWindow)) continue;
    n++;
    const ctx = s.messages.filter(([t]) => inWindow(t)).map(([, c]) => c);
    if (ctx.length > 0) peaks.push(max(ctx));
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
    compacted_10plus: compacted10
  };
}
function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function max(xs) {
  return xs.length === 0 ? null : xs.reduce((a, b) => b > a ? b : a);
}
function sum(xs) {
  return xs.reduce((a, b) => a + b, 0);
}
function sortKeys(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

// src/lib/session.ts
import { createReadStream, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { basename, join as join2 } from "node:path";

// src/lib/time.ts
var ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function parseIso(s) {
  const m = ISO_WITH_ZONE.exec(s);
  if (!m) return void 0;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const real = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === h && t.getUTCMinutes() === mi;
  const ms = Date.parse(s);
  return real && Number.isFinite(ms) ? ms : void 0;
}

// src/lib/session.ts
function emptyCounters() {
  return { bad_lines: 0, bad_files: 0, bad_records: 0, dup_records: 0 };
}
function listSessionFiles(projectsDir, sinceMs, parse) {
  const files = [];
  for (const project of readdirSync2(projectsDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = join2(projectsDir, project.name);
    let entries;
    try {
      entries = readdirSync2(projectDir, { withFileTypes: true });
    } catch {
      parse.bad_files++;
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const path = join2(projectDir, e.name);
      try {
        if (statSync2(path).mtimeMs < sinceMs) continue;
      } catch {
        parse.bad_files++;
        continue;
      }
      files.push(path);
    }
  }
  return files;
}
async function collectSessions(projectsDir, sinceMs) {
  const parse = emptyCounters();
  const files = listSessionFiles(projectsDir, sinceMs, parse);
  return collectSessionFiles(files, parse);
}
async function collectSessionFiles(files, parse = emptyCounters()) {
  const ordered = [];
  for (const file of files) {
    const head = await firstRecord(file);
    if (head === "unreadable") {
      parse.bad_files++;
      continue;
    }
    let born = 0;
    let live = false;
    try {
      const st = statSync2(file);
      born = st.birthtimeMs;
      live = Date.now() - st.mtimeMs < LIVE_MS;
    } catch {
    }
    ordered.push({ file, first: head.ts, copied: head.copied ? 1 : 0, born, live });
  }
  ordered.sort(
    (a, b) => a.first - b.first || a.copied - b.copied || (a.born > 0 && b.born > 0 ? a.born - b.born : 0) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
  );
  const seenUuids = /* @__PURE__ */ new Set();
  const seenMessages = /* @__PURE__ */ new Set();
  const sessions = [];
  for (const { file, live } of ordered) {
    const stats = await parseFile(file, live, seenUuids, seenMessages, parse);
    if (stats) sessions.push(stats);
  }
  return { sessions, parse };
}
async function firstRecord(file) {
  try {
    for await (const { text } of readLines(file)) {
      const rec = parseLine(text);
      if (!rec) continue;
      const ts = parseTimestamp(rec.timestamp);
      if (ts === void 0) continue;
      const copied = typeof rec.sessionId === "string" && rec.sessionId !== basename(file, ".jsonl");
      return { ts, copied };
    }
    return { ts: Number.POSITIVE_INFINITY, copied: false };
  } catch {
    return "unreadable";
  }
}
async function* readLines(file) {
  const stream = createReadStream(file, { encoding: "utf8" });
  let pending = [];
  try {
    for await (const chunk of stream) {
      const text = chunk;
      let start = 0;
      for (let nl = text.indexOf("\n"); nl !== -1; nl = text.indexOf("\n", start)) {
        pending.push(text.slice(start, nl));
        yield { text: pending.join(""), partial: false };
        pending = [];
        start = nl + 1;
      }
      if (start < text.length) pending.push(text.slice(start));
    }
    if (pending.length > 0) yield { text: pending.join(""), partial: true };
  } finally {
    stream.destroy();
  }
}
var LIVE_MS = 60 * 60 * 1e3;
async function parseFile(file, live, seenUuids, seenMessages, parse) {
  const stats = {
    file,
    recordTimes: [],
    messages: [],
    compactions: [],
    naive: { usage_records: 0, compact_records: 0 }
  };
  try {
    for await (const { text, partial } of readLines(file)) {
      if (text.trim() === "") continue;
      const rec = parseLine(text);
      if (!rec) {
        if (!(partial && live)) parse.bad_lines++;
        continue;
      }
      const usage = usageOf(rec);
      const compact = rec.type === "system" && rec.subtype === "compact_boundary";
      if (usage) stats.naive.usage_records++;
      if (compact) stats.naive.compact_records++;
      const uuid = typeof rec.uuid === "string" ? rec.uuid : void 0;
      if (uuid === void 0 && (usage || compact)) parse.bad_records++;
      if (uuid !== void 0) {
        if (seenUuids.has(uuid)) {
          parse.dup_records++;
          continue;
        }
        seenUuids.add(uuid);
      }
      const ts = parseTimestamp(rec.timestamp);
      if (ts === void 0) {
        if (usage || compact) parse.bad_records++;
        continue;
      }
      stats.recordTimes.push(ts);
      if (compact) stats.compactions.push(ts);
      if (usage) {
        const key = messageKey(rec);
        if (key !== void 0) {
          if (seenMessages.has(key)) continue;
          seenMessages.add(key);
        }
        const { ctx, bad } = contextSize(usage);
        if (bad) parse.bad_records++;
        if (ctx !== void 0) stats.messages.push([ts, ctx]);
      }
    }
  } catch {
    parse.bad_files++;
    return void 0;
  }
  return stats;
}
function parseLine(line) {
  try {
    const v = JSON.parse(line);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : void 0;
  } catch {
    return void 0;
  }
}
function parseTimestamp(v) {
  return typeof v === "string" ? parseIso(v) : void 0;
}
function usageOf(rec) {
  if (rec.type !== "assistant" || rec.isApiErrorMessage === true) return void 0;
  const message = rec.message;
  if (message === null || typeof message !== "object") return void 0;
  if (message.model === "<synthetic>") return void 0;
  const usage = message.usage;
  return usage !== null && typeof usage === "object" ? usage : void 0;
}
function messageKey(rec) {
  const id = rec.message.id;
  if (typeof id === "string") return `m:${id}`;
  if (typeof rec.requestId === "string") return `r:${rec.requestId}`;
  if (typeof rec.uuid === "string") return `u:${rec.uuid}`;
  return void 0;
}
var CONTEXT_FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
function contextSize(usage) {
  let ctx = 0;
  let bad = false;
  let present = 0;
  for (const f of CONTEXT_FIELDS) {
    const v = usage[f];
    if (v === void 0 || v === null) continue;
    present++;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) ctx += v;
    else bad = true;
  }
  return present === 0 ? { ctx: void 0, bad: true } : { ctx, bad };
}

// src/lib/cli.ts
var USAGE = "usage: loop-metrics [--projects-dir DIR] [--out FILE] [--now ISO] [--dry-run] [--session FILE]\n";
var VALUE_FLAGS = /* @__PURE__ */ new Set(["projects-dir", "out", "now", "session"]);
var BARE_FLAGS = /* @__PURE__ */ new Set(["dry-run", "help"]);
function parseCli(argv) {
  const args = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const key = a.startsWith("--") ? a.slice(2) : void 0;
    if (key !== void 0 && BARE_FLAGS.has(key)) {
      args[key] = "true";
    } else if (key !== void 0 && VALUE_FLAGS.has(key)) {
      const next = argv[i + 1];
      if (next === void 0 || next.startsWith("--")) return { error: `error: ${a} needs a value
${USAGE}` };
      args[key] = next;
      i++;
    } else {
      unknown.push(a);
    }
  }
  if (unknown.length > 0) return { error: `error: unknown argument ${unknown.join(" ")}
${USAGE}` };
  return { args };
}
var processIo = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s)
};
async function main(argv, io = processIo) {
  if (argv.includes("--help")) {
    io.stdout(USAGE);
    return 0;
  }
  const parsed = parseCli(argv);
  if ("error" in parsed) {
    io.stderr(parsed.error);
    return 2;
  }
  const { args } = parsed;
  let now = Date.now();
  if (args.now !== void 0) {
    now = parseIso(args.now) ?? NaN;
    if (!Number.isFinite(now)) {
      io.stderr(`error: --now is not an ISO timestamp: ${args.now}
`);
      return 2;
    }
  }
  if (args.session !== void 0) return sessionReport(args.session, io);
  const projectsDir = args["projects-dir"] ?? join3(homedir(), ".claude", "projects");
  const out = args.out ?? join3(homedir(), ".claude", "metrics", "loops.jsonl");
  try {
    if (!statSync3(projectsDir).isDirectory()) throw new Error("not a directory");
    readdirSync3(projectsDir);
  } catch (e) {
    io.stderr(`error: cannot read --projects-dir ${projectsDir}: ${e.message}
`);
    return 1;
  }
  const since = now - WIDEST_WINDOW_MS;
  const { sessions, parse } = await collectSessions(projectsDir, since);
  const runs = collectWorkflows(projectsDir, since, parse);
  const line = JSON.stringify(buildRow(sessions, runs, parse, now)) + "\n";
  if (args["dry-run"] === void 0) {
    try {
      appendRow(out, line);
    } catch (e) {
      io.stderr(`error: cannot append to --out ${out}: ${e.message}
`);
      return 1;
    }
  }
  io.stdout(line);
  return 0;
}
function appendRow(out, line) {
  mkdirSync(dirname(out), { recursive: true });
  const fd = openSync(out, "a+");
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    const torn = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10;
    const data = Buffer.from((torn ? "\n" : "") + line);
    let written = 0;
    try {
      written = writeSync(fd, data);
    } finally {
      if (written !== data.length && fstatSync(fd).size === size + written) ftruncateSync(fd, size);
    }
    if (written !== data.length) throw new Error(`short write (${written} of ${data.length} bytes)`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
async function sessionReport(file, io) {
  try {
    if (!statSync3(file).isFile()) throw new Error("not a file");
  } catch (e) {
    io.stderr(`error: cannot read --session ${file}: ${e.message}
`);
    return 1;
  }
  const { sessions, parse } = await collectSessionFiles([file], emptyCounters());
  const s = sessions[0];
  if (!s) {
    io.stderr(`error: cannot read --session ${file}
`);
    return 1;
  }
  const peak = s.messages.reduce((m, [, c]) => c > m ? c : m, -1);
  const report = {
    file,
    deduped: {
      records: s.recordTimes.length,
      messages: s.messages.length,
      compactions: s.compactions.length,
      context_peak: peak < 0 ? null : peak
    },
    naive: {
      usage_records: s.naive.usage_records,
      compactions: s.naive.compact_records
    },
    parse
  };
  io.stdout(JSON.stringify(report, null, 2) + "\n");
  return 0;
}

// src/bin/loop-metrics.ts
process.exitCode = await main(process.argv.slice(2));
