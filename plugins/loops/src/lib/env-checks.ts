// Built-in `loops env-check` checks (groups a, c, d, e) and the runner for `[[local]]` checks.
// Every check returns Results; a check that cannot decide fails or warns, never passes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { isMap, parseAllDocuments } from "yaml";
import { composeName, composeVersion, isSwitch, rerun, type ComposeError, type ComposeName } from "./compose-config.js";
import { compileGlob } from "./glob.js";
import type { Config, LocalCheck } from "./env-config.js";
import { ALIAS, disagreement, localOk, pinOf, PinError, readSource, ver, type PinValue } from "./pins.js";
import { git, isExecutable, shimOf, shQuote, which, type Runner } from "./proc.js";
import { CONTROL, cut, escapeCtl, quote, short } from "./text.js";

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
  /**
   * `$HOME` shown as `~`: the renderer's own redaction, applied to relayed text before it is cut, since a cut through
   * home would leave a prefix the renderer no longer recognises.
   */
  redact: (s: string) => string;
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

const VERSION_CMD: Record<string, [string, string[]]> = { go: ["go", ["version"]], node: ["node", ["--version"]], python: ["python3", ["--version"]] };
/** Docker calls and toolchain probes: a hung daemon, shim or network call must not hang the run. */
const PROBE_TIMEOUT_MS = 10_000;

/** How to install `tool` at `want`: the asdf/mise command when a `.tool-versions` line pins `want` written as a plain
 * version (not `1.62.x` or `v1.2.3`, which the managers would not install as `want`), else the generic advice. An alias
 * tool's line may name another plugin (`golang`), so it gets a bare `asdf install` in that file's directory. */
function installFix(root: string, tool: string, want: string, pins: PinValue[]): string {
  const generic = `install ${tool} ${want} (asdf install, mise install, or your package manager)`;
  const names = Object.hasOwn(ALIAS, tool) ? ALIAS[tool]! : [tool];
  const written = (file: string): boolean => {
    try {
      return readFileSync(join(root, file), "utf8").split("\n").some((l) => {
        const m = /^\s*(\S+)\s+(\S+)/.exec(l);
        return !!m && names.includes(m[1]!) && m[2] === want;
      });
    } catch {
      return false;
    }
  };
  const TV = "tool-versions:";
  const file = /^\d+(?:\.\d+)*$/.test(want) ? pins.map((v) => v.src).find((src) => src.startsWith(TV) && written(src.slice(TV.length)))?.slice(TV.length) : undefined;
  if (file === undefined) return generic;
  if (!Object.hasOwn(ALIAS, tool)) return `install ${tool} ${want}: asdf install ${tool} ${want}, or mise install ${tool}@${want}`;
  if (basename(file) !== ".tool-versions") return generic; // a bare asdf install reads only a .tool-versions
  const dir = dirname(file);
  return `install ${tool} ${want}: run asdf install (or mise install) in ${dir === "." ? "the repo root" : dir}, which installs the ${file} pins`;
}

