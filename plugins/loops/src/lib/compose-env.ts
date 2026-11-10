// A local reading of a Compose project directory's `.env` and of one interpolated string (a peer's `name:`), for the
// e.project fallback. Never the process environment: a value is what that checkout's `.env` gives, or unknown. Nothing
// here runs Compose, and no value read here is ever put into a message by this module.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** `.env` variables: a value, or null when loops cannot know it (a bare `KEY`, which Compose takes from the shell; a
 * value expanding a variable loops cannot resolve; an unclosed quote). A name absent from the map is unset. */
export type DotEnv = Map<string, string | null>;

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const KEY = /(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.]*)[ \t]*([=:]?)[ \t]*/y;

/**
 * Compose's template syntax over `vars`: `$$`, `$V`, `${V}`, `${V:-d}` (unset or empty), `${V-d}` (unset),
 * `${V:?e}`/`${V?e}` (required), `${V:+r}`/`${V+r}`, defaults nested. Null when any variable it needs is unknown, or
 * unset with no default (Compose would take it from the shell or fail), or when the template is malformed.
 */
export function resolveTemplate(t: string, vars: DotEnv): string | null {
  let out = "";
  for (let i = 0; i < t.length; ) {
    const ch = t[i]!;
    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }
    const next = t[i + 1];
    if (next === "$") {
      out += "$";
      i += 2;
      continue;
    }
    if (next !== "{") {
      NAME.lastIndex = i + 1;
      const m = NAME.exec(t);
      if (!m) return null;
      const v = vars.get(m[0]);
      if (v === undefined || v === null) return null;
      out += v;
      i = NAME.lastIndex;
      continue;
    }
    NAME.lastIndex = i + 2;
    const m = NAME.exec(t);
    if (!m) return null;
    let j = NAME.lastIndex;
    const op = /^(:-|-|:\?|\?|:\+|\+)?/.exec(t.slice(j))![0];
    j += op.length;
    // The argument runs to the `}` that closes this `${`, past nested `${...}`.
    let depth = 0;
    let end = -1;
    for (let k = j; k < t.length; k++) {
      if (t[k] === "$" && t[k + 1] === "$") k++;
      else if (t[k] === "$" && t[k + 1] === "{") {
        depth++;
        k++;
      } else if (t[k] === "}") {
        if (depth === 0) {
          end = k;
          break;
        }
        depth--;
      }
    }
    if (end < 0 || (!op && end !== j)) return null;
    const arg = t.slice(j, end);
    const v = vars.get(m[0]);
    if (v === null) return null;
    const set = v !== undefined;
    const full = set && v !== "";
    let got: string | null;
    if (op === ":-") got = full ? v : resolveTemplate(arg, vars);
    else if (op === "-") got = set ? v : resolveTemplate(arg, vars);
    else if (op === ":?") got = full ? v : null;
    else if (op === "?") got = set ? v : null;
    else if (op === ":+") got = full ? resolveTemplate(arg, vars) : "";
    else if (op === "+") got = set ? resolveTemplate(arg, vars) : "";
    else got = set ? v : null;
    if (got === null) return null;
    out += got;
    i = end + 1;
  }
  return out;
}

const eol = (s: string, i: number): number => {
  const n = s.indexOf("\n", i);
  return n < 0 ? s.length : n;
};

/**
 * Parses `.env` text as Compose does (its dotenv rules): `KEY=value` or `KEY: value`, an optional `export `, `#`
 * comment lines, a ` #` comment after an unquoted value, single quotes literal, double quotes with `\n \t \\ \"`
 * escapes and multi-line values, and unquoted or double-quoted values expanding variables defined above them.
 */
export function parseDotEnv(s: string): DotEnv {
  const vars: DotEnv = new Map();
  for (let i = 0; i < s.length; ) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;
    if (s[i] === "#") {
      i = eol(s, i);
      continue;
    }
    KEY.lastIndex = i;
    const m = KEY.exec(s);
    if (!m) {
      i = eol(s, i);
      continue;
    }
    const key = m[1]!;
    i = KEY.lastIndex;
    if (!m[2]) {
      // A bare KEY: Compose looks it up in the shell.
      vars.set(key, null);
      i = eol(s, i);
      continue;
    }
    const q = s[i];
    if (q === "'" || q === '"') {
      let k = i + 1;
      // Either quote can be escaped inside itself (Compose's dotenv: STACK='feat\'s' is feat's).
      while (k < s.length && s[k] !== q) k += s[k] === "\\" && (q === '"' || s[k + 1] === "'") ? 2 : 1;
      if (k >= s.length) {
        vars.set(key, null);
        break;
      }
      const inner = s.slice(i + 1, k);
      i = eol(s, k + 1);
      if (q === "'") vars.set(key, inner.replace(/\\'/g, "'"));
      else if (inner.includes("\\$")) vars.set(key, null);
      else {
        const un = inner.replace(/\\(.)/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c);
        vars.set(key, un.includes("$") ? resolveTemplate(un, vars) : un);
      }
      continue;
    }
    const end = eol(s, i);
    let v = s.slice(i, end);
    const hash = v.search(/\s#/);
    if (hash >= 0) v = v.slice(0, hash);
    v = v.trim();
    i = end;
    vars.set(key, v.includes("$") ? resolveTemplate(v, vars) : v);
  }
  return vars;
}

/** The `.env` of project directory `pdir`, parsed; empty when it is missing or unreadable. */
export function readDotEnv(pdir: string): DotEnv {
  try {
    return parseDotEnv(readFileSync(join(pdir, ".env"), "utf8"));
  } catch {
    return new Map();
  }
}
