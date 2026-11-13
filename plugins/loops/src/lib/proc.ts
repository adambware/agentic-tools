// Process and flag helpers shared by `loops zone` and `loops env-check`. Commands that spawn
// (git, tool version probes, local checks) go through the injected Runner, like RunGh in repos.ts.
import { spawnSync } from "node:child_process";
import { accessSync, closeSync, constants, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import type { Platform } from "./node-modules.js";

/** Bad usage, bad config or an unreadable repo: the CLI prints it to stderr and exits 2. */
export class UsageError extends Error {}

export interface RunOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /**
   * Run in its own session and process group, and end the whole group at the timeout or an interrupt (SIGTERM or
   * SIGINT, then SIGKILL after GRACE_MS), with the descendants it can find, so a child it started does not outlive it.
   */
  group?: boolean;
  /** The ps a grouped run lists processes with; default findPs(). Tests inject a fake. */
  ps?: string | null;
}
export interface RunResult {
  /** null when the process could not start or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True when spawn failed with ENOENT: the command is not there, or the cwd is not; false or absent otherwise. */
  notFound?: boolean;
  /** What left code null when the process did not just exit: the signal that killed it or the spawn error code (ENOBUFS, EACCES…). */
  abend?: string;
  /** A grouped run whose supervisor died or overran the backstop: stdout is what the check printed before (whole lines). Absent: false. */
  lost?: boolean;
  /** For a lost run, whether the check's group is gone ("yes"), was left as not this run's ("no") or could not be checked. Absent: "yes". */
  cleaned?: "yes" | "no" | "unverified";
}
export type Runner = (cmd: string, args: string[], opts?: RunOpts) => RunResult;

const MAX_BUFFER = 64 * 1024 * 1024;

/** How long a terminated check gets to exit after SIGTERM or SIGINT before SIGKILL. */
export const GRACE_MS = 2000;
/** The longest one ps listing may take. */
export const PS_TIMEOUT_MS = 5000;
/** How long a terminated check's pipes get to close after the final SIGKILL. */
export const SETTLE_MS = 500;
/**
 * How far a ps start time (lstart) may read before the real start. macOS truncates to whole seconds (under 1 s). Linux
 * procps adds the boot time, itself truncated to whole seconds, to the start ticks, then truncates again: just under
 * 2 s, plus a clock tick.
 */
export const LSTART_SLACK_MS = 2500;
/**
 * How far two `ps` listings of one process can disagree on its lstart: one whole second, since lstart is whole seconds
 * and procps 4 derives the boot time from the clock on each run. Both sides come from ps, so LSTART_SLACK_MS (lstart
 * against Date.now()) would be too loose: it would keep a pid reused a second or two after the one seen.
 */
export const LSTART_TICK_MS = 1000;

/**
 * The engine's backstop on a grouped run: past the check's timeout, the supervisor's worst case to end it (two ps
 * listings, the grace and the settle) plus 3 s for node to start and exit.
 */
export function backstopMs(timeoutMs: number): number {
  return timeoutMs + 2 * PS_TIMEOUT_MS + GRACE_MS + SETTLE_MS + 3000;
}

/**
 * The ps to list processes with: /bin/ps, else /usr/bin/ps, else the first ps on `pathVar` (NixOS keeps it elsewhere).
 * The system dirs come first, so a repo's PATH cannot put a fake ps ahead of the real one. Null when there is none, or
 * when the PATH one is relative.
 */
export function findPs(pathVar: string | undefined = process.env.PATH, system: string[] = ["/bin/ps", "/usr/bin/ps"]): string | null {
  for (const f of system) if (isExecutable(f)) return f;
  // A relative entry resolves against this cwd, but the supervisor runs in the repo root: count it as no ps.
  const p = which("ps", pathVar);
  return p && isAbsolute(p) ? p : null;
}

