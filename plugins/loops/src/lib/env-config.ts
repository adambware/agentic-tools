// `.loops/env-check.toml`: parse and strictly validate (unknown keys, wrong types and unsupported
// schema versions are UsageErrors, exit 2).
import { isAbsolute, normalize } from "node:path";
import { parse } from "smol-toml";
import { UsageError } from "./proc.js";
import { isSourceKind, type Compare } from "./pins.js";
import { VERSION } from "./version.js";

export interface Pin {
  tool: string;
  sources: string[];
  /** Sources (as written in sources) read when present and skipped when absent (0.8.0); a subset of sources. */
  optional: string[];
  compare: Compare;
  /** The a.local level for a version that differs first in each component (0.8.0); a probe failure uses major. */
  local: Record<Part, Severity>;
  /** "check" compares the pin against each range a source yields (0.8.0); "info" reports the range only. */
  range: "check" | "info";
}
export type Severity = "fail" | "warn" | "info" | "off";
export type Part = "major" | "minor" | "patch";
export interface LocalCheck {
  id: string;
  run: string;
  static: boolean;
  timeoutS: number;
  /** timeoutS in whole milliseconds, rounded once so float error (16.1 * 1000) cannot leak into the spawn timeout. */
  timeoutMs: number;
}
export interface Config {
  sharedHint: string | null;
  pins: Pin[];
  harness: { tools: string[]; files: string[]; entrypoints: string[] | "auto"; tracked: boolean; sparse: boolean };
  /** null when the config has no [compose] table: no e.* checks run. */
  compose: { mode: "none" | "test"; files: string[]; inputs: string[]; containers: "fail" | "warn"; derive: "slug-hash" | "dirname"; allowContainerName: string[]; mainProject: string | null; mainFiles: string[] | null } | null;
  locals: LocalCheck[];
}

type T = Record<string, unknown>;
function table(v: unknown, where: string, allowed: string[]): T {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new UsageError(`${where} must be a table`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new UsageError(`${where}: unknown key "${k}" (a key from a newer loops needs a newer engine: update agentic-tools, and set engine = ">=0.8.0" or the version that added it, so an older engine says so)`);
  return v as T;
}
function pick<V>(t: T, k: string, where: string, ok: (v: unknown) => v is V, what: string, def?: V): V {
  const v = t[k];
  if (v === undefined) {
    if (def === undefined) throw new UsageError(`${where}: missing ${k}`);
    return def;
  }
  if (!ok(v)) throw new UsageError(`${where}: ${k} must be ${what}`);
  return v;
}
const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "");
const isNonEmptyStrs = (v: unknown): v is string[] => isStrs(v) && v.length > 0;
/** What Compose takes for -p: lowercase letters, digits, `-` and `_`, a letter or digit first. */
const isProjectName = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(v);
const oneOf =
  <S extends string>(...opts: S[]) =>
  (v: unknown): v is S =>
    typeof v === "string" && (opts as string[]).includes(v);
const list = (v: unknown, where: string): unknown[] => {
  if (!Array.isArray(v)) throw new UsageError(`${where} must be an array of tables`);
  return v;
};

/** `local`: "fail" | "warn" | "off" sets every component; a { major, minor, patch } table sets each (missing: warn). */
function localOf(v: unknown, where: string): Pin["local"] {
  const all = (s: Severity) => ({ major: s, minor: s, patch: s });
  if (v === undefined || typeof v === "string") return all(pick({ local: v }, "local", where, oneOf<Severity>("fail", "warn", "off"), 'fail|warn|off or a { major, minor, patch } table', "warn"));
  const t = table(v, `${where}: local`, ["major", "minor", "patch"]);
  const part = (k: Part): Severity => {
    const s = t[k] ?? "warn";
    if (!oneOf<Severity>("fail", "warn", "info", "off")(s)) throw new UsageError(`${where}: local.${k} must be fail|warn|info|off`);
    return s;
  };
  return { major: part("major"), minor: part("minor"), patch: part("patch") };
}

/** `>=X.Y.Z` is the only range form; anything else is a config error. */
function checkEngine(range: string): void {
  const m = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) throw new UsageError(`engine must look like ">=0.4.0", found "${range}"`);
  const want = m.slice(1).map(Number);
  const have = VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] !== want[i]) {
      if (have[i]! < want[i]!) throw new UsageError(`config needs loops ${range}, this is ${VERSION}; update agentic-tools (stable checkout: git pull; CI: bump the action's pinned SHA)`);
      return;
    }
  }
}

