import { describe, expect, it } from "vitest";
import { CONTROL, cut, escapeCtl, quote, short } from "./text.js";

describe("text helpers", () => {
  it("short lists up to n items and counts the rest", () => {
    expect(short(["a", "b"])).toBe("a, b");
    expect(short(["a", "b", "c", "d", "e", "f", "g"])).toBe("a, b, c, d, e (+2 more)");
    expect(short(["a", "b", "c"], 2)).toBe("a, b (+1 more)");
  });

  it("cut counts code points, marks a cut with an ellipsis, and never splits a surrogate pair", () => {
    expect(cut("abc", 3)).toBe("abc");
    expect(cut("abcd", 3)).toBe("abc…");
    expect(cut("ab😀cd", 3)).toBe("ab😀…");
    expect(cut("😀😀", 1)).toBe("😀…");
  });

  it("CONTROL flags control characters and line separators, but not tab or printable text", () => {
    for (const c of ["\u0000", "\r", "\n", "\u001b", "\u007f", "\u0085", "\u009b", "\u2028", "\u2029"]) expect(CONTROL.test(`a${c}b`)).toBe(true);
    for (const s of ["a\tb", "plain — fix: text", "émoji 😀", "\u00a0nbsp"]) expect(CONTROL.test(s)).toBe(false);
  });

  it("escapeCtl makes control characters visible and defuses a fix separator, leaving other text alone", () => {
    expect(escapeCtl("a\rb\tc\nd\u001b[2K\u0000\u009b\u2028")).toBe("a\\rb\\tc\\nd\\u001b[2K\\u0000\\u009b\\u2028");
    expect(escapeCtl("boom — fix: x")).toBe("boom \\u2014 fix: x");
    expect(escapeCtl("a — b, C:\\dir \"q\"")).toBe("a — b, C:\\dir \"q\"");
  });

  it("quote gives one double-quoted string with no raw control character and no fix separator", () => {
    expect(quote("all good")).toBe('"all good"');
    expect(quote('say "hi" \\ — fix: x\r')).toBe('"say \\"hi\\" \\\\ \\u2014 fix: x\\r"');
    const long = quote("x".repeat(200));
    expect(long).toBe(`"${"x".repeat(80)}…"`);
    expect(quote("abc", 2)).toBe('"ab…"');
  });
});
