import { describe, it, expect } from "vitest";
import { extractEntries } from "./registry.js";

describe("extractEntries", () => {
  it("returns [] for null/undefined (empty/missing registry)", () => {
    expect(extractEntries(undefined, "security")).toEqual([]);
    expect(extractEntries(null, "security")).toEqual([]);
  });

  it("reads a {vectors:[...]} document", () => {
    const doc = { vectors: [{ id: "V1", owner: "security" }] };
    expect(extractEntries(doc, "security")).toHaveLength(1);
  });

  it("reads a {flows:[...]} document", () => {
    const doc = { flows: [{ id: "F1", owner: "design" }] };
    expect(extractEntries(doc, "design")).toHaveLength(1);
  });

  it("reads a bare list", () => {
    expect(extractEntries([{ id: "V1", owner: "security" }], "security")).toHaveLength(1);
  });

  it("filters by owner lane (entries without owner pass through)", () => {
    const doc = {
      vectors: [
        { id: "V1", owner: "security" },
        { id: "F1", owner: "design" },
        { id: "X1" },
      ],
    };
    expect(extractEntries(doc, "security").map((e) => e.id)).toEqual(["V1", "X1"]);
  });

  it("throws on a malformed object (no list key)", () => {
    expect(() => extractEntries({ nope: 1 }, "security")).toThrow(/malformed registry/);
  });

  it("throws when the list key is not a list", () => {
    expect(() => extractEntries({ vectors: "oops" }, "security")).toThrow(/not a list/);
  });

  it("throws on a scalar document", () => {
    expect(() => extractEntries(42, "security")).toThrow(/malformed registry/);
  });
});
