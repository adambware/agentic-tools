// Built-in `loops env-check` checks (groups a, c, d, e) and the runner for `[[local]]` checks.
// Every check returns Results; a check that cannot decide fails or warns, never passes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isMap, parseAllDocuments } from "yaml";
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

/** Compose's project directory: the first compose file's. It holds the `.env` Compose reads and names the default project. */
const projectDir = (c: Ctx, root: string): string => dirname(resolve(root, c.cfg.compose!.files[0]!));
const dotEnv = (c: Ctx, root: string): string => join(projectDir(c, root), ".env");

/** The name plain `docker compose` gives `root` (the main checkout, or any checkout under "dirname"), else the slug-hash. */
function derive(c: Ctx, root: string): string {
  const main = c.worktrees[0] ?? c.root;
  if (c.cfg.compose?.derive === "dirname" || rp(root) === rp(main)) return normProject(basename(projectDir(c, root)));
  const hash = createHash("sha1").update(rp(root)).digest("hex").slice(0, 6);
  return `${norm(basename(main)) || "wt"}-${norm(basename(root)).slice(0, 24)}-${hash}`;
}

/**
 * KEY=VALUE or KEY: VALUE lines of a `.env` file (optional `export `, quotes, `#` comments); a missing or unreadable file is {}.
 * As in Compose, an unquoted or double-quoted value is interpolated against `shell`, then the keys above it; one that
 * cannot be resolved keeps its raw text, so its `$` fails whatever uses it.
 */
function parseDotEnv(file: string, shell: NodeJS.ProcessEnv): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([\w.-]+)\s*[=:]\s*(.*)$/.exec(line);
    if (!m) continue;
    const q = /^(["'])(.*?)\1/.exec(m[2]!);
    const v = q?.[2] ?? m[2]!.replace(/(^|\s)#.*$/, "").trim();
    out[m[1]!] = q?.[1] === "'" ? v : (interpolate(v, { ...out, ...shell }) ?? v);
  }
  return out;
}

/** Compose-style interpolation of a `name:` value against `env`; null when it cannot be resolved. */
function interpolate(raw: string, env: NodeJS.ProcessEnv): string | null {
  let bad = false;
  const out = raw.replace(/\$(?:\$|\{(\w+)(?:(:?[-?])([^}]*))?\}|(\w+))/g, (m, braced?: string, op?: string, arg = "", bare?: string) => {
    if (m === "$$") return "$";
    const v = env[braced ?? bare!];
    const set = op?.startsWith(":") ? !!v : v !== undefined;
    if (op?.endsWith("?") ? !set : !op && v === undefined) bad = true;
    return set ? v! : (op?.endsWith("-") ? arg : "");
  });
  return bad || out.includes("$") ? null : out;
}

/** Compose normalizes a file-declared project name: lowercase, characters outside [a-z0-9_-] dropped, leading `_` and `-` trimmed. */
const normProject = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[_-]+/, "");

interface Plain {
  /** Compose files, relative to the checkout. */
  files: string[];
  /** Project directory: the default name's source. */
  dir: string;
  /** What `name:` is interpolated against. */
  env: NodeJS.ProcessEnv;
  /** COMPOSE_PROJECT_NAME as Compose reads it. */
  project?: string;
  /** The implicit compose.override.* among `files`. */
  override?: string;
  /** What plain `docker compose` discovers instead, when that is not `files`. */
  discovered?: Plain;
}
const isFile = (f: string): boolean => {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
};

/**
 * What plain `docker compose` (no -f, no -p) loads in checkout `w`, run from its project directory. COMPOSE_FILE (the
 * shell's when `shell`, even empty, else the `.env`'s) replaces the configured files and moves the project directory
 * to its first file's, whose `.env` fills keys the first left unset; without it a lone default-named file gains the
 * compose.override.* beside it, and Compose's own discovery, when it finds other files, is `discovered`. `{ bad }`
 * when COMPOSE_FILE is empty or names something that is not a file.
 */
