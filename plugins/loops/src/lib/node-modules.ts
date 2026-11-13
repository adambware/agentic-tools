// 0.8.0 D2: `d.node_modules`, whether each tracked npm lockfile's packages are what node_modules holds. It compares
// file content only (never an mtime): the lockfile against npm's own record of the install, the hidden lockfile
// `node_modules/.package-lock.json`, on every package record's `version` and `integrity`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { Level, Result } from "./env-checks.js";
import { shQuote } from "./proc.js";

/** What npm filters `os`, `cpu` and `libc` on. `libc` is "glibc", "musl" or null (unknown, and always null off Linux). */
export interface Platform {
  os: string;
  cpu: string;
  libc: string | null;
}

/**
 * The libc family as npm's current-env reads it: off Linux none; on Linux the text of `/usr/bin/ldd` ("musl" is musl,
 * "GNU C Library" is glibc, other text unknown), and only when ldd cannot be read Node's process report (a glibc runtime
 * version is glibc, a musl loader among the shared objects is musl).
 */
export function detectLibc(os: string, ldd: () => string | null, report: () => { header?: { glibcVersionRuntime?: string }; sharedObjects?: unknown } | null): string | null {
  if (os !== "linux") return null;
  const text = ldd();
  if (text !== null) return text.includes("musl") ? "musl" : text.includes("GNU C Library") ? "glibc" : null;
  const r = report();
  if (r?.header?.glibcVersionRuntime) return "glibc";
  const libs = Array.isArray(r?.sharedObjects) ? (r.sharedObjects as unknown[]) : [];
  return libs.some((f) => typeof f === "string" && (f.includes("libc.musl-") || f.includes("ld-musl-"))) ? "musl" : null;
}

/** This machine's platform, as npm sees it (see detectLibc). */
export function hostPlatform(): Platform {
  const ldd = (): string | null => {
    try {
      return readFileSync("/usr/bin/ldd", "utf8");
    } catch {
      return null;
    }
  };
  const report = () => {
    // excludeNetwork (Node 20.13+) keeps the report from resolving host names; older Node ignores it.
    const rep = process.report as (NodeJS.ProcessReport & { excludeNetwork?: boolean }) | undefined;
    if (!rep) return null;
    const saved = rep.excludeNetwork;
    rep.excludeNetwork = true;
    try {
      return rep.getReport() as { header?: { glibcVersionRuntime?: string }; sharedObjects?: unknown };
    } finally {
      rep.excludeNetwork = saved;
    }
  };
  return { os: process.platform, cpu: process.arch, libc: detectLibc(process.platform, ldd, report) };
}

interface Pkg {
  version?: string;
  integrity?: string;
  resolved?: string;
  link?: boolean;
  dev?: boolean;
  optional?: boolean;
  devOptional?: boolean;
  inBundle?: boolean;
  os?: unknown;
  cpu?: unknown;
  libc?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  devDependencies?: unknown;
}

/** npm-install-checks' list rule: `any`, `!x` excludes x, and a list of only negations admits everything else. */
function listOk(value: string, raw: unknown): boolean {
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  if (!list.length || (list.length === 1 && list[0] === "any")) return true;
  let negated = 0;
  let match = false;
  for (const e of list) {
    if (e.startsWith("!")) {
      negated++;
      if (e.slice(1) === value) return false;
    } else if (e === value) match = true;
  }
  return match || negated === list.length;
}

/**
 * Whether npm installs `p` on this platform at all, by npm-install-checks' checkPlatform: a package with a `libc` field
 * is never installed off Linux or when the libc is unknown.
 */
export function eligible(p: Pkg, pf: Platform): boolean {
  if (p.os !== undefined && !listOk(pf.os, p.os)) return false;
  if (p.cpu !== undefined && !listOk(pf.cpu, p.cpu)) return false;
  if (p.libc !== undefined && (pf.os !== "linux" || pf.libc === null || !listOk(pf.libc, p.libc))) return false;
  return true;
}

/** Where a dependency `name` of the record at `key` resolves: node's lookup, up from `key`'s own node_modules. */
function resolveDep(packages: Record<string, Pkg>, key: string, name: string): string | null {
  for (let at: string | null = key; at !== null; ) {
    const k = at === "" ? `node_modules/${name}` : `${at}/node_modules/${name}`;
    if (Object.hasOwn(packages, k)) return k;
    if (at === "") at = null;
    else {
      const i = at.lastIndexOf("node_modules/");
      at = i <= 0 ? "" : at.slice(0, i - 1);
    }
  }
  return null;
}

