// Version pins for `loops env-check`: read one tool's version out of the files that pin it, then
// compare them. Every value a source yields is a pin (compared), a range (reported, never compared)
// or an unsupported form. A configured source that cannot be read or parsed, or holds an unsupported
// form, throws PinError (reported as a FAIL by the caller), never a pass.
import { existsSync, readFileSync } from "node:fs";
import { basename, join, normalize } from "node:path";
import { parse as parseToml } from "smol-toml";
import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, visit, type Node, type YAMLMap } from "yaml";
import { compileGlob, isGlob } from "./glob.js";

export class PinError extends Error {}
export interface PinValue {
  src: string;
  /** The pinned version, or a range's value as written. */
  v: string;
  /** A range (engines, requires-python, a range input): reported, never compared. */
  range: boolean;
}
type Found = { v: string; range?: boolean }[];
/** `file` is the repo-relative file `text` came from, for messages. */
type Parser = (text: string, tool: string, root: string, file: string) => Found;

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
const unsupported = (v: string, file: string, line: number): PinError =>
  new PinError(`unsupported form "${v}" in ${file}:${line}; pin an exact version`);
/** The 1-based line of `text` at `index` (line 1 when the value was not found). */
const lineAt = (text: string, index: number): number => text.slice(0, Math.max(index, 0)).split("\n").length;
/** The whole of `s` as one version or series (`20`, `v1.26.1`, `1.26.x`, `3.13.0rc1`); null for an alias, a word or a
 * version followed by other text (`lts/*`, `pypy3.9`, `20.11.0-custom`). */
const exact = (s: string): string | null => {
  const v = /^v?\d/i.test(s) ? ver(s) : null;
  return v !== null && s.replace(/^v/i, "").replace(/(?:\.[xX*])+$/, "") === v ? v : null;
};
const OP = /^(?:~>|===?|!=|<=|>=|~=|[<>=~^])/;
/** A range is made only of versions: every comparator (split on `||`, `,`, ` - ` and whitespace, an operator joined to
 * its version) is an optional operator and a whole version or series. A word or other text anywhere (`20 latest`,
 * `3.10, pypy`, `^lts20`, `3.11 # old`) makes it no range. */
const isRange = (s: string): boolean => {
  const toks = s.replace(/(~>|===?|!=|<=|>=|~=|[<>=~^])\s+(?=v?\d)/gi, "$1").split(/\s*(?:\|\||,)\s*|\s+-\s+|\s+/);
  return (toks.length > 1 || OP.test(s)) && toks.every((t) => exact(t.replace(OP, "")) !== null);
};
/** A version spec as a pin, the series it installs (`1.26`, `v1.26.1`, `1.26.x`, `~1.26`, `~> v2`, `^1`, node's `=20.11.1`);
 * as a range when it is wider than its stated components (`>=1.20`, `^1.20`, `~1.20.3`, `20 || 22`), kept as written;
 * null for anything else. */
const classify = (raw: string, tool: string): Found[number] | null => {
  const s = tool === "node" ? raw.replace(/^=\s*(?=v?\d)/, "") : raw;
  const t = /^(~>?|\^)\s*v?(\d+(?:\.\d+)?)(?:\.[xX*])?$/.exec(s);
  if (t && !(t[1] === "^" && t[2]!.includes("."))) return { v: t[2]! };
  if (isRange(s)) return { v: raw, range: true };
  const v = exact(s);
  return v === null ? null : { v };
};
/** A pin-only reader's value: a pin by `classify`, else (a range, a word, other text) unsupported at file:line. */
const pinAt = (raw: string, tool: string, file: string, line: number): Found => {
  const f = classify(raw, tool);
  if (!f || f.range) throw unsupported(raw, file, line);
  return [{ v: f.v }];
};
const ALIAS: Record<string, string[]> = { node: ["node", "nodejs"], go: ["go", "golang"] };
const IMAGE: Record<string, string> = { go: "golang" };

/** Every line naming the tool or an alias, so `golang` and `go` lines that conflict are both seen; its first version
 * field is a pin. */
