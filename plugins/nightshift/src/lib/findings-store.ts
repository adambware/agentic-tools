// Read the append-only findings log and fold it to current state. The log is
// LWW-per-dedupe_key (a recurring finding is re-appended with a bumped last_seen,
// mirroring daily.jsonl); the reader takes the last line per key.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./types.js";
import { readJsonl } from "./io.js";
import { dedupeKeyString, isOpen } from "./dedupekey.js";

/** All finding lines across monthly shards, in append order. */
export function readAllFindings(metricsDir: string): Finding[] {
  const dir = join(metricsDir, "findings");
  if (!existsSync(dir)) return [];
  const shards = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  const out: Finding[] = [];
  for (const shard of shards) out.push(...readJsonl<Finding>(join(dir, shard)));
  return out;
}

/** Fold to the latest line per dedupe_key (LWW). */
export function foldFindings(findings: Finding[]): Map<string, Finding> {
  const byKey = new Map<string, Finding>();
  for (const f of findings) byKey.set(dedupeKeyString(f.dedupe_key), f);
  return byKey;
}

/** Current open findings (latest-per-key, not resolved). */
export function openFindings(metricsDir: string): Finding[] {
  return [...foldFindings(readAllFindings(metricsDir)).values()].filter(isOpen);
}