export function parseConfig(text: string, file: string): Config {
  let raw: T;
  try {
    raw = parse(text) as T;
  } catch (e) {
    throw new UsageError(`${file}: ${(e as Error).message.split("\n")[0]}`);
  }
  const top = table(raw, file, ["schema_version", "engine", "shared_checkout", "pins", "harness", "compose", "local"]);
  if (top.schema_version !== 1) {
    const what = top.schema_version === undefined ? "is missing" : `${String(top.schema_version)} is unsupported by loops ${VERSION}`;
    throw new UsageError(`${file}: schema_version ${what} (want 1)`);
  }
  if (top.engine !== undefined) checkEngine(pick(top, "engine", "engine", isStr, "a string"));

  const shared = top.shared_checkout === undefined ? null : table(top.shared_checkout, "[shared_checkout]", ["hint"]);
  const sharedHint = shared && pick(shared, "hint", "[shared_checkout]", isStr, "a string", "use a git worktree");

  const pins = list(top.pins ?? [], "[[pins]]").map((p, i): Pin => {
    const where = `[[pins]] #${i + 1}`;
    const t = table(p, where, ["tool", "sources", "optional", "compare", "local", "range"]);
    const sources = pick(t, "sources", where, isStrs, "a list of strings");
    for (const s of sources) if (!isSourceKind(s)) throw new UsageError(`${where}: unknown source kind in "${s}"`);
    if (!sources.length) throw new UsageError(`${where}: sources is empty`);
    const optional = pick(t, "optional", where, isStrs, "a list of strings", []);
    for (const s of optional) if (!sources.includes(s)) throw new UsageError(`${where}: optional "${s}" is not in sources (list a source exactly as written there)`);
    if (t.compare === "floor")
      throw new UsageError(`${where}: compare = floor was removed in loops 0.6.0: compare no longer reads ranges; use exact, minor or major, and set range = "check" (0.8.0) to check the pin against each range`);
    return {
      tool: pick(t, "tool", where, isStr, "a string"),
      sources,
      optional,
      compare: pick(t, "compare", where, oneOf<Compare>("exact", "minor", "major"), "exact|minor|major", "exact"),
      local: localOf(t.local, where),
      range: pick(t, "range", where, oneOf<"check" | "info">("check", "info"), "check|info", "info"),
    };
  });

  const h = table(top.harness ?? {}, "[harness]", ["tools", "files", "entrypoints", "tracked", "sparse"]);
  const isEntry = (v: unknown): v is string[] | "auto" => v === "auto" || isStrs(v);
  const harness = {
    tools: pick(h, "tools", "[harness]", isStrs, "a list of strings", []),
    files: pick(h, "files", "[harness]", isStrs, "a list of strings", []),
    entrypoints: pick(h, "entrypoints", "[harness]", isEntry, '"auto" or a list of paths', []),
    tracked: pick(h, "tracked", "[harness]", isBool, "a boolean", false),
    sparse: pick(h, "sparse", "[harness]", oneOf("warn", "off"), "warn|off", "off") === "warn",
  };

  const c = table(top.compose ?? {}, "[compose]", ["mode", "files", "inputs", "containers", "derive", "allow_container_name", "main_project", "main_files"]);
  const compose = top.compose === undefined ? null : {
    mode: pick(c, "mode", "[compose]", oneOf<"none" | "test">("none", "test"), "none|test", "none"),
    files: pick(c, "files", "[compose]", isStrs, "a list of strings", []),
    inputs: pick(c, "inputs", "[compose]", isStrs, "a list of globs", []),
    containers: pick(c, "containers", "[compose]", oneOf<"fail" | "warn">("fail", "warn"), "fail|warn", "fail"),
    derive: pick(c, "derive", "[compose]", oneOf<"slug-hash" | "dirname">("slug-hash", "dirname"), "slug-hash|dirname", "dirname"),
    allowContainerName: pick(c, "allow_container_name", "[compose]", isStrs, "a list of strings", []),
    // The `-p` name the repo's wrappers give the main checkout (0.8.0): Compose's project-name form, as -p takes it.
    mainProject: c.main_project === undefined ? null : pick(c, "main_project", "[compose]", isProjectName, "a Compose project name (lowercase letters, digits, - and _, starting with a letter or digit)"),
    // The main checkout's file set (0.8.0); null: the main checkout uses files.
    mainFiles: c.main_files === undefined ? null : pick(c, "main_files", "[compose]", isNonEmptyStrs, "a non-empty list of strings"),
  };
  if (compose?.mode === "test" && !compose.files.length) throw new UsageError("[compose]: mode test needs files");

  const seen = new Set<string>();
  const locals = list(top.local ?? [], "[[local]]").map((l, i): LocalCheck => {
    const where = `[[local]] #${i + 1}`;
    const t = table(l, where, ["id", "run", "static", "timeout_s"]);
    const id = pick(t, "id", where, isStr, "a string");
    if (!/^[a-ex]\.[\w.-]+$/.test(id)) throw new UsageError(`${where}: id "${id}" must look like <a-e or x>.<name>`);
    if (id === "x.none") throw new UsageError(`${where}: id x.none is reserved for env-check's own "no check ran" row`);
    if (seen.has(id)) throw new UsageError(`${where}: duplicate id ${id}`);
    seen.add(id);
    const timeoutS = pick(t, "timeout_s", where, (v): v is number => typeof v === "number" && v >= 0.001 && Number.isSafeInteger(Math.round(v * 1000)), "a positive number of seconds (at least 0.001)", 15);
    const timeoutMs = Math.round(timeoutS * 1000);
    const run = pick(t, "run", where, isStr, "a path");
    if (isAbsolute(run) || /^\.\.(\/|$)/.test(normalize(run))) throw new UsageError(`${where}: run "${run}" must be a repo-relative path`);
    return { id, run, static: pick(t, "static", where, isBool, "a boolean", false), timeoutS, timeoutMs };
  });
  return { sharedHint, pins, harness, compose, locals };
}
