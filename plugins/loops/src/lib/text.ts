// Text helpers for `loops env-check` output: lists, and relaying text a check or tool printed without letting it
// break the one-line-per-result format.

/** Up to `n` items joined by ", ", noting how many more there are. */
export const short = (xs: string[], n = 5): string => xs.slice(0, n).join(", ") + (xs.length > n ? ` (+${xs.length - n} more)` : "");

/** The first `n` code points of `s`, ending in "…" when cut; never splits a surrogate pair. */
export function cut(s: string, n: number): string {
  const cps = [...s];
  return cps.length > n ? `${cps.slice(0, n).join("")}…` : s;
}

/** A control character (C0, DEL, C1) other than tab, or a Unicode line or paragraph separator. */
export const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/;
// What escapeCtl rewrites: every control character (tab too) and the dash of a "— fix:", the output's fix separator.
const ESCAPED = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]|—(?=\s*fix:)/g;
const NAMED: Record<string, string> = { "\t": "\\t", "\n": "\\n", "\r": "\\r" };

/**
 * `s` with control characters and the dash of any `— fix:` written as escapes (`\r`, `\u001b`, `\u2014`), so relayed
 * text can neither move the cursor nor read as a second fix on its output line.
 */
export function escapeCtl(s: string): string {
  return s.replace(ESCAPED, (c) => NAMED[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** `s` cut to `n` code points as a double-quoted string, with `\`, `"` and what escapeCtl rewrites escaped. */
export function quote(s: string, n = 80): string {
  return `"${escapeCtl(cut(s, n).replace(/[\\"]/g, "\\$&"))}"`;
}
