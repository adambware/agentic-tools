// Built-in `loops env-check` checks (groups a, c, d, e) and the runner for `[[local]]` checks.
// Every check returns Results; a check that cannot decide fails or warns, never passes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isMap, parseAllDocuments } from "yaml";
import { composeName, isNoFile } from "./compose-config.js";
import { compileGlob } from "./glob.js";
import type { Config, LocalCheck } from "./env-config.js";
import { belowFloor, disagreement, localOk, pinOf, PinError, readSource, ver, type PinValue } from "./pins.js";
import { git, isExecutable, which, type Runner } from "./proc.js";

export type Level = "PASS" | "WARN" | "FAIL" | "SKIP" | "INFO";
export interface Result {
  level: Level;
  id: string;
  message: string;
  fix?: string;
  source: "builtin" | "local";
  /** Ids of later results with the same level and message, folded into this one. */
  also?: string[];
}
export interface Ctx {
  run: Runner;
  root: string;
  env: NodeJS.ProcessEnv;
  static: boolean;
  cfg: Config;
  /** `git ls-files`. */
  tracked: string[];
  /** Linked worktree? False in --static, where nothing probes worktrees. */
  isWorktree: boolean;
  /** `git worktree list` paths, the main checkout first. */
  worktrees: string[];
}

const res = (level: Level, id: string, message: string, fix?: string): Result => ({ level, id, message, fix, source: "builtin" });
const CFG = ".loops/env-check.toml";
const rp = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const short = (xs: string[], n = 5): string => xs.slice(0, n).join(", ") + (xs.length > n ? ` (+${xs.length - n} more)` : "");

const VERSION_CMD: Record<string, [string, string[]]> = { go: ["go", ["version"]], node: ["node", ["--version"]], python: ["python3", ["--version"]] };
/** Docker calls and toolchain probes: a hung daemon, shim or network call must not hang the run. */
const PROBE_TIMEOUT_MS = 10_000;

export function pinChecks(c: Ctx): Result[] {
  const out: Result[] = [];
  for (const pin of c.cfg.pins) {
    const id = `a.pins.${pin.tool}`;
    let vals: PinValue[];
    try {
      vals = pin.sources.flatMap((s) => readSource(c.root, c.tracked, pin.tool, s));
    } catch (e) {
      if (!(e instanceof PinError)) throw e;
      out.push(res("FAIL", id, e.message, `fix the source file or the sources in ${CFG}`));
      continue;
    }
    const bad = disagreement(vals, pin.compare);
    if (bad) {
      out.push(res("FAIL", id, bad, `align the pinned versions, or loosen compare in ${CFG}`));
      continue;
    }
    const want = pinOf(vals, pin.compare);
    out.push(res("PASS", id, `${pin.tool} ${want} (${[...new Set(vals.map((v) => v.src))].join(", ")})`));
    if (c.static || pin.local === "off") continue;
    const [bin, args] = Object.hasOwn(VERSION_CMD, pin.tool) ? VERSION_CMD[pin.tool]! : [pin.tool, ["--version"]];
    const r = c.run(bin, args, { cwd: c.root, env: { ...c.env, GOTOOLCHAIN: "local", GOPROXY: "off" }, timeoutMs: PROBE_TIMEOUT_MS });
    const have = r.code === 0 ? ver(r.stdout + r.stderr) : null;
    const lid = `a.local.${pin.tool}`;
    const level = pin.local === "fail" ? "FAIL" : "WARN";
    const fix = `install ${pin.tool} ${want} (asdf install, mise install, or your package manager)`;
    if (r.timedOut) out.push(res(level, lid, `${[bin, ...args].join(" ")} timed out after ${PROBE_TIMEOUT_MS / 1000}s`, fix));
    else if (have === null) out.push(res(level, lid, `${bin} not found or gave no version`, fix));
    else if (!localOk(have, want, pin.compare)) out.push(res(level, lid, `local ${pin.tool} ${have} does not match pin ${want}`, fix));
    else if (belowFloor(have, vals)) out.push(res(level, lid, `local ${pin.tool} ${have} is below the floor ${belowFloor(have, vals)}`, fix));
    else out.push(res("PASS", lid, `local ${pin.tool} ${have} matches pin ${want}`));
  }
  return out;
}