function plainCompose(c: Ctx, w: string, shell: boolean): Plain | { bad: string } {
  const cwd = projectDir(c, w);
  let dot = parseDotEnv(dotEnv(c, w), c.env);
  // A set-but-empty shell value still hides the .env one.
  const pick = (k: string): string | undefined => (shell && c.env[k] !== undefined ? c.env[k] : dot[k]);
  const list = pick("COMPOSE_FILE");
  if (list === undefined) {
    const override = overrideBeside(c, w);
    const files = [...c.cfg.compose!.files, ...(override ? [override] : [])];
    const found = discover(w, cwd);
    const same = found && found.files.length === files.length && found.files.every((f, i) => resolve(w, f) === resolve(w, files[i]!));
    // A .env in the directory Compose found the file in fills keys the working directory's left unset.
    const fill = found && found.dir !== cwd ? { ...parseDotEnv(join(found.dir, ".env"), c.env), ...dot } : dot;
    const discovered = found && !same ? { files: found.files, dir: found.dir, env: { ...fill, ...c.env }, project: shell && c.env.COMPOSE_PROJECT_NAME !== undefined ? c.env.COMPOSE_PROJECT_NAME : fill.COMPOSE_PROJECT_NAME } : undefined;
    return { files, dir: cwd, env: { ...dot, ...c.env }, project: pick("COMPOSE_PROJECT_NAME"), override, discovered };
  }
  if (!list) return { bad: "COMPOSE_FILE is empty, which Compose rejects" };
  const files = list.split(pick("COMPOSE_PATH_SEPARATOR") || ":").map((f) => resolve(cwd, f));
  const gone = files.find((f) => !isFile(f));
  if (gone !== undefined) return { bad: `COMPOSE_FILE names ${relative(w, gone) || "."}, which is not a file` };
  const dir = dirname(files[0]!);
  if (dir !== cwd) dot = { ...parseDotEnv(join(dir, ".env"), c.env), ...dot };
  return { files: files.map((f) => relative(w, f)), dir, env: { ...dot, ...c.env }, project: pick("COMPOSE_PROJECT_NAME") };
}

/**
 * The last non-empty top-level `name:` across plain Compose's ordered files in checkout `w`, interpolated against
 * its `.env` (the shell env wins) and normalized: `undefined` when none declares one (`name: ""` counts as none),
 * `{ bad }` (why, after "compose ") when its name cannot be resolved, `{ bad, structural }` when a file is not one
 * valid YAML mapping with a string name, which Compose rejects whatever names the project.
 */
function declaredName(w: string, p: Plain): string | { bad: string; structural?: true } | undefined {
  let last: string | undefined;
  for (const f of p.files) {
    if (!existsSync(resolve(w, f))) continue;
    const broken = (why: string) => ({ bad: `file ${f} ${why}`, structural: true as const });
    const docs = readCompose(resolve(w, f));
    if (typeof docs === "string") return broken(docs);
    // Compose merges the documents in order, checking the name after each: a later null or "" keeps the one set.
    let raw: unknown;
    let has = false;
    for (const d of docs) {
      if (!d) return broken("has no top-level mapping");
      if (Object.hasOwn(d, "name") && (!has || (d.name !== null && d.name !== ""))) [raw, has] = [d.name, true];
      // Compose rejects a null or non-string name rather than ignoring it.
      if (has && typeof raw !== "string") return broken("has a name: that is not a string");
    }
    if (typeof raw !== "string") continue;
    const v = interpolate(raw, p.env);
    if (v === null || (v !== "" && !normProject(v))) return { bad: `name: ${raw} cannot be resolved` };
    if (v !== "") last = normProject(v);
  }
  return last;
}

/**
 * The project plain `docker compose` gives Plain `p` in checkout `w` (its COMPOSE_PROJECT_NAME, else its `name:`,
 * else its directory's), `named` when a `name:` sets it, or why Compose rejects it (`env` when COMPOSE_PROJECT_NAME is bad).
 */
function plainRun(w: string, p: Plain): { name: string; named: boolean } | { bad: string; structural?: true; env?: true } {
  const e = envProject(p.project);
  if (typeof e === "object") return { ...e, env: true };
  const d = declaredName(w, p);
  if (typeof d === "object" && (d.structural || !e)) return d;
  return e ? { name: e, named: false } : typeof d === "string" ? { name: d, named: true } : { name: normProject(basename(p.dir)), named: false };
}

/**
 * A COMPOSE_PROJECT_NAME (Plain.project): `undefined` when unset or empty, `{ bad }` when it cannot be resolved or
 * is not a valid name (Compose rejects it rather than normalizing it).
 */
function envProject(v: string | undefined): string | { bad: string } | undefined {
  if (!v) return undefined;
  if (normProject(v) === v) return v;
  return { bad: `COMPOSE_PROJECT_NAME ${v} ${v.includes("$") ? "cannot be resolved" : "is not a valid Compose project name"}` };
}

export type ComposeProject = { name: string | null; result: Result };

/**
 * The Compose project name for this checkout and its e.project result. The name is null in --static and on a FAIL,
 * except when only plain `docker compose` (no -p) would misplace the stack: then `-p <name>` is still safe.
 */
