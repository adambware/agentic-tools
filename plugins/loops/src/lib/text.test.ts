import { describe, expect, it } from "vitest";
import { CONTROL, cut, escapeCtl, jsonText, quote, short } from "./text.js";

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

  it("cut reads no further than the code point after the cut, so one huge line costs no more than a short one", () => {
    let read = 0;
    const big = Object.assign(new String("x".repeat(1000)), {
      *[Symbol.iterator]() {
        for (let i = 0; i < 1000; i++) {
          read++;
          yield "x";
        }
      },
    });
    expect(cut(big as unknown as string, 3)).toBe("xxx…");
    expect(read).toBe(4);
  });

  it("CONTROL flags control characters and line separators, but not tab or printable text", () => {
    for (const c of ["\u0000", "\r", "\n", "\u001b", "\u007f", "\u0085", "\u009b", "\u2028", "\u2029"]) expect(CONTROL.test(`a${c}b`)).toBe(true);
    for (const s of ["a\tb", "plain — fix: text", "émoji 😀", "\u00a0nbsp"]) expect(CONTROL.test(s)).toBe(false);
  });

  it("CONTROL and escapeCtl cover bidi controls and marks and the zero-width space, but not ZWNJ or ZWJ", () => {
    const bidi = ["\u061c", "\u200b", "\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069"];
    for (const c of bidi) expect([c, CONTROL.test(`a${c}b`)]).toEqual([c, true]);
    expect(escapeCtl("ok \u202egnp.exe\u200b\u061c")).toBe("ok \\u202egnp.exe\\u200b\\u061c");
    for (const s of ["family 👨\u200d👩\u200d👧", "می\u200cخواهم"]) {
      expect(CONTROL.test(s)).toBe(false);
      expect(escapeCtl(s)).toBe(s);
    }
  });

  it("escapeCtl makes control characters visible and defuses a fix separator, leaving other text alone", () => {
    expect(escapeCtl("a\rb\tc\nd\u001b[2K\u0000\u009b\u2028")).toBe("a\\rb\\tc\\nd\\u001b[2K\\u0000\\u009b\\u2028");
    expect(escapeCtl("boom — fix: x")).toBe("boom \\u2014 fix: x");
    expect(escapeCtl("a — b, C:\\dir \"q\"")).toBe("a — b, C:\\dir \"q\"");
  });

  it("escapeCtl defuses an ASCII -- fix: by its first dash, and leaves other double dashes alone", () => {
    expect(escapeCtl("m -- fix: a --fix: b")).toBe("m \\u002d- fix: a \\u002d-fix: b");
    for (const s of ["git checkout -- x", "a --- b", "--fix-it", "x -- fixes"]) expect(escapeCtl(s)).toBe(s);
  });

  // Coverage, green at 18bfbea too: the renderer escapes text a producer may already have quoted. Mutation that turns
  // it red: escape `\` in ESCAPED, or defuse the second dash of `--`.
  it("escapeCtl is idempotent", () => {
    for (const s of ["a\rb\u001b[2K\u009b\u202e\t", "boom — fix: x", "m -- fix: a --- fix: b", quote("q — fix: \u001b")]) {
      expect(escapeCtl(escapeCtl(s))).toBe(escapeCtl(s));
    }
  });

  it("jsonText writes DEL, C1, line separators, bidi and zero-width as \\uXXXX, losslessly", () => {
    const raw = "a\u061c\u007fb\u0080\u009b\u2028\u2029\u200b\u200e\u200f\u202a\u202e\u2066\u2069\u001b\\u001b é\u200d";
    const s = jsonText({ [raw]: [raw] });
    expect(s).not.toMatch(/[\u061c\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069]/);
    expect(s).toContain("\\u009b");
    expect(JSON.parse(s)).toEqual({ [raw]: [raw] });
  });

  // The renderer and the JSON pass escape control text (R26), so a quoted value reaches --json raw.
  it("quote gives one double-quoted, cut string, escaping only its backslashes and quotes", () => {
    expect(quote("all good")).toBe('"all good"');
    expect(quote('say "hi" \\ — fix: x\r\u001b')).toBe('"say \\"hi\\" \\\\ — fix: x\r\u001b"');
    const long = quote("x".repeat(200));
    expect(long).toBe(`"${"x".repeat(80)}…"`);
    expect(quote("abc", 2)).toBe('"ab…"');
  });
});