export function sharedCheck(c: Ctx): Result[] {
  if (c.cfg.sharedHint === null) return [];
  if (c.static) return [res("SKIP", "c.shared", "not checked in --static mode")];
  if (c.isWorktree) return [res("PASS", "c.shared", "in a linked worktree")];
  if (c.env.ENV_CHECK_ALLOW_MAIN === "1") return [res("INFO", "c.shared", "shared checkout allowed by ENV_CHECK_ALLOW_MAIN")];
  return [res("FAIL", "c.shared", "this is the shared checkout; agents and branches belong in a worktree", c.cfg.sharedHint)];
}

/** Paths a CI workflow runs as `./something`. */
function autoEntrypoints(c: Ctx): string[] {
  const re = compileGlob(".github/workflows/*.{yml,yaml}");
  const found = new Set<string>();
  for (const f of c.tracked.filter((t) => re.some((r) => r.test(t)) && existsSync(join(c.root, t)))) {
    for (const m of readFileSync(join(c.root, f), "utf8").matchAll(/^\s*(?:-\s+)?(?:run:\s+(?:[|>][+-]?\s*)?)?\.\/([\w./-]+)/gm)) found.add(m[1]!);
  }
  return [...found].sort();
}

export function harnessChecks(c: Ctx): Result[] {
  const h = c.cfg.harness;
  const out: Result[] = [];
  if (h.tools.length && !c.static) {
    const missing = h.tools.filter((t) => !which(t, c.env.PATH));
    out.push(missing.length ? res("FAIL", "d.tools", `missing on PATH: ${missing.join(", ")}`, "install the missing tools") : res("PASS", "d.tools", `present: ${h.tools.join(", ")}`));
  }
  if (h.files.length) {
    const bad = h.files.filter((f) => !existsSync(join(c.root, f)) || statSync(join(c.root, f)).size === 0);
    out.push(bad.length ? res("FAIL", "d.files", `missing or empty: ${bad.join(", ")}`, "restore the files (git checkout) or fix [harness] files") : res("PASS", "d.files", `present: ${h.files.join(", ")}`));
  }
  const entries = h.entrypoints === "auto" ? autoEntrypoints(c) : h.entrypoints;
  if (entries.length) {
    const bad = entries.filter((e) => !isExecutable(join(c.root, e)));
    out.push(bad.length ? res("FAIL", "d.entrypoints", `missing or not executable: ${short(bad)}`, `chmod +x ${bad.slice(0, 3).join(" ")}`) : res("PASS", "d.entrypoints", `${entries.length} executable`));
  }
  const [deletedZ, stagedZ] = h.tracked ? ["-d", "-s"].map((f) => git(c.run, c.root, ["ls-files", f, "-z"])) : [];
  if (h.tracked && (deletedZ == null || stagedZ == null)) out.push(res("FAIL", "d.tracked", "git ls-files failed", "run git status to see what is wrong with the index"));
  else if (h.tracked) {
    const deleted = deletedZ!.split("\0").filter(Boolean);
    const lost = stagedZ!
      .split("\0")
      .flatMap((l) => (l.startsWith("100755 ") ? [l.split("\t")[1] ?? ""] : []))
      .filter((p) => p && existsSync(join(c.root, p)) && !isExecutable(join(c.root, p)));
    const parts = [deleted.length ? `deleted: ${short(deleted)}` : "", lost.length ? `exec bit lost: ${short(lost)}` : ""].filter(Boolean);
    out.push(parts.length ? res("FAIL", "d.tracked", parts.join("; "), "git checkout -- <path> to restore, chmod +x for exec bits") : res("PASS", "d.tracked", "no tracked file deleted, exec bits intact"));
  }
  if (h.sparse && !c.static && git(c.run, c.root, ["config", "--get", "core.sparseCheckout"])?.trim() === "true") {
    out.push(res("WARN", "d.sparse", "sparse checkout is enabled; tools may not see every file", "git sparse-checkout disable"));
  }
  return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "");
