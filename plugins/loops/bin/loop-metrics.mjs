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
  readdirSync as readdirSync4,
  readSync,
  statSync as statSync4,
  writeSync
} from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname3, join as join5 } from "node:path";

// src/lib/lens.ts
import { readFileSync, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/lib/session.ts
import { createReadStream, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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
  for (const project of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = join(projectsDir, project.name);
    let entries;
    try {
      entries = readdirSync(projectDir, { withFileTypes: true });
    } catch {
      parse.bad_files++;
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const path = join(projectDir, e.name);
      try {
        if (statSync(path).mtimeMs < sinceMs) continue;
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
      const st = statSync(file);
      born = st.birthtimeMs;
      const age = Date.now() - st.mtimeMs;
      live = age > -FUTURE_SLACK_MS && age < LIVE_MS;
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
var FUTURE_SLACK_MS = 60 * 1e3;
async function parseFile(file, live, seenUuids, seenMessages, parse) {
  const stats = {
    file,
    project: basename(dirname(file)),
    recordTimes: [],
    messages: [],
    tokens: [],
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
      const uuid = nonEmpty(rec.uuid);
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
        if ((usage || compact) && uuid !== void 0) parse.bad_records++;
        continue;
      }
      stats.recordTimes.push(ts);
      if (compact) stats.compactions.push(ts);
      if (usage) {
        const { key, bad: badKey } = messageKey(rec);
        if (badKey && uuid !== void 0) parse.bad_records++;
        if (key !== void 0) {
          if (seenMessages.has(key)) continue;
          seenMessages.add(key);
        }
        const { ctx, bad } = contextSize(usage);
        if (bad) parse.bad_records++;
        if (ctx !== void 0) stats.messages.push([ts, ctx]);
        const out = outputTokens(usage);
        if (out.bad) parse.bad_records++;
        if (ctx !== void 0 || out.n !== void 0) stats.tokens.push([ts, (ctx ?? 0) + (out.n ?? 0)]);
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
function nonEmpty(v) {
  return typeof v === "string" && v !== "" ? v : void 0;
}
function messageKey(rec) {
  const raw = rec.message.id;
  const id = nonEmpty(raw);
  const requestId = nonEmpty(rec.requestId);
  const uuid = nonEmpty(rec.uuid);
  const key = id !== void 0 ? `m:${id}` : requestId !== void 0 ? `r:${requestId}` : uuid !== void 0 ? `u:${uuid}` : void 0;
  return { key, bad: raw !== void 0 && raw !== null && id === void 0 };
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
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) ctx += v;
    else bad = true;
  }
  return present === 0 ? { ctx: void 0, bad: true } : { ctx, bad };
}
function outputTokens(usage) {
  const v = usage.output_tokens;
  if (v === void 0 || v === null) return { n: void 0, bad: false };
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return { n: v, bad: false };
  return { n: void 0, bad: true };
}

// src/lib/lens.ts
var KNOWN_LENSES = /* @__PURE__ */ new Set([
  "api-contract",
  "data-migration",
  "design",
  "maintainability",
  "performance",
  "red-team",
  "security",
  "simplification",
  "testing"
]);
var OTHER_ACTIONS = /* @__PURE__ */ new Set(["deferred", "unresolved", "pending", "asked"]);
var LENS_NAME = /^[a-z0-9][a-z0-9-]*$/;
function normalizeLens(s) {
  return s.trim().toLowerCase().replace(/_/g, "-");
}
function count(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : void 0;
}
function parseReview(rec) {
  if (rec.skill !== "review") return { ok: false, badRecords: 0 };
  const ts = typeof rec.timestamp === "string" ? parseIso(rec.timestamp) : void 0;
  if (ts === void 0) return { ok: false, badRecords: 1 };
  let badRecords = 0;
  let specialists = null;
  const sp = rec.specialists;
  if (Array.isArray(sp) && sp.length === 0) {
    specialists = [];
  } else if (sp !== void 0 && sp !== null) {
    if (typeof sp !== "object" || Array.isArray(sp)) {
      badRecords++;
    } else {
      specialists = [];
      for (const [key, value] of Object.entries(sp)) {
        const lens = normalizeLens(key);
        if (!LENS_NAME.test(lens) || value === null || typeof value !== "object" || Array.isArray(value)) {
          badRecords++;
          continue;
        }
        const v = value;
        if (typeof v.dispatched !== "boolean") {
          badRecords++;
          continue;
        }
        let reported = 0;
        let reportedCritical = 0;
        if (v.dispatched) {
          const f = count(v.findings);
          if (f === void 0) badRecords++;
          reported = f ?? 0;
          const c = v.critical === void 0 ? 0 : count(v.critical);
          if (c === void 0) badRecords++;
          reportedCritical = c ?? 0;
        }
        specialists.push({ lens, dispatched: v.dispatched, reported, reportedCritical });
      }
    }
  }
  let findings = null;
  const fl = rec.findings;
  if (fl !== void 0 && fl !== null && !Array.isArray(fl) && typeof fl !== "number") badRecords++;
  if (Array.isArray(rec.findings)) {
    findings = [];
    for (const entry of rec.findings) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        badRecords++;
        continue;
      }
      const f = entry;
      let action = "other";
      if (f.action === "fixed" || f.action === "auto-fixed" || f.action === "skipped") action = f.action;
      else if (!OTHER_ACTIONS.has(f.action)) badRecords++;
      const sev = typeof f.severity === "string" ? f.severity.trim().toUpperCase() : "";
      let lens = null;
      if (typeof f.fingerprint === "string") {
        const category = normalizeLens(f.fingerprint.slice(f.fingerprint.lastIndexOf(":") + 1));
        if (KNOWN_LENSES.has(category)) lens = category;
      }
      findings.push({ lens, action, critical: sev === "CRITICAL" || sev === "P1" });
    }
  }
  return { ok: true, review: { ts, specialists, findings }, badRecords };
}
function collectReviews(gstackDir, sinceMs) {
  const parse = emptyCounters();
  const reviews = [];
  const seen = /* @__PURE__ */ new Map();
  const repos = readdirSync2(gstackDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const repo of repos) {
    let names;
    try {
      names = readdirSync2(join2(gstackDir, repo)).sort();
    } catch {
      parse.bad_files++;
      continue;
    }
    for (const name of names) {
      if (!name.endsWith("-reviews.jsonl")) continue;
      const path = join2(gstackDir, repo, name);
      let text;
      try {
        const st = statSync2(path);
        if (!st.isFile() || st.mtimeMs < sinceMs) continue;
        text = readFileSync(path, "utf8");
      } catch {
        parse.bad_files++;
        continue;
      }
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line === "") continue;
        const prior = seen.get(line);
        if (prior !== void 0) {
          if (prior) parse.dup_records++;
          continue;
        }
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          rec = void 0;
        }
        const isObject = rec !== null && typeof rec === "object" && !Array.isArray(rec);
        seen.set(line, isObject);
        if (!isObject) {
          parse.bad_lines++;
          continue;
        }
        const parsed = parseReview(rec);
        parse.bad_records += parsed.badRecords;
        if (parsed.ok) reviews.push(parsed.review);
      }
    }
  }
  return { reviews, parse };
}

