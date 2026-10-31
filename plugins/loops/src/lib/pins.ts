// Version pins for `loops env-check`: read one tool's version out of the files that pin it, then
// compare them. A configured source that cannot be read or parsed throws PinError (reported as a
// FAIL by the caller), never a pass.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { compileGlob, isGlob } from "./glob.js";

export class PinError extends Error {}
export interface PinValue {
  src: string;
  v: string;
  /** A lower bound (package.json engines), not a pinned version. */
  floor: boolean;
}
type Found = { v: string; floor?: boolean }[];
type Parser = (text: string, tool: string, root: string) => Found;

export const ver = (s: string): string | null => /(\d+(?:\.\d+){0,2})/.exec(s)?.[1] ?? null;
const hit = (s: string | undefined | null, floor = false): Found => {
  const v = s ? ver(s) : null;
  return v ? [{ v, floor }] : [];
};
const ALIAS: Record<string, string[]> = { node: ["node", "nodejs"] };
const IMAGE: Record<string, string> = { go: "golang" };

const toolVersions: Parser = (text, tool) => {
  for (const line of text.split("\n")) {
    const m = /^\s*(\S+)\s+(\S+)/.exec(line);
    if (m && (ALIAS[tool] ?? [tool]).includes(m[1]!)) return hit(m[2]);
  }
  return [];
};
const plain: Parser = (text) => {
  const v = ver(text.trim().replace(/^v/, ""));
  if (!v) throw new PinError(`no version in "${text.trim().slice(0, 30)}"`);
  return [{ v }];
};
const goMod: Parser = (text, tool) =>
  tool !== "go" ? [] : hit(/^toolchain\s+go(\S+)/m.exec(text)?.[1] ?? /^go\s+(\S+)/m.exec(text)?.[1]);
const engines: Parser = (text, tool) => {
  try {
    const e = (JSON.parse(text) as { engines?: Record<string, unknown> }).engines?.[tool];
    return typeof e === "string" ? hit(e, true) : [];
  } catch {
    throw new PinError("not valid JSON");
  }
};
const dockerfile: Parser = (text, tool) => {
  const out: Found = [];
  for (const m of text.matchAll(/^FROM\s+(?:--\S+\s+)?(\S+)/gim)) {
    const [name = "", tag = ""] = m[1]!.split(":");
    if (name.split("/").pop() === (IMAGE[tool] ?? tool)) out.push(...hit(tag));
  }
  const arg = new RegExp(`^ARG\\s+${tool.toUpperCase().replace(/\W/g, "_")}_VERSION=(\\S+)`, "gim");
  for (const m of text.matchAll(arg)) out.push(...hit(m[1]));
  return out;
};

/** `-file` inputs of the setup-* actions point at one of the simple version files. */
function byName(file: string): Parser {
  const b = basename(file);
  return b === "go.mod" ? goMod : b === ".tool-versions" ? toolVersions : plain;
}

