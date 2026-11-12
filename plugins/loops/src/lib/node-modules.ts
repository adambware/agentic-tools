// 0.8.0 D2: `d.node_modules`, whether each tracked npm lockfile's packages are what node_modules holds. It compares
// file content only (never an mtime): the lockfile against npm's own record of the install, the hidden lockfile
// `node_modules/.package-lock.json`, on every package record's `version` and `integrity`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { Level, Result } from "./env-checks.js";
import { shQuote } from "./proc.js";

/** What npm filters `os`, `cpu` and `libc` on. `libc` is "glibc", "musl" or null (unknown: filters nothing); only Linux reads it. */
export interface Platform {
  os: string;
  cpu: string;
  libc: string | null;
}

/**
 * This machine's platform, as npm sees it. On Linux the libc is glibc when Node's process report names a glibc runtime
 * (`header.glibcVersionRuntime`, the test npm's own detect-libc makes first), else musl when a `/lib/ld-musl-*` loader
 * exists, else unknown.
 */
export function hostPlatform(): Platform {
  let libc: string | null = null;
  if (process.platform === "linux") {
    const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
    if (header?.glibcVersionRuntime) libc = "glibc";
    else {
      try {
        if (readdirSync("/lib").some((f) => f.startsWith("ld-musl-"))) libc = "musl";
      } catch {
        // no /lib: unknown
      }
    }
  }
  return { os: process.platform, cpu: process.arch, libc };
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

/** Whether npm installs `p` on this platform at all; libc only matters on Linux, and an unknown libc filters nothing. */
export function eligible(p: Pkg, pf: Platform): boolean {
  if (p.os !== undefined && !listOk(pf.os, p.os)) return false;
  if (p.cpu !== undefined && !listOk(pf.cpu, p.cpu)) return false;
  if (p.libc !== undefined && pf.os === "linux" && pf.libc !== null && !listOk(pf.libc, p.libc)) return false;
  return true;
}

type Read = { ok: true; version: unknown; packages: Record<string, Pkg> } | { ok: false; why: string };
function readLock(file: string): Read | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
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

/**
 * One `d.node_modules` row per tracked `package-lock.json` (none inside a node_modules tree or a workspace member of
 * another one): at `level` for a difference, WARN for a missing optional package or a lockfile it cannot verify, INFO for
 * an unsupported lockfileVersion, else PASS.
 */
export function nodeModulesRows(root: string, tracked: string[], level: "fail" | "warn", pf: Platform): Result[] {
  const LEVEL: Level = level === "fail" ? "FAIL" : "WARN";
  const row = (lvl: Level, message: string, fix?: string): Result => ({ level: lvl, id: "d.node_modules", message, fix, source: "builtin" });
  const locks = tracked.filter((f) => (f === "package-lock.json" || f.endsWith("/package-lock.json")) && !f.split("/").includes("node_modules"));
  const read = new Map(locks.map((f) => [f, readLock(join(root, f))]));
  // Workspace members of any lockfile here: their link targets. Only the root lockfile and root node_modules count.
  const members = new Set<string>();
  for (const [f, r] of read) {
    if (!r?.ok) continue;
    for (const p of Object.values(r.packages)) if (p?.link && typeof p.resolved === "string") members.add(normalize(join(dirname(f), p.resolved)));
  }
  const out: Result[] = [];
  for (const f of locks) {
    const dir = dirname(f);
    if (members.has(dir)) continue;
    const fix = dir === "." ? "npm ci" : `(cd ${shQuote(dir)} && npm ci)`;
    const r = read.get(f);
    if (!r) {
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
    const want = Object.entries(r.packages).filter(([k, p]) => rootTree(k) && p && typeof p === "object" && eligible(p, pf));
    const nm = join(root, dir, "node_modules");
    if (!isDir(nm)) {
      out.push(want.length ? row(LEVEL, `${f}: node_modules/ missing (${pkgs(want.length)} to install)`, fix) : row("PASS", `${f}: no packages to install`));
      continue;
    }
    const hidden = readLock(join(nm, ".package-lock.json"));
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
  return out;
}
