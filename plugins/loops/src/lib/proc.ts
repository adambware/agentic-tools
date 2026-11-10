// Process and flag helpers shared by `loops zone` and `loops env-check`. Commands that spawn
// (git, tool version probes, local checks) go through the injected Runner, like RunGh in repos.ts.
import { spawnSync } from "node:child_process";
import { accessSync, closeSync, constants, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";

/** Bad usage, bad config or an unreadable repo: the CLI prints it to stderr and exits 2. */
export class UsageError extends Error {}

export interface RunOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Run in its own process group, and kill the whole group at the timeout or an interrupt, so a child it started does not outlive it. */
  group?: boolean;
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
}
export type Runner = (cmd: string, args: string[], opts?: RunOpts) => RunResult;

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The supervisor a grouped run goes through: a node process in the caller's own process group that starts the command
 * detached (its own session and process group), so the whole group can be killed, and kills that group with SIGKILL at
 * the timeout, on SIGINT, SIGTERM or SIGHUP (a terminal's Ctrl-C reaches the supervisor, not the detached group), and
 * when its parent is gone (an engine killed while spawnSync blocks its signal handlers). It reads {cmd, args, env,
 * timeoutMs, max, parent} as JSON on stdin and relays the command's output once it ends, after one JSON status line
 * on stderr: {code, signal, error, timedOut}.
 */
const SUPERVISOR = `
const { spawn } = require("node:child_process");
const { readFileSync, writeSync } = require("node:fs");
const { constants } = require("node:os");
const o = JSON.parse(readFileSync(0, "utf8"));
let child = null, error = null, timedOut = false, done = false, timer = null;
const kill = () => { try { if (child && child.pid) process.kill(-child.pid, "SIGKILL"); } catch {} };
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { kill(); process.exit(128 + constants.signals[s]); });
const orphan = () => process.ppid !== o.parent;
setInterval(() => { if (orphan()) { kill(); process.exit(1); } }, 100).unref();
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
  put(2, Buffer.from(JSON.stringify(st) + "\\n"));
  put(2, Buffer.concat(bufs[1]));
  put(1, Buffer.concat(bufs[0]));
  process.exit(0);
};
if (orphan()) process.exit(1);
child = spawn(o.cmd, o.args, { env: o.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
child.on("error", (e) => { error = e.code || String(e); finish(null, null); });
[child.stdout, child.stderr].forEach((s, i) => s.on("data", (b) => {
  sizes[i] += b.length;
  if (sizes[i] > o.max) { error = "ENOBUFS"; kill(); finish(null, null); } else bufs[i].push(b);
}));
child.on("close", finish);
if (o.timeoutMs) timer = setTimeout(() => {
  timedOut = true; error = "ETIMEDOUT"; kill();
  // The kill closes the pipes; one held by a process that left the group would not.
  setTimeout(() => finish(null, null), 500);
}, o.timeoutMs);
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
 * blocks this process's own signal handlers, so the supervisor is what ends the group on an interrupt.
 */
function runGroup(cmd: string, args: string[], opts: RunOpts): RunResult {
  const input = JSON.stringify({ cmd, args, env: opts.env ?? process.env, timeoutMs: opts.timeoutMs, max: MAX_BUFFER, parent: process.pid });
  const r = spawnSync(process.execPath, ["-e", SUPERVISOR], {
    cwd: opts.cwd,
    env: {},
    input,
    // A backstop only: the supervisor keeps the deadline.
    timeout: opts.timeoutMs === undefined ? undefined : opts.timeoutMs + 10_000,
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
    return { code: null, stdout: "", stderr: "", timedOut: errCode === "ETIMEDOUT", notFound: errCode === "ENOENT", abend: why };
  }
  const abend = st.code === null ? (st.error ?? st.signal ?? undefined) : undefined;
  return { code: st.code, stdout: r.stdout, stderr: r.stderr.slice(nl + 1), timedOut: st.timedOut, notFound: st.error === "ENOENT", abend };
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
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    head = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (!/^# asdf-plugin:/m.test(head)) return null;
  const m = /^\s*exec\s+(?:"([^"]+)"|(\S+))\s+exec\s/m.exec(head);
  const cmd = m?.[1] ?? m?.[2];
  const providers = [...head.matchAll(/^# asdf-plugin:[ \t]+(\S+)[ \t]+(\S+)/gm)].map((p) => ({ plugin: p[1]!, version: p[2]! }));
  return { manager: "asdf", cmd: cmd && isAbsolute(cmd) && basename(cmd) === "asdf" ? cmd : null, providers };
}

type Flags = Record<string, boolean | string | string[]>;

/**
 * Tiny flag parser. `--x` and `-z` set bool flags; `--x v` / `--x=v` set value flags; list flags
 * take every following arg up to the next flag (or everything after `--`). Anything else is a
 * UsageError.
 */
export function parseFlags(argv: string[], spec: { bool?: string[]; value?: string[]; list?: string[] }): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--?([A-Za-z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!m) throw new UsageError(`unexpected argument ${arg}`);
    const [, name = "", inline] = m;
    if (spec.bool?.includes(name) && inline === undefined) out[name] = true;
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
