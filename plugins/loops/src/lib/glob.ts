// Glob matching for risk-zones rows and env-check pin sources. Deliberately small and strict: any
// syntax outside the supported subset is an error, so a typo can never silently match nothing.
import { UsageError } from "./proc.js";

function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  return [...parts, cur];
}

/** Bash-style comma brace expansion, nested. {a..b}, comma-less groups and unbalanced braces throw. */
export function expandBraces(g: string): string[] {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}") {
      if (depth === 0) throw new UsageError(`unbalanced "}" in ${g}`);
      if (--depth === 0) {
        const parts = splitTop(g.slice(start + 1, i));
        if (parts.length < 2) throw new UsageError(`brace group without a comma in ${g} ({a..b} is not supported)`);
        return parts.flatMap((p) => expandBraces(g.slice(0, start) + p + g.slice(i + 1)));
      }
    }
  }
  if (depth !== 0) throw new UsageError(`unbalanced "{" in ${g}`);
  return [g];
}

/**
 * One brace-free glob to a RegExp over repo-relative POSIX paths. `*` is `[^/]*` (it matches
 * dotfiles, unlike bash), `?` is `[^/]`, `**` followed by `/` is zero or more directories, any
 * other `**` (including a trailing `/**`) is `.*`.
 */
export function globToRegExp(g: string): RegExp {
  if (/[[!]/.test(g) || g.startsWith("/")) {
    throw new UsageError(`unsupported glob ${g} ("[", "!" and a leading "/" are not allowed)`);
  }
  let r = "";
  for (let i = 0; i < g.length; ) {
    if (g.startsWith("**/", i)) {
      r += "(?:.*/)?";
      i += 3;
    } else if (g.startsWith("**", i)) {
      r += ".*";
      i += 2;
    } else if (g[i] === "*") {
      r += "[^/]*";
      i++;
    } else if (g[i] === "?") {
      r += "[^/]";
      i++;
    } else {
      r += g[i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${r}$`, "s");
}

/** Compile a glob with braces: a path matches when any expansion matches. */
export function compileGlob(token: string): RegExp[] {
  return expandBraces(token).map(globToRegExp);
}

export const isGlob = (s: string): boolean => /[*?{]/.test(s);