/**
 * The supervisor a grouped run goes through: a node process in the caller's own process group that starts the command
 * detached (a new session, so its own process group and no controlling terminal), so the whole group can be killed. It
 * reads {cmd, args, env, timeoutMs, max, parent, pidfile, out, ps} as JSON on stdin. Right after the spawn it publishes
 * {pgid, startMs, spawnedMs} to `pidfile` (tmp + rename; startMs is taken before the spawn, spawnedMs right after it, so
 * the leader's start time lies between them), and it copies the check's stdout to
 * `out` as it arrives, so an engine that loses the supervisor can still kill the group and keep what the check printed.
 * One terminate routine ends the check at the timeout (SIGTERM), on SIGINT (SIGINT), on SIGTERM or SIGHUP (SIGTERM; a
 * terminal's Ctrl-C and hangup reach the supervisor, not the detached group), and when its parent is gone (SIGTERM; an
 * engine killed while spawnSync blocks its signal handlers): see `terminate`. It relays the command's output once it
 * ends, after one JSON status line on stderr: {code, signal, error, timedOut}. When it exits after its engine is gone
 * (an engine killed by a signal never runs its own cleanup), it removes the run dir that holds pidfile and out.
 */
const SUPERVISOR = `
const { spawn, spawnSync } = require("node:child_process");
const { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } = require("node:fs");
const { constants } = require("node:os");
const { dirname } = require("node:path");
const o = JSON.parse(readFileSync(0, "utf8"));
const GRACE_MS = ${GRACE_MS}, PS_TIMEOUT_MS = ${PS_TIMEOUT_MS}, SLACK = ${LSTART_SLACK_MS}, TICK = ${LSTART_TICK_MS};
let child = null, error = null, timedOut = false, done = false, timer = null, terminating = false, closed = false, settling = false, tee = null;
// Every live pid of the check seen so far, the leader and its descendants, with the start time each had when first seen.
const seen = new Set(), starts = new Map();
// When the leader exited (its pid is then free to be reused), and whether the leader's group is still the check's.
let leaderExitMs = null, groupOk = true;
// One \`ps -A -o pid=,ppid=,pgid=,lstart=\` listing in UTC (start times parsed to ms, NaN when one does not parse), or
// null without a usable ps (then the sweep keeps what it knew).
const list = () => {
  if (!o.ps) return null;
  const r = spawnSync(o.ps, ["-A", "-o", "pid=,ppid=,pgid=,lstart="], { env: { LC_ALL: "C", TZ: "UTC0" }, encoding: "utf8", timeout: PS_TIMEOUT_MS });
  if (!r.stdout) return null;
  const rows = [];
  for (const line of r.stdout.split("\\n")) {
    const m = /^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\S.*?)\\s*$/.exec(line);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], at: Date.parse(m[4].replace(/\\s+/g, " ") + " UTC") });
  }
  return rows;
};
// Drop every seen pid that is gone or now has another start time (exited, maybe reused; two listings of one process
// differ by at most TICK, so a pid whose start moved further is another process), then add every live
// descendant of the rest: a setsid child whose parent is still alive is found; a daemon already reparented to init is
// not. Once the leader has exited, its group is still the check's only while a member started before that.
const sweep = () => {
  const rows = list();
  if (!rows) return;
  const live = new Map(rows.map((x) => [x.pid, x]));
  for (const p of [...seen]) {
    const x = live.get(p);
    if (!x || Math.abs(x.at - starts.get(p)) > TICK) seen.delete(p);
    else if (Number.isNaN(starts.get(p))) starts.set(p, x.at);
  }
  const kids = new Map();
  for (const x of rows) kids.set(x.ppid, [...(kids.get(x.ppid) || []), x.pid]);
  const todo = [...seen];
  while (todo.length) for (const k of kids.get(todo.pop()) || []) if (k !== process.pid && !seen.has(k)) { seen.add(k); starts.set(k, live.get(k).at); todo.push(k); }
  if (leaderExitMs !== null) groupOk = rows.some((x) => x.pgid === child.pid && !(x.at > leaderExitMs + SLACK));
};
const signal = (sig) => {
  if (groupOk) try { process.kill(-child.pid, sig); } catch {}
  for (const p of seen) try { process.kill(p, sig); } catch {}
};
const alive = () => {
  if (groupOk) try { process.kill(-child.pid, 0); return true; } catch {}
  for (const p of seen) try { process.kill(p, 0); return true; } catch {}
  return false;
};
// The one way a check is ended early. It turns off the orphan poll and the timer and ignores a repeat call (a second
// Ctrl-C), sends sig to the group and every swept pid, and waits up to GRACE_MS for them all to exit, staying alive
// after the leader exits and when the engine is gone. Then it sweeps again and SIGKILLs the group and every pid seen.
const terminate = (sig, then) => {
  if (terminating) return;
  terminating = true;
  clearInterval(poll);
  clearTimeout(timer);
  if (!child || !child.pid) return then();
  sweep();
  signal(sig);
  const end = Date.now() + GRACE_MS;
  const wait = () => {
    if (alive() && Date.now() < end) return void setTimeout(wait, 25);
    sweep();
    signal("SIGKILL");
    then();
  };
  wait();
};
const orphan = () => process.ppid !== o.parent;
// An engine that is gone left its run dir behind: remove it on the way out. While the engine lives it reads the
// pidfile and the stdout copy after a supervisor it lost, and removes the dir itself.
process.on("exit", () => {
  if (!o.pidfile || !orphan()) return;
  try { if (tee !== null) closeSync(tee); } catch {}
  try { rmSync(dirname(o.pidfile), { recursive: true, force: true }); } catch {}
});
const poll = setInterval(() => { if (orphan()) terminate("SIGTERM", () => process.exit(1)); }, 100);
poll.unref();
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => terminate(s === "SIGINT" ? "SIGINT" : "SIGTERM", () => process.exit(128 + constants.signals[s])));
// The pipes to the engine are non-blocking: a full one (64 KB) throws EAGAIN until the engine drains it, so wait a ms.
const nap = new Int32Array(new SharedArrayBuffer(4));
const put = (fd, b) => {
  for (let at = 0; at < b.length; ) {
    try { at += writeSync(fd, b, at, b.length - at); } catch (e) { if (e.code !== "EAGAIN") throw e; Atomics.wait(nap, 0, 0, 1); }
  }
};
const bufs = [[], []], sizes = [0, 0];
const finish = (code, signal) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  const st = timedOut || error ? { code: null, signal: null, error, timedOut } : { code, signal, error: null, timedOut };
  try {
    put(2, Buffer.from(JSON.stringify(st) + "\\n"));
    put(2, Buffer.concat(bufs[1]));
    put(1, Buffer.concat(bufs[0]));
  } catch {
    process.exit(1);
  }
  process.exit(0);
};
// After a terminate that ends in a result: the kill closes the pipes; one held by a process that left the group would not.
const settle = () => { settling = true; if (closed) finish(null, null); else setTimeout(() => finish(null, null), ${SETTLE_MS}); };
if (orphan()) process.exit(1);
if (o.out) try { tee = openSync(o.out, "a"); } catch {}
const startMs = Date.now();
child = spawn(o.cmd, o.args, { env: o.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
if (child.pid) {
  seen.add(child.pid);
  starts.set(child.pid, NaN);
  if (o.pidfile) try { writeFileSync(o.pidfile + ".tmp", JSON.stringify({ pgid: child.pid, startMs, spawnedMs: Date.now() })); renameSync(o.pidfile + ".tmp", o.pidfile); } catch {}
}
child.on("error", (e) => { error = e.code || String(e); finish(null, null); });
// A reaped leader's pid is free: never signal it on its own again.
child.on("exit", () => { leaderExitMs = Date.now(); seen.delete(child.pid); });
[child.stdout, child.stderr].forEach((s, i) => s.on("data", (b) => {
  sizes[i] += b.length;
  if (sizes[i] <= o.max) {
    bufs[i].push(b);
    if (i === 0 && tee !== null) try { writeSync(tee, b); } catch {}
  } else if (!terminating) { error = "ENOBUFS"; terminate("SIGKILL", settle); }
}));
child.on("close", (code, signal) => { closed = true; if (!terminating) finish(code, signal); else if (settling) finish(null, null); });
if (o.timeoutMs) timer = setTimeout(() => { timedOut = true; error = "ETIMEDOUT"; terminate("SIGTERM", settle); }, o.timeoutMs);
`;