const COMPOSE_FILE = /(^|\/)(docker-)?compose([.-][\w.-]+)?\.ya?ml$/i;
const COMPOSE_KEYS = ["services", "include", "networks", "volumes", "configs", "secrets", "models"];
const table = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
/** Top-level keys Compose allows besides COMPOSE_KEYS; a file of only these loads unless it holds only `version`. */
const isMetaKey = (k: string): boolean => k === "name" || k === "version" || k.startsWith("x-");

/**
 * A compose file's documents, read as Compose reads them: YAML 1.2 core scalars whatever a `%YAML 1.1` directive
 * says, anchors, aliases and `<<` merge keys resolved, unknown tags (`!reset`) ignored. A document that is not a
 * mapping is null. A string says why Compose rejects the file (after "file <f> ").
 */
function readCompose(file: string): (Record<string, unknown> | null)[] | string {
  let text: string;
  try {
    text = readFileSync(file, "utf8"); // yaml skips a leading BOM itself
  } catch {
    return "cannot be read";
  }
  const docs = parseAllDocuments(text, { merge: true, schema: "core" });
  if (!docs.length) return [null];
  const out: (Record<string, unknown> | null)[] = [];
  for (const doc of docs) {
    const err = doc.errors[0];
    if (err) return `is not valid YAML: ${err.message.split("\n")[0]}`;
    if (doc.directives?.yaml.explicit && doc.directives.yaml.version !== "1.1") return "has a %YAML directive other than 1.1, which Compose rejects";
    if (!isMap(doc.contents)) {
      out.push(null);
      continue;
    }
    try {
      // Shared anchors multiply yaml's alias count past its default budget of 100 in ordinary files.
      out.push(doc.toJS({ maxAliasCount: -1 }) as Record<string, unknown>);
    } catch (e) {
      return `is not valid YAML: ${(e as Error).message.split("\n")[0]}`;
    }
  }
  return out;
}

/**
 * Whether a tracked file counts as a Compose file under mode none. A `compose-*` name is common for other YAML
 * (CI workflows, specs), so it counts only when its documents, merged as Compose merges them, hold a top-level Compose
 * key or only keys Compose allows (a `name:` overlay), or when it cannot be read or parsed as YAML.
 */
function isComposeFile(c: Ctx, f: string): boolean {
  const m = COMPOSE_FILE.exec(f);
  if (!m) return false;
  if (!m[3]?.startsWith("-")) return true;
  const docs = readCompose(join(c.root, f));
  if (typeof docs === "string") return true;
  const keys = docs.flatMap((d) => (d ? Object.keys(d) : []));
  return keys.some((k) => COMPOSE_KEYS.includes(k)) || (keys.some((k) => k !== "version") && keys.every(isMetaKey));
}

/** Compose normalizes a directory or `name:` into a project name: lowercase, characters outside [a-z0-9_-] dropped, leading `_` and `-` trimmed. */
const normProject = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[_-]+/, "");
/**
 * Compose's project directory for checkout `root`: the first configured file's. The configured run reads its `.env` and
 * defaults to its name, and it is where a plain `docker compose` (no -f) is modelled to start, so both read the same `.env`.
 */
const projectDir = (c: Ctx, root: string): string => dirname(resolve(root, c.cfg.compose!.files[0]!));

/**
 * The `-p` name loops gives checkout `root`: this is loops' own policy, not Compose's. The main checkout (and any
 * checkout under "dirname") gets what plain Compose would derive from its project directory, else the slug-hash.
 */
export function derive(c: Ctx, root: string): string {
  const main = c.worktrees[0] ?? c.root;
  if (c.cfg.compose?.derive === "dirname" || rp(root) === rp(main)) return normProject(basename(projectDir(c, root)));
  const hash = createHash("sha1").update(rp(root)).digest("hex").slice(0, 6);
  return `${norm(basename(main)) || "wt"}-${norm(basename(root)).slice(0, 24)}-${hash}`;
}

