// The README pins tables are the only list of supported forms: they must name exactly the source kinds (with their
// default files) and the `<tool>-version-file` basenames that pins.ts reads, in both directions.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOURCE_KINDS, VERSION_FILES } from "./pins.js";

const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../README.md"), "utf8");

/** The body rows of the markdown table whose header row starts with `header`, as cells (escaped `\|` kept inside a cell). */
function table(header: string): string[][] {
  const lines = README.split("\n");
  const at = lines.findIndex((l) => l.startsWith(header));
  if (at < 0) throw new Error(`README has no table starting ${header}`);
  const rows: string[][] = [];
  for (const l of lines.slice(at + 2)) {
    if (!l.startsWith("|")) break;
    rows.push(l.slice(1, l.trimEnd().endsWith("|") ? l.trimEnd().length - 1 : undefined).split(/(?<!\\)\|/).map((c) => c.trim()));
  }
  return rows;
}
/** Every backticked token in a cell. */
const codes = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

const KINDS_HEADER = "| kind | default file | pin (compared) | range (INFO, not compared) | anything else |";
const FILES_HEADER = "| `<tool>-version-file` name | reads | pin (compared) | range (INFO, not compared) |";

describe("README pins support matrix", () => {
  it("lists every source kind once, with its default file, and nothing else", () => {
    const rows = table(KINDS_HEADER);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toHaveLength(5);
    const kinds = rows.map((r) => codes(r[0]!));
    for (const k of kinds) expect(k).toHaveLength(1); // one kind per row, so its default file is unambiguous
    const files = rows.map((r) => codes(r[1]!));
    for (const f of files) expect(f).toHaveLength(1);
    const readme = rows.map((_, i) => [kinds[i]![0]!, files[i]![0]!] as const);
    expect(new Set(readme.map(([k]) => k)).size).toBe(readme.length);
    expect(Object.fromEntries(readme)).toEqual(SOURCE_KINDS);
  });

  it("lists every supported <tool>-version-file basename once, and nothing else", () => {
    const rows = table(FILES_HEADER);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toHaveLength(4);
    const names = rows.flatMap((r) => codes(r[0]!));
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...VERSION_FILES].sort());
  });

  it("no longer shows compare = \"floor\" as a valid setting", () => {
    expect(README).not.toMatch(/^compare = "floor"/m);
    expect(README).not.toMatch(/exact \(default\) \| minor \| major \| floor/);
  });
});
