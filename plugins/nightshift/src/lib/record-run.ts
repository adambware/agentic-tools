// bin/record logic (run-loop.md step 5). Consume decisions.json and durably write
// the stateful path: append the per-run metrics record, append finding lines (new +
// recurring last_seen bumps), and update each reviewed entry's last_reviewed/status.
// All writes are atomic / whole-line appends (E6). The CLI shell handles argv.
//
// Hardening (v3 A1/T5): checks run BEFORE the first durable append, in this
// order:
//   1. Provenance assert — decisions.json must carry this run's own identity.
//   2. Format validation — date and run_id are checked against strict patterns
//      before either is used to build a path, so a malformed/malicious value
//      (e.g. date "../../..") can never escape metricsDir.
//   3. Per-repo lock — acquired around the uniqueness scan, the claim, and all
//      appends, so two concurrent invocations for the same run_id can't both
//      pass the scan.
//   4. run_id uniqueness — a run_id already recorded in ANY month shard, OR
//      already holding a claim file (below), aborts.
// Real guarantee: nothing is written before provenance + format validation +
// the claim succeed, so a failure before that point leaves the metrics dir
// byte-identical to before the call. Once the claim file exists, a crash
// mid-append IS possible (findings and the run row are two separate appends)
// — that is by design: the claim makes the partial state diagnosable (it
// carries ts/date/lane) and refuses a naive retry loudly instead of silently
// re-appending and corrupting the FPR denominator. See each check below.
import { join } from "node:path";
import { existsSync, readdirSync, mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import type { Finding, RunMetrics, Lane } from "./types.js";
import { appendJsonl, readJsonl } from "./io.js";
import { openFindings } from "./findings-store.js";
import { updateRegistryState, type EntryState } from "./registry-write.js";
import type { Decisions } from "./dedupe-run.js";
import { acquireLock, type LockOpts } from "./lock.js";

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
  // findings_created is NOT injected — runRecord derives it from counts it
  // already trusts: confirmed + recurring + rejected_tier1 + rejected_tier2
  // (= proposed_count - suppressed). run-meta cannot compute it because it runs
  // before dedupe and so cannot know how many survivors will be suppressed.
  rejectedTier1: number;
  rejectedTier2: number;
  usageByModel: Record<string, number | string>;
  usageSpent: number | string;
  elapsed: number | string;
  // per-repo lock over the durable phase (uniqueness scan + claim + all
  // appends). Default path lives alongside metrics so any lane/run sharing
  // metricsDir serializes against each other. lock lets tests inject tiny
  // timeouts/fakes.
  lockPath?: string;
  lock?: LockOpts;
}

