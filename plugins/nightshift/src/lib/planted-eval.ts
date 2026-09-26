// Planted-vuln eval (T14, plan §9.17) — the false-negative counterweight to FPR.
//
// FPR only counts false positives, so a reviewer prompt/model change that makes the
// reviewer MISS real issues looks like an improving FPR. This scores a finished
// security-lane run against examples/novudesk/eval/: planted, unambiguous
// vulnerabilities (caught/total) plus clean control surfaces (false positives on
// clean). It is REPORT-ONLY: nothing here gates CI or a run, and bin/eval-planted
// exits 0 whatever the score.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readYaml } from "./io.js";

export interface PlantedLocation {
  file: string;
  /** Inclusive 1-based [start, end]. */
  lines: [number, number];
}

export interface PlantedEntry {
  id: string;
  vector: string;
  class: string;
  summary: string;
  locations: PlantedLocation[];
}

export interface CleanControl {
  vector: string;
  files: string[];
}

export interface AnswerKey {
  key_format: 1;
  target: string;
  planted: PlantedEntry[];
  clean: CleanControl[];
}

/** The subset of a finding / candidate record the scorer reads. */
export interface ScoredFinding {
  surface: string;
  symptom: string;
  root_cause: string;
  location?: string;
  run_id?: string;
}

export interface PlantedResult {
  id: string;
  vector: string;
  class: string;
  caught: boolean;
}

export interface CleanResult {
  vector: string;
  false_positives: number;
}

export interface PlantedEvalReport {
  gating: false;
  planted_total: number;
  caught: number;
  planted: PlantedResult[];
  clean_controls: number;
  clean_controls_with_fp: number;
  false_positives_on_clean: number;
  clean: CleanResult[];
  other_findings: number;
  findings_scanned: number;
}

/** Default line slack: a reviewer citing the line just above/below a planted range still caught it. */
export const DEFAULT_LINE_SLACK = 3;