const names = (deps: unknown): string[] => (deps && typeof deps === "object" && !Array.isArray(deps) ? Object.keys(deps) : []);

/**
 * The records npm skips on this platform: each one that fails `eligible`, plus npm's optional set, every optional
 * record that only skipped records depend on (fsevents' own dependencies on Linux). A required record is never
 * skipped this way: one reachable only through a skipped package is a lockfile problem, and is still compared.
 */
function skipped(packages: Record<string, Pkg>, pf: Platform): Set<string> {
  const out = new Set<string>();
  const users = new Map<string, Set<string>>();
  for (const [k, p] of Object.entries(packages)) {
    if (!p || typeof p !== "object") continue;
    if (rootTree(k) && !eligible(p, pf)) out.add(k);
    const deps = [...names(p.dependencies), ...names(p.optionalDependencies), ...(k === "" ? names(p.devDependencies) : [])];
    for (const name of deps) {
      const to = resolveDep(packages, k, name);
      if (to !== null) users.set(to, (users.get(to) ?? new Set()).add(k));
    }
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [k, p] of Object.entries(packages)) {
      if (out.has(k) || !rootTree(k) || !p || !(p.optional || p.devOptional)) continue;
      const by = users.get(k);
      if (by?.size && [...by].every((u) => out.has(u))) {
        out.add(k);
        grew = true;
      }
    }
  }
  return out;
}

/** Brace expansion past this many globs is refused (the glob is then kept as written). */
const MAX_BRACES = 1024;

/**
 * `glob` with its braces expanded as npm's (minimatch's) brace-expansion does: `{a,b}` alternatives, nested ones too,
 * and `{1..3}` numeric ranges. A `{x}` with neither, an unclosed `{` and a `\\`-escaped brace stay literal.
 */
export function braces(glob: string): string[] {
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "\\") {
      i++;
      continue;
    }
    if (glob[i] !== "{") continue;
    const parts: string[] = [];
    let depth = 0;
    let from = i + 1;
    let close = -1;
    for (let j = i; j < glob.length && close < 0; j++) {
      const c = glob[j];
      if (c === "\\") j++;
      else if (c === "{") depth++;
      else if (c === "," && depth === 1) {
        parts.push(glob.slice(from, j));
        from = j + 1;
      } else if (c === "}" && --depth === 0) {
        parts.push(glob.slice(from, j));
        close = j;
      }
    }
    if (close < 0) return [glob];
    let alts = parts;
    if (parts.length === 1) {
      const m = /^(-?\d+)\.\.(-?\d+)$/.exec(parts[0]!);
      if (!m) {
        i = close;
        continue;
      }
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (Math.abs(b - a) >= MAX_BRACES) return [glob];
      alts = [];
      for (let k = a; a <= b ? k <= b : k >= b; k += a <= b ? 1 : -1) alts.push(String(k));
    }
    const pre = glob.slice(0, i);
    const post = glob.slice(close + 1);
    const out: string[] = [];
    for (const alt of alts) {
      out.push(...braces(pre + alt + post));
      if (out.length > MAX_BRACES) return [glob];
    }
    return out;
  }
  return [glob];
}

/** One glob path segment as a regex: `*` any run within the segment, `?` one character, `[...]` a class (`[!...]` or `[^...]` negated). */
function segRe(pat: string): RegExp {
  const esc = (c: string) => c.replace(/[.*+?^$()|[\]{}\\/-]/g, "\\$&");
  let re = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i]!;
    if (c === "\\" && i + 1 < pat.length) re += esc(pat[++i]!);
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      // A class runs to the first `]` after its first character; an unclosed `[` is literal.
      let j = i + 1;
      const neg = pat[j] === "!" || pat[j] === "^";
      if (neg) j++;
      const end = pat.indexOf("]", j + 1);
      if (end < 0) {
        re += "\\[";
        continue;
      }
      const body = pat.slice(j, end).replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^");
      re += `[${neg ? "^" : ""}${body}]`;
      i = end;
    } else re += esc(c);
  }
  return new RegExp("^" + re + "$");
}

