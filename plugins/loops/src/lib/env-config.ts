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
  compare: Compare;
  local: "fail" | "warn" | "off";
}
export interface LocalCheck {
  id: string;
  run: string;
  static: boolean;
  timeoutS: number;
}
export interface Config {
  sharedHint: string | null;
  pins: Pin[];
  harness: { tools: string[]; files: string[]; entrypoints: string[] | "auto"; tracked: boolean; sparse: boolean };
  /** null when the config has no [compose] table: no e.* checks run. */
  compose: { mode: "none" | "test"; files: string[]; inputs: string[]; containers: "fail" | "warn"; derive: "slug-hash" | "dirname"; allowContainerName: string[] } | null;
  locals: LocalCheck[];
}

type T = Record<string, unknown>;
function table(v: unknown, where: string, allowed: string[]): T {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new UsageError(`${where} must be a table`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new UsageError(`${where}: unknown key "${k}"`);
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
const oneOf =
  <S extends string>(...opts: S[]) =>
  (v: unknown): v is S =>
    typeof v === "string" && (opts as string[]).includes(v);
const list = (v: unknown, where: string): unknown[] => {
  if (!Array.isArray(v)) throw new UsageError(`${where} must be an array of tables`);
  return v;
};

/** `>=X.Y.Z` is the only range form; anything else is a config error. */
function checkEngine(range: string): void {
  const m = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) throw new UsageError(`engine must look like ">=0.4.0", found "${range}"`);
  const want = m.slice(1).map(Number);
  const have = VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] !== want[i]) {
      if (have[i]! < want[i]!) throw new UsageError(`config needs loops ${range}, this is ${VERSION}; update agentic-tools`);
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
    const t = table(p, where, ["tool", "sources", "compare", "local"]);
    const sources = pick(t, "sources", where, isStrs, "a list of strings");
    for (const s of sources) if (!isSourceKind(s)) throw new UsageError(`${where}: unknown source kind in "${s}"`);
    if (!sources.length) throw new UsageError(`${where}: sources is empty`);
    return {
      tool: pick(t, "tool", where, isStr, "a string"),
      sources,
      compare: pick(t, "compare", where, oneOf<Compare>("exact", "minor", "major", "floor"), "exact|minor|major|floor", "exact"),
      local: pick(t, "local", where, oneOf<Pin["local"]>("fail", "warn", "off"), "fail|warn|off", "warn"),
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

  const c = table(top.compose ?? {}, "[compose]", ["mode", "files", "inputs", "containers", "derive", "allow_container_name"]);
  const compose = top.compose === undefined ? null : {
    mode: pick(c, "mode", "[compose]", oneOf<"none" | "test">("none", "test"), "none|test", "none"),
    files: pick(c, "files", "[compose]", isStrs, "a list of strings", []),
    inputs: pick(c, "inputs", "[compose]", isStrs, "a list of globs", []),
    containers: pick(c, "containers", "[compose]", oneOf<"fail" | "warn">("fail", "warn"), "fail|warn", "fail"),
    derive: pick(c, "derive", "[compose]", oneOf<"slug-hash" | "dirname">("slug-hash", "dirname"), "slug-hash|dirname", "dirname"),
    allowContainerName: pick(c, "allow_container_name", "[compose]", isStrs, "a list of strings", []),
  };
  if (compose?.mode === "test" && !compose.files.length) throw new UsageError("[compose]: mode test needs files");

  const seen = new Set<string>();
  const locals = list(top.local ?? [], "[[local]]").map((l, i): LocalCheck => {
    const where = `[[local]] #${i + 1}`;
    const t = table(l, where, ["id", "run", "static", "timeout_s"]);
    const id = pick(t, "id", where, isStr, "a string");
    if (!/^[a-ex]\.[\w.-]+$/.test(id)) throw new UsageError(`${where}: id "${id}" must look like <a-e or x>.<name>`);
    if (seen.has(id)) throw new UsageError(`${where}: duplicate id ${id}`);
    seen.add(id);
    const timeoutS = pick(t, "timeout_s", where, (v): v is number => typeof v === "number" && v > 0, "a positive number", 15);
    const run = pick(t, "run", where, isStr, "a path");
    if (isAbsolute(run) || /^\.\.(\/|$)/.test(normalize(run))) throw new UsageError(`${where}: run "${run}" must be a repo-relative path`);
    return { id, run, static: pick(t, "static", where, isBool, "a boolean", false), timeoutS };
  });
  return { sharedHint, pins, harness, compose, locals };
}
