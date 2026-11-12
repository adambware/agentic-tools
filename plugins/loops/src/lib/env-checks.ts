// Built-in `loops env-check` checks (groups a, c, d, e) and the runner for `[[local]]` checks.
// Every check returns Results; a check that cannot decide fails or warns, never passes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { isMap, parseAllDocuments } from "yaml";
import { composeName, composeNameRaw, composeVersion, isSwitch, rerun, type ComposeError, type ComposeName } from "./compose-config.js";
import { readDotEnv, resolveTemplate } from "./compose-env.js";
import { compileGlob } from "./glob.js";
import type { Config, LocalCheck, Severity } from "./env-config.js";
import { ALIAS, diffPart, disagreement, inRange, localOk, pinOf, PinError, readSource, sourceAbsent, ver, type PinValue } from "./pins.js";
import { git, gitEnv, isExecutable, shimOf, shQuote, which, type Runner } from "./proc.js";
import { CONTROL, cut, quote, short } from "./text.js";

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
  /** Where env-check runs: an inherited relative GIT_DIR is relative to it. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  static: boolean;
  cfg: Config;
  /** `git ls-files`. */
  tracked: string[];
  /** Not the main checkout (git-dir != common-dir), in every mode; a cp -R copy counts. False when git-dir is null. */
  isWorktree: boolean;
  /** `git rev-parse --git-dir`, absolute, in every mode; null when it or `--git-common-dir` failed. */
  gitDir: string | null;
  /** `git worktree list` paths, the main checkout first. */
  worktrees: string[];
  /** False when `git worktree list` failed or did not run (--static). */
  worktreesRead: boolean;
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
/** The git-dir a GIT_DIR of `p` names, as git reads it: a `gitdir: <path>` file (a worktree's .git) points elsewhere. */
const gitDirAt = (p: string): string => {
  try {
    const m = statSync(p).isFile() ? /^gitdir: (.+)/.exec(readFileSync(p, "utf8")) : null;
    return m ? resolve(dirname(p), m[1]!.trim()) : p;
  } catch {
    return p;
  }
};

const VERSION_CMD: Record<string, [string, string[]]> = { go: ["go", ["version"]], node: ["node", ["--version"]], python: ["python3", ["--version"]] };
/** Why an executable file failed to spawn with ENOENT: the interpreter its `#!` line names is not there. */
const NO_INTERP = "could not start (missing interpreter in its #! line?)";
/** Docker calls and toolchain probes: a hung daemon, shim or network call must not hang the run. */
const PROBE_TIMEOUT_MS = 10_000;