const toolVersions: Parser = (text, tool, _root, file) => {
  const names = Object.hasOwn(ALIAS, tool) ? ALIAS[tool]! : [tool];
  return text.split("\n").flatMap((line, i) => {
    const m = /^\s*(\S+)\s+(\S+)/.exec(line);
    return m && names.includes(m[1]!) ? pinAt(m[2]!, tool, file, i + 1) : [];
  });
};
/** The first line that is not blank or a comment, with a trailing `# comment` dropped as nvm does (`.python-version` may
 * list several versions). A plain version file holds a pin: a range there is a FAIL of its own, and so is a file with no
 * version line (even one of several glob matches). */
const plain: Parser = (text, tool, _root, file) => {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  const i = lines.findIndex((l) => l);
  if (i < 0) throw new PinError(`no version in ${file}`);
  const f = classify(lines[i]!, tool);
  if (f?.range) throw new PinError(`"${lines[i]}" is a range, not a pinned version`);
  if (!f) throw unsupported(lines[i]!, file, i + 1);
  return [f];
};
/** The `toolchain` directive, else `go`: its whole value up to a `//` comment is the pin. */
const goMod: Parser = (text, tool, _root, file) => {
  const m = tool === "go" ? (/^toolchain[ \t]+go([^\r\n]*)/m.exec(text) ?? /^go[ \t]+([^\r\n]*)/m.exec(text)) : null;
  return m ? pinAt(m[1]!.replace(/\/\/.*/, "").trim(), tool, file, lineAt(text, m.index)) : [];
};
type Pkg = { engines?: Record<string, unknown>; volta?: Record<string, unknown> };
const pkg = (text: string): Pkg => {
  try {
    return JSON.parse(text) as Pkg;
  } catch {
    throw new PinError("not valid JSON");
  }
};
/** `engines.<tool>` is always a range, kept as written: even an exact-looking value only constrains. */
const engines: Parser = (text, tool) => {
  const e = pkg(text).engines?.[tool];
  if (e === undefined) return [];
  if (typeof e !== "string") throw new PinError(`engines.${tool} is not a string`);
  return [{ v: e.trim(), range: true }];
};
/** `node-version-file: package.json` reads `volta.node` (a pin), else `engines.node` (a range) only when volta has no
 * `node` key: a volta value that is not a string is a FAIL, never skipped. */
const pkgVersion: Parser = (text, tool, root, file) => {
  const p = pkg(text);
  const volta = p.volta && typeof p.volta === "object" && Object.hasOwn(p.volta, tool) ? p.volta[tool] : undefined;
  if (volta !== undefined && typeof volta !== "string") throw new PinError(`volta.${tool} is not a string`);
  if (volta === undefined) {
    const out = engines(text, tool, root, file);
    if (!out.length) throw new PinError(`no volta.${tool} or engines.${tool}`);
    return out;
  }
  return pinAt(volta.trim(), tool, file, lineAt(text, text.indexOf(JSON.stringify(volta), text.indexOf('"volta"'))));
};
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
 * `[project]` table, else `[tool.poetry.dependencies] python`. Either is a range, kept as written. */
const pyproject: Parser = (text) => {
  const doc = toml(text);
  if ("project" in doc) {
    const rp = table(doc.project)?.["requires-python"];
    if (rp === undefined) throw new PinError("no project.requires-python");
    if (typeof rp !== "string") throw new PinError("requires-python is not a string");
    return [{ v: rp.trim(), range: true }];
  }
  const py = table(table(table(doc.tool)?.poetry)?.dependencies)?.python;
  if (py === undefined) throw new PinError("no project.requires-python or tool.poetry.dependencies.python");
  if (typeof py !== "string") throw new PinError("tool.poetry.dependencies.python is not a string");
  return [{ v: py.trim(), range: true }];
};
/** `python-version-file: Pipfile` reads `[requires] python_full_version`, else `python_version`, as setup-python does. */
const pipfile: Parser = (text, tool, _root, file) => {
  const req = table(toml(text).requires);
  const key = req && "python_full_version" in req ? "python_full_version" : "python_version";
  const v = req?.[key];
  if (v === undefined) throw new PinError("no requires.python_version");
  if (typeof v !== "string") throw new PinError(`requires.${key} is not a string`);
  const f = classify(v.trim(), tool);
  if (!f) throw unsupported(v.trim(), file, lineAt(text, text.search(new RegExp(`^[ \\t]*${key}[ \\t]*=`, "m"))));
  return [f];
};
/** In an image tag a bare `-dev` right after the version is the Chainguard/Wolfi dev variant (`20-dev`, `3.12-dev-slim`),
 * not a prerelease; `-dev.1` still is one. */
