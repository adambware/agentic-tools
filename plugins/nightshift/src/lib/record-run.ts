// bin/record logic (run-loop.md step 5). Consume decisions.json and durably write
// the stateful path: append the per-run metrics record, append finding lines (new +
// recurring last_seen bumps), and update each reviewed entry's last_reviewed/status.
// All writes are atomic / whole-line appends (E6). The CLI shell handles argv.
import { join } from "node:path";
import type { Finding, RunMetrics, Lane } from "./types.js";
import { appendJsonl } from "./io.js";
import { openFindings } from "./findings-store.js";
import { updateRegistryState, type EntryState } from "./registry-write.js";
import type { Decisions } from "./dedupe-run.js";

export interface RecordOpts {
  decisions: Decisions;
  metricsDir: string;
  registryPath?: string;
  reviewedIds: string[];
  // run metadata + judgment-derived counts (injected; record never invents them)
  runId: string;
  lane: Lane;
  date: string;
  ts: string;
  packSha: string;
  selected: number;
  reviewed: number;
  findingsCreated: number;
  rejectedTier1: number;
  rejectedTier2: number;
  usageByModel: Record<string, number | string>;
  usageSpent: number | string;
  elapsed: number | string;
}

export interface RecordResult {
  runRecord: RunMetrics;
  findingsAppended: number;
  recurringBumped: number;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function runRecord(opts: RecordOpts): RecordResult {
  const month = monthOf(opts.date);
  const findingsPath = join(opts.metricsDir, "findings", `${month}.jsonl`);
  const runsPath = join(opts.metricsDir, "runs", `${month}.jsonl`);

  let findingsAppended = 0;
  let recurringBumped = 0;

  // (b) Append confirmed findings + recurring last_seen bumps.
  for (const d of opts.decisions.decisions) {
    if (d.decision === "suppressed") continue;
    const first_seen = d.decision === "recurring" ? d.first_seen : opts.date;
    const finding: Finding = {
      ...d.finding,
      first_seen,
      last_seen: opts.date,
      run_id: opts.runId,
    };
    appendJsonl(findingsPath, finding);
    if (d.decision === "new") findingsAppended++;
    else recurringBumped++;
  }

  // (a) Append the per-run record. confirmed = newly-logged findings; suppressed
  // from the decisions; the refuter-derived counts are injected.
  const runRecord: RunMetrics = {
    run_id: opts.runId,
    ts: opts.ts,
    date: opts.date,
    lane: opts.lane,
    pack_sha: opts.packSha,
    selected: opts.selected,
    reviewed: opts.reviewed,
    findings_created: opts.findingsCreated,
    confirmed: opts.decisions.counts.confirmed,
    rejected_tier1: opts.rejectedTier1,
    rejected_tier2: opts.rejectedTier2,
    suppressed: opts.decisions.counts.suppressed,
    usage_by_model: opts.usageByModel,
    usage_spent: opts.usageSpent,
    elapsed: opts.elapsed,
  };
  appendJsonl(runsPath, runRecord);

  // Update reviewed entries' state: last_reviewed=today; status=open-findings if a
  // surface has an open finding, else green (just reviewed -> staleness 0).
  if (opts.registryPath && opts.reviewedIds.length > 0) {
    const openSurfaces = new Set(openFindings(opts.metricsDir).map((f) => f.dedupe_key.surface));
    const updates = new Map<string, EntryState>();
    for (const id of opts.reviewedIds) {
      updates.set(id, {
        last_reviewed: opts.date,
        status: openSurfaces.has(id) ? "open-findings" : "green",
      });
    }
    updateRegistryState(opts.registryPath, updates);
  }

  return { runRecord, findingsAppended, recurringBumped };
}