/** How to install `tool` at `want`: the asdf/mise command when a `.tool-versions` line pins `want` as written, else the
 * generic advice. A series or a `v` prefix never matches as written (`want` is the normalized version), so the plain-version
 * guard only turns away a prerelease written verbatim (`golangci-lint 2.0.0-rc.1`), which gets the generic fix. An alias
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
  return `install ${tool} ${want}: run asdf install (or mise install) in ${dir === "." ? "the repo root" : shQuote(dir)}, which installs the ${file} pins`;
}

export function pinChecks(c: Ctx): Result[] {
  const out: Result[] = [];
  for (const pin of c.cfg.pins) {
    const id = `a.pins.${pin.tool}`;
    let vals: PinValue[];
    const notes: string[] = [];
    // B2: an absent optional source is skipped; when every source is optional and none is present, there is no pin.
    const present = pin.sources.filter((s) => !pin.optional.includes(s) || !sourceAbsent(c.root, c.tracked, s));
    if (!present.length) {
      out.push(res("SKIP", id, `no source present (all optional: ${pin.sources.join(", ")})`));
      continue;
    }
    try {
      vals = present.flatMap((s) => readSource(c.root, c.tracked, pin.tool, s, notes));
    } catch (e) {
      if (!(e instanceof PinError)) throw e;
      out.push(res("FAIL", id, e.message, e.fix ?? `fix the source file or the sources in ${CFG}`));
      continue;
    }
    // Only exact pins are compared with each other; each distinct (source, value) range is one row after the verdict
    // (INFO, or under range = "check" the pin against that range), then one INFO per distinct workflow skipped for its
    // reusable-workflow calls.
    const pins = vals.filter((v) => !v.range);
    const srcs = (xs: PinValue[]) => [...new Set(xs.map((v) => v.src))].join(", ");
    const seen = new Set<string>();
    const ranges = vals.filter((v) => v.range && !seen.has(`${v.src}\0${v.v}`) && seen.add(`${v.src}\0${v.v}`));
    const info = (v: PinValue, why = "") => res("INFO", id, `${v.src}: "${v.v}" is a range, not compared${why}`);
    const noted = [...new Set(notes)].map((n) => res("INFO", id, n));
    if (!pins.length) {
      out.push(res("FAIL", id, `no exact pin among sources (${srcs(vals) || present.join(", ")}); pin an exact version in a supported source`, `add a source that pins an exact version to ${CFG}`), ...ranges.map((v) => info(v)), ...noted);
      continue;
    }
    const bad = disagreement(vals, pin.compare);
    const want = pinOf(vals);
    // B1: under range = "check", each distinct pin against each range (a series as the set of versions it names), so the
    // verdict never depends on which pin is the most specific: the row is the worst, FAIL outside, WARN partly inside,
    // INFO when a pin cannot be checked, else PASS. With more than one distinct pin, the row names the pin's sources.
    const distinct = [...new Set(pins.map((v) => v.v))];
    const named = (w: string) => (distinct.length > 1 ? `${w} (${srcs(pins.filter((v) => v.v === w))})` : w);
    const ranged = (v: PinValue): Result => {
      if (pin.range === "info") return info(v);
      if (bad) return info(v, " (the pins disagree)");
      const at = distinct.map((w) => [w, inRange(w, v.v, v.pep440)] as const);
      const first = (k: string | null) => at.find(([, a]) => a === k)?.[0];
      const outside = first("outside");
      const partly = first("partly");
      return outside !== undefined ? res("FAIL", id, `${v.src}: pin ${named(outside)} is outside "${v.v}"`, `pin a version inside the range, or change the range`)
        : partly !== undefined ? res("WARN", id, `${v.src}: pin ${named(partly)} is only partly inside "${v.v}"`, `pin a version the range wholly allows (a series pin names every version in it), or widen the range`)
        : first(null) !== undefined ? info(v, ' (not a form range = "check" reads)')
        : res("PASS", id, `${v.src}: ${distinct.length > 1 ? `pins ${distinct.map(named).join(", ")} are` : `pin ${want} is`} inside "${v.v}"`);
    };
    out.push(bad ? res("FAIL", id, bad, `align the pinned versions, or loosen compare in ${CFG}`) : res("PASS", id, `${pin.tool} ${want} (${srcs(pins)})`), ...ranges.map(ranged), ...noted);
    const sev = pin.local;
    if (c.static || Object.values(sev).every((s) => s === "off")) continue;
    const [bin, args] = Object.hasOwn(VERSION_CMD, pin.tool) ? VERSION_CMD[pin.tool]! : [pin.tool, ["--version"]];
    const r = c.run(bin, args, { cwd: c.root, env: { ...c.env, GOTOOLCHAIN: "local", GOPROXY: "off", MISE_AUTO_INSTALL: "0" }, timeoutMs: PROBE_TIMEOUT_MS });
    const have = r.code === 0 ? ver(r.stdout + r.stderr) : null;
    const lid = `a.local.${pin.tool}`;
    const row = (s: Severity, message: string, fix: string) => void (s !== "off" && out.push(res(s.toUpperCase() as Level, lid, message, fix)));
    // When the pins disagree (B5), each distinct pin gets its own row, named by its sources, and the fix is to align them.
    const fixFor = (w: string) => (bad ? `align the pins first (${id}); env-check then names the version to install` : installFix(c.root, pin.tool, w, pins));
    const of = (w: string) => (bad ? ` (${srcs(pins.filter((v) => v.v === w))})` : "");
    const cmd = [bin, ...args].join(" ");
    // The tool's first output line, redacted then cut; the renderer escapes it, so it stays on this row and cannot read as
    // a second fix.
    const said = (...texts: string[]) => {
      const l = texts.flatMap((t) => t.split("\n")).map((x) => x.trim()).find(Boolean);
      return l ? `: ${cut(c.redact(l), 120)}` : "";
    };
    // A probe that gives no version is reported at the major level. ENOENT for a file that is on PATH is its #!
    // interpreter, which spawn reports as it does a missing file.
    const at = r.notFound ? which(bin, c.env.PATH) : null;
    const failed = r.timedOut ? `${cmd} timed out after ${PROBE_TIMEOUT_MS / 1000}s`
      : r.notFound ? (at ? `${at} ${NO_INTERP}` : `${bin} not found on PATH`)
      : r.code === null ? `${cmd} could not run (${r.abend ?? "killed"})`
      : r.code !== 0 ? `${cmd} exited ${r.code}${said(r.stderr, r.stdout)}`
      : null;
    if (failed !== null || have === null) row(sev.major, failed ?? `${cmd} printed no version${said(r.stdout, r.stderr)}`, fixFor(want));
    else {
      // compare decides; only a rejected version picks a level, by the first numeric component that differs (patch for a
      // prerelease-only difference).
      for (const w of bad ? [...new Set(pins.map((v) => v.v))] : [want]) {
        if (localOk(have, w, pin.compare)) out.push(res("PASS", lid, `local ${pin.tool} ${have} matches pin ${w}${of(w)}`));
        else row(sev[diffPart(have, w)], `local ${pin.tool} ${have} does not match pin ${w}${of(w)}`, fixFor(w));
      }
    }
    const amb = ambiguousShim(c, bin);
    if (amb) out.push(res("WARN", lid, amb, `find the stray copy (asdf which ${bin}, then the bin dir of each listed provider; a Go-installed tool is in that Go install's bin dir), remove it, then run asdf reshim; ask the machine owner if unsure`));
  }
  return out;
}

/**
 * Why the asdf shim `bin` resolves to on PATH is ambiguous, or null: more than one plugin among its `# asdf-plugin:`
 * header lines has a version active here, so more than one copy can answer to the name (B6). Each plugin is named by
 * the first of its active versions the shim lists. Read from asdf's own files, never by running asdf or the tool.
 */
