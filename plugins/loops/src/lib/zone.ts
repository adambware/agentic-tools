// risk-zones.md: strict parser and path classifier for `loops zone`. Every format violation is a
// UsageError carrying file:line, so a malformed policy file can never silently downgrade a change.
import { compileGlob } from "./glob.js";
import { UsageError } from "./proc.js";
import { VERSION } from "./version.js";

export type Zone = "green" | "yellow" | "red";
export const RANK: Record<Zone, number> = { green: 0, yellow: 1, red: 2 };
const SUPPORTED_SCHEMA = 1;

export interface Row {
  line: number;
  /** The backticked glob token as written (braces unexpanded). */
  glob: string;
  zone: Zone;
  prod: "yes" | "no" | "?";
  evidence: string[];
  matchers: RegExp[];
}
export interface RiskZones {
  rows: Row[];
  /** `## Ship prefix` bullets by key (red, yellow, green, docs-only, ...), quotes stripped when the whole value is quoted. */
  ship: Record<string, string>;
}
export interface PathInfo {
  path: string;
  zone: Zone;
  prod: boolean;
  evidence: string[];
  rows: Row[];
  unmatched: boolean;
}

const COLUMNS = ["glob", "zone", "prod", "evidence class", "why"];
const splitCells = (line: string): string[] =>
  line
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

export function parseRiskZones(text: string, file: string): RiskZones {
  const lines = text.split(/\r?\n/);
  const fail = (n: number, msg: string): never => {
    throw new UsageError(`${file}:${n}: ${msg}`);
  };
  const zonesAt = lines.findIndex((l) => /^## Zones\s*$/.test(l));
  if (zonesAt < 0) fail(1, "no `## Zones` section");
  const sectionEnd = (from: number): number => {
    const i = lines.findIndex((l, n) => n > from && /^## /.test(l));
    return i < 0 ? lines.length : i;
  };

  let schema: { n: number; line: number } | null = null;
  for (let i = 0; i < zonesAt && !schema; i++) {
    const m = lines[i]!.startsWith(">") ? /Schema version (\d+)/.exec(lines[i]!) : null;
    if (m) schema = { n: Number(m[1]), line: i + 1 };
  }
  if (!schema) fail(1, 'missing "Schema version N" in the header blockquote');
  else if (schema.n !== SUPPORTED_SCHEMA) fail(schema.line, `schema ${schema.n} unsupported by loops ${VERSION}`);

  const rows: Row[] = [];
  let cols: number[] | null = null;
  let width = 0;
  let inTable = false;
  for (let i = zonesAt + 1; i < sectionEnd(zonesAt); i++) {
    const line = lines[i]!.trim();
    if (!line) inTable = false;
    // markdown allows omitting the outer pipes; a pipe-less table (even one before or after the piped table) must fail closed
    if (/^[\s:|-]+$/.test(line) && line.includes("|") && line.includes("-")) {
      // GFM lets each row choose its outer pipes, so a piped delimiter under a pipe-less header is still a table
      const prev = lines[i - 1]?.trim() ?? "";
      if (!line.startsWith("|") || (prev && !prev.startsWith("|"))) fail(i + 1, "table must use leading pipes");
      inTable = true;
    }
    // a pipe-less row inside the table must not read as prose
    if (inTable && !line.startsWith("|") && /(?<!\\)\|/.test(line) && !/^[\s:|-]+$/.test(line)) fail(i + 1, "table row must start with `|`");
    if (!line.startsWith("|") || /^\|[\s:|-]+$/.test(line)) continue;
    const cells = splitCells(line);
    if (!cols) {
      width = cells.length;
      cols = COLUMNS.map((name) => cells.findIndex((c) => c.toLowerCase().startsWith(name)));
      const missing = COLUMNS.filter((_, k) => cols![k] === -1);
      if (missing.length) fail(i + 1, `table header lacks column(s): ${missing.join(", ")}`);
      inTable = true;
      continue;
    }
    inTable = true;
    if (cells.length !== width) fail(i + 1, `expected ${width} columns, found ${cells.length}`);
    const cell = (k: number): string => cells[cols![k]!]!;
    const zone = cell(1).toLowerCase();
    if (!Object.hasOwn(RANK, zone)) fail(i + 1, `unknown zone "${cell(1)}" (green, yellow or red)`);
    const prod = cell(2).toLowerCase();
    if (prod !== "yes" && prod !== "no" && prod !== "?") fail(i + 1, `Prod must be yes, no or ?, found "${cell(2)}"`);
    const tokens = [...cell(0).matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    if (!tokens.length) fail(i + 1, "Glob cell has no backticked glob");
    const evidence = cell(3)
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && e !== "none");
    for (const glob of tokens) {
      let matchers: RegExp[] = [];
      try {
        matchers = compileGlob(glob);
      } catch (e) {
        fail(i + 1, (e as Error).message);
      }
      rows.push({ line: i + 1, glob, zone: zone as Zone, prod: prod as Row["prod"], evidence, matchers });
    }
  }
  if (!rows.length) fail(zonesAt + 1, "`## Zones` table has no rows");

  const ship: Record<string, string> = {};
  const shipAt = lines.findIndex((l) => /^## Ship prefix\s*$/.test(l));
  for (let i = shipAt + 1; shipAt >= 0 && i < sectionEnd(shipAt); i++) {
    const m = /^- ([^:]+):\s*(.*?)\s*$/.exec(lines[i]!);
    if (m) ship[m[1]!.trim()] = /^"[^"]*"$/.test(m[2]!) ? m[2]!.slice(1, -1) : m[2]!;
  }
  return { rows, ship };
}

/** Zone = max over matching rows; no match is yellow (round up). */
export function classifyPath(rz: RiskZones, path: string): PathInfo {
  const rows = rz.rows.filter((r) => r.matchers.some((re) => re.test(path)));
  if (!rows.length) return { path, zone: "yellow", prod: false, evidence: [], rows, unmatched: true };
  const zone = rows.reduce<Zone>((z, r) => (RANK[r.zone] > RANK[z] ? r.zone : z), "green");
  const evidence = [...new Set(rows.flatMap((r) => r.evidence))].sort();
  return { path, zone, prod: rows.some((r) => r.prod !== "no"), evidence, rows, unmatched: false };
}

export interface Summary {
  zone: Zone | "none";
  prodPaths: number;
  unmatched: number;
  evidence: string[];
  counts: Record<Zone, number>;
  /** Rows at the change's zone with the paths they matched; `row: null` is the no-row default. */
  drivers: { row: Row | null; paths: string[] }[];
}

export function summarize(infos: PathInfo[]): Summary {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const p of infos) counts[p.zone]++;
  const zone = infos.reduce<Zone | "none">((z, p) => (z === "none" || RANK[p.zone] > RANK[z] ? p.zone : z), "none");
  const drivers: Summary["drivers"] = [];
  const byRow = new Map<Row, string[]>();
  const loose: string[] = [];
  for (const p of infos) {
    if (p.zone !== zone) continue;
    if (p.unmatched) loose.push(p.path);
    for (const r of p.rows) if (r.zone === zone) byRow.set(r, [...(byRow.get(r) ?? []), p.path]);
  }
  for (const [row, paths] of byRow) drivers.push({ row, paths });
  if (loose.length) drivers.push({ row: null, paths: loose });
  return {
    zone,
    prodPaths: infos.filter((p) => p.prod).length,
    unmatched: infos.filter((p) => p.unmatched).length,
    evidence: [...new Set(infos.flatMap((p) => p.evidence))].sort(),
    counts,
    drivers,
  };
}