export interface RecordResult {
  runRecord: RunMetrics;
  findingsAppended: number;
  recurringBumped: number;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_ID_RE = /^[A-Za-z0-9_.-]+$/;

/** date flows straight into monthOf() -> the findings/runs file path. Format-only
 * check (not calendar validity — "2026-06-99" passes): the point is closing the
 * path-injection, e.g. date "../../.." escaping metricsDir. */
function assertValidDate(date: string, field: string): void {
  if (!DATE_RE.test(date)) {
    throw new Error(`${field} "${date}" must match YYYY-MM-DD`);
  }
}

/** run_id becomes a filename next (the claim below, and indirectly shard
 * contents), so reject anything that isn't filename-safe or that names the
 * current/parent directory. */
function assertValidRunId(runId: string): void {
  if (runId === "." || runId === ".." || !RUN_ID_RE.test(runId)) {
    throw new Error(`run_id "${runId}" must be filename-safe (matches ${RUN_ID_RE} and not "." or "..")`);
  }
}

/**
 * Scan every metrics/runs/*.jsonl month shard for an existing record with
 * run_id. Missing runs dir -> no records (first-ever run for this metricsDir).
 * Scans ALL months, not just the current one, because a retry of a run whose
 * date rolled past a month boundary must still be caught. Filters to *.jsonl
 * so the runs/.claims/ subdirectory (below) is never read as a shard — the
 * claims dir must never be named *.jsonl.
 */
function findExistingRunId(metricsDir: string, runId: string): boolean {
  const runsDir = join(metricsDir, "runs");
  if (!existsSync(runsDir)) return false;
  const shards = readdirSync(runsDir).filter((f) => f.endsWith(".jsonl"));
  for (const shard of shards) {
    const records = readJsonl<{ run_id: string }>(join(runsDir, shard));
    if (records.some((r) => r.run_id === runId)) return true;
  }
  return false;
}

export function runRecord(opts: RecordOpts): RecordResult {
  // 1. PROVENANCE ASSERT — decisions.json must carry this run's own identity
  // (run_id/lane/date, sourced from run-meta). A decisions.json left over from
  // another run (forged or stale) can therefore never be replayed into this
  // run's durable appends. Runs before the lock: no I/O has happened yet, so
  // there is nothing to serialize against for this check alone.
  if (opts.decisions.run_id !== opts.runId) {
    throw new Error(
      `decisions.run_id "${opts.decisions.run_id}" does not match run-meta run_id "${opts.runId}"`,
    );
  }
  if (opts.decisions.lane !== opts.lane) {
    throw new Error(
      `decisions.lane "${opts.decisions.lane}" does not match run-meta lane "${opts.lane}"`,
    );
  }
  if (opts.decisions.date !== opts.date) {
    throw new Error(
      `decisions.date "${opts.decisions.date}" does not match run-meta date "${opts.date}"`,
    );
  }

  // 1b. FORMAT VALIDATION — date and run_id are checked before either is used
  // to build a path (monthOf(date) below, the claim filename further down).
  // Runs before the lock for the same reason as the provenance assert: no I/O
  // has happened yet, nothing to serialize against.
  assertValidDate(opts.date, "date");
  assertValidDate(opts.decisions.date, "decisions.date");
  assertValidRunId(opts.runId);

  const lockPath = opts.lockPath ?? join(opts.metricsDir, ".lock");
  const lock = acquireLock(lockPath, opts.lock);
  try {
    // 2. RUN_ID UNIQUENESS (idempotency) — the launcher flow is record ->
    // record-cost -> dashboard -> clean; a failure AFTER record invites a retry
    // that would otherwise double-append findings and inflate the FPR
    // denominator. Must run inside the lock: otherwise two concurrent
    // invocations for the same run_id could both observe "not yet recorded"
    // and both append.
    if (findExistingRunId(opts.metricsDir, opts.runId)) {
      throw new Error(`run_id already recorded: ${opts.runId}`);
    }

    // 2b. ATOMIC CLAIM — the scan above only reads runs/*.jsonl, so it can't
    // see a crash between the findings append and the runs-row append below
    // (two separate appends, same call). openSync(..., "wx") is O_CREAT|O_EXCL:
    // creating this file is the atomic uniqueness token, immune to the same
    // races the scan is exposed to. EEXIST means either a true concurrent
    // duplicate or (far more likely) a retry after a partial write from this
    // very run_id — either way we refuse loudly rather than silently
    // re-appending, which would corrupt the FPR denominator; a human has to
    // look. Claims are never deleted, even on later success elsewhere. The
    // written content (ts/date/lane) is for that human's diagnosis only, not
    // read back by this code.
    const claimsDir = join(opts.metricsDir, "runs", ".claims");
    mkdirSync(claimsDir, { recursive: true });
    const claimPath = join(claimsDir, opts.runId);
    try {
      const fd = openSync(claimPath, "wx");
      try {
        writeSync(fd, JSON.stringify({ ts: opts.ts, date: opts.date, lane: opts.lane }) + "\n");
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`run_id already recorded (claim exists): ${opts.runId}`);
      }
      throw err;
    }

    // Exclusion is near-certain but not absolute (see lock.ts header): re-check
    // ownership before entering the append section, so a lock lost to age-based
    // recovery aborts loudly (exit 2, claim already burned, human diagnoses).
    // The appends themselves are tolerable even under a lost lock -- each is a
    // single whole-line O_APPEND write (interleaved but never torn; measured
    // clean to 100KB lines) and the findings store folds LWW per dedupe_key --
    // so this check narrows exposure; it is the registry rewrite below that
    // strictly needs one.
    lock.assertHeld();

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
    // findings_created = confirmed + recurring + rejected_tier1 + rejected_tier2
    //   = proposed_count - suppressed  (FPR denominator; excludes suppressed).
    const findings_created =
      opts.decisions.counts.confirmed +
      opts.decisions.counts.recurring +
      opts.rejectedTier1 +
      opts.rejectedTier2;
    const runRecordRow: RunMetrics = {
      run_id: opts.runId,
      ts: opts.ts,
      date: opts.date,
      lane: opts.lane,
      pack_sha: opts.packSha,
      selected: opts.selected,
      reviewed: opts.reviewed,
      findings_created,
      confirmed: opts.decisions.counts.confirmed,
      rejected_tier1: opts.rejectedTier1,
      rejected_tier2: opts.rejectedTier2,
      suppressed: opts.decisions.counts.suppressed,
      usage_by_model: opts.usageByModel,
      usage_spent: opts.usageSpent,
      elapsed: opts.elapsed,
    };
    appendJsonl(runsPath, runRecordRow);

    // Update reviewed entries' state: last_reviewed=today; status=open-findings if a
    // surface has an open finding, else green (just reviewed -> staleness 0).
    // The registry rewrite is a read-modify-write with no CAS — under a lost
    // lock a concurrent writer's stamps would be silently dropped (an area with
    // open findings could show green). So assertHeld goes AFTER openFindings
    // (which reads and parses every findings shard — 5-30ms+ on a mature pack,
    // an eternity next to a rename) and immediately before the rewrite,
    // leaving only the update-map construction inside the exposure window.
    if (opts.registryPath && opts.reviewedIds.length > 0) {
      const openSurfaces = new Set(openFindings(opts.metricsDir).map((f) => f.dedupe_key.surface));
      const updates = new Map<string, EntryState>();
      for (const id of opts.reviewedIds) {
        updates.set(id, {
          last_reviewed: opts.date,
          status: openSurfaces.has(id) ? "open-findings" : "green",
        });
      }
      lock.assertHeld();
      updateRegistryState(opts.registryPath, updates);
    }

    return { runRecord: runRecordRow, findingsAppended, recurringBumped };
  } finally {
    lock.release();
  }
}
