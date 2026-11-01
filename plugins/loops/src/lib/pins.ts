// Version pins for `loops env-check`: read one tool's version out of the files that pin it, then
// compare them. A configured source that cannot be read or parsed throws PinError (reported as a
// FAIL by the caller), never a pass.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, visit, type Node, type YAMLMap } from "yaml";
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

/** The first version in `s`, keeping a prerelease suffix (`22.0.0-rc.1`, `-beta-30`, `3.13.0rc1`, `1.26rc1`, `3.14.0.dev0`).
 * Only known prerelease shapes count, so an image variant (`-alpine`, `-slim-bookworm`), a patchlevel (`3.1.4p223`), a
 * build id or a vendor suffix (`-desktop.1`) ends the version. */
const VER = /(\d+(?:\.\d+){0,2}(?:-(?:alpha|beta|rc|preview|pre|dev|next|nightly|canary|snapshot|ea)(?![a-z])(?:[.-]?\d[0-9a-z]*)*|\.?(?:alpha|beta|preview|pre|dev|rc|a|b|c)\d+(?:\.\d+)*)?)/i;
export const ver = (s: string): string | null => VER.exec(s)?.[1]?.replace(/[.-]+$/, "") ?? null;
/** `1.26.1-rc.1` -> core [1, 26, 1] and prerelease "rc.1" ("" for a release). */
const split = (v: string): [number[], string] => {
  const m = /^(\d+(?:\.\d+)*)-?(.*)$/.exec(v);
  return m ? [m[1]!.split(".").map(Number), m[2]!] : [[NaN], v];
};
/** A prerelease sorts below its release; two prereleases compare by their numeric-aware identifiers. */
const preCmp = (p: string, q: string): number =>
  p === q ? 0 : !p ? 1 : !q ? -1 : Math.sign(p.localeCompare(q, "en", { numeric: true })) || (p < q ? -1 : 1);
/** A value that starts with a version; one that starts with a word (`pypy3.9`, `lts/-1`, `alpine3.20`) names no version. */
const hit = (s: string | undefined | null): Found => {
  const v = s && /^v?\d/i.test(s) ? ver(s) : null;
  return v ? [{ v }] : [];
};
const ALIAS: Record<string, string[]> = { node: ["node", "nodejs"], go: ["go", "golang"] };
const IMAGE: Record<string, string> = { go: "golang" };

/** Every line naming the tool or an alias, so `golang` and `go` lines that conflict are both seen. */
const toolVersions: Parser = (text, tool) => {
  const out: Found = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\S+)\s+(\S+)/.exec(line);
    if (m && (Object.hasOwn(ALIAS, tool) ? ALIAS[tool]! : [tool]).includes(m[1]!)) out.push(...hit(m[2]));
  }
  return out;
};
/** A version spec as the series it installs: `1.26`, `v1.26.1`, `1.26.x`, `~1.26`, `~> v2`, `^1`. A range wider than its
 * stated components (`>=1.20`, `^1.20`, `~1.20.3`, `20 || 22`) installs some newer version, so it is no pin. */
const spec = (raw: string, tool: string, label = ""): Found => {
  const s = tool === "node" ? raw.replace(/^=\s*(?=v?\d)/, "") : raw; // node-semver's `=20.11.1` is `20.11.1`
  const t = /^(~>?|\^)\s*v?(\d+(?:\.\d+)?)(?:\.[xX*])?$/.exec(s);
  if (t && !(t[1] === "^" && t[2]!.includes("."))) return hit(t[2]);
  const range = () => new PinError(`${label}"${raw}" is a range, not a pinned version`);
  if (/^[<>=~^!]/.test(s) && ver(s)) throw range();
  const h = hit(s);
  if (h.length && /[<>=~^!|,*\s]/.test(s.replace(/(?:\.[xX*])+$/, ""))) throw range();
  return h;
};
/** The first line that is not blank or a comment, with a trailing `# comment` dropped as nvm does (`.python-version` may
 * list several versions). */
const plain: Parser = (text, tool) => {
  const line = text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).find((l) => l) ?? "";
  const found = spec(line, tool);
  if (!found.length) throw new PinError(`no version in "${line.slice(0, 30)}"`);
  return found;
};
const goMod: Parser = (text, tool) =>
  tool !== "go" ? [] : hit(/^toolchain\s+go(\S+)/m.exec(text)?.[1] ?? /^go\s+(\S+)/m.exec(text)?.[1]);