// src/lib/repos.ts
import { execFileSync } from "node:child_process";
import { readFileSync as readFileSync2 } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname2, isAbsolute, join as join3, resolve } from "node:path";
var DAY_MS = 24 * 60 * 60 * 1e3;
var SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function loadConfig(file) {
  const json = JSON.parse(readFileSync2(file, "utf8"));
  if (json === null || typeof json !== "object" || !Array.isArray(json.repos)) {
    throw new Error("config needs a repos array");
  }
  const seen = /* @__PURE__ */ new Set();
  const repos = json.repos.map((r, i) => {
    const e = r;
    if (e === null || typeof e !== "object" || typeof e.slug !== "string" || !SLUG.test(e.slug)) {
      throw new Error(`repos[${i}]: slug must be owner/name`);
    }
    if (typeof e.path !== "string" || e.path === "") throw new Error(`repos[${i}]: path must be a string`);
    if (seen.has(e.slug)) throw new Error(`repos[${i}]: duplicate slug ${e.slug}`);
    const ignore = e.escape_ignore ?? [];
    if (!Array.isArray(ignore) || !ignore.every((x) => typeof x === "string")) {
      throw new Error(`repos[${i}]: escape_ignore must be a list of paths`);
    }
    seen.add(e.slug);
    const p = e.path === "~" ? homedir() : e.path.startsWith("~/") ? join3(homedir(), e.path.slice(2)) : e.path;
    return { slug: e.slug, path: isAbsolute(p) ? resolve(p) : resolve(dirname2(file), p), escape_ignore: ignore };
  });
  return { repos };
}
function projectKey(path) {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}
function ownsProject(repoPath, project) {
  const key = projectKey(repoPath);
  return project === key || project.startsWith(`${key}--claude-worktrees-`);
}
function parsePrList(json) {
  if (!Array.isArray(json)) throw new Error("gh output is not an array");
  return json.map((p, i) => {
    const e = p;
    const mergedAt = typeof e?.mergedAt === "string" ? parseIso(e.mergedAt) : void 0;
    if (e === null || typeof e !== "object" || typeof e.number !== "number" || typeof e.title !== "string" || mergedAt === void 0 || !Array.isArray(e.files)) {
      throw new Error(`gh pr ${i}: unexpected shape`);
    }
    const files = e.files.map((f) => f?.path);
    if (!files.every((f) => typeof f === "string")) throw new Error(`gh pr #${e.number}: file without a path`);
    return { number: e.number, title: e.title, mergedAt, files };
  });
}
var PR_LIMIT = 1e3;
var GH_TIMEOUT_MS = 5 * 60 * 1e3;
var runGh = (args) => execFileSync("gh", args, {
  encoding: "utf8",
  timeout: GH_TIMEOUT_MS,
  maxBuffer: 256 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? "/usr/bin:/bin"}` }
});
function fetchMergedPrs(slug, sinceMs, gh = runGh) {
  const name = gh(["repo", "view", slug, "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
  if (name.toLowerCase() !== slug.toLowerCase()) throw new Error(`${slug}: gh resolves it to ${name === "" ? "nothing" : name}`);
  const day = new Date(sinceMs).toISOString().slice(0, 10);
  const out = gh([
    "pr",
    "list",
    "-R",
    slug,
    "--state",
    "merged",
    "--search",
    `merged:>=${day}`,
    "--limit",
    String(PR_LIMIT),
    "--json",
    "number,title,mergedAt,files"
  ]);
  const prs = parsePrList(JSON.parse(out));
  if (prs.length >= PR_LIMIT) throw new Error(`${PR_LIMIT}+ merged PRs: the list may be cut short`);
  return prs.filter((p) => p.mergedAt >= sinceMs);
}
var FIX_TITLE = /^\s*(v?\d+(\.\d+)*\s+)?(revert|fix|hotfix)\b/i;
function isFixPr(pr) {
  return FIX_TITLE.test(pr.title);
}
var ESCAPE_DAYS = 14;
var BOOKKEEPING = /(^|\/)(VERSION|package\.json|plugin\.json|marketplace\.json|[^/]*\.lock|package-lock\.json|pnpm-lock\.yaml|go\.sum)$|\.(md|mdx|txt|snap)$|(^|\/)(__tests__|__snapshots__|tests?|spec)\/|\.(test|spec)\.[A-Za-z]+$/i;
function isBookkeeping(path) {
  return BOOKKEEPING.test(path);
}
function ignored(path, ignore) {
  return isBookkeeping(path) || ignore.some((x) => x.endsWith("/") ? path.startsWith(x) : path === x);
}
function escaped(pr, all, ignore = []) {
  const until = pr.mergedAt + ESCAPE_DAYS * DAY_MS;
  for (const fix of all) {
    if (fix.number === pr.number || fix.mergedAt <= pr.mergedAt || fix.mergedAt > until || !isFixPr(fix)) continue;
    for (const file of fix.files) {
      if (ignored(file, ignore) || !pr.files.includes(file)) continue;
      const later = all.some(
        (o) => o.number !== pr.number && o.number !== fix.number && o.mergedAt > pr.mergedAt && o.mergedAt < fix.mergedAt && o.files.includes(file)
      );
      if (!later) return true;
    }
  }
  return false;
}

// src/lib/workflow.ts
import { readFileSync as readFileSync3, readdirSync as readdirSync3, statSync as statSync3 } from "node:fs";
import { join as join4 } from "node:path";
var AGENT_STATES = /* @__PURE__ */ new Set(["start", "progress", "done", "error"]);
var PROGRESS_TYPES = /* @__PURE__ */ new Set(["workflow_phase", "workflow_agent"]);
function parseWorkflow(json) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return { ok: false };
  const rec = json;
  if (typeof rec.startTime !== "number" || !Number.isFinite(rec.startTime)) return { ok: false };
  let badRecords = 0;
  const num = (v) => {
    if (v === void 0 || v === null) return 0;
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
    badRecords++;
    return 0;
  };
  if (rec.totalTokens === void 0 || rec.totalTokens === null) badRecords++;
  if (!Array.isArray(rec.phases)) badRecords++;
  if (!Array.isArray(rec.workflowProgress)) badRecords++;
  if (typeof rec.status !== "string") badRecords++;
  const runId = typeof rec.runId === "string" && rec.runId !== "" ? rec.runId : void 0;
  if (runId === void 0) badRecords++;
  const durationOk = typeof rec.durationMs === "number" && Number.isSafeInteger(rec.durationMs) && rec.durationMs >= 0;
  if (!durationOk) badRecords++;
  const status = typeof rec.status === "string" ? rec.status : "unknown";
  const run = {
    project: "",
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
    if (entry === null || typeof entry !== "object" || !PROGRESS_TYPES.has(entry.type)) {
      badRecords++;
      continue;
    }
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
    for (const session of subdirs(join4(projectsDir, project))) {
      const dir = join4(projectsDir, project, session, "workflows");
      let names;
      try {
        names = readdirSync3(dir);
      } catch (e) {
        if (!isMissing(e)) parse.bad_files++;
        continue;
      }
      for (const name of names) {
        if (!name.startsWith("wf_") || !name.endsWith(".json")) continue;
        const path = join4(dir, name);
        let parsed;
        try {
          if (statSync3(path).mtimeMs < sinceMs) continue;
          parsed = parseWorkflow(JSON.parse(readFileSync3(path, "utf8")));
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
        parsed.run.project = project;
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
    return readdirSync3(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
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
var VERSION = "0.5.0";
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var WINDOW_DAYS = [7, 30];
var WIDEST_WINDOW_MS = Math.max(...WINDOW_DAYS) * DAY_MS2;
function buildRow(sessions, runs, parse, now, lenses = null, repos = null) {
  const iso = new Date(now).toISOString();
  const window = (days) => {
    const start = now - days * DAY_MS2;
    const inWindow = (t) => t > start && t <= now;
    return {
      workflows: workflowWindow(runs, inWindow),
      sessions: sessionWindow(sessions, inWindow),
      lenses: lenses === null ? null : lensWindow(lenses.reviews, inWindow),
      repos: repos === null ? null : reposWindow(repos, sessions, runs, now, inWindow)
    };
  };
  return {
    schema: 1,
    version: VERSION,
    generated_at: iso,
    window_end: iso,
    w7: window(7),
    w30: window(30),
    parse: { ...parse },
    parse_lenses: lenses === null ? null : { ...lenses.parse },
    repo_errors: repos === null ? null : repos.filter((r) => r.prs === null).map((r) => r.slug).sort()
  };
}
function reposWindow(repos, sessions, runs, now, inWindow) {
  const out = /* @__PURE__ */ Object.create(null);
  for (const repo of repos) {
    if (repo.prs === null) {
      out[repo.slug] = null;
      continue;
    }
    const all = repo.prs.filter((p) => p.mergedAt <= now);
    const esc = (p) => escaped(p, all, repo.escape_ignore);
    const merged = all.filter((p) => inWindow(p.mergedAt));
    const observed = merged.filter((p) => p.mergedAt + ESCAPE_DAYS * DAY_MS2 <= now);
    const mine = sessions.filter((s) => ownsProject(repo.path, s.project) && s.recordTimes.some(inWindow));
    const sessionTokens = sum(mine.flatMap((s) => s.tokens.filter(([t]) => inWindow(t)).map(([, n]) => n)));
    const myRuns = runs.filter((r) => ownsProject(repo.path, r.project) && inWindow(r.startMs));
    const workflowTokens = sum(myRuns.map((r) => r.tokens));
    const local = mine.length > 0 || myRuns.length > 0;
    const per = merged.length > 0 && local;
    out[repo.slug] = {
      merged_prs: merged.length,
      fix_prs: merged.filter(isFixPr).length,
      escaped: merged.filter(esc).length,
      observed_14d: observed.length,
      escaped_observed: observed.filter(esc).length,
      sessions: mine.length,
      session_tokens: sessionTokens,
      workflow_runs: myRuns.length,
      workflow_tokens: workflowTokens,
      tokens_per_merged_pr: per ? Math.round((sessionTokens + workflowTokens) / merged.length) : null,
      sessions_per_merged_pr: per ? Math.round(100 * mine.length / merged.length) / 100 : null
    };
  }
  return sortKeys(out);
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
function emptyFindings() {
  return { findings: 0, fixed: 0, auto_fixed: 0, skipped: 0, other_action: 0, critical: 0, critical_skipped: 0 };
}
function lensWindow(all, inWindow) {
  const reviews = all.filter((r) => inWindow(r.ts));
  const byLens = /* @__PURE__ */ Object.create(null);
  const slot = (lens) => byLens[lens] ??= { dispatched: 0, not_dispatched: 0, reported: 0, reported_critical: 0, ...emptyFindings() };
  const other = emptyFindings();
  for (const r of reviews) {
    for (const s of r.specialists ?? []) {
      const c = slot(s.lens);
      if (s.dispatched) c.dispatched++;
      else c.not_dispatched++;
      c.reported += s.reported;
      c.reported_critical += s.reportedCritical;
    }
    for (const f of r.findings ?? []) {
      const c = f.lens === null ? other : slot(f.lens);
      c.findings++;
      if (f.action === "fixed") c.fixed++;
      else if (f.action === "auto-fixed") c.auto_fixed++;
      else if (f.action === "skipped") c.skipped++;
      else c.other_action++;
      if (f.critical) {
        c.critical++;
        if (f.action === "skipped") c.critical_skipped++;
      }
    }
  }
  return {
    reviews: reviews.length,
    with_specialists: reviews.filter((r) => r.specialists !== null).length,
    with_findings: reviews.filter((r) => r.findings !== null).length,
    by_lens: sortKeys(byLens),
    other
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

// src/lib/cli.ts
var USAGE = "usage: loop-metrics [--projects-dir DIR] [--gstack-dir DIR] [--config FILE] [--out FILE] [--now ISO] [--dry-run] [--session FILE]\n";
var VALUE_FLAGS = /* @__PURE__ */ new Set(["projects-dir", "gstack-dir", "config", "out", "now", "session"]);
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
async function main(argv, io = processIo, deps = {}) {
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
  const projectsDir = args["projects-dir"] ?? join5(homedir2(), ".claude", "projects");
  const out = args.out ?? join5(homedir2(), ".claude", "metrics", "loops.jsonl");
  try {
    if (!statSync4(projectsDir).isDirectory()) throw new Error("not a directory");
    readdirSync4(projectsDir);
  } catch (e) {
    io.stderr(`error: cannot read --projects-dir ${projectsDir}: ${e.message}
`);
    return 1;
  }
  const gstackDir = args["gstack-dir"] ?? join5(homedir2(), ".gstack", "projects");
  let readLenses = true;
  try {
    if (!statSync4(gstackDir).isDirectory()) throw new Error("not a directory");
    readdirSync4(gstackDir);
  } catch (e) {
    const code = e.code;
    if (args["gstack-dir"] !== void 0 || code !== "ENOENT") {
      io.stderr(`error: cannot read --gstack-dir ${gstackDir}: ${e.message}
`);
      return 1;
    }
    readLenses = false;
  }
  const configNamed = args.config ?? (process.env.LOOPS_CONFIG || void 0);
  const configPath = configNamed ?? deps.defaultConfig ?? join5(homedir2(), ".config", "agentic-loops", "config.json");
  let config = null;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    if (configNamed !== void 0 || e.code !== "ENOENT") {
      io.stderr(`error: cannot read config ${configPath}: ${e.message}
`);
      return 1;
    }
  }
  const since = now - WIDEST_WINDOW_MS;
  let repos = null;
  if (config !== null) {
    repos = config.repos.map((r) => {
      try {
        return { ...r, prs: fetchMergedPrs(r.slug, since, deps.gh ?? runGh) };
      } catch (e) {
        io.stderr(`warning: ${r.slug}: cannot read merged PRs: ${e.message.split("\n")[0]}
`);
        return { ...r, prs: null };
      }
    });
  }
  let line;
  try {
    const { sessions, parse } = await collectSessions(projectsDir, since);
    const runs = collectWorkflows(projectsDir, since, parse);
    let lenses = null;
    try {
      if (readLenses) lenses = collectReviews(gstackDir, since);
    } catch (e) {
      io.stderr(`error: cannot read --gstack-dir ${gstackDir}: ${e.message}
`);
      return 1;
    }
    line = JSON.stringify(buildRow(sessions, runs, parse, now, lenses, repos)) + "\n";
  } catch (e) {
    io.stderr(`error: cannot read --projects-dir ${projectsDir}: ${e.message}
`);
    return 1;
  }
  if (args["dry-run"] === void 0) {
    try {
      appendRow(out, line);
    } catch (e) {
      if (!(e instanceof NotDurableError)) {
        io.stderr(`error: cannot append to --out ${out}: ${e.message}
`);
        return 1;
      }
      io.stdout(line);
      io.stderr(`error: --out ${out}: ${e.message}
`);
      return 1;
    }
  }
  io.stdout(line);
  return 0;
}
function appendRow(out, line) {
  const madeDir = mkdirSync(dirname3(out), { recursive: true });
  const fd = openSync(out, "a+");
  let synced = false;
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    const torn = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10;
    const data = Buffer.from((torn ? "\n" : "") + line);
    let written = 0;
    try {
      written = writeSync(fd, data);
    } finally {
      try {
        if (written !== data.length && fstatSync(fd).size === size + written) ftruncateSync(fd, size);
      } catch {
        if (written === data.length) throw new Error("write succeeded but its length could not be confirmed");
      }
    }
    if (written !== data.length) throw new Error(`short write (${written} of ${data.length} bytes)`);
    durably(() => fsyncSync(fd));
    synced = true;
  } finally {
    try {
      closeSync(fd);
    } catch (e) {
      if (synced) durably(() => {
        throw e;
      });
    }
  }
  const top = madeDir === void 0 ? dirname3(out) : dirname3(madeDir);
  durably(() => {
    for (let dir = dirname3(out); ; dir = dirname3(dir)) {
      syncDir(dir);
      if (dir === top || dir === dirname3(dir)) break;
    }
  });
}
var NO_DIR_SYNC = /* @__PURE__ */ new Set(["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EACCES"]);
function syncDir(dir) {
  let dirFd;
  try {
    dirFd = openSync(dir, "r");
  } catch (e) {
    if (NO_DIR_SYNC.has(e.code ?? "")) return;
    throw e;
  }
  try {
    fsyncSync(dirFd);
  } catch (e) {
    if (!NO_DIR_SYNC.has(e.code ?? "")) throw e;
  } finally {
    closeSync(dirFd);
  }
}
var NotDurableError = class extends Error {
};
function durably(sync) {
  try {
    sync();
  } catch (e) {
    throw new NotDurableError(`row written but may not be on disk: ${e.message}`);
  }
}
async function sessionReport(file, io) {
  try {
    if (!statSync4(file).isFile()) throw new Error("not a file");
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
