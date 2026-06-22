// Orchestration for bin/select: load registry + manifest, select top-K, write
// surfaces.json atomically. Pure of process.argv so it is fully unit-testable
// (E7 full-branch coverage). The CLI shell (src/bin/select.ts) only parses args.
import { existsSync } from "node:fs";
import type { Lane, Surface, RegistryEntry } from "./types.js";
import { readYaml, writeJson } from "./io.js";
import { extractEntries } from "./registry.js";
import { selectSurfaces } from "./staleness.js";
import { makeGitRunner, type GitRunner } from "./git.js";

export interface RunSelectOpts {
  vectorsPath: string;
  manifestPath: string;
  lane: Lane;
  today: string;
  repo: string;
  outPath: string;
  /** Injectable for tests; defaults to a real git runner over `repo`. */
  git?: GitRunner;
}

export interface RunSelectResult {
  k: number;
  selected: number;
  surfaces: Surface[];
}

function readK(manifestPath: string, lane: Lane): number {
  if (!existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);
  const manifest = readYaml<{ window_budget_k?: Record<string, unknown> }>(manifestPath);
  const k = manifest?.window_budget_k?.[lane];
  if (typeof k !== "number" || !Number.isInteger(k) || k < 0)
    throw new Error(`manifest.window_budget_k.${lane} must be a non-negative integer`);
  return k;
}

export function runSelect(opts: RunSelectOpts): RunSelectResult {
  if (!existsSync(opts.vectorsPath)) throw new Error(`registry not found: ${opts.vectorsPath}`);
  const k = readK(opts.manifestPath, opts.lane);
  const doc = readYaml(opts.vectorsPath);
  const entries: RegistryEntry[] = extractEntries(doc, opts.lane);
  const git = opts.git ?? makeGitRunner(opts.repo);
  const surfaces = selectSurfaces(entries, {
    today: opts.today,
    k,
    changedFilesFor: (e) => git.changedFilesSince(e.last_reviewed),
  });
  writeJson(opts.outPath, surfaces);
  return { k, selected: surfaces.length, surfaces };
}
