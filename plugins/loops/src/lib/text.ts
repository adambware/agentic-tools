// Text helpers for `loops env-check` output: lists, and relaying text a check or tool printed without letting it
// break the one-line-per-result format.

/** Up to `n` items joined by ", ", noting how many more there are. */
export const short = (xs: string[], n = 5): string => xs.slice(0, n).join(", ") + (xs.length > n ? ` (+${xs.length - n} more)` : "");

/** The first `n` code points of `s`, ending in "…" when cut; never splits a surrogate pair, and reads no further. */
export function cut(s: string, n: number): string {
  let out = "";
  let i = 0;
  for (const cp of s) {
    if (i++ === n) return `${out}…`;
    out += cp;
  }
  return s;
}

/**
 * A control character (C0, DEL, C1) other than tab, a Unicode line or paragraph separator, a bidi control or mark
 * (Bidi_Control: U+061C, U+200E/F, U+202A-202E, U+2066-2069; they reorder how a row displays), or a zero-width
 * space. ZWNJ and ZWJ (U+200C, U+200D) pass: scripts and emoji need them.
 */
export const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069]/;
// What escapeCtl rewrites: every CONTROL character, tab too, the dash of a "— fix:", the output's fix separator, and
// the first dash of a "-- fix:", its ASCII form (other double dashes, as in `git checkout -- x`, stay).
const ESCAPED = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069]|—(?=\s*fix:)|-(?=-\s*fix:)/g;
const NAMED: Record<string, string> = { "\t": "\\t", "\n": "\\n", "\r": "\\r" };

/**
 * `s` with control characters and the dash of any `— fix:` or first dash of any `-- fix:` written as escapes (`\r`,
 * `\u001b`, `\u2014`, `\u002d`), so relayed text can neither move the cursor nor read as a second fix on its output line.
 * Idempotent: its output has nothing left to rewrite.
 */
export function escapeCtl(s: string): string {
  return s.replace(ESCAPED, (c) => NAMED[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * `s` cut to `n` code points as a double-quoted string, with `\` and `"` escaped. Control text stays raw: the renderer
 * escapes a text row and the JSON pass a --json one, so JSON.parse returns the quoted text as it was.
 */
export function quote(s: string, n = 80): string {
  return `"${cut(s, n).replace(/[\\"]/g, "\\$&")}"`;
}

// What JSON.stringify leaves raw that a terminal acts on: DEL, C1, line and paragraph separators, bidi, zero-width.
const JSON_RAW = /[\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069]/g;

/**
 * `v` as JSON with those characters also written as `\uXXXX` (JSON.stringify already escapes C0), so the text is safe to
 * print and JSON.parse returns the values exactly. They occur only inside strings, where `\uXXXX` is valid.
 */
export function jsonText(v: unknown): string {
  return JSON.stringify(v).replace(JSON_RAW, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