interface Status {
  code: number | null;
  signal: string | null;
  error: string | null;
  timedOut: boolean;
}

export const run: Runner = (cmd, args, opts = {}) => {
  if (opts.group) return runGroup(cmd, args, opts);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    // SIGTERM can be trapped or ignored; a deadline has to hold.
    killSignal: "SIGKILL",
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  const errCode = (r.error as NodeJS.ErrnoException | undefined)?.code;
  const abend = r.status === null ? (errCode ?? r.signal ?? undefined) : undefined;
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: errCode === "ETIMEDOUT", notFound: errCode === "ENOENT", abend };
};

/**
 * `run` for `group`: through SUPERVISOR, with a clean env so NODE_OPTIONS and the like reach only the command. spawnSync
 * blocks this process's own signal handlers, so the supervisor is what ends the group on an interrupt. A supervisor
 * that dies (SIGKILLed, out of memory) or overruns the backstop is lost: then this side kills the group its pidfile
 * names, once `ps` shows the group is this run's, and returns what the check had printed.
 */
function runGroup(cmd: string, args: string[], opts: RunOpts): RunResult {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "loops-run-"));
  } catch {
    // no run dir: the supervisor publishes no pidfile, and a lost one's group cannot be verified
  }
  try {
    const [pidfile, out] = dir ? [join(dir, "group.pid"), join(dir, "out")] : [null, null];
    const ps = opts.ps === undefined ? findPs() : opts.ps;
    const input = JSON.stringify({ cmd, args, env: opts.env ?? process.env, timeoutMs: opts.timeoutMs, max: MAX_BUFFER, parent: process.pid, pidfile, out, ps });
    const r = spawnSync(process.execPath, ["-e", SUPERVISOR], {
      cwd: opts.cwd,
      env: {},
      input,
      // A backstop only: the supervisor keeps the deadline; backstopMs covers its worst case to end the check.
      timeout: opts.timeoutMs === undefined ? undefined : backstopMs(opts.timeoutMs),
      killSignal: "SIGKILL",
      encoding: "utf8",
      maxBuffer: 2 * MAX_BUFFER,
    });
    const errCode = (r.error as NodeJS.ErrnoException | undefined)?.code;
    const nl = (r.stderr ?? "").indexOf("\n");
    let st: Status | null = null;
    try {
      st = nl < 0 ? null : (JSON.parse(r.stderr.slice(0, nl)) as Status);
    } catch {
      // no status: the supervisor itself did not finish
    }
    // A supervisor that died after its status line (a relay write failed) relayed only part of the output.
    if (!st || r.status !== 0) {
      const why = errCode ?? r.signal ?? `supervisor exited ${r.status}`;
      const cleaned = pidfile ? reapLost(pidfile, () => psStarts(ps)) : "unverified";
      return { code: null, stdout: out ? printed(out) : "", stderr: "", timedOut: errCode === "ETIMEDOUT", notFound: errCode === "ENOENT", abend: why, lost: true, cleaned };
    }
    const abend = st.code === null ? (st.error ?? st.signal ?? undefined) : undefined;
    return { code: st.code, stdout: r.stdout, stderr: r.stderr.slice(nl + 1), timedOut: st.timedOut, notFound: st.error === "ENOENT", abend, lost: false, cleaned: "yes" };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** The whole lines of the stdout copy a lost supervisor left (a last line cut short is dropped), or "". */
function printed(out: string): string {
  try {
    const s = readFileSync(out, "utf8");
    return s.slice(0, s.lastIndexOf("\n") + 1);
  } catch {
    return "";
  }
}

/** `LC_ALL=C TZ=UTC0 ps -A -o pid=,pgid=,lstart=` (start times in UTC), or null without a ps or when it failed. */
function psStarts(ps: string | null = findPs()): string | null {
  if (!ps) return null;
  const r = spawnSync(ps, ["-A", "-o", "pid=,pgid=,lstart="], { env: { LC_ALL: "C", TZ: "UTC0" }, encoding: "utf8", timeout: PS_TIMEOUT_MS });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Whose group `pgid` is in a `pid= pgid= lstart=` listing with UTC start times, for a leader spawned between `startMs`
 * and `spawnedMs`: "gone" when no process has it; "other" when one of its processes started before startMs, or its
 * leader (pid == pgid) after spawnedMs (the group ended and a new one got the same number); "ours" when its leader is
 * there and started in that window; "unknown" when a start time does not parse, or the leader is not there (a group
 * whose leader exited cannot be told from a newer one with the same pgid). Each bound allows LSTART_SLACK_MS, since
 * lstart is whole seconds and can read up to about 2 s off on Linux. UTC, since a local time is ambiguous in a DST
 * fall-back.
 */
export function groupOwner(listing: string, pgid: number, startMs: number, spawnedMs: number): "gone" | "ours" | "other" | "unknown" {
  let found = false;
  let leader: number | null = null;
  for (const line of listing.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (!m || Number(m[2]) !== pgid) continue;
    const at = Date.parse(`${m[3]!.replace(/\s+/g, " ")} UTC`);
    if (Number.isNaN(at)) return "unknown";
    if (at < startMs - LSTART_SLACK_MS) return "other";
    if (Number(m[1]) === pgid) leader = at;
    found = true;
  }
  if (!found) return "gone";
  if (leader === null) return "unknown";
  return leader > spawnedMs + LSTART_SLACK_MS ? "other" : "ours";
}

/**
 * After a lost supervisor: SIGKILL the group its pidfile names when `ps` shows the group is this run's (the PID-reuse
 * guard: its leader started in the spawn window), and say whether the group is gone ("yes"), was left because it is not
 * this run's ("no"), or could not be checked ("unverified": no pidfile, as when the supervisor died before publishing
 * it, no usable ps, or a group whose leader has exited).
 */
export function reapLost(pidfile: string, ps: () => string | null = psStarts): "yes" | "no" | "unverified" {
  let rec: { pgid?: unknown; startMs?: unknown; spawnedMs?: unknown };
  try {
    rec = JSON.parse(readFileSync(pidfile, "utf8")) as typeof rec;
  } catch {
    return "unverified";
  }
  const { pgid, startMs, spawnedMs } = rec ?? {};
  // pgid 1 (or less) would make kill(-pgid) signal every process this user can reach.
  if (!Number.isSafeInteger(pgid) || (pgid as number) <= 1 || pgid === process.pid || typeof startMs !== "number" || typeof spawnedMs !== "number") return "unverified";
  const listing = ps();
  if (listing === null) return "unverified";
  const owner = groupOwner(listing, pgid as number, startMs, spawnedMs);
  if (owner === "unknown") return "unverified";
  if (owner === "other") return "no";
  if (owner === "ours") {
    try {
      process.kill(-(pgid as number), "SIGKILL");
    } catch {
      // gone since the listing
    }
  }
  return "yes";
}

/** `s` as one POSIX shell word, for commands a fix tells the developer to run. */
export function shQuote(s: string): string {
  return /^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** A character that can continue a path segment (`bob2`, `bob.old`). */
const SEGMENT = /[\p{L}\p{N}\p{M}._+@%~-]/u;
const NAME = /[\p{L}\p{N}\p{M}]/u;

/**
 * Whether the segment characters from `s[i]` on join a `home` match ending there to a longer name: they do when they
 * hold a letter or digit (`bob.old`, `bob-x`), not when they are only punctuation, as at the end of a sentence
 * (`/home/bob.`, `/home/bob...`). Before a match any segment character joins it (`./home/bob` is a relative path).
 */
function joined(s: string, i: number): boolean {
  for (; i < s.length && SEGMENT.test(s[i]!); i++) if (NAME.test(s[i]!)) return true;
  return false;
}

/**
 * `s` with `home` shown as `~`, keeping printed commands runnable: a tilde inside quotes does not expand, so a word
 * shQuote quoted from a path under home becomes `~/'rest'` (or `~` for home itself). A trailing slash on home is
 * ignored, so `HOME=/home/u/` still hides a bare `/home/u`. Only a whole path at a segment boundary on both sides is
 * replaced (`/home/u2` and `/x/home/u` stay; a `/home/u.` ending a sentence is replaced), and only an absolute home
 * (POSIX; a relative `HOME=build` would hit every `build` folder). `home` is matched literally, never turned into a
 * pattern.
 */
export function redactHome(s: string, home: string): string {
  home = home.replace(/\/+$/, "");
  if (home.length <= 1 || !home.startsWith("/")) return s;
  let out = "";
  let from = 0;
  for (let i = s.indexOf(home); i !== -1; i = s.indexOf(home, Math.max(from, i + 1))) {
    const before = s[i - 1] ?? "";
    const after = s[i + home.length] ?? "";
    if ((before && SEGMENT.test(before)) || joined(s, i + home.length)) continue;
    // A quoted `'<home>/rest'` or `'<home>'` drops its opening quote, so the tilde is outside it.
    const quoted = i > from && before === "'" && (after === "/" || after === "'");
    out += `${s.slice(from, quoted ? i - 1 : i)}${quoted ? (after === "/" ? "~/'" : "~") : "~"}`;
    from = i + home.length + (quoted ? 1 : 0);
  }
  return out + s.slice(from);
}

/** Everything a subcommand touches outside its own logic, injected so tests need no real process state. */
export interface Deps {
  run: Runner;
  cwd: string;
  env: NodeJS.ProcessEnv;
  readStdin: () => string;
  out: (s: string) => void;
  err: (s: string) => void;
  /** What d.node_modules filters npm's os/cpu/libc on; tests inject it, else this machine's (hostPlatform). */
  platform?: Platform;
}

// What `git rev-parse --local-env-vars` lists (git 2.56), the variables that point git at a repo, index or object
// store other than the one cwd is in, less GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT: git's prepare_other_repo_env
// (run-command.c), which sets up the env for a git run in another repo, keeps those two, since they carry
// command-scope config (`git -c`, safe.directory in CI) rather than a location. GIT_CONFIG, the file `git config`
// reads instead of the repo's, goes as git drops it. Hardcoded; a later git may add one.
const GIT_LOCAL_ENV = ["GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_SHALLOW_FILE", "GIT_COMMON_DIR"];

/** `p`'s real path, or null when it does not exist. */
function realOrNull(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * `env` without git's repo-local variables, for env-check's git: an inherited GIT_DIR (a hook's, another checkout's)
 * must not make it read some other repo. GIT_INDEX_FILE stays when `own` is given and it names a file directly in
 * that checkout's git-dir: the index.lock (or next-index-*.lock) git hands a pre-commit hook of `git commit -a` or
 * `git commit <paths>`, so d.tracked sees the deletion being committed. It must exist: git reads an absent one as an
 * empty index, so a stale one (a hook outliving its commit, a leftover export) is dropped. Under the git-dir, deeper,
 * a linked worktree's or a submodule's index is another checkout's, and dropped. Git reads a relative one from the worktree
 * top, which is `own.root`, every such spawn's cwd. Discover the git-dir without `own`, so it never sees the index.
 * `loops zone` keeps the caller's git env, temporary index and all.
 */
export function gitEnv(env: NodeJS.ProcessEnv, own?: { gitDir: string | null; root: string }): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of GIT_LOCAL_ENV) delete out[k];
  const index = env.GIT_INDEX_FILE;
  const gitDir = own?.gitDir ? realOrNull(own.gitDir) : null;
  const file = index && own && gitDir ? realOrNull(resolve(own.root, index)) : null;
  if (file && dirname(file) === gitDir) out.GIT_INDEX_FILE = index;
  return out;
}

/** stdout of a successful git command, else null; `env` undefined inherits this process's env. */
export function git(r: Runner, cwd: string, args: string[], env: NodeJS.ProcessEnv | undefined): string | null {
  const res = r("git", args, { cwd, env });
  return res.code === 0 ? res.stdout : null;
}

/** The repo's top-level dir, or null outside a git repo. */
export function repoRoot(r: Runner, cwd: string, env: NodeJS.ProcessEnv | undefined): string | null {
  return git(r, cwd, ["rev-parse", "--show-toplevel"], env)?.trim() || null;
}

export function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** First executable `name` on `pathVar`, or null. */
export function which(name: string, pathVar: string | undefined): string | null {
  for (const dir of (pathVar ?? "").split(delimiter)) {
    if (dir && isExecutable(join(dir, name))) return join(dir, name);
  }
  return null;
}

/** A version-manager shim: which manager resolves the tool, and the manager binary to ask (null: look it up on PATH). */
export interface Shim {
  manager: "asdf" | "mise";
  cmd: string | null;
  /** The plugin versions an asdf shim's `# asdf-plugin: <plugin> <version>` header lines name, in order; none for mise. */
  providers: { plugin: string; version: string }[];
}

/** The most of a shim `shimOf` reads. */
const SHIM_MAX = 1 << 20;
/**
 * The version manager behind `file`, read from the file and never run, or null for anything else. An asdf shim is a
 * script with a `# asdf-plugin:` line in its header that execs asdf, by an absolute path in older shims (that asdf is
 * the one to ask, if the path names an `asdf`; any other program is never run, and asdf is looked up on PATH) or by
 * name; a mise shim is a symlink to the mise binary itself.
 */
export function shimOf(file: string): Shim | null {
  let real: string;
  try {
    real = realpathSync(file);
  } catch {
    return null;
  }
  if (/^mise(\.exe)?$/.test(basename(real)) && !/^mise(\.exe)?$/.test(basename(file))) return { manager: "mise", cmd: real, providers: [] };
  const buf = Buffer.alloc(4096);
  let head: string;
  let n: number;
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    n = readSync(fd, buf, 0, buf.length, 0);
    head = buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (!/^# asdf-plugin:/m.test(head)) return null;
  // An asdf shim has one header line per installed version, so it can run past the head: then read all of it, up to
  // 1 MiB (a bigger file keeps the head).
  if (n === buf.length) {
    try {
      if (statSync(file).size <= SHIM_MAX) head = readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
  const m = /^\s*exec\s+(?:"([^"]+)"|(\S+))\s+exec\s/m.exec(head);
  const cmd = m?.[1] ?? m?.[2];
  const providers = [...head.matchAll(/^# asdf-plugin:[ \t]+(\S+)[ \t]+(\S+)/gm)].map((p) => ({ plugin: p[1]!, version: p[2]! }));
  return { manager: "asdf", cmd: cmd && isAbsolute(cmd) && basename(cmd) === "asdf" ? cmd : null, providers };
}

type Flags = Record<string, boolean | string | string[]>;

/**
 * Tiny flag parser. `--x` and `-z` set bool flags; `--x v` / `--x=v` set value flags; an opt flag
 * is true bare and the string after `=` with one (`--x=` alone is an error, and `--x v` never takes
 * v: that is an unexpected argument naming the `--x=v` form; a repeated opt flag is an error); list flags take every following arg
 * up to the next flag (or everything after `--`). Anything else is a UsageError.
 */
export function parseFlags(argv: string[], spec: { bool?: string[]; value?: string[]; opt?: string[]; list?: string[] }): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--?([A-Za-z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!m) throw new UsageError(`unexpected argument ${arg}`);
    const [, name = "", inline] = m;
    if (spec.bool?.includes(name) && inline === undefined) out[name] = true;
    else if (spec.opt?.includes(name)) {
      if (inline === "") throw new UsageError(`--${name}= needs a value (write --${name} bare, or --${name}=<value>)`);
      const next = argv[i + 1];
      if (inline === undefined && next !== undefined && !next.startsWith("-")) {
        throw new UsageError(`unexpected argument ${next}: --${name} takes its value after "=" (write --${name}=${next})`);
      }
      // A second occurrence would silently replace the first list (a required id dropped), so it is an error.
      if (name in out) throw new UsageError(`--${name} given twice (write it once, with every id in one comma list)`);
      out[name] = inline ?? true;
    }
    else if (spec.value?.includes(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`--${name} needs a value`);
      out[name] = v;
    } else if (spec.list?.includes(name) && inline === undefined) {
      const items: string[] = [];
      while (i + 1 < argv.length) {
        const next = argv[i + 1]!;
        if (next === "--") {
          items.push(...argv.slice(i + 2));
          i = argv.length;
        } else if (next.startsWith("-") && next !== "-") break;
        else {
          items.push(next);
          i++;
        }
      }
      out[name] = items;
    } else throw new UsageError(`unknown flag ${arg}`);
  }
  return out;
}