/**
 * The top-level `name:` the configured files declare (the last wins, as Compose merges them), interpolation markers and
 * all; undefined when none does. What it resolves to is Compose's business; this only says a file sets the name.
 */
function declaredName(root: string, files: string[]): string | undefined {
  let last: string | undefined;
  for (const f of files) {
    const docs = readCompose(join(root, f));
    if (typeof docs === "string") continue;
    for (const d of docs) if (typeof d?.name === "string" && d.name) last = d.name;
  }
  return last;
}
/** A declared `name:` that needs no interpolation. */
const literal = (declared: string | undefined): string | undefined => (declared && !declared.includes("$") ? declared : undefined);

export type ComposeProject = { name: string | null; result: Result };

const PROBE_FIX = "fix the file until docker compose config accepts it, or set COMPOSE_PROJECT_NAME";

/**
 * The Compose project name for this checkout and its e.project result. Compose says what each checkout is named;
 * loops only decides what may collide. The name is null in --static and on a FAIL, except when only plain
 * `docker compose` (no -p) would misplace the stack: then `-p <name>` is still safe. Without Compose (SKIP) the name
 * is only what loops can vouch for: the shell's COMPOSE_PROJECT_NAME, else a worktree's derived name, else null.
 */
export function composeProject(c: Ctx): ComposeProject {
  const id = "e.project";
  const { files, derive: how } = c.cfg.compose!;
  const fail = (message: string, fix: string): ComposeProject => ({ name: null, result: res("FAIL", id, message, fix) });
  const present = files.filter((f) => existsSync(join(c.root, f)));
  if (!present.length) return fail(`no compose file found (${files.join(", ")})`, `fix [compose] files in ${CFG}`);
  const missing = files.filter((f) => !present.includes(f));
  if (missing.length) return fail(`compose file missing: ${missing.join(", ")}`, `restore ${missing[0]} or fix [compose] files in ${CFG}`);
  const declared = literal(declaredName(c.root, files));
  if (c.static) return { name: null, result: res("PASS", id, `compose files present${declared ? `, name: ${declared}` : ""} (project name not resolved in --static)`) };
  // The shell's COMPOSE_PROJECT_NAME is the one name loops can vouch for without asking Compose (an empty one is unset, but still hides a .env's).
  const envName = c.env.COMPOSE_PROJECT_NAME || undefined;
  const main = c.worktrees[0] ?? c.root;
  const skip = (why: string): ComposeProject => ({ name: envName ?? (c.isWorktree ? derive(c, c.root) : null), result: res("SKIP", id, `compose unavailable (${why}); nothing to collide with`) });
  // Other checkouts run from their own shells, which do not carry this one's COMPOSE_* exports.
  const scrubbed = Object.fromEntries(Object.entries(c.env).filter(([k]) => !k.startsWith("COMPOSE_")));
  /**
   * One checkout's name under the configured files (`fs`) or plain (from its project directory): the name, null when
   * plain Compose finds no file there (it runs nothing, so there is nothing to collide with), or the result to return.
   */
  const probe = (root: string, fs: string[] | undefined, env: NodeJS.ProcessEnv, whose: string): string | null | ComposeProject => {
    const r = composeName({ root: fs ? root : projectDir(c, root), files: fs, env, run: c.run });
    if ("name" in r) return r.name;
    if ("unavailable" in r) return skip(r.unavailable);
    return !fs && isNoFile(r) ? null : fail(`${whose}compose config: ${r.error}`, PROBE_FIX);
  };
  const isResult = (x: string | null | ComposeProject): x is ComposeProject => typeof x === "object" && x !== null;
  // This checkout's probes run with the shell as is: they are the developer's own invocations.
  const own = probe(c.root, files, c.env, "");
  // A shell COMPOSE_PROJECT_NAME does not rescue a FAIL here: Compose would fail the developer's run the same way.
  if (isResult(own)) return own;
  /**
   * Whether Compose's name for `root` can only have come from its `.env`: neither the configured files' literal `name:`
   * nor the project directory explains it. loops cannot read that `.env` itself, so this is the one inference it makes.
   */
  const fromDotEnv = (root: string, n: string): boolean => {
    const d = declaredName(root, files);
    if (d === undefined) return n !== normProject(basename(projectDir(c, root)));
    // A name: explains Compose's answer when it is that literal, or an interpolation whose default it is; any other
    // interpolation may resolve to anything, so it is read as a committed name and the worktree stays derived.
    const dflt = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}$/.exec(d)?.[1];
    return d.includes("$") ? dflt !== undefined && n !== normProject(dflt) : n !== normProject(d);
  };
  // A worktree runs under its derived name, unless its own .env names the stack (that is what the plain-run fix asks for).
  const dotEnvName = c.isWorktree && !envName && fromDotEnv(c.root, own!) ? own! : undefined;
  const name = envName ?? dotEnvName ?? (c.isWorktree ? derive(c, c.root) : own!);
  if (!name) return fail(`no project name derives from directory ${basename(projectDir(c, c.root))}`, "set COMPOSE_PROJECT_NAME, or declare name: in the compose file");
  const source = envName || dotEnvName ? "COMPOSE_PROJECT_NAME" : c.isWorktree ? `derived: ${how}` : declared && normProject(declared) === name ? "name: in compose file" : name === normProject(basename(projectDir(c, c.root))) ? "derived: dirname" : "COMPOSE_PROJECT_NAME";
  const hasFiles = (root: string): boolean => files.some((f) => existsSync(join(root, f)));
  // The prod stack is the main checkout's, started with the configured files or plain; a main checkout without them runs nothing.
  const prods: string[] = [];
  if (c.isWorktree && hasFiles(main)) {
    for (const fs of [files, undefined]) {
      const n = probe(main, fs, scrubbed, "the main checkout's ");
      if (isResult(n)) return n;
      if (n) prods.push(n);
    }
  }
  if (prods.includes(name)) return fail(`worktree would use the main checkout's project name ${name}`, "set COMPOSE_PROJECT_NAME, or use derive = \"slug-hash\"");
  // A peer worktree runs as the name its .env gives it (its -p and its plain runs alike, so its derived name is free),
  // else as its derived name under -p and, seen from a worktree, as whatever plain Compose picks there. The main
  // checkout does not go red for a peer's committed name: or directory, which that worktree's own e.project reports.
  const peers: { w: string; names: string[] }[] = [];
  for (const w of c.worktrees.filter((w) => rp(w) !== rp(c.root) && rp(w) !== rp(main))) {
    const names = [derive(c, w)];
    if (hasFiles(w)) {
      const n = probe(w, undefined, scrubbed, `worktree ${w}'s `);
      if (isResult(n)) return n;
      if (n && fromDotEnv(w, n)) names.splice(0, 1, n);
      else if (n && c.isWorktree) names.push(n);
    }
    peers.push({ w, names });
  }
  const clash = peers.find((p) => p.names.includes(name));
  if (clash) return fail(`project name ${name} is also used by worktree ${clash.w}`, "set a distinct COMPOSE_PROJECT_NAME, rename a worktree, or use derive = \"slug-hash\"");
  // Without -p, plain `docker compose` here picks its own name. -p <name> stays safe, so these FAILs keep the name.
  if (c.isWorktree && !envName && !dotEnvName) {
    const plain = probe(c.root, undefined, c.env, "");
    if (isResult(plain)) return plain;
    const unset = c.env.COMPOSE_PROJECT_NAME === "" ? "unset the empty COMPOSE_PROJECT_NAME in the shell, which hides the .env one, and " : "";
    const dotEnv = relative(c.root, join(projectDir(c, c.root), ".env"));
    const plainFail = (message: string): ComposeProject => ({ name, result: res("FAIL", id, message, `${unset}add COMPOSE_PROJECT_NAME=${name} to ${dotEnv}, or always pass -p ${name}`) });
    if (plain && prods.includes(plain)) return plainFail(`plain docker compose in this worktree would use the main checkout's project name ${plain}`);
    // A committed name: is every worktree's.
    if (plain && declared && plain !== name) return plainFail(`plain docker compose in this worktree would use its compose name: ${plain}, not ${name}`);
    const shared = plain && plain !== name && peers.find((p) => p.names.includes(plain));
    if (shared) return plainFail(`plain docker compose in this worktree would use project ${plain}, which worktree ${shared.w} also uses`);
  }
  return { name, result: res("PASS", id, `${name} (${source})`) };
}