export function composeProject(c: Ctx): ComposeProject {
  const id = "e.project";
  const { files, derive: how } = c.cfg.compose!;
  const fail = (message: string, fix: string): { name: null; result: Result } => ({ name: null, result: res("FAIL", id, message, fix) });
  const present = files.filter((f) => existsSync(join(c.root, f)));
  if (!present.length) return fail(`no compose file found (${files.join(", ")})`, `fix [compose] files in ${CFG}`);
  const missing = files.filter((f) => !present.includes(f));
  if (missing.length) return fail(`compose file missing: ${missing.join(", ")}`, `restore ${missing[0]} or fix [compose] files in ${CFG}`);
  const own = plainCompose(c, c.root, true);
  const mine = "bad" in own ? undefined : declaredName(c.root, own);
  const declared = typeof mine === "string" ? mine : null;
  if (c.static) return { name: null, result: res("PASS", id, `compose files present${declared ? `, name: ${declared}` : ""} (project name not resolved in --static)`) };
  const unresolved = (d: { bad: string; structural?: true }, whose = "") =>
    fail(`${whose}compose ${d.bad}`, d.structural ? "fix the file until docker compose config accepts it" : "make name: a plain string or set the variable it uses, or set COMPOSE_PROJECT_NAME");
  const badEnv = (d: { bad: string }, whose = "") => fail(`${whose}${d.bad}`, "set COMPOSE_PROJECT_NAME to lowercase letters, digits, _ and -, with no unresolved $");
  const badFiles = (d: { bad: string }, whose = "") => fail(`${whose}${d.bad}`, "point COMPOSE_FILE at existing compose files, or unset it");
  if ("bad" in own) return badFiles(own);
  // The shell's COMPOSE_PROJECT_NAME beats this checkout's own .env, which beats the file.
  const envName = envProject(own.project);
  if (typeof envName === "object") return badEnv(envName);
  // A file Compose rejects fails whatever names the project; an unresolvable name: only where it sets the project.
  if (typeof mine === "object" && (mine.structural || !envName)) return unresolved(mine);
  // A worktree may declare its own name:; the prod name is the main checkout's, and a COMPOSE_PROJECT_NAME in its .env beats the file.
  const main = c.worktrees[0] ?? c.root;
  const prodPlain = c.isWorktree ? plainCompose(c, main, false) : own;
  if ("bad" in prodPlain) return badFiles(prodPlain, "the main checkout's ");
  const theirs = c.isWorktree ? declaredName(main, prodPlain) : mine;
  const mainEnvName = c.isWorktree ? envProject(prodPlain.project) : undefined;
  if (typeof mainEnvName === "object") return badEnv(mainEnvName, "the main checkout's ");
  if (c.isWorktree && typeof theirs === "object" && !mainEnvName) return unresolved(theirs, "the main checkout's ");
  // The worktree's own name: stands in for prod only when the main checkout has no compose file to run.
  const mainHasCompose = prodPlain.files.some((f) => existsSync(resolve(main, f)));
  const prodDeclared = typeof theirs === "string" ? theirs : c.isWorktree && mainHasCompose ? null : declared;
  const prod = mainEnvName || (prodDeclared ?? normProject(basename(prodPlain.dir)));
  // Plain `docker compose` in the main checkout may load other files than the configured ones: its name is prod too.
  const prodAlt = c.isWorktree && prodPlain.discovered ? plainRun(main, prodPlain.discovered) : undefined;
  if (prodAlt && "bad" in prodAlt) return prodAlt.env ? badEnv(prodAlt, "the main checkout's ") : unresolved(prodAlt, "the main checkout's ");
  const prods = [prod, ...(prodAlt?.name ? [prodAlt.name] : [])];
  const name = envName ?? (c.isWorktree ? derive(c, c.root) : (declared ?? normProject(basename(own.dir))));
  if (!name) return fail(`no project name derives from directory ${basename(projectDir(c, c.root))}`, "set COMPOSE_PROJECT_NAME, or declare name: in the compose file");
  if (normProject(name) !== name) return fail(`project name ${name} is not a valid Compose project name`, "set COMPOSE_PROJECT_NAME, or declare name: in the compose file");
  const source = envName ? "COMPOSE_PROJECT_NAME" : c.isWorktree ? `derived: ${how}` : declared ? "name: in compose file" : "derived: dirname";
  if (c.isWorktree && prods.includes(name)) return fail(`worktree would use the main checkout's project name ${name}`, "set COMPOSE_PROJECT_NAME, or use derive = \"slug-hash\"");
  // A peer worktree runs as its .env's COMPOSE_PROJECT_NAME; without one, as its derived name under -p, and (seen from
  // a worktree) as its plain Compose name. The main checkout is the prod check above.
  const peerNames = (w: string): string[] => {
    const p = plainCompose(c, w, false);
    const e = "bad" in p ? undefined : envProject(p.project);
    if (typeof e === "string") return [e];
    if ("bad" in p || !c.isWorktree) return [derive(c, w)];
    const d = declaredName(w, p);
    const alt = p.discovered && plainRun(w, p.discovered);
    return [derive(c, w), typeof d === "string" ? d : normProject(basename(p.dir)), ...(alt && "name" in alt ? [alt.name] : [])];
  };
  const peers = c.worktrees.filter((w) => rp(w) !== rp(c.root) && rp(w) !== rp(main)).map((w) => ({ w, names: peerNames(w) }));
  const clash = peers.find((p) => p.names.includes(name));
  if (clash) return fail(`project name ${name} is also used by worktree ${clash.w}`, "set a distinct COMPOSE_PROJECT_NAME, rename a worktree, or use derive = \"slug-hash\"");
  // Without -p, plain `docker compose` here takes this worktree's own name:, else its project directory's name.
  // -p <name> stays safe, so these FAILs keep the name.
  if (c.isWorktree && !envName) {
    const alt = own.discovered && plainRun(c.root, own.discovered);
    if (alt && "bad" in alt) return alt.env ? badEnv(alt) : unresolved(alt);
    const unset = c.env.COMPOSE_PROJECT_NAME === "" ? "unset the empty COMPOSE_PROJECT_NAME in the shell, which hides the .env one, and " : "";
    const plainFail = (message: string) => ({ name, result: res("FAIL", id, message, `${unset}add COMPOSE_PROJECT_NAME=${name} to ${relative(c.root, dotEnv(c, c.root))}, or always pass -p ${name}`) });
    // The configured files, and what Compose discovers when it finds others.
    for (const { name: plain, named } of [{ name: declared ?? normProject(basename(own.dir)), named: !!declared }, ...(alt ? [alt] : [])]) {
      if (prods.includes(plain)) return plainFail(`plain docker compose in this worktree would use the main checkout's project name ${plain}`);
      // A committed name: is every worktree's.
      if (named && plain !== name) return plainFail(`plain docker compose in this worktree would use its compose name: ${plain}, not ${name}`);
      const shared = plain !== name && peers.find((p) => p.names.includes(plain));
      if (shared) return plainFail(`plain docker compose in this worktree would use project ${plain}, which worktree ${shared.w} also uses`);
    }
  }
  return { name, result: res("PASS", id, `${name} (${source})`) };
}