const imageTag = (t: string): string => t.replace(/^(v?\d+(?:\.\d+)*)-dev(?![.-]?\d)/i, "$1");
/** A FROM tag that starts with a version, as that version (`20-alpine3.20` is `20`); null for anything else. Before a `$`
 * the version must be complete, ended by a variant separator (`18-${DISTRO}`, `20-alpine${X}`): a `$` that may continue
 * it (`20${X}`, `20.${X}`, `3.13rc${BUILD}`, `22-rc${N}`) leaves it unknown. */
const tagVer = (t: string): string | null => {
  const lit = imageTag(t.split("$")[0]!);
  const v = /^v?\d/i.test(lit) ? ver(lit) : null;
  return v !== null && (!t.includes("$") || /^[-_]/.test(lit.slice(lit.indexOf(v) + v.length))) ? v : null;
};
/** A Dockerfile instruction as Docker reads it: its text and, for each character, the 1-based physical line it is on. */
type Logical = { text: string; lines: number[] };
/** Docker's logical lines: a line ending in `\` continues; a full-line comment is dropped and never continued (inside a
 * continuation it is dropped without ending it), as is an empty line inside a continuation; the body of a RUN, COPY or
 * ADD heredoc (`<<EOF`, `<<-"EOF"`, `<<\EOF`, `<<E"OF"`; not a `<<` inside quotes) is skipped up to its delimiter line.
 * An unterminated heredoc, also on an instruction still open at EOF, is a FAIL, and so is an `escape` parser directive
 * other than `\` (only the default escape is read). */