export function pinChecks(c: Ctx): Result[] {
  const out: Result[] = [];
  for (const pin of c.cfg.pins) {
    const id = `a.pins.${pin.tool}`;
    let vals: PinValue[];
    const notes: string[] = [];
    try {
      vals = pin.sources.flatMap((s) => readSource(c.root, c.tracked, pin.tool, s, notes));
    } catch (e) {
      if (!(e instanceof PinError)) throw e;
      out.push(res("FAIL", id, e.message, e.fix ?? `fix the source file or the sources in ${CFG}`));
      continue;
    }
    // Only exact pins are compared; each distinct (source, value) range is one INFO row after the verdict, then one per
    // distinct workflow skipped for its reusable-workflow calls.
    const pins = vals.filter((v) => !v.range);
    const srcs = (xs: PinValue[]) => [...new Set(xs.map((v) => v.src))].join(", ");
    const seen = new Set<string>();
    const info = vals
      .filter((v) => v.range && !seen.has(`${v.src}\0${v.v}`) && seen.add(`${v.src}\0${v.v}`))
      .map((v) => res("INFO", id, `${v.src}: "${v.v}" is a range, not compared`))
      .concat([...new Set(notes)].map((n) => res("INFO", id, n)));
    if (!pins.length) {
      out.push(res("FAIL", id, `no exact pin among sources (${srcs(vals)}); pin an exact version in a supported source`, `add a source that pins an exact version to ${CFG}`), ...info);
      continue;
    }
    const bad = disagreement(vals, pin.compare);
    if (bad) {
      out.push(res("FAIL", id, bad, `align the pinned versions, or loosen compare in ${CFG}`), ...info);
      continue;
    }
    const want = pinOf(vals);
    out.push(res("PASS", id, `${pin.tool} ${want} (${srcs(pins)})`), ...info);
    if (c.static || pin.local === "off") continue;
    const [bin, args] = Object.hasOwn(VERSION_CMD, pin.tool) ? VERSION_CMD[pin.tool]! : [pin.tool, ["--version"]];
    const r = c.run(bin, args, { cwd: c.root, env: { ...c.env, GOTOOLCHAIN: "local", GOPROXY: "off" }, timeoutMs: PROBE_TIMEOUT_MS });
    const have = r.code === 0 ? ver(r.stdout + r.stderr) : null;
    const lid = `a.local.${pin.tool}`;
    const level = pin.local === "fail" ? "FAIL" : "WARN";
    const fix = installFix(c.root, pin.tool, want, pins);
    const cmd = [bin, ...args].join(" ");
    // The tool's first output line, redacted then cut and escaped, so it stays on this row and cannot read as a second fix.
    const said = (...texts: string[]) => {
      const l = texts.flatMap((t) => t.split("\n")).map((x) => x.trim()).find(Boolean);
      return l ? `: ${escapeCtl(cut(c.redact(l), 120))}` : "";
    };
    if (r.timedOut) out.push(res(level, lid, `${cmd} timed out after ${PROBE_TIMEOUT_MS / 1000}s`, fix));
    else if (r.notFound) out.push(res(level, lid, `${bin} not found on PATH`, fix));
    else if (r.code === null) out.push(res(level, lid, `${cmd} could not run (${r.abend ?? "killed"})`, fix));
    else if (r.code !== 0) out.push(res(level, lid, `${cmd} exited ${r.code}${said(r.stderr, r.stdout)}`, fix));
    else if (have === null) out.push(res(level, lid, `${cmd} printed no version${said(r.stdout, r.stderr)}`, fix));
    else if (!localOk(have, want, pin.compare)) out.push(res(level, lid, `local ${pin.tool} ${have} does not match pin ${want}`, fix));
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

/**
 * Why the asdf or mise shim at `p` cannot run `tool` in this checkout, or null when it resolves or `p` is no shim. Asks
 * the manager (`asdf which` / `mise which`, from the repo root with the run's env), which resolves the version the shim
 * would use; the tool itself never runs.
 */
function shimProblem(c: Ctx, tool: string, p: string): string | null {
  const s = shimOf(p);
  if (!s) return null;
  const cmd = s.cmd ?? which(s.manager, c.env.PATH);
  if (!cmd) return `${s.manager} not on PATH`;
  const r = c.run(cmd, ["which", tool], { cwd: c.root, env: c.env, timeoutMs: PROBE_TIMEOUT_MS });
  const how = `${s.manager} which ${tool}`;
  const said = [r.stderr, r.stdout].flatMap((t) => t.split("\n")).map((x) => x.trim()).find(Boolean);
  if (r.timedOut) return `${how} timed out after ${PROBE_TIMEOUT_MS / 1000}s`;
  if (r.notFound) return `${s.manager} not found at ${cmd}`;
  if (r.code === null) return `${how} could not run (${r.abend ?? "killed"})`;
  if (r.code !== 0) return `${how} exited ${r.code}${said ? `: ${escapeCtl(cut(c.redact(said), 120))}` : ""}`;
  return r.stdout.trim() ? null : `${how} printed no path`;
}

export function harnessChecks(c: Ctx): Result[] {
  const h = c.cfg.harness;
  const out: Result[] = [];
  if (h.tools.length && !c.static) {
    const missing: string[] = [];
    const unresolved: string[] = [];
    for (const t of h.tools) {
      const p = which(t, c.env.PATH);
      const why = p ? shimProblem(c, t, p) : null;
      if (!p) missing.push(t);
      else if (why) unresolved.push(`${t} (${why})`);
    }
    if (missing.length) out.push(res("FAIL", "d.tools", `missing on PATH: ${missing.join(", ")}`, "install the missing tools"));
    if (unresolved.length) {
      out.push(
        res(
          "FAIL",
          "d.tools",
          `version-manager shim resolves no version here: ${unresolved.join("; ")}`,
          "set a version for this checkout (a .tool-versions line for asdf, mise use <tool>@<version> for mise), put the version manager on PATH, or install the tool outside it",
        ),
      );
    }
    if (!missing.length && !unresolved.length) out.push(res("PASS", "d.tools", `present: ${h.tools.join(", ")}`));
  }
  if (h.files.length) {
    // One stat, symlinks followed: a directory's size is a filesystem detail, so anything but a regular file FAILs.
    // The working tree only; whether the file is tracked is d.tracked's job.
    const kind = (f: string): "ok" | "missing" | "other" => {
      try {
        const s = statSync(join(c.root, f));
        return !s.isFile() ? "other" : s.size === 0 ? "missing" : "ok";
      } catch {
        return "missing";
      }
    };
    const kinds = h.files.map(kind);
    const missing = h.files.filter((_, i) => kinds[i] === "missing");
    const other = h.files.filter((_, i) => kinds[i] === "other");
    const parts = [missing.length ? `missing or empty: ${missing.join(", ")}` : "", other.length ? `not a regular file: ${other.join(", ")}` : ""].filter(Boolean);
    const fix = `restore the files (git checkout) or fix [harness] files${other.length ? " (list a file inside a directory, not the directory)" : ""}`;
    out.push(parts.length ? res("FAIL", "d.files", parts.join("; "), fix) : res("PASS", "d.files", `present: ${h.files.join(", ")}`));
  }
  const entries = h.entrypoints === "auto" ? autoEntrypoints(c) : h.entrypoints;
  // "auto" finding nothing is said (uncounted), so it does not read as checked; an explicit [] configures nothing.
  if (h.entrypoints === "auto" && !entries.length) out.push(res("INFO", "d.entrypoints", "auto: no ./ command in tracked .github/workflows; nothing to check"));
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
  if (h.sparse && !c.static) {
    // --type=bool reads every git spelling (yes, on, 1) and --default=false makes unset "false", so a failed read (an
    // invalid value, git failing) or any other output is a WARN, never "off".
    const on = git(c.run, c.root, ["config", "--type=bool", "--default=false", "--get", "core.sparseCheckout"])?.trim();
    if (on === "true") out.push(res("WARN", "d.sparse", "sparse checkout is enabled; tools may not see every file", "git sparse-checkout disable"));
    else if (on === "false") out.push(res("PASS", "d.sparse", "sparse checkout is off"));
    else out.push(res("WARN", "d.sparse", "could not read core.sparseCheckout", "run git config --type=bool --get core.sparseCheckout to see what is wrong"));
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
/** A name Compose takes for -p or COMPOSE_PROJECT_NAME: one normalizing leaves as is (lowercase letters, digits, `-`, `_`; a letter or digit first). */
const isProject = (s: string): boolean => s !== "" && normProject(s) === s;
/** Compose's project directory for checkout `root` under the configured files: the first configured file's. */
const projectDir = (c: Ctx, root: string): string => dirname(resolve(root, c.cfg.compose!.files[0]!));

/**
 * The `-p` name loops gives checkout `root`: this is loops' own policy, not Compose's. The main checkout (and any
 * checkout under "dirname") gets what plain Compose would derive from its project directory, else the slug-hash.
 */
function derive(c: Ctx, root: string): string {
  const main = c.worktrees[0] ?? c.root;
  if (c.cfg.compose?.derive === "dirname" || rp(root) === rp(main)) return normProject(basename(projectDir(c, root)));
  const hash = createHash("sha1").update(rp(root)).digest("hex").slice(0, 6);
  return `${norm(basename(main)) || "wt"}-${norm(basename(root)).slice(0, 24)}-${hash}`;
}

/** One `docker compose` run without -p: where it starts, its project directory (whose `.env` it reads), its -f files. */
interface Run {
  dir: string;
  pdir: string;
  files?: string[];
  label: string;
}
/**
 * runs(X): the configured run (only when X has every configured file); plain `docker compose` from the first configured
 * file's directory, or its nearest existing ancestor (Compose walks up from there, possibly out of X); plain
 * `docker compose` from X's root, when that is another directory.
 */
function runs(c: Ctx, root: string): Run[] {
  const { files } = c.cfg.compose!;
  let dir = projectDir(c, root);
  while (!existsSync(dir) && dir !== root) dir = dirname(dir);
  const atRoot = rp(dir) === rp(root);
  return [
    ...(files.every((f) => existsSync(join(root, f))) ? [{ dir: root, pdir: projectDir(c, root), files, label: "configured run" }] : []),
    { dir, pdir: dir, label: atRoot ? "root plain run" : "project-dir plain run" },
    ...(atRoot ? [] : [{ dir: root, pdir: root, label: "root plain run" }]),
  ];
}
/** A container from `docker ps -a`: its name, state, creation time (ms) and Compose labels. */
export interface Container {
  name: string;
  state: string;
  created: number;
  project: string;
  workingDir: string;
  configFiles: string;
  envFile: string;
}
/** Every container, or why `docker ps` listed none (`timedOut`: it hung; otherwise the running-stack check did not run). */
export type Listing = Container[] | { failed: string; timedOut: boolean };
const LABELS = ["", ".working_dir", ".config_files", ".environment_file"].map((l) => `{{json (.Label "com.docker.compose.project${l}")}}`);
/** One JSON array per container, so any character in a path survives. */
const PS_FORMAT = `[{{json .Names}},{{json .State}},{{json .CreatedAt}},${LABELS.join(",")}]`;

/** The one `docker ps -a` of a run, shared by e.project (running stacks) and b.containers. */
export function listContainers(c: Ctx): Listing {
  const r = c.run("docker", ["ps", "-a", "--format", PS_FORMAT], { cwd: c.root, env: c.env, timeoutMs: PROBE_TIMEOUT_MS });
  if (r.timedOut) return { failed: `docker ps timed out after ${PROBE_TIMEOUT_MS / 1000}s`, timedOut: true };
  if (r.code !== 0) return { failed: r.notFound ? "docker not found" : `docker ps exit ${r.code ?? r.abend ?? "abnormal"}`, timedOut: false };
  try {
    return r.stdout.split("\n").filter(Boolean).map((l) => {
      const [name, state, at, project, workingDir, configFiles, envFile] = JSON.parse(l) as string[];
      // CreatedAt is Go's time.String(): `2026-11-01 17:00:00 -0400 EDT`, whole seconds.
      const created = Date.parse(at!.replace(/^(\S+) (\S+) ([+-]\d\d)(\d\d).*/, "$1T$2$3:$4"));
      return { name: name!, state: state!, created, project: project!, workingDir: workingDir!, configFiles: configFiles!, envFile: envFile! };
    });
  } catch {
    return { failed: "docker ps printed a listing loops cannot read", timedOut: false };
  }
}

/** `p` as the filesystem spells it (symlinks resolved, native letter case); a gone path through its nearest existing ancestor. */
function canon(p: string): string {
  if (!isAbsolute(p)) return p;
  for (let head = p, tail = ""; ; tail = `/${basename(head)}${tail}`, head = dirname(head)) {
    try {
      return realpathSync.native(head) + tail;
    } catch {
      if (dirname(head) === head) return p;
    }
  }
}

/**
 * Containers of `projects` whose project directory (`working_dir` label) another checkout or no checkout owns: the
 * longest checkout root that holds it by whole path segments. One [project, directory (empty without the label), owner]
 * per project and directory.
 */
function strays(c: Ctx, ps: Container[], projects: string[]): [string, string, string][] {
  const roots = c.worktrees.map((w) => [canon(w), w] as const).sort((a, b) => b[0].length - a[0].length);
  const out = new Map<string, [string, string, string]>();
  for (const k of ps.filter((k) => projects.includes(k.project))) {
    const wd = canon(k.workingDir);
    const owner = roots.find(([r]) => wd === r || wd.startsWith(`${r}/`));
    if (owner?.[0] === canon(c.root)) continue;
    const whose = !owner ? "outside every checkout" : owner[0] === canon(c.worktrees[0]!) ? "the main checkout" : `worktree ${owner[1]}`;
    out.set(`${k.project}\0${k.workingDir}`, [k.project, k.workingDir, whose]);
  }
  return [...out.values()];
}

/** One (run, env) cell and what Compose answered. `pre` marks this checkout's cells probed without the shell's COMPOSE_*. */
type Cell = Run & { whose: string; pre: string; r: ComposeName };

/**
 * e.project. `name` is the `-p` name, null when a FAIL withholds it, when the main checkout has no Compose (SKIP) and
 * in --static. `results` is one PASS or SKIP, or every FAIL, worst first: those that withhold the name, then those that
 * keep it (`-p name` is safe; only a run without -p is not). `answers` are this checkout's; `ps` is the run's `docker ps` (b.containers reads it too), absent when
 * evaluation stopped before the running-stack check.
 */
export type ComposeProject = { name: string | null; results: Result[]; withheld: boolean; answers: string[]; ps?: Listing };

const UPGRADE_FIX = "upgrade Docker Compose to one whose config takes --no-env-resolution";
// Compose exited 0 there, so the rerun (config -q) prints nothing.
const NO_NAME_FIX = "Compose exited 0 without a usable project name; check `docker compose version` and upgrade Docker Compose";

/**
 * The Compose project name for this checkout and its e.project results. Compose says what each run without -p is
 * named; loops only decides what may collide, and never guesses where Compose's answer came from.
 */
export function composeProject(c: Ctx): ComposeProject {
  const id = "e.project";
  const { files, derive: how } = c.cfg.compose!;
  const one = (level: Level, message: string, fix?: string, name: string | null = null): ComposeProject => ({ name, results: [res(level, id, message, fix)], withheld: level === "FAIL", answers: [] });
  // Check 0: this checkout lacks a configured file.
  const missing = files.filter((f) => !existsSync(join(c.root, f)));
  if (missing.length === files.length) return one("FAIL", `no compose file found (${files.join(", ")})`, `fix [compose] files in ${CFG}`);
  if (missing.length) return one("FAIL", `compose file missing: ${missing.join(", ")}`, `restore ${missing[0]} or fix [compose] files in ${CFG}`);
  if (c.static) return one("PASS", "compose files present (project name not resolved in --static)");
  const envName = c.env.COMPOSE_PROJECT_NAME || undefined;
  // Check 0b: Compose rejects the shell's name outright, so every run here fails and no name holds.
  if (envName && !isProject(envName)) return one("FAIL", `your shell's COMPOSE_PROJECT_NAME ${JSON.stringify(envName)} is not a Compose project name (lowercase letters, digits, - and _, starting with a letter or digit)`, "export a COMPOSE_PROJECT_NAME of that form, or unset it");
  // Check 0c: git lists the main checkout first and every linked worktree after it (a successful list has at least one
  // entry). Without that, derive and the held names would take this worktree for the main checkout.
  if (c.isWorktree ? c.worktrees.length < 2 || rp(c.worktrees[0]!) === rp(c.root) : !c.worktrees.length) return one("FAIL", "git worktree list did not list the main checkout; the names other checkouts hold are unknown", `rerun to see why: cd ${shQuote(c.root)} && git worktree list --porcelain`);
  // Check 1: without Compose nothing here starts a stack; the name is then only what loops vouches for on its own.
  const v = composeVersion(c.run, c.root, c.env);
  if ("unavailable" in v) return one("SKIP", `compose unavailable (${v.unavailable}); nothing to collide with`, undefined, envName ?? (c.isWorktree ? derive(c, c.root) : null));
  if ("error" in v) return one("FAIL", `compose: ${v.error}`, `rerun to see why: cd ${shQuote(c.root)} && docker compose version`);
  // envs(X): this checkout under the shell as is, and again without COMPOSE_* when the shell sets any (even empty);
  // every other checkout runs from its own shell, so without this one's COMPOSE_*.
  const set = Object.keys(c.env).filter((k) => k.startsWith("COMPOSE_") && !isSwitch(k)).sort();
  const probe = (root: string, whose: string, scrubs: boolean[]): Cell[] =>
    runs(c, root).flatMap((r) => scrubs.map((scrub) => ({ ...r, whose, pre: root === c.root && scrub ? `without your shell's COMPOSE_* (${set.join(", ")}), ` : "", r: composeName({ root: r.dir, files: r.files, env: c.env, scrub, run: c.run }) })));
  const failed = (p: Cell): Result => {
    const e = p.r as ComposeError;
    return res("FAIL", id, `${p.pre}${p.whose}${p.label}: ${e.error}`, e.kind === "tooOld" ? UPGRADE_FIX : e.kind === "json" || e.kind === "noName" ? NO_NAME_FIX : `rerun to see Compose's error: ${rerun(e)}`);
  };
  const named = (p: Cell): string | undefined => ("name" in p.r ? p.r.name : undefined);
  const own = probe(c.root, c.isWorktree ? "this worktree's " : "this checkout's ", set.length ? [false, true] : [false]);
  // name(X): the shell's, else a worktree's derived one, else the main checkout's configured run as is (own[0], as
  // check 0 found every file). That probe failing leaves nothing to check.
  if (!envName && !c.isWorktree && "error" in own[0]!.r) return { name: null, results: [failed(own[0]!)], withheld: true, answers: [] };
  if (!envName && !c.isWorktree && "noFile" in own[0]!.r) return one("FAIL", "this checkout's configured run: docker compose config found no compose file", `fix [compose] files in ${CFG}`);
  const name = envName ?? (c.isWorktree ? derive(c, c.root) : named(own[0]!));
  if (!name) return one("FAIL", `no project name derives from directory ${basename(projectDir(c, c.root))}`, "set COMPOSE_PROJECT_NAME, or declare name: in the compose file");
  // Held names, from a worktree: the main checkout's answers, every other worktree's derived name and answers (a gone
  // one only its derived name). From the main checkout: only the worktrees' derived names (each reports the rest).
  const main = rp(c.worktrees[0] ?? c.root);
  const held = new Map<string, string>();
  const others: Cell[] = [];
  for (const w of c.worktrees.filter((w) => rp(w) !== rp(c.root))) {
    const isMain = rp(w) === main;
    const holder = isMain ? "the main checkout" : `worktree ${w}`;
    if (!isMain && !held.has(derive(c, w))) held.set(derive(c, w), existsSync(w) ? holder : `${holder} (gone, until git worktree prune)`);
    if (!c.isWorktree || !existsSync(w)) continue;
    const cells = probe(w, `${holder}'s `, [true]);
    others.push(...cells);
    for (const n of cells.map(named)) if (n && !held.has(n)) held.set(n, holder);
  }
  // Every check runs; each FAIL says whether it withholds the name (true) or keeps it.
  const fails: [Result, boolean][] = [];
  // Check 2: a failed run of another checkout, or the main checkout's configured run, withholds the name (it feeds the
  // name or a held one); this checkout's other runs keep it (only that run is unknown).
  for (const p of [...own, ...others]) if ("error" in p.r) fails.push([failed(p), others.includes(p) || (!c.isWorktree && !!p.files)]);
  // Checks 3 and 6: the name itself is another checkout's.
  const holder = held.get(name);
  const rename = `export another COMPOSE_PROJECT_NAME${how === "dirname" ? `, set derive = "slug-hash" in ${CFG}` : ""}, or rename ${holder}`;
  if (holder) fails.push([res("FAIL", id, `${c.isWorktree ? "this worktree" : "this checkout"} would use project ${name}, which ${holder} uses`, rename), true]);
  // Check 4: each run here without -p lands on an own name: the name, the derived one, or the root's directory name for
  // a run whose project directory is the root; each only while nobody holds it.
  const unset = c.env.COMPOSE_PROJECT_NAME === "" ? "unset the empty COMPOSE_PROJECT_NAME, then " : "";
  for (const p of c.isWorktree ? own : []) {
    const a = named(p);
    const mine = [name, derive(c, c.root), ...(rp(p.pdir) === rp(c.root) ? [normProject(basename(c.root))] : [])];
    if (a === undefined || (mine.includes(a) && !held.has(a))) continue;
    const by = held.get(a);
    const fix = `${unset}add COMPOSE_PROJECT_NAME=${name} to ${join(p.pdir, ".env")}, or export it, or always pass -p ${name}`;
    fails.push([res("FAIL", id, `${p.pre}${p.label} would use project ${a}, ${by ? `which ${by} uses` : `not ${name}`}`, fix), false]);
  }
  const answers = [...new Set(own.flatMap((p) => named(p) ?? []))];
  // Check 5: a stack of the name (withholds) or of an answer (keeps) started from another checkout or none; it reports
  // first. A docker ps that hangs withholds; one that fails leaves the check not run, and the first Result says so.
  // A stack whose project directory still exists may run there on purpose (a committed name: in another checkout, a
  // clone): the fix only steers this checkout off it. `down -p` (it needs no compose file) only when the label is gone.
  const ps = listContainers(c);
  // Gone is ENOENT or ENOTDIR; an unreadable directory (EACCES: another user's home) still exists.
  const gone = (d: string): boolean => {
    try {
      statSync(d);
      return false;
    } catch (e) {
      return ["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? "");
    }
  };
  const stop = (p: string, d: string): string => `${p === name ? "export another COMPOSE_PROJECT_NAME" : `always pass -p ${name}`}${isAbsolute(d) && !gone(d) ? `; leave that stack to whoever runs it from ${shQuote(d)}` : `, or stop that stack: docker compose -p ${p} down`}`;
  if (!Array.isArray(ps) && ps.timedOut) fails.unshift([res("FAIL", id, `running stacks not checked (${ps.failed})`, "rerun to see why: docker ps -a"), true]);
  else if (Array.isArray(ps)) fails.unshift(...strays(c, ps, [name, ...answers]).map(([p, d, by]): [Result, boolean] => [res("FAIL", id, `project ${p} was started from project directory ${d || "(no working_dir label)"} (${by})`, stop(p, d)), p === name]));
  const source = envName ? "COMPOSE_PROJECT_NAME" : c.isWorktree ? `derived: ${how}` : "compose";
  const note = Array.isArray(ps) || ps.timedOut ? "" : `; running stacks not checked (${ps.failed})`;
  if (!fails.length) return { name, results: [res("PASS", id, `${name} (${source})${note}`)], withheld: false, answers, ps };
  const withheld = fails.some(([, w]) => w);
  const results = [...fails.filter(([, w]) => w), ...fails.filter(([, w]) => !w)].map(([r]) => r);
  results[0] = { ...results[0]!, message: results[0]!.message + note };
  return { name: withheld ? null : name, results, withheld, answers, ps };
}

/**
 * b.containers: a running container of this checkout's Compose project that was created before the
 * newest change to a `[compose] inputs` glob is running stale code. The newest change is the later of
 * the newest commit touching the inputs and their modification times: a pull, merge or checkout can
 * bring in a commit dated before the build, but it rewrites the file. Docker (via the injected
 * Runner) being absent or down, or the stack not running, is a SKIP, never a WARN. It reads e.project's
 * `docker ps -a` listing, and lists the containers itself only when e.project stopped before the running-stack check.
 * The fix replays the stale containers' own invocation from their Compose labels when they agree on it, and runs
 * from the checkout root.
 */
export function containersCheck(c: Ctx, { name: project, results, ps }: ComposeProject): Result[] {
  const cfg = c.cfg.compose!;
  const id = "b.containers";
  if (!cfg.inputs.length) return [];
  // A SKIP without a name is the main checkout without Compose: nothing vouches for its project.
  if (!project) return results[0]!.level === "SKIP" ? [res("SKIP", id, "project unknown (compose unavailable)")] : [];
  const all = ps ?? listContainers(c);
  if (!Array.isArray(all)) return [res("SKIP", id, `docker is not available (${all.failed})`)];
  const running = all.filter((k) => k.project === project && k.state === "running");
  if (!running.length) return [res("SKIP", id, `stack down (no running container for project ${project})`)];
  const matchers = cfg.inputs.flatMap((g) => compileGlob(g));
  const files = c.tracked.filter((f) => matchers.some((re) => re.test(f)));
  if (!files.length) return [res("SKIP", id, "no commit touches the [compose] inputs")];
  const level = cfg.containers === "fail" ? "FAIL" : "WARN";
  // Empty output is a log with no commit over the inputs; a failed git or text that is no time is not that.
  // --no-show-signature: a user's log.showSignature would print the signature check before the time.
  const logged = git(c.run, c.root, ["log", "-1", "--no-show-signature", "--format=%ct", "--", ...files])?.trim();
  const ct = logged === undefined || !/^\d*$/.test(logged) ? NaN : Number(logged);
  if (Number.isNaN(ct)) return [res(level, id, "loops cannot read the commit time of the compose inputs, so it cannot tell whether the running containers are older")];
  if (!ct) return [res("SKIP", id, "no commit touches the [compose] inputs")];
  // A tracked input whose modification time cannot be read (deleted from the working tree, EACCES) is not time 0.
  const mtimes = files.map((f): [string, number] => {
    try {
      return [f, statSync(join(c.root, f)).mtimeMs];
    } catch {
      return [f, NaN];
    }
  });
  const unstat = mtimes.filter(([, t]) => Number.isNaN(t)).map(([f]) => f);
  if (unstat.length) return [res(level, id, `loops cannot read the modification time of ${short(unstat)}, so it cannot tell whether the running containers are older`, `restore ${short(unstat)} or make it readable, then re-run`)];
  const newest = mtimes.reduce((n, [, t]) => Math.max(n, t), ct * 1000);
  // A creation time loops cannot read (NaN) is never "newer": that container counts as stale.
  const stale = running.filter((k) => !(k.created >= newest));
  const unreadable = stale.filter((k) => Number.isNaN(k.created)).map((k) => k.name);
  const quote = (s: string): string => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  // A label path relative to the root when spelled under it, else as Compose recorded it: Compose resolves a file's
  // relative paths (../data) against its directory as spelled, so neither a symlinked directory nor another spelling
  // of the root is its target.
  const rel = (p: string): string => (p === c.root ? "." : p.startsWith(`${c.root}/`) ? p.slice(c.root.length + 1) : p);
  // Compose joins each label's paths with commas, so only a comma that starts a new absolute path splits them.
  const split = (v: string): string[] => v.split(/,(?=\/)/);
  const agreed = new Set(stale.map((k) => JSON.stringify([k.configFiles, k.workingDir, k.envFile])));
  const [started = "", wd = "", envFile = ""] = agreed.size === 1 ? (JSON.parse([...agreed][0]!) as string[]) : [];
  // The files the stack was started with (its override included) when every one is still there, else the configured list.
  const own = split(started);
  const fs = own.every((f) => isAbsolute(f) && existsSync(f)) ? own.map(rel) : cfg.files;
  const args = fs.map((f) => ` -f ${quote(f)}`);
  // Compose's default project directory is the first file's directory as spelled, so compare spellings.
  if (wd && rel(wd) !== normalize(dirname(fs[0]!))) args.push(` --project-directory ${quote(rel(wd))}`);
  if (envFile) args.push(...split(envFile).map((f) => ` --env-file ${quote(rel(f))}`));
  // A cache-hit `--build` leaves a container whose inputs were only rewritten Running, still stale by mtime.
  // A recreated container prints the same unreadable time, so recreating cannot clear that case: name the escape too.
  const fix = `docker compose -p ${project}${args.join("")} up -d --build --force-recreate${unreadable.length && level === "FAIL" ? `; if docker ps prints CreatedAt in a form loops cannot read, set [compose] containers = "warn" in ${CFG}` : ""}`;
  const why = unreadable.length ? ` (loops cannot read ${unreadable.length === 1 && stale.length === 1 ? "its creation time" : `the creation time of ${short(unreadable)}`})` : "";
  return [stale.length ? res(level, id, `${short(stale.map((k) => k.name))} created before the newest change to the compose inputs${why}`, fix) : res("PASS", id, `${running.length} running container(s) are newer than the compose inputs`)];
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
    ...project.results,
    ...(c.static || project.results.some((r) => r.level === "FAIL") ? [] : containersCheck(c, project)),
    unread.length
      ? res("WARN", "e.container_name", `cannot read container_name: ${short(unread)} does not parse as a compose file`, "fix the file until docker compose config accepts it")
      : names.length
        ? res("WARN", "e.container_name", `fixed container_name ${short([...new Set(names)])} collides across worktrees`, `drop container_name, or list it in allow_container_name in ${CFG}`)
        : res("PASS", "e.container_name", "no fixed container_name"),
  ];
}

// The message ends at the first separator; a bare trailing "— fix:" is an empty fix.
const LINE = /^(PASS|WARN|FAIL|SKIP|INFO) (\S+) (.+?)(?: (?:—|--) fix:(?: (.*))?)?$/;

/**
 * Run one `[[local]]` check. Fail closed: bad lines (a control character other than tab included), no lines, or a bad
 * exit without a FAIL are FAILs. Relayed text is escaped, so a check cannot move the cursor or add a second fix, and
 * has `$HOME` redacted before it is cut.
 */
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
    const m = CONTROL.test(line) ? null : LINE.exec(line);
    if (m && (m[2] === l.id || m[2]!.startsWith(`${l.id}.`))) out.push(mk(m[1] as Level, m[2]!, m[3]!, m[4]?.trim() || undefined));
    else out.push(mk("FAIL", `${l.id}.protocol`, `unparseable line ${quote(c.redact(line))}`, "emit `LEVEL id message [— fix: ...]`, one line per result, id = the configured id or <id>.<name>"));
  }
  // What the check printed before the timeout still counts (an emitted FAIL survives).
  if (r.timedOut) return [...out, mk("WARN", l.id, `timed out after ${l.timeoutS}s (not a pass)`, `raise timeout_s or run ${l.run} by hand`)];
  const stderr = r.stderr.trim().split("\n")[0] ?? "";
  const why = stderr ? ` (${escapeCtl(cut(c.redact(stderr), 120))})` : "";
  if (!out.length) return [mk("FAIL", l.id, `printed no results${r.code ? `, exit ${r.code}` : ""}${why}`, `run ${l.run} by hand`)];
  if (r.code !== 0 && !out.some((x) => x.level === "FAIL")) out.push(mk("FAIL", l.id, `exited ${r.code ?? "abnormally"} without a FAIL line${why}`, `run ${l.run} by hand`));
  return out;
}