/**
 * Whether `path` (relative, `/`-separated) matches a workspaces glob the way npm's minimatch does for these: braces
 * expanded first, then per segment `*`, `?` and `[...]`, and `**` for any number of segments.
 */
function globMatch(glob: string, path: string): boolean {
  const p = path.split("/").filter((x) => x && x !== ".");
  return braces(glob).some((one) => {
    const g = normalize(one).replace(/\/+$/, "").split("/").filter((x) => x && x !== ".");
    const go = (i: number, j: number): boolean => {
      if (i === g.length) return j === p.length;
      if (g[i] === "**") return go(i + 1, j) || (j < p.length && go(i, j + 1));
      return j < p.length && segRe(g[i]!).test(p[j]!) && go(i + 1, j + 1);
    };
    return go(0, 0);
  });
}

/** Whether `rel` is a member under npm's workspaces `globs`: matched by one, and by no `!` negation. */
export function isMember(globs: string[], rel: string): boolean {
  const neg = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  return globs.some((g) => !g.startsWith("!") && globMatch(g, rel)) && !neg.some((g) => globMatch(g, rel));
}

type Read = { ok: true; version: unknown; packages: Record<string, Pkg> } | { ok: false; why: string };
/** The lockfile at `file`; "missing" when it is not there (ENOENT), null when it cannot be read. */
function readLock(file: string): Read | "missing" | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : null;
  }
  try {
    const j = JSON.parse(text) as { lockfileVersion?: unknown; packages?: unknown };
    const packages = j.packages && typeof j.packages === "object" && !Array.isArray(j.packages) ? (j.packages as Record<string, Pkg>) : {};
    return { ok: true, version: j.lockfileVersion, packages };
  } catch (e) {
    return { ok: false, why: `not valid JSON (${(e as Error).message.split("\n")[0]})` };
  }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
/** A record of the root node_modules tree (nested ones included); a workspace member's own tree is not compared. */
const rootTree = (key: string): boolean => key.startsWith("node_modules/");
const label = (key: string): string => key.slice("node_modules/".length);
const same = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);
const pkgs = (n: number): string => `${n} package${n === 1 ? "" : "s"}`;

/** `packages[""].workspaces`: an array of globs, or `{packages: [...]}`. */
function workspaces(r: { packages: Record<string, Pkg> }): string[] {
  const w = (r.packages[""] as { workspaces?: unknown } | undefined)?.workspaces;
  const list = Array.isArray(w) ? w : w && typeof w === "object" && Array.isArray((w as { packages?: unknown }).packages) ? (w as { packages: unknown[] }).packages : [];
  return list.filter((x): x is string => typeof x === "string");
}

/**
 * One `d.node_modules` row per tracked `package-lock.json` (none inside a node_modules tree or a workspace member of
 * another one): at `level` for a difference, WARN for a missing optional package or a lockfile it cannot verify, INFO for
 * an unsupported lockfileVersion, a lockfile sparse checkout left out (`sparse` says which: git's skip-worktree), or
 * nothing to compare, else PASS.
 */
