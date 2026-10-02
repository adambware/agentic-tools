// Orchestration for bin/dedupe: load the validated candidates, the open-findings
// log, and active suppressions; partition; write decisions.json atomically.
import { existsSync } from "node:fs";
import type { CandidateFinding, Suppression, Lane } from "./types.js";
import { readJson, readYaml, writeJson } from "./io.js";
import { openFindings } from "./findings-store.js";
import { dedupe, type Decisions } from "./dedupe-run.js";

export interface RunDedupeOpts {
  candidatesPath: string;
  metricsDir: string;
  suppressionsPath: string;
  outPath: string;
  runId: string;
  lane: Lane;
  today: string;
}

function loadSuppressions(path: string): Suppression[] {
  if (!existsSync(path)) return [];
  const doc = readYaml<{ suppressions?: Suppression[] } | Suppression[]>(path);
  if (!doc) return [];
  const list = Array.isArray(doc) ? doc : doc.suppressions;
  return Array.isArray(list) ? list : [];
}

export function runDedupe(opts: RunDedupeOpts): Decisions {
  if (!existsSync(opts.candidatesPath))
    throw new Error(`candidates not found: ${opts.candidatesPath}`);
  const candidates = readJson<CandidateFinding[]>(opts.candidatesPath);
  if (!Array.isArray(candidates))
    throw new Error("candidates file must contain a JSON array");
  const result = dedupe({
    run_id: opts.runId,
    lane: opts.lane,
    today: opts.today,
    candidates,
    openFindings: openFindings(opts.metricsDir),
    suppressions: loadSuppressions(opts.suppressionsPath),
  });
  writeJson(opts.outPath, result);
  return result;
}