type Pkg = { engines?: Record<string, unknown>; volta?: Record<string, unknown> };
const pkg = (text: string): Pkg => {
  try {
    return JSON.parse(text) as Pkg;
  } catch {
    throw new PinError("not valid JSON");
  }
};
/** Zero-padded total order for floors: `20` is `20.0.0`, below `20.11.0` (unlike `cmp`, which treats them as equal). */
const fcmp = (a: string, b: string): number => {
  const [x, p] = split(a);
  const [y, q] = split(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return preCmp(p, q);
};
/** The lowest version satisfying `>v` (semver x-ranges): bump the last stated component, zero the rest (`20.11.0` -> `20.11.1`, `20.11` -> `20.12.0`, `20` -> `21.0.0`). */
const above = (v: string): string => {
  const p = v.split(".").map(Number);
  p[p.length - 1]!++;
  while (p.length < 3) p.push(0);
  return p.join(".");
};
/** The immediate successor of a prerelease (`20.0.0-rc.1` -> `20.0.0-rc.1.0`, `3.13.0rc1` -> `3.13.0rc1.0`): the floor
 * of an exclusive prerelease bound, which admits the next prerelease (`rc.2`) but not the bound itself. */
const after = (v: string): string => `${v}.0`;
/** The lowest lower bound of an npm range (`>=18 <21`, `^18 || ^20`): the strongest bound within each `||` alternative, the weakest across them; `<20` alone has none. */
function lowerBound(expr: string, tool: string): string {
  const lows = expr.split("||").map((alt) => {
    const bounds: string[] = [];
    for (const m of alt.replace(/\s-\s+v?[\d.xX*]+(?:[-+][\w.-]+)?/g, "").matchAll(/(<=?|>=?|\^|~>?|=)?\s*v?(\d+(?:\.(?:\d+|[xX*]))*)([-+][\w.-]+)?/g)) {
      const v = m[1]?.startsWith("<") ? null : ver(m[2]!);
      const pre = m[3]?.startsWith("-") ? m[3] : ""; // ver() would drop `-0`; build metadata is not a prerelease
      if (v) bounds.push(m[1] !== ">" ? v + pre : pre ? after(v + pre) : above(v));
    }
    if (!bounds.length) throw new PinError(`engines.${tool} "${expr}" has no lower bound`);
    return bounds.sort(fcmp).at(-1)!;
  });
  return lows.sort(fcmp)[0]!;
}
/** The lower bound of a PEP 440 specifier set (`>=3.10, !=3.11.*, <4`): the strongest of its clauses. */
function pyLowerBound(expr: string): string | null {
  const bounds: string[] = [];
  for (const clause of expr.split(",")) {
    const m = /^\s*(===?|~=|>=?)\s*v?(\d\S*)/.exec(clause);
    const v = m ? ver(m[2]!) : null;
    if (!v) continue;
    const [core, pre] = split(v);
    // PEP 440 has no x-ranges: >3.9 admits 3.9.1, and >3.13.0rc1 admits 3.13.0rc2.
    bounds.push(m![1] !== ">" ? v : pre ? after(v) : above(core.concat(0, 0).slice(0, 3).join(".")));
  }
  return bounds.sort(fcmp).at(-1) ?? null;
}
/** A Poetry constraint's lower bound: the lowest across `||`; within one, clauses split on `,` or a space, and `^X`,
 * `~X` and a bare `X` (or `X.*`) all start at X. */
function poetryLowerBound(expr: string): string {
  const lows = expr.split("||").map((alt) => {
    const clauses = alt.trim().split(/\s*,\s*|(?<![<>=!~^])\s+/).map((c) => c.replace(/^[\^~](?!=)\s*/, ">=").replace(/^(?=v?\d)/, "=="));
    const v = pyLowerBound(clauses.join(","));
    if (!v) throw new PinError(`tool.poetry.dependencies.python "${expr}" has no lower bound`);
    return v;
  });
  return lows.sort(fcmp)[0]!;
}
const toml = (text: string): Record<string, unknown> => {
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch (e) {
    throw new PinError(`not valid TOML: ${(e as Error).message.split("\n")[0]}`);
  }
};
const table = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
/** `python-version-file: pyproject.toml`, read as setup-python reads it: `[project] requires-python` when there is a
 * `[project]` table, else `[tool.poetry.dependencies] python`; its lower bound is a floor. */
const pyproject: Parser = (text) => {
  const doc = toml(text);
  if ("project" in doc) {
    const rp = table(doc.project)?.["requires-python"];
    if (rp === undefined) throw new PinError("no project.requires-python");
    if (typeof rp !== "string") throw new PinError("requires-python is not a string");
    const v = pyLowerBound(rp);
    if (!v) throw new PinError(`requires-python "${rp}" has no lower bound`);
    return [{ v, floor: true }];
  }
  const py = table(table(table(doc.tool)?.poetry)?.dependencies)?.python;
  if (py === undefined) throw new PinError("no project.requires-python or tool.poetry.dependencies.python");
  if (typeof py !== "string") throw new PinError("tool.poetry.dependencies.python is not a string");
  return [{ v: poetryLowerBound(py), floor: true }];
};
/** `python-version-file: Pipfile` reads `[requires] python_full_version`, else `python_version`, as setup-python does. */
const pipfile: Parser = (text, tool) => {
  const req = table(toml(text).requires);
  const key = req && "python_full_version" in req ? "python_full_version" : "python_version";
  const v = req?.[key];
  if (v === undefined) throw new PinError("no requires.python_version");
  if (typeof v !== "string") throw new PinError(`requires.${key} is not a string`);
  return spec(v.trim(), tool, `requires.${key} `);
};
const engines: Parser = (text, tool) => {
  const e = pkg(text).engines?.[tool];
  return typeof e === "string" ? [{ v: lowerBound(e, tool), floor: true }] : [];
};
/** `node-version-file: package.json` reads `volta.node`, else `engines.node` as a floor. */
const pkgVersion: Parser = (text, tool, root) => {
  const volta = pkg(text).volta?.[tool];
  const out = typeof volta === "string" ? hit(volta) : engines(text, tool, root);
  if (!out.length) throw new PinError(`no volta.${tool} or engines.${tool}`);
  return out;
};
/** In an image tag a bare `-dev` right after the version is the Chainguard/Wolfi dev variant (`20-dev`, `3.12-dev-slim`),
 * not a prerelease; `-dev.1` still is one. */
const imageTag = (t: string): string => t.replace(/^(v?\d+(?:\.\d+)*)-dev(?![.-]?\d)/i, "$1");
const dockerfile: Parser = (text, tool) => {
  const out: Found = [];
  for (const m of text.matchAll(/^FROM\s+(?:--\S+\s+)?(\S+)/gim)) {
    const [name = "", tag = ""] = m[1]!.split("@")[0]!.split("/").pop()!.split(":"); // after the last "/": a registry port is not a tag
    if (name === (IMAGE[tool] ?? tool)) out.push(...hit(imageTag(tag))); // ver() ends the version at "-alpine", "-slim"
  }
  const arg = new RegExp(`^ARG\\s+${tool.toUpperCase().replace(/\W/g, "_")}_VERSION=(\\S+)`, "gim");
  for (const m of text.matchAll(arg)) out.push(...hit(imageTag(m[1]!.replace(/^(["'])(.*)\1$/, "$2")))); // `"20.11.0"` is `20.11.0`
  return out;
};

/** `-file` inputs of the setup-* actions with a format of their own; any other file is read as a plain version file, as
 * the actions read it, so its first line must be a pinned version. */
const BY_NAME: Record<string, Parser> = {
  "go.mod": goMod,
  "go.work": goMod,
  ".tool-versions": toolVersions,
  "package.json": pkgVersion,
  "pyproject.toml": pyproject,
  Pipfile: pipfile,
};
const byName = (file: string): Parser => (Object.hasOwn(BY_NAME, basename(file)) ? BY_NAME[basename(file)]! : plain);

/** Workflow actions whose `with:` input pins a tool: kind -> [action, tool, input key]. */
const ACTIONS = {
  "setup-go": ["actions/setup-go", "go", "go-version"],
  "setup-node": ["actions/setup-node", "node", "node-version"],
  "setup-python": ["actions/setup-python", "python", "python-version"],
  "golangci-action": ["golangci/golangci-lint-action", "golangci-lint", "version"],
  "goreleaser-action": ["goreleaser/goreleaser-action", "goreleaser", "version"],
} as const;
/** Reads every `jobs.*.steps[]` (or a composite action's `runs.steps[]`) step that uses the action, as YAML 1.2 the way
 * Actions does. A workflow that does not parse, an unreadable input, or a `uses:` of the action anywhere else fails. */
function setup(kind: keyof typeof ACTIONS): Parser {
  const [action, forTool, key] = ACTIONS[kind];
  const named = new RegExp(`^${action}@`, "i"); // GitHub resolves action repos case-insensitively
  return (text, tool, root) => {
    if (tool !== forTool) return [];
    const lc = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lc });
    if (doc.errors.length) throw new PinError(`not valid YAML: ${doc.errors[0]!.message.split("\n")[0]}`);
    const line = (n: Node) => `line ${lc.linePos(n.range?.[0] ?? 0).line}`;
    const deref = (n: unknown): unknown => {
      if (!isAlias(n)) return n;
      const r = n.resolve(doc);
      if (!r) throw new PinError(`alias *${n.source} at ${line(n)} has no anchor`);
      return r;
    };
    const keyOf = (n: unknown): string | null => {
      const k = deref(n);
      return isScalar(k) ? String(k.value) : null;
    };
    const uses = (n: unknown) => {
      const v = deref(n);
      return isScalar(v) && typeof v.value === "string" && named.test(v.value.trim());
    };
    /** A scalar input as the action receives it; "" when empty. */
    const scalar = (k: string, n: unknown): string => {
      const v = deref(n) as Node;
      if (!isScalar(v)) throw new PinError(`${k} "${text.slice(v.range![0], v.range![1]).trim()}" is not a literal version at ${line(v)}`);
      if (v.value === null) return "";
      const s = String(v.value);
      if (typeof v.value === "number" && v.source !== s) throw new PinError(`${k}: unquoted ${v.source} reads as ${s}; quote it`);
      if (s.includes("${{")) throw new PinError(`${k} "${s.trim()}" is not a literal version`);
      return s.trim();
    };
    const read = (step: YAMLMap): Found => {
      const w = deref(step.get("with", true));
      if (w === undefined || (isScalar(w) && w.value === null)) return [];
      if (!isMap(w)) throw new PinError(`with: of ${action} at ${line(w as Node)} is not a mapping`);
      const ins: [string, string][] = [];
      for (const p of w.items) {
        const k = keyOf(p.key)?.toLowerCase(); // action inputs are case-insensitive
        if (k === "<<") throw new PinError(`with: of ${action} at ${line(w)} uses a merge key, which Actions does not read`);
        if (k === key || k === `${key}-file`) ins.push([k, scalar(k, p.value)]);
      }
      // An empty input is fine only beside a non-empty one: the action then reads that one.
      if (ins.length && !ins.some(([, v]) => v)) throw new PinError(`${ins[0]![0]} has no value`);
      // The actions use the direct input and ignore `-file` when both are set.
      const used = ins.some(([k, v]) => k === key && v) ? ins.filter(([k]) => k === key) : ins;
      const out: Found = [];
      for (const [k, val] of used) {
        if (!val) continue;
        if (k === key) {
          if (val === "latest") continue;
          for (const l of val.split(/\r?\n/).filter((x) => x.trim())) {
            const h = spec(l.trim(), tool, `${k} `);
            if (!h.length) throw new PinError(`${k} "${l.trim()}" is not a version`);
            out.push(...h);
          }
        } else if (!existsSync(join(root, val))) throw new PinError(`${key}-file ${val} not found`);
        else {
          const found = byName(val)(readFileSync(join(root, val), "utf8"), tool, root);
          if (!found.length) throw new PinError(`${key}-file ${val} has no ${tool} version`);
          out.push(...found);
        }
      }
      return out;
    };
    const lists: unknown[] = [];
    const top = deref(doc.contents);
    if (isMap(top)) {
      const jobs = deref(top.get("jobs", true));
      if (isMap(jobs)) for (const p of jobs.items) {
        const job = deref(p.value);
        if (isMap(job)) lists.push(job.get("steps", true));
      }
      const runs = deref(top.get("runs", true));
      if (isMap(runs)) lists.push(runs.get("steps", true));
    }
    const steps = new Set<unknown>();
    const out: Found = [];
    for (const list of lists.map(deref)) {
      if (!isSeq(list)) continue;
      for (const s of list.items.map(deref)) {
        if (!isMap(s) || steps.has(s) || !uses(s.get("uses", true))) continue;
        steps.add(s);
        out.push(...read(s));
      }
    }
    visit(doc, {
      Pair(_, p, path) {
        if (keyOf(p.key) === "uses" && uses(p.value) && !steps.has(path.at(-1))) throw new PinError(`the ${action} step at ${line(p.value as Node)} cannot be read`);
      },
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
  "setup-go": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-go") },
  "setup-node": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-node") },
  "setup-python": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-python") },
  "golangci-action": { file: ".github/workflows/*.{yml,yaml}", parse: setup("golangci-action") },
  "goreleaser-action": { file: ".github/workflows/*.{yml,yaml}", parse: setup("goreleaser-action") },
};

export const splitSource = (spec: string): [string, string | undefined] => {
  const i = spec.indexOf(":");
  return i < 0 ? [spec, undefined] : [spec.slice(0, i), spec.slice(i + 1)];
};
export const isSourceKind = (spec: string): boolean => Object.hasOwn(KINDS, splitSource(spec)[0]);

/** Read `spec` (`kind` or `kind:path-or-glob`) for `tool`; `tracked` is `git ls-files`. */
export function readSource(root: string, tracked: string[], tool: string, spec: string): PinValue[] {
  const [kind, path] = splitSource(spec);
  const k = KINDS[kind]!;
  const target = path ?? k.file;
  const res = isGlob(target) ? compileGlob(target) : null;
  const files = res ? tracked.filter((f) => res.some((re) => re.test(f))) : [target];
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

/** Compare on the components both versions state (so `1.26` equals `1.26.1` under exact), up to `depth`. A prerelease
 * counts once `depth` reaches its last component: `22.0.0-rc.1` differs from `22.0.0` and `22` under exact, not minor. */
export function cmp(a: string, b: string, depth = 3): number {
  const [x, p] = split(a);
  const [y, q] = split(b);
  for (let i = 0; i < Math.min(depth, x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return (p && depth >= x.length) || (q && depth >= y.length) ? preCmp(p, q) : 0;
}
const maxFloor = (vals: PinValue[]): string | null => vals.filter((x) => x.floor).map((x) => x.v).sort((a, b) => fcmp(b, a))[0] ?? null;

const parts = (v: string): number => split(v)[0].length;
/** The version a pin stands for: the highest floor in floor mode, else the most specific source's (first on a tie). */
export const pinOf = (vals: PinValue[], mode: Compare): string =>
  mode === "floor" ? maxFloor(vals) ?? vals[0]!.v : pinned(vals).reduce((a, b) => (parts(b.v) > parts(a.v) ? b : a)).v;
/** Pinned versions win over floors: a lower bound never becomes the exact pin. */
const pinned = (vals: PinValue[]): PinValue[] => (vals.some((x) => !x.floor) ? vals.filter((x) => !x.floor) : vals);

/** Why the sources disagree, or null when they agree. */
export function disagreement(vals: PinValue[], mode: Compare): string | null {
  if (mode === "floor") {
    const fl = maxFloor(vals);
    if (fl === null) return "compare = floor needs a floor source (engines)";
    const bad = vals.filter((x) => !x.floor && cmp(x.v, fl) < 0);
    return bad.length ? bad.map((x) => `${x.src}=${x.v}`).join(", ") + ` below the floor ${fl}` : null;
  }
  // Exact pins are compared pairwise (floors only when no exact pin exists); a range floor next to exact pins only
  // bounds them from below, judged like floor mode so a partial pin (`20`) meets a floor in the series it names.
  const pins = pinned(vals);
  const bad = pins.some((x, i) => pins.slice(i + 1).some((y) => cmp(x.v, y.v, DEPTH[mode]) !== 0));
  if (bad) return pins.map((x) => `${x.src}=${x.v}`).join(", ") + ` disagree (${mode})`;
  const fl = maxFloor(vals);
  const under = fl === null ? [] : pins.filter((x) => !x.floor && cmp(x.v, fl) < 0);
  return under.length ? under.map((x) => `${x.src}=${x.v}`).join(", ") + ` below the floor ${fl}` : null;
}

/** Does a local toolchain version satisfy the pin? */
/** The floor a local version is under, if any: a pinned source never waives an engines floor. */
export const belowFloor = (local: string, vals: PinValue[]): string | null => {
  const fl = maxFloor(vals);
  return fl !== null && fcmp(local, fl) < 0 ? fl : null;
};

export const localOk = (local: string, pin: string, mode: Compare): boolean =>
  mode === "floor" ? cmp(local, pin) >= 0 : cmp(local, pin, DEPTH[mode]) === 0;