const logicalLines = (text: string, file: string): Logical[] => {
  const phys = text.replace(/^\uFEFF/, "").split("\n").map((l) => l.replace(/\r$/, ""));
  // Parser directives are the leading `# name=value` lines, before any blank line, other comment or instruction.
  for (let i = 0; i < phys.length; i++) {
    const d = /^\s*#\s*([a-z]+)\s*=\s*(.*?)\s*$/i.exec(phys[i]!);
    if (!d) break;
    if (d[1]!.toLowerCase() === "escape" && d[2] !== "\\") throw unsupported(`escape=${d[2]}`, file, i + 1);
  }
  const out: Logical[] = [];
  /** Add a finished instruction that ends on physical line index `i`; returns the index reading resumes after. */
  const close = (ins: Logical, i: number): number => {
    if (!ins.text.trim()) return i;
    out.push(ins);
    // Docker's heredoc word, matched on shell words (quotes kept, so a `<<` inside quotes is not one): `<<` or `<<-`
    // and a name, whose quotes and backslashes are removed as the shell removes them; only RUN, COPY and ADD take one.
    if (!/^\s*(?:RUN|COPY|ADD)\s/i.test(ins.text)) return i;
    for (const w of ins.text.match(/(?:[^\s"'\\]|\\.?|"(?:[^"\\]|\\.)*"?|'[^']*'?)+/g) ?? []) {
      const h = /^\d*<<(-?)([^<]+)$/.exec(w);
      const name = h?.[2]!.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'|\\(.)/g, (_q, dq?: string, sq?: string, esc?: string) => dq?.replace(/\\(.)/g, "$1") ?? sq ?? esc ?? "");
      if (!h || !name) continue;
      const start = i;
      while (++i < phys.length && (h[1] ? phys[i]!.replace(/^\t+/, "") : phys[i]) !== name);
      if (i >= phys.length) throw new PinError(`unterminated heredoc <<${name} in ${file}:${start + 1}`);
    }
    return i;
  };
  let cur: Logical | null = null;
  let end = 0; // the last physical line `cur` took text from
  for (let i = 0; i < phys.length; i++) {
    const line = phys[i]!;
    if (/^\s*#/.test(line) || (cur && !line.trim())) continue;
    const cont = /\\[ \t]*$/.exec(line);
    const body = cont ? line.slice(0, cont.index) : line;
    cur ??= { text: "", lines: [] };
    cur.text += body;
    for (let k = 0; k < body.length; k++) cur.lines.push(i + 1); // per UTF-16 unit, as the text is indexed
    end = i;
    if (cont) continue;
    i = close(cur, i);
    cur = null;
  }
  if (cur) close(cur, end);
  return out;
};
/** `FROM [--flag] <image>[:tag][@digest]` of the tool image and `ARG <TOOL>_VERSION=<v>`, each a pin. A tag that starts
 * with `$` is skipped (its ARG is the pin); a tag with a literal version a variant separator ends before its `$`
 * (`18-${DISTRO}`) is that version; no tag, a digest only or any other tag is unsupported. An ARG value is its whole shell
 * word and must be a pin as written: quotes may wrap the whole value only (`"20.11.0"`, not `"20"${SUFFIX}`). */
const dockerfile: Parser = (text, tool, _root, file) => {
  const logical = logicalLines(text, file);
  const at = (l: Logical, index: number): number => l.lines[Math.min(index, l.lines.length - 1)] ?? 1;
  const out: Found = [];
  const stages = new Set<string>(); // aliases declared by earlier `FROM … AS <alias>` lines (Docker matches them case-insensitively)
  for (const l of logical) {
    const m = /^(\s*FROM\s+(?:--\S+\s+)*)(\S+)(?:\s+AS\s+(\S+))?/i.exec(l.text);
    if (!m) continue;
    const image = m[2]!;
    const [name = "", tag = ""] = image.split("@")[0]!.split("/").pop()!.split(":"); // after the last "/": a registry port is not a tag
    const stageRef = image === name && stages.has(name.toLowerCase()); // a tagless name that is an earlier alias is a stage, not the image
    if (m[3]) stages.add(m[3].toLowerCase());
    if (stageRef || name !== (IMAGE[tool] ?? tool) || tag.startsWith("$")) continue;
    const v = tag ? tagVer(tag) : null;
    if (v === null) throw unsupported(image, file, at(l, m[1]!.length));
    out.push({ v });
  }
  // `ARG A=1 B=2` declares each pair: the tool's may be any of them.
  const key = `${tool.toUpperCase().replace(/\W/g, "_")}_VERSION`;
  for (const l of logical) {
    const m = /^(\s*ARG\s+)(.*)$/is.exec(l.text);
    if (!m) continue;
    for (const p of m[2]!.matchAll(/(?:^|\s)([A-Za-z_]\w*)=((?:"[^"]*"?|'[^']*'?|[^\s"'])*)/g)) {
      if (p[1]!.toUpperCase() !== key) continue;
      const v = p[2]!.replace(/^"([^"]*)"$|^'([^']*)'$/, "$1$2"); // `"20.11.0"` is `20.11.0`; `"20"${SUFFIX}` stays as written
      out.push(...pinAt(v, tool, file, at(l, m[1]!.length + p.index + p[0].length - p[2]!.length)));
    }
  }
  return out;
};

/** The `-file` inputs of the setup-* actions loops reads, by basename: the actions' own formats and the plain version
 * files. Any other name is an unsupported form, never read as a plain file. */
const BY_NAME: Record<string, Parser> = {
  "go.mod": goMod,
  "go.work": goMod,
  ".tool-versions": toolVersions,
  "package.json": pkgVersion,
  "pyproject.toml": pyproject,
  Pipfile: pipfile,
  ".nvmrc": plain,
  ".node-version": plain,
  ".python-version": plain,
  ".go-version": plain,
};
/** The supported `<tool>-version-file` basenames (the README matrix lists exactly these). */
export const VERSION_FILES: string[] = Object.keys(BY_NAME);

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
  return (text, tool, root, file) => {
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
      const ins: [string, string, number][] = [];
      for (const p of w.items) {
        const k = keyOf(p.key)?.toLowerCase(); // action inputs are case-insensitive
        if (k === "<<") throw new PinError(`with: of ${action} at ${line(w)} uses a merge key, which Actions does not read`);
        if (k === key || k === `${key}-file`) ins.push([k, scalar(k, p.value), lc.linePos((deref(p.value) as Node | null)?.range?.[0] ?? 0).line]);
      }
      // An empty input is fine only beside a non-empty one: the action then reads that one.
      if (ins.length && !ins.some(([, v]) => v)) throw new PinError(`${ins[0]![0]} has no value`);
      // The actions use the direct input and ignore `-file` when both are set.
      const used = ins.some(([k, v]) => k === key && v) ? ins.filter(([k]) => k === key) : ins;
      const out: Found = [];
      for (const [k, val, at] of used) {
        if (!val) continue;
        if (k === key) {
          // Each line is a pin or a range on its own; `latest` and every other word is unsupported.
          for (const l of val.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
            const f = classify(l, tool);
            if (!f) throw unsupported(l, file, at);
            out.push(f);
          }
        } else if (!existsSync(join(root, val))) throw new PinError(`${key}-file ${val} not found`);
        else if (!Object.hasOwn(BY_NAME, basename(val)))
          throw new PinError(`unsupported form: ${k} ${val} in ${file}:${at} is not a supported version file (${VERSION_FILES.join(", ")}); pin an exact version`);
        else {
          const found = BY_NAME[basename(val)]!(readFileSync(join(root, val), "utf8"), tool, root, normalize(val));
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
/** Source kind -> its default file (the README matrix lists exactly these). */
export const SOURCE_KINDS: Record<string, string> = Object.fromEntries(Object.entries(KINDS).map(([k, { file }]) => [k, file]));

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
      for (const x of k.parse(readFileSync(join(root, f), "utf8"), tool, root, f)) out.push({ src: `${kind}:${f}`, v: x.v, range: x.range ?? false });
    } catch (e) {
      throw new PinError(`${spec}: ${f}: ${(e as Error).message}`);
    }
  }
  if (!out.length) throw new PinError(`${spec}: no ${tool} version found in ${files.length === 1 ? files[0] : `${files.length} files`}`);
  return out;
}

export type Compare = "exact" | "minor" | "major";
const DEPTH = { exact: 3, minor: 2, major: 1 };

/** Compare on the components both versions state (so `1.26` equals `1.26.1` under exact), up to `depth`. A prerelease
 * counts once `depth` reaches its last component: `22.0.0-rc.1` differs from `22.0.0` and `22` under exact, not minor. */
export function cmp(a: string, b: string, depth = 3): number {
  const [x, p] = split(a);
  const [y, q] = split(b);
  for (let i = 0; i < Math.min(depth, x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return (p && depth >= x.length) || (q && depth >= y.length) ? preCmp(p, q) : 0;
}

const parts = (v: string): number => split(v)[0].length;
/** Only pins are compared: a range is reported, never a bound. */
const pinsOf = (vals: PinValue[]): PinValue[] => vals.filter((x) => !x.range);
/** The version a pin stands for: the most specific pin (first on a tie). `vals` must hold a pin. */
export const pinOf = (vals: PinValue[], _mode?: Compare): string => pinsOf(vals).reduce((a, b) => (parts(b.v) > parts(a.v) ? b : a)).v;

/** Why the pins disagree at the compare depth, or null when they agree. */
export function disagreement(vals: PinValue[], mode: Compare): string | null {
  const pins = pinsOf(vals);
  const bad = pins.some((x, i) => pins.slice(i + 1).some((y) => cmp(x.v, y.v, DEPTH[mode]) !== 0));
  return bad ? pins.map((x) => `${x.src}=${x.v}`).join(", ") + ` disagree (${mode})` : null;
}

/** Does a local toolchain version match the pin at the compare depth? */
export const localOk = (local: string, pin: string, mode: Compare): boolean => cmp(local, pin, DEPTH[mode]) === 0;
