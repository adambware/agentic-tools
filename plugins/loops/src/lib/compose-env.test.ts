import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDotEnv, readDotEnv, resolveTemplate, type DotEnv } from "./compose-env.js";

const vars = (o: Record<string, string | null>): DotEnv => new Map(Object.entries(o));

describe("resolveTemplate", () => {
  it("substitutes ${V} and bare $V from the map", () => {
    expect(resolveTemplate("${STACK}", vars({ STACK: "feat-a" }))).toBe("feat-a");
    expect(resolveTemplate("$STACK-x", vars({ STACK: "feat-a" }))).toBe("feat-a-x");
    expect(resolveTemplate("lit", vars({}))).toBe("lit");
  });

  it("applies :- for unset or empty and - for unset only", () => {
    expect(resolveTemplate("${PN:-x}", vars({}))).toBe("x");
    expect(resolveTemplate("${PN:-x}", vars({ PN: "" }))).toBe("x");
    expect(resolveTemplate("${PN:-x}", vars({ PN: "y" }))).toBe("y");
    expect(resolveTemplate("${PN-x}", vars({}))).toBe("x");
    expect(resolveTemplate("${PN-x}", vars({ PN: "" }))).toBe("");
    expect(resolveTemplate("${A:-${B:-c}}", vars({}))).toBe("c");
    expect(resolveTemplate("${A:-${B}}", vars({ B: "b" }))).toBe("b");
  });

  it("is null when a needed variable is unset without a default, unknown, or required and missing", () => {
    expect(resolveTemplate("${STACK}", vars({}))).toBeNull();
    expect(resolveTemplate("$STACK", vars({}))).toBeNull();
    expect(resolveTemplate("${PN:-x}", vars({ PN: null }))).toBeNull();
    expect(resolveTemplate("${V:?set}", vars({}))).toBeNull();
    expect(resolveTemplate("${V:?set}", vars({ V: "" }))).toBeNull();
    expect(resolveTemplate("${V?set}", vars({ V: "" }))).toBe("");
    expect(resolveTemplate("${V:?set}", vars({ V: "v" }))).toBe("v");
    expect(resolveTemplate("${A:-${B}}", vars({}))).toBeNull();
  });

  it("handles :+, + and $$, and rejects malformed templates", () => {
    expect(resolveTemplate("${V:+r}", vars({ V: "v" }))).toBe("r");
    expect(resolveTemplate("${V:+r}", vars({ V: "" }))).toBe("");
    expect(resolveTemplate("${V+r}", vars({ V: "" }))).toBe("r");
    expect(resolveTemplate("$$x${V:-q}", vars({}))).toBe("$xq");
    expect(resolveTemplate("${V", vars({ V: "v" }))).toBeNull();
    expect(resolveTemplate("${V x}", vars({ V: "v" }))).toBeNull();
    expect(resolveTemplate("$-", vars({}))).toBeNull();
  });
});

describe("parseDotEnv", () => {
  it("reads Compose's dotenv forms", () => {
    const e = parseDotEnv(
      [
        "# comment",
        "export STACK=\"Feat A\" # hi",
        "B=a b # c",
        "C=d#e",
        "D: colon",
        "E='${Q}'",
        'F="x\\ny"',
        'G="multi',
        'line"',
        "H=",
        "BARE",
        "I=${STACK}-i",
        "J=${NOPE}",
        "K=${NOPE:-k}",
        'L="unclosed',
      ].join("\n"),
    );
    expect(Object.fromEntries(e)).toEqual({
      STACK: "Feat A",
      B: "a b",
      C: "d#e",
      D: "colon",
      E: "${Q}",
      F: "x\ny",
      G: "multi\nline",
      H: "",
      BARE: null,
      I: "Feat A-i",
      J: null,
      K: "k",
      L: null,
    });
  });

  it("honors an escaped quote inside single quotes", () => {
    expect(parseDotEnv("STACK='feat\\'s'\nN=1\n").get("STACK")).toBe("feat's");
    expect(parseDotEnv("STACK='feat\\'s'\nN=1\n").get("N")).toBe("1");
  });

  it("expands only variables defined above", () => {
    expect(parseDotEnv("A=${B:-zz}x\nB=1\n").get("A")).toBe("zzx");
  });
});

describe("readDotEnv", () => {
  it("reads <dir>/.env and is empty without one", () => {
    const d = mkdtempSync(join(tmpdir(), "loops-dotenv-"));
    try {
      expect(readDotEnv(d).size).toBe(0);
      writeFileSync(join(d, ".env"), "STACK=feat-a\n");
      expect(readDotEnv(d).get("STACK")).toBe("feat-a");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