function fail(msg: string): never {
  throw new Error(`answer key: ${msg}`);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** Load and validate an answer key. Throws on any malformed entry. */
export function loadAnswerKey(path: string): AnswerKey {
  if (!existsSync(path)) fail(`not found: ${path}`);
  const doc = readYaml<Record<string, unknown>>(path);
  if (!doc || typeof doc !== "object") fail("not a mapping");
  if (doc.key_format !== 1) fail("key_format must be 1");
  if (!nonEmptyString(doc.target)) fail("target must be a non-empty string");
  if (!Array.isArray(doc.planted) || doc.planted.length === 0) fail("planted must be a non-empty list");
  if (!Array.isArray(doc.clean)) fail("clean must be a list");

  const ids = new Set<string>();
  const planted: PlantedEntry[] = doc.planted.map((raw: unknown, i: number) => {
    const e = raw as Record<string, unknown>;
    for (const f of ["id", "vector", "class", "summary"])
      if (!nonEmptyString(e?.[f])) fail(`planted[${i}].${f} must be a non-empty string`);
    const id = e.id as string;
    if (ids.has(id)) fail(`duplicate planted id ${id}`);
    ids.add(id);
    if (!Array.isArray(e.locations) || e.locations.length === 0)
      fail(`planted[${i}].locations must be a non-empty list`);
    const locations = e.locations.map((l: unknown, j: number) => {
      const loc = l as Record<string, unknown>;
      if (!nonEmptyString(loc?.file)) fail(`planted[${i}].locations[${j}].file must be a string`);
      const lines = loc.lines;
      if (
        !Array.isArray(lines) ||
        lines.length !== 2 ||
        !lines.every((n) => Number.isInteger(n) && (n as number) >= 1) ||
        (lines[0] as number) > (lines[1] as number)
      )
        fail(`planted[${i}].locations[${j}].lines must be [start, end] with 1 <= start <= end`);
      return { file: loc.file as string, lines: [lines[0], lines[1]] as [number, number] };
    });
    return {
      id,
      vector: e.vector as string,
      class: e.class as string,
      summary: e.summary as string,
      locations,
    };
  });

  const clean: CleanControl[] = doc.clean.map((raw: unknown, i: number) => {
    const c = raw as Record<string, unknown>;
    if (!nonEmptyString(c?.vector)) fail(`clean[${i}].vector must be a non-empty string`);
    if (!Array.isArray(c.files) || c.files.length === 0 || !c.files.every(nonEmptyString))
      fail(`clean[${i}].files must be a non-empty list of strings`);
    return { vector: c.vector as string, files: c.files as string[] };
  });

  const plantedVectors = new Set(planted.map((p) => p.vector));
  const plantedFiles = new Set(planted.flatMap((p) => p.locations.map((l) => l.file)));
  for (const c of clean) {
    if (plantedVectors.has(c.vector)) fail(`vector ${c.vector} is both planted and clean`);
    for (const f of c.files) if (plantedFiles.has(f)) fail(`file ${f} is both planted and clean`);
  }

  return { key_format: 1, target: doc.target as string, planted, clean };
}

/** A path-ish token, optionally followed by `:line` or `:start-end`. */
const LOCATION_RE = /([A-Za-z0-9_.\-/]+\.[A-Za-z0-9]+)(?::(\d+)(?:-(\d+))?)?/g;

export interface ParsedLocation {
  file: string;
  line?: number;
  lineEnd?: number;
}

/**
 * Pull every `path[:line[-end]]` out of a free-text `location`
 * ("app/x.rb:88 (GET /x)", "app/a.rb:3, app/b.rb:9-12", "app/x.rb#show").
 */
export function parseLocations(location: string | undefined): ParsedLocation[] {
  if (!location) return [];
  const out: ParsedLocation[] = [];
  for (const m of location.matchAll(LOCATION_RE)) {
    const file = m[1]!.replace(/^\.\//, "");
    if (!file.includes("/") && !/\.(rb|erb|ts|js|py|go|yml)$/.test(file)) continue;
    const loc: ParsedLocation = { file };
    if (m[2]) loc.line = Number(m[2]);
    if (m[3]) loc.lineEnd = Number(m[3]);
    out.push(loc);
  }
  return out;
}

function sameFile(cited: string, keyed: string): boolean {
  return cited === keyed || cited.endsWith(`/${keyed}`);
}

function toFinding(raw: unknown): ScoredFinding | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const dk = r.dedupe_key as Record<string, unknown> | undefined;
  if (!dk || !nonEmptyString(dk.surface)) return undefined;
  const f: ScoredFinding = {
    surface: dk.surface,
    symptom: typeof dk.symptom === "string" ? dk.symptom : "",
    root_cause: typeof dk.root_cause === "string" ? dk.root_cause : "",
  };
  if (typeof r.location === "string") f.location = r.location;
  if (typeof r.run_id === "string") f.run_id = r.run_id;
  return f;
}

function listFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  const out: string[] = [];
  for (const name of readdirSync(path).sort()) {
    const child = join(path, name);
    const st = statSync(child);
    if (st.isDirectory()) out.push(...listFiles(child));
    else if (name.endsWith(".json") || name.endsWith(".jsonl")) out.push(child);
  }
  return out;
}

/**
 * Collect finding-shaped records (anything carrying `dedupe_key.surface`) from a
 * findings jsonl, a candidates JSON array, or a directory of either (recursive).
 * Non-finding JSON (reviewed.json id lists, surfaces.json, …) is skipped, so a whole
 * run dir or `.nightshift/metrics/findings/` can be pointed at directly.
 */
export function collectFindings(path: string): ScoredFinding[] {
  if (!existsSync(path)) throw new Error(`findings path not found: ${path}`);
  const out: ScoredFinding[] = [];
  for (const file of listFiles(path)) {
    const text = readFileSync(file, "utf8");
    const values: unknown[] = [];
    if (file.endsWith(".jsonl")) {
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        try {
          values.push(JSON.parse(line));
        } catch {
          throw new Error(`malformed JSONL line in ${file}`);
        }
      }
    } else {
      let doc: unknown;
      try {
        doc = JSON.parse(text);
      } catch {
        throw new Error(`malformed JSON in ${file}`);
      }
      if (Array.isArray(doc)) values.push(...doc);
      else values.push(doc);
    }
    for (const v of values) {
      const f = toFinding(v);
      if (f) out.push(f);
    }
  }
  return out;
}

