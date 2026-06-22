import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, appendJsonl, readJsonl, readYaml, readJson, writeJson } from "./io.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-io-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  it("writes the file and leaves no temp file behind", () => {
    const p = join(dir, "nested", "surfaces.json");
    atomicWrite(p, "hello");
    expect(readFileSync(p, "utf8")).toBe("hello");
    const leftovers = readdirSync(join(dir, "nested")).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("overwrites an existing file atomically", () => {
    const p = join(dir, "f.txt");
    atomicWrite(p, "v1");
    atomicWrite(p, "v2");
    expect(readFileSync(p, "utf8")).toBe("v2");
  });
});

describe("appendJsonl / readJsonl", () => {
  it("appends whole lines and reads them back", () => {
    const p = join(dir, "m", "runs.jsonl");
    appendJsonl(p, { a: 1 });
    appendJsonl(p, { a: 2 });
    expect(readJsonl(p)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("returns [] for a missing file", () => {
    expect(readJsonl(join(dir, "nope.jsonl"))).toEqual([]);
  });

  it("skips blank lines", () => {
    const p = join(dir, "x.jsonl");
    writeFileSync(p, '{"a":1}\n\n  \n{"a":2}\n');
    expect(readJsonl(p)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("readYaml / readJson / writeJson", () => {
  it("parses yaml and returns undefined for a missing file", () => {
    const p = join(dir, "c.yml");
    writeFileSync(p, "window_budget_k:\n  security: 6\n");
    expect(readYaml(p)).toEqual({ window_budget_k: { security: 6 } });
    expect(readYaml(join(dir, "missing.yml"))).toBeUndefined();
  });

  it("round-trips json", () => {
    const p = join(dir, "out.json");
    writeJson(p, [{ id: "A" }]);
    expect(readJson(p)).toEqual([{ id: "A" }]);
    expect(readJson(join(dir, "missing.json"))).toBeUndefined();
  });
});