/** The file names plain `docker compose` finds on its own; with one of these as the only configured file, the repair command needs no -f. */
const DEFAULT_FILES = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];

/**
 * b.containers: a running container of this checkout's Compose project that was created before the
 * newest change to a `[compose] inputs` glob is running stale code. The newest change is the later of
 * the newest commit touching the inputs and their modification times: a pull, merge or checkout can
 * bring in a commit dated before the build, but it rewrites the file. Docker (via the injected
 * Runner) being absent or down, or the stack not running, is a SKIP, never a WARN.
 */
export function containersCheck(c: Ctx, { name: project, result }: ComposeProject): Result[] {
  const cfg = c.cfg.compose!;
  const id = "b.containers";
  if (!cfg.inputs.length) return [];
  // A SKIP without a name is the main checkout without Compose: nothing vouches for its project.
  if (!project) return result.level === "SKIP" ? [res("SKIP", id, "project unknown (compose unavailable)")] : [];
  const ids = c.run("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`], { cwd: c.root, timeoutMs: PROBE_TIMEOUT_MS });
  if (ids.code !== 0) return [res("SKIP", id, "docker is not available (not installed, the daemon is down, or it did not answer in 10s)")];
  const running = ids.stdout.split("\n").filter(Boolean);
  if (!running.length) return [res("SKIP", id, `stack down (no running container for project ${project})`)];
  const matchers = cfg.inputs.flatMap((g) => compileGlob(g));
  const files = c.tracked.filter((f) => matchers.some((re) => re.test(f)));
  const ct = files.length ? Number(git(c.run, c.root, ["log", "-1", "--format=%ct", "--", ...files])?.trim()) : NaN;
  if (!ct) return [res("SKIP", id, "no commit touches the [compose] inputs")];
  const mtime = (f: string): number => {
    try {
      return statSync(join(c.root, f)).mtimeMs;
    } catch {
      return 0;
    }
  };
  const newest = files.reduce((n, f) => Math.max(n, mtime(f)), ct * 1000);
  const info = c.run("docker", ["inspect", "--format", "{{.Name}} {{.Created}}", ...running], { cwd: c.root, timeoutMs: PROBE_TIMEOUT_MS });
  if (info.code !== 0) return [res("SKIP", id, "docker inspect failed")];
  const stale = info.stdout
    .split("\n")
    .map((l) => l.trim().split(" "))
    .filter(([name, created]) => name && Date.parse(created ?? "") < newest)
    .map(([name]) => name!.replace(/^\//, ""));
  const quote = (s: string): string => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  // The developer's own invocation plus -p: a lone default-named file needs no -f, and Compose then adds its own override file.
  const fileArgs = cfg.files.length === 1 && DEFAULT_FILES.includes(cfg.files[0]!) ? "" : cfg.files.map((f) => ` -f ${quote(f)}`).join("");
  // A cache-hit `--build` leaves a container whose inputs were only rewritten Running, still stale by mtime.
  const fix = `docker compose -p ${project}${fileArgs} up -d --build --force-recreate`;
  const level = cfg.containers === "fail" ? "FAIL" : "WARN";
  return [stale.length ? res(level, id, `${short(stale)} created before the newest change to the compose inputs`, fix) : res("PASS", id, `${running.length} running container(s) are newer than the compose inputs`)];
}

/** The compose checks. `project` is the one composeProject result for this run (null only when compose is not in test mode). */
export function composeChecks(c: Ctx, project: ComposeProject | null): Result[] {
  if (!c.cfg.compose) return [];
  const { mode, files, allowContainerName } = c.cfg.compose;
  if (mode === "none") {
    const tracked = c.tracked.filter((f) => isComposeFile(c, f));
    return [tracked.length ? res("FAIL", "e.none", `config says compose mode none but ${short(tracked)} is tracked`, `set [compose] mode = "test" and list the files in ${CFG}`) : res("PASS", "e.none", "no compose file tracked")];
  }
  const read = files.filter((f) => existsSync(join(c.root, f))).map((f) => ({ f, docs: readCompose(join(c.root, f)) }));
  const unread = read.filter((r) => typeof r.docs === "string").map((r) => r.f);
  const names = read
    .flatMap((r) => (typeof r.docs === "string" ? [] : r.docs))
    .flatMap((d) => Object.values(table(d?.services) ?? {}))
    .flatMap((s) => {
      const n = table(s)?.container_name;
      return n == null || n === "" ? [] : [String(n)];
    })
    .filter((n) => !allowContainerName.includes(n));
  if (!project) throw new Error("composeChecks: compose mode test needs the resolved project");
  return [
    project.result,
    ...(c.static || project.result.level === "FAIL" ? [] : containersCheck(c, project)),
    unread.length
      ? res("WARN", "e.container_name", `cannot read container_name: ${short(unread)} does not parse as a compose file`, "fix the file until docker compose config accepts it")
      : names.length
        ? res("WARN", "e.container_name", `fixed container_name ${short([...new Set(names)])} collides across worktrees`, `drop container_name, or list it in allow_container_name in ${CFG}`)
        : res("PASS", "e.container_name", "no fixed container_name"),
  ];
}

const LINE = /^(PASS|WARN|FAIL|SKIP|INFO) (\S+) (.+?)(?: (?:—|--) fix: (.*))?$/;

/** Run one `[[local]]` check. Fail closed: bad lines, no lines, or a bad exit without a FAIL are FAILs. */
export function runLocal(c: Ctx, l: LocalCheck, project: string | null): Result[] {
  if (c.static && !l.static) return [{ ...res("SKIP", l.id, "not run in --static mode"), source: "local" }];
  const env: NodeJS.ProcessEnv = {
    ...c.env,
    ENV_CHECK_ROOT: c.root,
    ENV_CHECK_MODE: c.static ? "static" : "full",
    ENV_CHECK_WORKTREE: c.isWorktree ? "1" : "0",
    ENV_CHECK_PROJECT: project ?? "",
    ENV_CHECK_ID: l.id,
    GOPROXY: "off",
    GOTOOLCHAIN: "local",
    NO_COLOR: "1",
  };
  const r = c.run(resolve(c.root, l.run), [], { cwd: c.root, env, timeoutMs: l.timeoutMs });
  const mk = (level: Level, id: string, message: string, fix?: string): Result => ({ level, id, message, fix, source: "local" });
  const out: Result[] = [];
  for (const line of r.stdout.split("\n").map((s) => s.trimEnd()).filter(Boolean)) {
    const m = LINE.exec(line);
    if (m && (m[2] === l.id || m[2]!.startsWith(`${l.id}.`))) out.push(mk(m[1] as Level, m[2]!, m[3]!, m[4]));
    else out.push(mk("FAIL", `${l.id}.protocol`, `unparseable line: ${line.slice(0, 80)}`, "emit `LEVEL id message [— fix: ...]`, one line per result, id = the configured id or <id>.<name>"));
  }
  // What the check printed before the timeout still counts (an emitted FAIL survives).
  if (r.timedOut) return [...out, mk("WARN", l.id, `timed out after ${l.timeoutS}s (not a pass)`, `raise timeout_s or run ${l.run} by hand`)];
  const stderr = r.stderr.trim().split("\n")[0] ?? "";
  const why = stderr ? ` (${stderr.slice(0, 120)})` : "";
  if (!out.length) return [mk("FAIL", l.id, `printed no results${r.code ? `, exit ${r.code}` : ""}${why}`, `run ${l.run} by hand`)];
  if (r.code !== 0 && !out.some((x) => x.level === "FAIL")) out.push(mk("FAIL", l.id, `exited ${r.code ?? "abnormally"} without a FAIL line${why}`, `run ${l.run} by hand`));
  return out;
}