function dedupeFindings(findings: ScoredFinding[]): ScoredFinding[] {
  const seen = new Map<string, ScoredFinding>();
  for (const f of findings) {
    const k = `${f.surface}\u0000${f.symptom}\u0000${f.root_cause}\u0000${f.location ?? ""}`;
    if (!seen.has(k)) seen.set(k, f);
  }
  return [...seen.values()];
}

function catches(f: ScoredFinding, p: PlantedEntry, slack: number): boolean {
  for (const cited of parseLocations(f.location)) {
    for (const loc of p.locations) {
      if (!sameFile(cited.file, loc.file)) continue;
      if (cited.line === undefined) {
        if (f.surface === p.vector) return true;
        continue;
      }
      const citedEnd = cited.lineEnd ?? cited.line;
      if (cited.line <= loc.lines[1] + slack && citedEnd >= loc.lines[0] - slack) return true;
    }
  }
  return false;
}

function onClean(f: ScoredFinding, c: CleanControl): boolean {
  if (f.surface === c.vector) return true;
  return parseLocations(f.location).some((l) => c.files.some((file) => sameFile(l.file, file)));
}

export interface ScoreOpts {
  slack?: number;
  runId?: string;
}

/** Score findings against the key. Pure. */
export function scorePlanted(
  key: AnswerKey,
  findings: ScoredFinding[],
  opts: ScoreOpts = {},
): PlantedEvalReport {
  const slack = opts.slack ?? DEFAULT_LINE_SLACK;
  const scoped = dedupeFindings(
    opts.runId === undefined ? findings : findings.filter((f) => f.run_id === opts.runId),
  );

  const caughtIds = new Set<string>();
  const cleanCounts = new Map<string, number>(key.clean.map((c) => [c.vector, 0]));
  let other = 0;

  for (const f of scoped) {
    const hits = key.planted.filter((p) => catches(f, p, slack));
    if (hits.length > 0) {
      for (const p of hits) caughtIds.add(p.id);
      continue;
    }
    const control = key.clean.find((c) => onClean(f, c));
    if (control) {
      cleanCounts.set(control.vector, cleanCounts.get(control.vector)! + 1);
      continue;
    }
    other++;
  }

  const clean = key.clean.map((c) => ({ vector: c.vector, false_positives: cleanCounts.get(c.vector)! }));
  return {
    gating: false,
    planted_total: key.planted.length,
    caught: caughtIds.size,
    planted: key.planted.map((p) => ({
      id: p.id,
      vector: p.vector,
      class: p.class,
      caught: caughtIds.has(p.id),
    })),
    clean_controls: key.clean.length,
    clean_controls_with_fp: clean.filter((c) => c.false_positives > 0).length,
    false_positives_on_clean: clean.reduce((n, c) => n + c.false_positives, 0),
    clean,
    other_findings: other,
    findings_scanned: scoped.length,
  };
}

/** Human-readable report. */
export function formatReport(r: PlantedEvalReport): string {
  const lines = [
    "planted-vuln eval (report-only; never gates)",
    `  caught: ${r.caught}/${r.planted_total} planted`,
    ...r.planted.map((p) => `    [${p.caught ? "x" : " "}] ${p.id} ${p.vector} ${p.class}${p.caught ? "" : "  <- missed"}`),
    `  false positives on clean: ${r.false_positives_on_clean} finding(s) across ${r.clean_controls_with_fp}/${r.clean_controls} control(s)`,
    ...r.clean.filter((c) => c.false_positives > 0).map((c) => `    ${c.vector}: ${c.false_positives}`),
    `  other findings (outside the key): ${r.other_findings}`,
    `  scanned: ${r.findings_scanned} unique finding(s)`,
  ];
  return lines.join("\n") + "\n";
}

export interface RunPlantedEvalOpts {
  keyPath: string;
  findingsPath: string;
  runId?: string;
  slack?: number;
}

export function runPlantedEval(opts: RunPlantedEvalOpts): PlantedEvalReport {
  const key = loadAnswerKey(opts.keyPath);
  const findings = collectFindings(opts.findingsPath);
  return scorePlanted(key, findings, { runId: opts.runId, slack: opts.slack });
}