/** Compose's discovery: one of these names, plus the first of the overrides beside it. */
const DEFAULT_FILES = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];
const OVERRIDE_FILES = ["compose.override.yml", "compose.override.yaml", "docker-compose.override.yml", "docker-compose.override.yaml"];

/**
 * What plain `docker compose` loads from `cwd` in checkout `w`: the first default-named file in `cwd` or its nearest
 * parent inside `w`, plus the first override beside it, relative to `w`. Undefined when it finds none.
 */
function discover(w: string, cwd: string): { dir: string; files: string[] } | undefined {
  for (let d = cwd; ; d = dirname(d)) {
    const f = DEFAULT_FILES.find((n) => isFile(join(d, n)));
    if (f) return { dir: d, files: [f, ...OVERRIDE_FILES.filter((o) => isFile(join(d, o))).slice(0, 1)].map((n) => relative(w, join(d, n))) };
    const up = relative(w, d);
    if (!up || up.startsWith("..") || dirname(d) === d) return undefined;
  }
}

/** The compose.override.* plain `docker compose` adds beside a lone default-named file (unless COMPOSE_FILE is set). */
function overrideBeside(c: Ctx, w: string): string | undefined {
  const { files } = c.cfg.compose!;
  if (files.length !== 1 || !DEFAULT_FILES.includes(basename(files[0]!))) return undefined;
  const dir = dirname(files[0]!);
  return OVERRIDE_FILES.map((o) => (dir === "." ? o : `${dir}/${o}`)).find((o) => existsSync(join(w, o)));
}

/**
 * b.containers: a running container of this checkout's Compose project that was created before the
 * newest change to a `[compose] inputs` glob is running stale code. The newest change is the later of
 * the newest commit touching the inputs and their modification times: a pull, merge or checkout can
 * bring in a commit dated before the build, but it rewrites the file. Docker (via the injected
 * Runner) being absent or down, or the stack not running, is a SKIP, never a WARN.
 */
export function containersCheck(c: Ctx, project: string | null): Result[] {
  const cfg = c.cfg.compose!;
  const id = "b.containers";
  if (!cfg.inputs.length || !project) return [];
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
  const plain = plainCompose(c, c.root, true);
  const override = "bad" in plain ? undefined : plain.override;
  // A cache-hit `--build` leaves a container whose inputs were only rewritten Running, still stale by mtime.
  const fix = `docker compose -p ${project} ${[...cfg.files, ...(override ? [override] : [])].map((f) => `-f ${quote(f)}`).join(" ")} up -d --build --force-recreate`;
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
    ...(c.static || project.result.level === "FAIL" ? [] : containersCheck(c, project.name)),
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