export function nodeModulesRows(root: string, tracked: string[], level: "fail" | "warn", pf: Platform, sparse: (f: string) => boolean = () => false): Result[] {
  const LEVEL: Level = level === "fail" ? "FAIL" : "WARN";
  const row = (lvl: Level, message: string, fix?: string): Result => ({ level: lvl, id: "d.node_modules", message, fix, source: "builtin" });
  const locks = tracked.filter((f) => (f === "package-lock.json" || f.endsWith("/package-lock.json")) && !f.split("/").includes("node_modules"));
  const read = new Map(locks.map((f) => [f, readLock(join(root, f))]));
  // Workspace members of any lockfile here: the link targets its root record's workspaces globs name (a `file:`
  // dependency's link target is not one, and its own lockfile is compared). Only the root lockfile and root
  // node_modules count for a member.
  const members = new Set<string>();
  for (const [f, r] of read) {
    if (!r || r === "missing" || !r.ok) continue;
    const globs = workspaces(r);
    if (!globs.length) continue;
    for (const p of Object.values(r.packages)) {
      if (!p?.link || typeof p.resolved !== "string") continue;
      const rel = normalize(p.resolved);
      if (isMember(globs, rel)) members.add(normalize(join(dirname(f), rel)));
    }
  }
  const out: Result[] = [];
  let compared = 0;
  for (const f of locks) {
    const dir = dirname(f);
    if (members.has(dir)) continue;
    compared++;
    const fix = dir === "." ? "npm ci" : `(cd ${shQuote(dir)} && npm ci)`;
    const r = read.get(f);
    if (r === "missing" && sparse(f)) {
      out.push(row("INFO", `${f}: not checked out (sparse checkout), not compared`));
      continue;
    }
    if (!r || r === "missing") {
      out.push(row(LEVEL, `${f}: cannot read the lockfile`, `restore it (git checkout -- ${shQuote(f)})`));
      continue;
    }
    if (!r.ok) {
      out.push(row(LEVEL, `${f}: ${r.why}`, `restore it (git checkout -- ${shQuote(f)}) or regenerate it with npm install`));
      continue;
    }
    if (r.version !== 2 && r.version !== 3) {
      out.push(row("INFO", `${f}: unsupported lockfile (lockfileVersion ${String(r.version)}; 2 and 3 are read), not compared`));
      continue;
    }
    const skip = skipped(r.packages, pf);
    const want = Object.entries(r.packages).filter(([k, p]) => rootTree(k) && p && typeof p === "object" && !skip.has(k));
    const nm = join(root, dir, "node_modules");
    if (!isDir(nm)) {
      out.push(want.length ? row(LEVEL, `${f}: node_modules/ missing (${pkgs(want.length)} to install)`, fix) : row("PASS", `${f}: no packages to install`));
      continue;
    }
    const installed = readLock(join(nm, ".package-lock.json"));
    const hidden = installed === "missing" ? null : installed;
    if (!hidden || !hidden.ok || (hidden.version !== 2 && hidden.version !== 3)) {
      if (!want.length && !hidden) {
        out.push(row("PASS", `${f}: no packages to install`));
        continue;
      }
      const why = !hidden ? "no node_modules/.package-lock.json" : !hidden.ok ? `node_modules/.package-lock.json is ${hidden.why}` : `node_modules/.package-lock.json has lockfileVersion ${String(hidden.version)}`;
      out.push(row("WARN", `${f}: cannot verify node_modules (${why}; it is written by npm 7 or later)`, fix));
      continue;
    }
    const diffs: [string, string][] = [];
    const optional: string[] = [];
    for (const [k, p] of want) {
      const h = hidden.packages[k];
      const name = label(k);
      if (p.link) {
        if (!h || !existsSync(join(root, dir, k))) diffs.push([k, `workspace link ${name} missing`]);
        continue;
      }
      if (!h) {
        if (p.optional || p.devOptional) optional.push(name);
        else if (p.inBundle) continue; // installed inside its parent's tarball
        else diffs.push([k, p.dev ? `dev package ${name} not installed (an install with --omit=dev? npm ci installs dev packages)` : `${name} not installed`]);
      } else if (!same(p.version, h.version)) diffs.push([k, `${name} is ${String(h.version ?? "unversioned")}, the lockfile wants ${String(p.version ?? "none")}`]);
      else if (!same(p.integrity, h.integrity)) diffs.push([k, `${name}${p.version ? ` ${p.version}` : ""} integrity differs from the lockfile`]);
    }
    for (const k of Object.keys(hidden.packages)) if (rootTree(k) && !Object.hasOwn(r.packages, k)) diffs.push([k, `${label(k)} is installed but not in the lockfile`]);
    diffs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (diffs.length) {
      const more = diffs.length > 1 ? ` (and ${diffs.length - 1} more)` : "";
      out.push(row(LEVEL, `${f}: ${diffs[0]![1]}${more}`, fix));
    } else if (optional.length) {
      const more = optional.length > 1 ? ` (and ${optional.length - 1} more)` : "";
      out.push(row("WARN", `${f}: optional package ${optional.sort()[0]} not installed${more}; npm skips an optional package whose install failed`, `${fix}, and read its output for the optional package's error`));
    } else out.push(row("PASS", `${f}: node_modules matches (${pkgs(want.length)})`));
  }
  if (!out.length) out.push(row("INFO", locks.length && !compared ? "every tracked package-lock.json is a workspace member's; none compared" : "no tracked package-lock.json to compare"));
  return out;
}