function ambiguousShim(c: Ctx, bin: string): string | null {
  const p = which(bin, c.env.PATH);
  const s = p ? shimOf(p) : null;
  if (!s || s.manager !== "asdf") return null;
  const found = [...new Set(s.providers.map((x) => x.plugin))].flatMap((plugin) => {
    const v = asdfActive(c, plugin).find((a) => s.providers.some((x) => x.plugin === plugin && x.version === a));
    return v ? [`${plugin} ${v}`] : [];
  });
  if (found.length < 2) return null;
  return `ambiguous shim: provided by ${found.slice(0, -1).join(", ")} and ${found.at(-1)} (shim ${p})`;
}

/**
 * The versions asdf takes as active for `plugin` in this checkout: `ASDF_<PLUGIN>_VERSION` (upper-cased, dashes as
 * underscores, as asdf names it), else the nearest `.tool-versions` that lists the plugin, walking up from the checkout,
 * else `$HOME/.tool-versions`. A line may list several versions; all are active. No `asdf current`: nothing runs.
 */
function asdfActive(c: Ctx, plugin: string): string[] {
  const env = c.env[`ASDF_${plugin.toUpperCase().replace(/-/g, "_")}_VERSION`]?.trim();
  if (env) return env.split(/\s+/);
  const listed = (dir: string): string[] | null => {
    let text: string;
    try {
      text = readFileSync(join(dir, ".tool-versions"), "utf8");
    } catch {
      return null;
    }
    for (const l of text.split("\n")) {
      const [name, ...vs] = l.replace(/#.*/, "").trim().split(/\s+/);
      if (name === plugin && vs.length) return vs;
    }
    return null;
  };
  for (let d = c.root; ; d = dirname(d)) {
    const v = listed(d);
    if (v) return v;
    if (dirname(d) === d) break;
  }
  return (c.env.HOME && listed(c.env.HOME)) || [];
}

export function sharedCheck(c: Ctx): Result[] {
  if (c.cfg.sharedHint === null) return [];
  const unread = (cmd: string) => [res("FAIL", "c.shared", "could not read git metadata", `rerun ${cmd} to see why`)];
  if (c.gitDir === null) return unread("git rev-parse --git-dir --git-common-dir");
  if (c.static) return [res("SKIP", "c.shared", "not checked in --static mode")];
  // Each FAIL below comes before ENV_CHECK_ALLOW_MAIN, which allows the shared checkout, not a checkout git mistakes.
  // The user's own git obeys an inherited GIT_DIR / GIT_WORK_TREE that env-check's git drops; the one git sets in a
  // hook names this checkout, so it is silent.
  for (const [k, want, what] of [["GIT_DIR", c.gitDir!, "git metadata"], ["GIT_WORK_TREE", c.root, "files"]] as const) {
    const at = c.env[k] ? rp(k === "GIT_DIR" ? gitDirAt(resolve(c.cwd, c.env[k])) : resolve(c.cwd, c.env[k])) : null;
    if (at && at !== rp(want)) return [res("FAIL", "c.shared", `${k} points at another checkout's ${what}; git commands here act on ${at}`, "unset GIT_DIR GIT_WORK_TREE")];
  }
  if (c.isWorktree) {
    // A real worktree is registered and owns its metadata: git's record of it (<git-dir>/gitdir, relative to the
    // git-dir when written with --relative-paths) names this folder. A cp -R copy, also one over another registered
    // worktree, shares a git-dir another checkout owns; a moved worktree's record names a folder that is gone.
    if (!c.worktreesRead) return unread("git worktree list --porcelain");
    const me = rp(c.root);
    let at: string | null = null;
    try {
      at = dirname(resolve(c.gitDir!, readFileSync(join(c.gitDir!, "gitdir"), "utf8").trim()));
    } catch {
      // No record: git lists it prunable, as it does a moved worktree.
    }
    if (at && rp(at) === me && c.worktrees.some((w) => rp(w) === me)) return [res("PASS", "c.shared", "in a linked worktree")];
    if (at && rp(at) !== me && existsSync(join(at, ".git"))) return [res("FAIL", "c.shared", "this folder shares another worktree's git metadata (copied?)", "recreate it with git worktree add; do not run git worktree repair here")];
    return [res("FAIL", "c.shared", at ? `worktree moved: git has it registered at ${at}${existsSync(at) ? "" : ", which is missing"}` : "worktree moved: git has no folder registered for its metadata", "run git worktree repair here")];
  }
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
 * would use; the tool itself never runs. A mise shim with no active version runs the next copy of the tool on PATH
 * (mise 2026.11.0, linux/aarch64, while `mise which` exits 1), so one that fails `mise which` resolves when an
 * executable copy that is no shim follows the shim's own directory on PATH. Only that state falls back: any other mise
 * error (an untrusted or broken config, mise itself failing) fails the shim too.
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
  if (r.notFound) return isExecutable(cmd) ? `${s.manager} at ${cmd} ${NO_INTERP}` : `${s.manager} not found at ${cmd}`;
  if (r.code === null) return `${how} could not run (${r.abend ?? "killed"})`;
  const inactive = s.manager === "mise" && r.code === 1 && /is a mise bin however it is not currently active/.test(r.stderr);
  if (r.code !== 0) return inactive && fallsBackTo(c, tool, p) ? null : `${how} exited ${r.code}${said ? `: ${cut(c.redact(said), 120)}` : ""}`;
  return r.stdout.trim() ? null : `${how} printed no path`;
}

/** Whether an executable `tool` that is no version-manager shim sits on PATH after `p`'s directory; it never runs. */
function fallsBackTo(c: Ctx, tool: string, p: string): boolean {
  const dirs = (c.env.PATH ?? "").split(delimiter);
  const at = dirs.findIndex((d) => d && join(d, tool) === p);
  return at >= 0 && dirs.slice(at + 1).some((d) => d !== "" && isExecutable(join(d, tool)) && !shimOf(join(d, tool)));
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
  const [deletedZ, stagedZ] = h.tracked ? ["-d", "-s"].map((f) => git(c.run, c.root, ["ls-files", f, "-z"], gitEnv(c.env, c))) : [];
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
    const on = git(c.run, c.root, ["config", "--type=bool", "--default=false", "--get", "core.sparseCheckout"], gitEnv(c.env, c))?.trim();
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
/** Whether checkout `root` is the main checkout (this checkout by its own git metadata; another by git's list order). */
const isMainRoot = (c: Ctx, root: string): boolean => (root === c.root ? !c.isWorktree : rp(root) === rp(c.worktrees[0] ?? c.root));
/**
 * The compose files of checkout `root`: `[compose] main_files` for the main checkout when set, else `files`. Every
 * consumer reads them here: runs, projectDir (so derive), check 0, the container_name scan, the b.containers fix.
 */
const filesFor = (c: Ctx, root: string): string[] => (isMainRoot(c, root) ? c.cfg.compose!.mainFiles : null) ?? c.cfg.compose!.files;
/** The key that lists checkout `root`'s files, as a fix names it. */
const filesKey = (c: Ctx, root: string): string => (isMainRoot(c, root) && c.cfg.compose!.mainFiles ? "main_files" : "files");
/** Compose's project directory for checkout `root` under its files: the first one's. */
const projectDir = (c: Ctx, root: string): string => dirname(resolve(root, filesFor(c, root)[0]!));

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
  const files = filesFor(c, root);
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

/** The shell's COMPOSE_* names (the remote switches aside), sorted: this checkout's cells run with and without them. */
const shellCompose = (c: Ctx): string[] => Object.keys(c.env).filter((k) => k.startsWith("COMPOSE_") && !isSwitch(k)).sort();

/** Every run of checkout `root`, once per `scrubs` entry (true: without the shell's COMPOSE_*). */
function cellsOf(c: Ctx, root: string, whose: string, scrubs: boolean[]): Cell[] {
  const set = shellCompose(c);
  return runs(c, root).flatMap((r) => scrubs.map((scrub) => ({ ...r, whose, pre: root === c.root && scrub ? `without your shell's COMPOSE_* (${set.join(", ")}), ` : "", r: composeName({ root: r.dir, files: r.files, env: c.env, scrub, run: c.run }) })));
}

/**
 * Another checkout, as this one sees it: one record per checkout git lists, this one aside, in git's order (the main
 * checkout first). Every name it may run under is held from this checkout, and every probe of it that failed is a
 * gap in that list; `heldOf` and `peerWarnings` read only these records.
 */
interface Peer {
  root: string;
  /** "the main checkout" or "worktree <root>", as messages name it. */
  holder: string;
  isMain: boolean;
  /** False for a worktree git still lists whose directory is gone (until git worktree prune). */
  exists: boolean;
  /** The files its configured run passes as -f (`main_files` for the main checkout when set). */
  files: string[];
  /** The `-p` name loops gives a linked worktree; null for the main checkout, whose name is Compose's answer. */
  derived: string | null;
  /** Its runs as another shell would start them (without this shell's COMPOSE_*). Probed only from a worktree, and
   * only while the directory exists: from the main checkout each worktree reports its own collisions. */
  cells: Cell[];
  /** Its cells whose probe failed, in order: each is a gap in what this checkout can check against (the peer WARN). */
  failed: Cell[];
  /** Names held besides its answers: the main checkout's `main_project` (always), its derived name when any of its
   * cells failed, and what the fallback (`recover`) read from the failed cells' files without interpolating them. */
  recovered: string[];
  /** A failed cell's `name:` is a template reading a variable loops could not resolve from that checkout's `.env`. */
  templated: boolean;
}

/** What the fallback read from one failed run's files: the names it holds, and whether `name:` was a template. */
type Recovered = { names: string[]; templated: boolean };
const NOTHING: Recovered = { names: [], templated: false };

/**
 * The fallback for a peer's failed run (kind interp or exit only: a Compose that hangs, crashes or is too old gives no
 * second answer): `config --no-interpolate --no-normalize` reads `name:` as written. A literal one is held as Compose
 * normalizes it; then the normalizing run (still uninterpolated) adds the project directory's `.env`
 * COMPOSE_PROJECT_NAME, or with no `name:` the directory default. A templated `name:` is resolved locally from the
 * project directory's `.env` (Compose's defaults applied, never the process env) and held normalized; that run's
 * answer is held too when it is not just the template normalized (a `.env` name beat it). When the template does not
 * resolve (a variable only that checkout's shell can set), the peer is marked templated. Any failure holds nothing. Runs are deduped by (cwd, files), and after one times out the rest of
 * this e.project run skips the fallback (each could hang as long).
 */
function recoverer(c: Ctx): (p: Cell) => Recovered {
  const seen = new Map<string, Recovered>();
  let timedOut = false;
  const once = (p: Cell): Recovered => {
    const o = { root: p.dir, files: p.files, env: c.env, scrub: true, run: c.run };
    const raw = composeNameRaw(o);
    if ("error" in raw) {
      timedOut ||= raw.kind === "timeout";
      return NOTHING;
    }
    const literal = raw.raw !== null && !raw.raw.includes("$") ? normProject(raw.raw) : null;
    const norm = composeNameRaw({ ...o, normalize: true });
    if ("error" in norm) timedOut ||= norm.kind === "timeout";
    const answer = "error" in norm ? null : norm.raw;
    const names = new Set(literal ? [literal] : []);
    if (raw.raw !== null && literal === null) {
      // The template resolved from the project directory's .env alone (its defaults applied), never this shell.
      const dotenv = readDotEnv(p.pdir);
      const local = resolveTemplate(raw.raw, dotenv);
      const resolved = local === null ? "" : normProject(local);
      if (resolved) names.add(resolved);
      // A .env COMPOSE_PROJECT_NAME beats name:, so then the template does not decide the name. Read it from the
      // .env itself: an answer equal to normProject(raw) (COMPOSE_PROJECT_NAME=stack over name: ${STACK}) is still it.
      const own = dotenv.get("COMPOSE_PROJECT_NAME");
      if (own) names.add(normProject(own));
      const beat = !!own || (answer !== null && answer !== normProject(raw.raw));
      if (beat && answer) names.add(answer);
      return { names: [...names], templated: !resolved && !beat };
    } else if (answer) names.add(answer);
    return { names: [...names], templated: false };
  };
  return (p) => {
    const kind = (p.r as ComposeError).kind;
    if (kind !== "interp" && kind !== "exit") return NOTHING;
    const key = `${rp(p.dir)}\0${(p.files ?? []).join("\0")}`;
    const hit = seen.get(key);
    if (hit) return hit;
    const got = timedOut ? NOTHING : once(p);
    seen.set(key, got);
    return got;
  };
}

function peers(c: Ctx): Peer[] {
  const main = rp(c.worktrees[0] ?? c.root);
  const recover = recoverer(c);
  return c.worktrees.filter((w) => rp(w) !== rp(c.root)).map((w) => {
    const isMain = rp(w) === main;
    const holder = isMain ? "the main checkout" : `worktree ${w}`;
    const exists = existsSync(w);
    const cells = c.isWorktree && exists ? cellsOf(c, w, `${holder}'s `, [true]) : [];
    const failed = cells.filter((p) => "error" in p.r);
    const got = failed.map(recover);
    // From a worktree the main checkout is a peer too: when its name is unknown, the name plain Compose derives for it
    // is held, so a worktree named like the main checkout never shares (and `down -v`s) its volumes.
    // Its main_project is the -p name its wrappers use, so it is held whatever Compose answers there.
    const mainProject = isMain ? c.cfg.compose!.mainProject : null;
    const recovered = [...(mainProject ? [mainProject] : []), ...(isMain && failed.length ? [derive(c, w)] : []), ...got.flatMap((g) => g.names)];
    return { root: w, holder, isMain, exists, files: filesFor(c, w), derived: isMain ? null : derive(c, w), cells, failed, recovered, templated: got.some((g) => g.templated) };
  });
}

const named = (p: Cell): string | undefined => ("name" in p.r ? p.r.name : undefined);

/**
 * Held names and who holds each, the first holder winning: every worktree's derived name (a gone one's included, as
 * git still lists it), then each peer's answers and recovered names, peer by peer in git's order.
 */
function heldOf(ps: Peer[]): Map<string, string> {
  const held = new Map<string, string>();
  for (const p of ps) {
    if (p.derived !== null && !held.has(p.derived)) held.set(p.derived, p.exists ? p.holder : `${p.holder} (gone, until git worktree prune)`);
    for (const n of [...p.cells.map(named), ...p.recovered]) if (n && !held.has(n)) held.set(n, p.holder);
  }
  return held;
}

/**
 * One WARN per peer whose probe failed somewhere (its first failed run, then how many more): its names that loops
 * could know are held, but a name only that checkout's shell sets is not, until its stack runs (check 5 sees it then).
 * The fix is that checkout's own run, whose e.project row says what to fix there.
 */
function peerWarnings(ps: Peer[], name: string, kept: boolean): Result[] {
  return ps.flatMap((p) => {
    const [first, ...more] = p.failed;
    if (!first) return [];
    const where = p.isMain ? "checkout" : "worktree";
    const also = more.length ? `, and ${more.length} more run${more.length > 1 ? "s" : ""}` : "";
    const keep = kept ? `this checkout keeps project ${name} (checked against every name loops can know)` : `this checkout's project ${name} was checked against every name loops can know`;
    const tpl = p.templated ? `; its name: reads a variable loops could not resolve from that ${where}'s .env` : "";
    const message = `${p.isMain ? "main checkout" : "peer worktree"} ${p.root}: ${first.label}: ${(first.r as ComposeError).error}${also}; ${keep}, but a name set only in that ${where}'s shell cannot be checked until its stack runs${tpl}`;
    const fix = `run bin/env-check in ${p.root} (its e.project row names the fix there)${p.isMain ? "" : `; if that worktree is abandoned, git worktree remove ${shQuote(p.root)} (refuses when it has changes)`}`;
    return [res("WARN", "e.project", message, fix)];
  });
}

/**
 * e.project. `name` is the `-p` name, null when a FAIL withholds it, when the main checkout has no Compose (SKIP) and
 * in --static. `results` is one PASS or SKIP, or every FAIL, worst first: those that withhold the name, then those
 * that keep it (`-p name` is safe; only a run without -p is not); `results[0]` is the row that decides. `withheld` is
 * whether any FAIL withholds. `answers` are the names Compose gave this checkout's own runs (b.containers and the
 * running-stack check read them). `ps` is the run's `docker ps` (b.containers reads it too), absent when evaluation
 * stopped before the running-stack check. `warnings` are the peer WARNs (one per other checkout whose probe failed),
 * shown after `results`; they never withhold the name or decide the row.
 */
export type ComposeProject = { name: string | null; results: Result[]; withheld: boolean; answers: string[]; ps?: Listing; warnings: Result[] };

const UPGRADE_FIX = "upgrade Docker Compose to one whose config takes --no-env-resolution";
const interpFix = (v: string, pdir: string): string =>
  `set ${v} in ${join(pdir, ".env")} or export it; copy its line from .env.example when one defines it; if it is a secret you do not have, ask the repo owner`;
// Compose exited 0 there, so the rerun (config -q) prints nothing.
const NO_NAME_FIX = "Compose exited 0 without a usable project name; check `docker compose version` and upgrade Docker Compose";

/**
 * The Compose project name for this checkout and its e.project results. Compose says what each run without -p is
 * named; loops only decides what may collide, and never guesses where Compose's answer came from.
 */
export function composeProject(c: Ctx): ComposeProject {
  const id = "e.project";
  const { derive: how, mainProject } = c.cfg.compose!;
  const files = filesFor(c, c.root);
  const key = filesKey(c, c.root);
  const one = (level: Level, message: string, fix?: string, name: string | null = null): ComposeProject => ({ name, results: [res(level, id, message, fix)], withheld: level === "FAIL", answers: [], warnings: [] });
  // Check 0: this checkout lacks a configured file.
  const missing = files.filter((f) => !existsSync(join(c.root, f)));
  if (missing.length === files.length) return one("FAIL", `no compose file found (${files.join(", ")})`, `fix [compose] ${key} in ${CFG}`);
  if (missing.length) return one("FAIL", `compose file missing: ${missing.join(", ")}`, `restore ${missing[0]} or fix [compose] ${key} in ${CFG}`);
  if (c.static) return one("PASS", "compose files present (project name not resolved in --static)");
  const envName = c.env.COMPOSE_PROJECT_NAME || undefined;
  // Check 0b: Compose rejects the shell's name outright, so every run here fails and no name holds.
  if (envName && !isProject(envName)) return one("FAIL", `your shell's COMPOSE_PROJECT_NAME ${JSON.stringify(envName)} is not a Compose project name (lowercase letters, digits, - and _, starting with a letter or digit)`, "export a COMPOSE_PROJECT_NAME of that form, or unset it");
  // Without git's metadata a worktree is not known to be one, so check 0c below would take it for the main checkout.
  if (c.gitDir === null) return one("FAIL", "could not read git metadata", "rerun git rev-parse --git-dir --git-common-dir to see why");
  // Check 0c: git lists the main checkout first and every linked worktree after it (a successful list has at least one
  // entry). Without that, derive and the held names would take this worktree for the main checkout.
  if (c.isWorktree ? c.worktrees.length < 2 || rp(c.worktrees[0]!) === rp(c.root) : !c.worktrees.length) return one("FAIL", "git worktree list did not list the main checkout; the names other checkouts hold are unknown", `rerun to see why: cd ${shQuote(c.root)} && git worktree list --porcelain`);
  // Check 0d: in the main checkout, a shell COMPOSE_PROJECT_NAME other than main_project runs another stack than the
  // one the config (and its wrappers' -p) names, so neither name is safe to hand out.
  if (!c.isWorktree && mainProject && envName && envName !== mainProject) return one("FAIL", `your shell's COMPOSE_PROJECT_NAME ${envName} is not [compose] main_project ${mainProject}: a run here without -p would use another stack than the config names`, `unset COMPOSE_PROJECT_NAME, or set main_project = "${envName}" in ${CFG}`);
  // The main checkout's name when main_project sets it: the wrappers pass it as -p, so Compose's answer need not match.
  const mainName = c.isWorktree ? null : mainProject;
  // Check 1: without Compose nothing here starts a stack; the name is then only what loops vouches for on its own.
  const v = composeVersion(c.run, c.root, c.env);
  if ("unavailable" in v) return one("SKIP", `compose unavailable (${v.unavailable}); nothing to collide with`, undefined, envName ?? (c.isWorktree ? derive(c, c.root) : mainName));
  if ("error" in v) return one("FAIL", `compose: ${v.error}`, `rerun to see why: cd ${shQuote(c.root)} && docker compose version`);
  // envs(X): this checkout under the shell as is, and again without COMPOSE_* when the shell sets any (even empty);
  // every other checkout runs from its own shell, so without this one's COMPOSE_*.
  const failed = (p: Cell): Result => {
    const e = p.r as ComposeError;
    // A required variable this checkout lacks is fixed here; another checkout's is fixed there (its own row says how).
    const fix = e.kind === "interp" && own.includes(p) ? interpFix(e.variable!, p.pdir) : e.kind === "tooOld" ? UPGRADE_FIX : e.kind === "json" || e.kind === "noName" ? NO_NAME_FIX : `rerun to see Compose's error: ${rerun(e)}`;
    return res("FAIL", id, `${p.pre}${p.whose}${p.label}: ${e.error}`, fix);
  };
  const own = cellsOf(c, c.root, c.isWorktree ? "this worktree's " : "this checkout's ", shellCompose(c).length ? [false, true] : [false]);
  // name(X): the shell's, else a worktree's derived one, else the main checkout's configured run as is (own[0], as
  // check 0 found every file). That probe failing leaves nothing to check.
  if (!envName && !c.isWorktree && !mainName && "error" in own[0]!.r) return { name: null, results: [failed(own[0]!)], withheld: true, answers: [], warnings: [] };
  if (!envName && !c.isWorktree && "noFile" in own[0]!.r) return one("FAIL", "this checkout's configured run: docker compose config found no compose file", `fix [compose] ${key} in ${CFG}`);
  const name = envName ?? (c.isWorktree ? derive(c, c.root) : (mainName ?? named(own[0]!)));
  if (!name) return one("FAIL", `no project name derives from directory ${basename(projectDir(c, c.root))}`, "set COMPOSE_PROJECT_NAME, or declare name: in the compose file");
  // Held names, from a worktree: the main checkout's answers, every other worktree's derived name and answers (a gone
  // one only its derived name). From the main checkout: only the worktrees' derived names (each reports the rest).
  const others = peers(c);
  const held = heldOf(others);
  // Every check runs; each FAIL says whether it withholds the name (true) or keeps it.
  const fails: [Result, boolean][] = [];
  // Check 2: this checkout's own probe that failed. The main checkout's configured run, in a main-checkout run,
  // withholds (it is where the name came from), unless main_project names it; this checkout's other runs keep the name: only that run without -p is
  // unknown. A peer's failed run is no FAIL here: every name loops can know for it is held (its derived name, the
  // main checkout's derived name, the fallback's), the rest is its own run's FAIL, and here it is a peer WARN.
  for (const p of own) if ("error" in p.r) fails.push([failed(p), !c.isWorktree && !mainName && !!p.files]);
  // Checks 3 and 6: the name itself is another checkout's.
  const holder = held.get(name);
  const rename = `export another COMPOSE_PROJECT_NAME${how === "dirname" ? `, set derive = "slug-hash" in ${CFG}` : ""}, or rename ${holder}`;
  // A3: a worktree's dirname-derived name that is the main checkout's. Both paths are named; the fixes are a new
  // directory name (only when the project directory is the worktree root: a subdirectory's name is the same in every
  // checkout) or slug-hash, which renames every worktree's project at once.
  const mainPath = c.worktrees[0] ?? c.root;
  // Only when the held name is the main checkout's own dirname-derived one; main_project, a literal name: or a .env
  // name there is another source, and the message says so (or stays generic).
  const byMain = c.isWorktree && holder === "the main checkout";
  const viaMainProject = byMain && name === mainProject;
  const dirnameClash = byMain && !envName && how === "dirname" && !viaMainProject && name === derive(c, mainPath);
  const atRoot = rp(projectDir(c, c.root)) === rp(c.root);
  const slug = `set derive = "slug-hash" in ${CFG}, which renames every worktree's project, so first stop each worktree's stack (docker compose down, without -v)`;
  const clash = `${atRoot ? `rename this worktree's directory: git worktree move ${shQuote(c.root)} <new-path>; or ` : ""}${slug}`;
  if (holder && dirnameClash) fails.push([res("FAIL", id, `this worktree would use project ${name}, which the main checkout uses: the main checkout ${mainPath} and this worktree ${c.root} derive one name under derive = "dirname"`, clash), true]);
  else if (holder && viaMainProject) fails.push([res("FAIL", id, `this worktree would use project ${name}, which the main checkout uses: it is [compose] main_project in ${CFG}`, `${envName ? "export another COMPOSE_PROJECT_NAME" : how === "dirname" ? clash : "export another COMPOSE_PROJECT_NAME"}, or set another main_project in ${CFG}`), true]);
  // main's literal name: or .env name equals this worktree's dirname-derived one: the same two fixes apply here.
  else if (holder) fails.push([res("FAIL", id, `${c.isWorktree ? "this worktree" : "this checkout"} would use project ${name}, which ${holder} uses`, byMain && !envName && how === "dirname" ? clash : rename), true]);
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
  const source = envName ? "COMPOSE_PROJECT_NAME" : c.isWorktree ? `derived: ${how}` : mainName ? "main_project" : "compose";
  const note = Array.isArray(ps) || ps.timedOut ? "" : `; running stacks not checked (${ps.failed})`;
  if (!fails.length) return { name, results: [res("PASS", id, `${name} (${source})${note}`)], withheld: false, answers, ps, warnings: peerWarnings(others, name, true) };
  const withheld = fails.some(([, w]) => w);
  const results = [...fails.filter(([, w]) => w), ...fails.filter(([, w]) => !w)].map(([r]) => r);
  results[0] = { ...results[0]!, message: results[0]!.message + note };
  return { name: withheld ? null : name, results, withheld, answers, ps, warnings: peerWarnings(others, name, !withheld) };
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
  const logged = git(c.run, c.root, ["log", "-1", "--no-show-signature", "--format=%ct", "--", ...files], gitEnv(c.env, c))?.trim();
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
  const fs = own.every((f) => isAbsolute(f) && existsSync(f)) ? own.map(rel) : filesFor(c, c.root);
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
  const { mode, allowContainerName } = c.cfg.compose;
  const files = filesFor(c, c.root);
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
    ...project.warnings,
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
 * exit without a FAIL are FAILs. Relayed text has `$HOME` redacted before it is cut; the renderer escapes it, so a
 * check cannot move the cursor or add a second fix.
 */
export function runLocal(c: Ctx, l: LocalCheck, project: string | null): Result[] {
  if (c.static && !l.static) return [{ ...res("SKIP", l.id, "not run in --static mode"), source: "local" }];
  const env: NodeJS.ProcessEnv = {
    ...c.env,
    ENV_CHECK_ROOT: c.root,
    ENV_CHECK_MODE: c.static ? "static" : "full",
    // "Not the main checkout"; empty when git could not be read, set so an inherited value never wins.
    ENV_CHECK_WORKTREE: c.gitDir === null ? "" : c.isWorktree ? "1" : "0",
    ENV_CHECK_PROJECT: project ?? "",
    ENV_CHECK_ID: l.id,
    GOPROXY: "off",
    GOTOOLCHAIN: "local",
    // A mise shim must not install a missing tool: auto_install off also turns off exec and not-found auto-install.
    MISE_AUTO_INSTALL: "0",
    NO_COLOR: "1",
  };
  const r = c.run(resolve(c.root, l.run), [], { cwd: c.root, env, timeoutMs: l.timeoutMs, group: true });
  const mk = (level: Level, id: string, message: string, fix?: string): Result => ({ level, id, message, fix, source: "local" });
  const out: Result[] = [];
  // Only a CRLF's "\r" and trailing blanks are trimmed, so a line ending in (or made of) another control is rejected.
  for (const line of r.stdout.split("\n").map((s) => s.replace(/\r$/, "").replace(/[ \t]+$/, "")).filter(Boolean)) {
    const m = CONTROL.test(line) ? null : LINE.exec(line);
    if (m && (m[2] === l.id || m[2]!.startsWith(`${l.id}.`))) out.push(mk(m[1] as Level, m[2]!, m[3]!, m[4]?.trim() || undefined));
    else out.push(mk("FAIL", `${l.id}.protocol`, `unparseable line ${quote(c.redact(line))}`, "emit `LEVEL id message`, with an optional fix after an em dash and `fix:`, one line per result, id = the configured id or <id>.<name>"));
  }
  // A lost supervisor (it died, or overran the backstop) never downgrades a FAIL the check printed before it.
  if (r.lost) {
    if (out.some((x) => x.level === "FAIL")) return out;
    const what = r.cleaned === "yes" ? "check group killed" : "check group could not be verified, nothing killed";
    return [...out, mk("WARN", l.id, `supervisor lost; ${what}`, "rerun once; report it if it repeats")];
  }
  // What the check printed before the timeout still counts (an emitted FAIL survives).
  if (r.timedOut) return [...out, mk("WARN", l.id, `timed out after ${l.timeoutS}s (not a pass)`, `raise timeout_s or run ${l.run} by hand`)];
  const stderr = r.stderr.split("\n").map((x) => x.trim()).find(Boolean) ?? "";
  const why = stderr ? ` (${cut(c.redact(stderr), 120)})` : "";
  // The run file was checked executable, so ENOENT is its #! interpreter.
  const none = r.notFound ? NO_INTERP : r.code === null ? `could not run (${r.abend ?? "killed"})` : `printed no results${r.code ? `, exit ${r.code}` : ""}`;
  if (!out.length) return [mk("FAIL", l.id, `${none}${why}`, `run ${l.run} by hand`)];
  if (r.code !== 0 && !out.some((x) => x.level === "FAIL")) out.push(mk("FAIL", l.id, `exited ${r.code ?? "abnormally"} without a FAIL line${why}`, `run ${l.run} by hand`));
  return out;
}