/** Workflow actions whose `with:` input pins a tool: kind -> [action, tool, input key]. */
const ACTIONS = {
  "setup-go": ["actions/setup-go", "go", "go-version"],
  "setup-node": ["actions/setup-node", "node", "node-version"],
  "setup-python": ["actions/setup-python", "python", "python-version"],
  "golangci-action": ["golangci/golangci-lint-action", "golangci-lint", "version"],
  "goreleaser-action": ["goreleaser/goreleaser-action", "goreleaser", "version"],
} as const;
function setup(kind: keyof typeof ACTIONS): Parser {
  const [action, forTool, key] = ACTIONS[kind];
  return (text, tool, root) => {
    if (tool !== forTool) return [];
    const lines = text.split("\n");
    const out: Found = [];
    lines.forEach((line, i) => {
      const m = new RegExp(`^(\\s*)(-\\s+)?uses:\\s*${action}@`).exec(line);
      if (!m) return;
      const keyIndent = m[1]!.length + (m[2]?.length ?? 0);
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]!;
        if (l.trim() && l.length - l.trimStart().length < keyIndent) break;
        const kv = new RegExp(`^\\s*(${key}(-file)?):\\s*(.+?)\\s*(?:#.*)?$`).exec(l);
        if (!kv || /\$\{\{|\[/.test(kv[3]!)) continue;
        const val = kv[3]!.replace(/^["']|["']$/g, "");
        if (!kv[2]) out.push(...hit(val));
        else if (existsSync(join(root, val))) out.push(...byName(val)(readFileSync(join(root, val), "utf8"), tool, root));
        else throw new PinError(`${key}-file ${val} not found`);
      }
    });
    return out;
  };
}

const KINDS: Record<string, { file: string; parse: Parser }> = {
  "tool-versions": { file: ".tool-versions", parse: toolVersions },
  nvmrc: { file: ".nvmrc", parse: plain },
  "node-version": { file: ".node-version", parse: plain },
  "python-version": { file: ".python-version", parse: plain },
  "go-mod": { file: "go.mod", parse: goMod },
  engines: { file: "package.json", parse: engines },
  dockerfile: { file: "Dockerfile", parse: dockerfile },
  "setup-go": { file: ".github/workflows/*.yml", parse: setup("setup-go") },
  "setup-node": { file: ".github/workflows/*.yml", parse: setup("setup-node") },
  "setup-python": { file: ".github/workflows/*.yml", parse: setup("setup-python") },
  "golangci-action": { file: ".github/workflows/*.yml", parse: setup("golangci-action") },
  "goreleaser-action": { file: ".github/workflows/*.yml", parse: setup("goreleaser-action") },
};

export const splitSource = (spec: string): [string, string | undefined] => {
  const i = spec.indexOf(":");
  return i < 0 ? [spec, undefined] : [spec.slice(0, i), spec.slice(i + 1)];
};
export const isSourceKind = (spec: string): boolean => splitSource(spec)[0] in KINDS;

/** Read `spec` (`kind` or `kind:path-or-glob`) for `tool`; `tracked` is `git ls-files`. */
export function readSource(root: string, tracked: string[], tool: string, spec: string): PinValue[] {
  const [kind, path] = splitSource(spec);
  const k = KINDS[kind]!;
  const target = path ?? k.file;
  const files = isGlob(target) ? tracked.filter((f) => compileGlob(target).some((re) => re.test(f))) : [target];
  if (!files.length) throw new PinError(`${spec}: no file matches ${target}`);
  const out: PinValue[] = [];
  for (const f of files) {
    if (!existsSync(join(root, f))) throw new PinError(`${spec}: ${f} not found`);
    try {
      for (const x of k.parse(readFileSync(join(root, f), "utf8"), tool, root)) out.push({ src: `${kind}:${f}`, v: x.v, floor: x.floor ?? false });
    } catch (e) {
      throw new PinError(`${spec}: ${f}: ${(e as Error).message}`);
    }
  }
  if (!out.length) throw new PinError(`${spec}: no ${tool} version found in ${files.length === 1 ? files[0] : `${files.length} files`}`);
  return out;
}

export type Compare = "exact" | "minor" | "major" | "floor";
const DEPTH = { exact: 3, minor: 2, major: 1, floor: 3 };

/** Compare on the components both versions state (so `1.26` equals `1.26.1` under exact), up to `depth`. */
export function cmp(a: string, b: string, depth = 3): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.min(depth, x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}
const maxFloor = (vals: PinValue[]): string | null => vals.filter((x) => x.floor).map((x) => x.v).sort((a, b) => cmp(b, a))[0] ?? null;

/** The version a pin stands for: the highest floor in floor mode, else the first source's. */
export const pinOf = (vals: PinValue[], mode: Compare): string => (mode === "floor" ? maxFloor(vals) ?? vals[0]!.v : vals[0]!.v);

/** Why the sources disagree, or null when they agree. */
export function disagreement(vals: PinValue[], mode: Compare): string | null {
  if (mode === "floor") {
    const fl = maxFloor(vals);
    if (fl === null) return "compare = floor needs a floor source (engines)";
    const bad = vals.filter((x) => !x.floor && cmp(x.v, fl) < 0);
    return bad.length ? bad.map((x) => `${x.src}=${x.v}`).join(", ") + ` below the floor ${fl}` : null;
  }
  const ref = vals[0]!;
  const bad = vals.filter((x) => cmp(x.v, ref.v, DEPTH[mode]) !== 0);
  return bad.length ? vals.map((x) => `${x.src}=${x.v}`).join(", ") + ` disagree (${mode})` : null;
}

/** Does a local toolchain version satisfy the pin? */
export const localOk = (local: string, pin: string, mode: Compare): boolean =>
  mode === "floor" ? cmp(local, pin) >= 0 : cmp(local, pin, DEPTH[mode]) === 0;
