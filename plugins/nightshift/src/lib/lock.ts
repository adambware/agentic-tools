// Per-repo lockfile for the nightshift engine (plan §9.11). Serializes lane
// runs against the same .nightshift/ pack so two concurrent runs never
// interleave writes to the same repo's stateful path.
//
// The lock file holds a JSON {pid, nonce, acquired_at_ms} record. The nonce is
// fresh per acquireLock() call and is what identifies a holder: a pid alone is
// reused across acquisitions (and across processes), so pid-only ownership
// checks can confuse a previous holder with the current one.
//
// CREATE is atomic with its content: the record is written to a unique temp
// file and link(2)ed into place. link(2) fails EEXIST if the lock already
// exists, so exactly one creator wins -- and unlike open('wx') followed by a
// second write, the lock file is never observable empty or half-written, so a
// concurrent acquirer can never mistake a freshly published lock for corrupt
// (i.e. stale) and blow it away. After a winning link we re-read the lock and
// confirm the nonce is ours; a mismatch means someone recovered it out from
// under us in that window, so we did not acquire and simply retry.
//
// EEXIST means someone else holds (or held) it:
//   - live -> sleep pollMs and retry until timeoutMs elapses, then throw.
//   - stale (owner pid dead, lock older than staleMs, or content
//     unreadable/corrupt) -> substitute our record for it and retry
//     immediately, no sleep, no deadline consumed (recovery is not "waiting").
// "Blocks, then proceeds": a waiter that outlives the holder's release()
// acquires normally on its next poll, no different from any other retry.
//
// RECOVERY never unlinks a stale lock, because "read it, judge it stale, delete
// whatever is there now" deletes a live lock that landed in the window between
// the read and the delete -- and worse, any recovery that leaves the lock file
// even briefly absent lets a waiter's create win while the real holder is still
// running. Instead recovery is an atomic substitution: we re-read and require
// the bytes to be exactly the bytes we judged stale, then rename(2) our own
// record over the lock. rename(2) replaces the name in one step, so the lock
// file is never absent, never empty, and never anything but one valid record.
//
// Recovery is additionally SERIALIZED through a short-lived recovery mutex
// (`<lockPath>.recovery`). Without it, the confirm-read + rename pair is not a
// compare-and-swap: two recoverers judging the same stale lock can both pass
// the confirm-read before either renames, and the second rename silently
// replaces the first recoverer's now-live record (measured at ~1 per ~110
// racing recoveries before the mutex). The mutex is created the SAME WAY the
// lock is -- record written to a private temp, link(2)ed into place -- because
// an open('wx')-then-write mutex is observable as a zero-length file between
// the two syscalls, which a rival reads as unreadable, judges abandoned, and
// blind-unlinks: the mutex would reintroduce the very race it exists to close
// (measured: ~6 double-entries per ~1300 mutex acquisitions with 'wx'; zero
// with link(2)). A mutex whose record is unreadable, older than
// RECOVERY_MUTEX_STALE_MS, or dated in the FUTURE (a clock step backwards --
// otherwise a leaked future-dated mutex wedges recovery forever) belonged to a
// crashed recoverer and is cleared. That clear is the residual race, and
// reaching it now requires a recoverer to crash inside a microsecond-scale
// critical section AND two more recoverers to then collide across the 5s
// boundary.
//
// release() unlinks only if the record on disk still carries OUR nonce, so a
// lock that was recovered and handed to a new owner is never deleted by the
// previous owner. Idempotent: a missing file, or a file owned by anyone else,
// is a silent no-op.
//
// Residual, accepted: staleness is partly age-based, so a live-but-descheduled
// holder that runs past staleMs can be recovered out from under. Exclusion is
// therefore near-certain but not absolute, and the durable path does not rely
// on it alone: holders re-check ownership at the moments that matter via
// assertHeld() (read the lock, throw if the nonce is no longer ours), and
// record-run's claim marker keeps any double-holder from double-appending.
// assertHeld() shrinks the damage window of a lost lock from "the whole
// durable phase" to the syscalls between the check and the next write.
import { writeFileSync, readFileSync, unlinkSync, renameSync, linkSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

export interface LockOpts {
  staleMs?: number; // default 30*60_000: an existing lock older than this is stale
  timeoutMs?: number; // default 60_000: how long to wait for a live held lock
  pollMs?: number; // default 200
  now?: () => number; // injectable clock (Date.now)
  sleep?: (ms: number) => void; // injectable blocking sleep (default: Atomics.wait on a SharedArrayBuffer)
  pid?: number; // injectable owner pid (default process.pid)
  isPidAlive?: (pid: number) => boolean; // default: process.kill(pid, 0) probe, EPERM counts as alive
  // Observability hook: fires once per successful stale-lock substitution.
  // The stress test asserts substitutions == recoverable stale locks -- an
  // unserialized recovery piles substitutions on each other's live records
  // (~7x), so this equality is a deterministic regression detector where
  // sentinel-overlap sampling has near-zero power at realistic hold times.
  onRecoverySubstitute?: () => void;
}

interface LockRecord {
  pid: number;
  nonce: string;
  acquired_at_ms: number;
}

const DEFAULT_STALE_MS = 30 * 60_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 200;
// A recovery-mutex holder is inside a microsecond-scale critical section; one
// this old crashed there and may be cleared so recovery is never wedged.
const RECOVERY_MUTEX_STALE_MS = 5_000;

/** A held lock. release() gives it up; assertHeld() throws if the lock is no
 * longer ours (recovered out from under us) -- callers place it immediately
 * before durable mutations so a lost lock aborts loudly instead of corrupting. */
export interface LockHandle {
  release(): void;
  assertHeld(): void;
}

/** process.kill(pid, 0) liveness probe. EPERM means the process exists but we
 * can't signal it (different user) -> alive. Any other error (ESRCH, etc.) -> dead. */
function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Blocking sleep with no timers/async, so acquireLock stays a plain sync call. */
function defaultSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** What a lock file looked like at one instant: the raw bytes (undefined =
 * no file) and the parsed record (undefined = no file, or unreadable junk). */
interface LockObservation {
  text: string | undefined;
  record: LockRecord | undefined;
}

const MISSING: LockObservation = { text: undefined, record: undefined };

function observeLock(path: string): LockObservation {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return MISSING;
  }
  try {
    const parsed = JSON.parse(text) as Partial<LockRecord>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.acquired_at_ms !== "number"
    ) {
      return { text, record: undefined };
    }
    return { text, record: { pid: parsed.pid, nonce: parsed.nonce, acquired_at_ms: parsed.acquired_at_ms } };
  } catch {
    return { text, record: undefined };
  }
}

/** Recovery's identity test: are these the same bytes? Byte equality is what
 * recovery needs rather than record equality, because it also tells one piece
 * of junk from another, and it never lets "the file is missing" pass for "the
 * corrupt file I judged stale" -- a conflation that turns a herd of recoverers
 * loose on whichever one of them just won. */
function sameBytes(a: LockObservation, b: LockObservation): boolean {
  return a.text !== undefined && a.text === b.text;
}

function isStale(
  observed: LockObservation,
  nowMs: number,
  staleMs: number,
  isPidAlive: (pid: number) => boolean,
): boolean {
  const record = observed.record;
  if (record === undefined) return true; // missing, or unreadable junk
  if (!isPidAlive(record.pid)) return true;
  return nowMs - record.acquired_at_ms >= staleMs;
}

function unlinkQuiet(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Acquire the per-repo lock; returns a LockHandle. Throws on timeout. */
export function acquireLock(lockPath: string, opts: LockOpts = {}): LockHandle {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const pid = opts.pid ?? process.pid;
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;

  mkdirSync(dirname(lockPath), { recursive: true });

  // One nonce per acquireLock() call, reused across retries: it names this
  // acquisition attempt, and doubles as the private suffix for our temp path
  // so no two acquirers can collide on it.
  const nonce = randomBytes(12).toString("hex");
  const tmpPath = `${lockPath}.${pid}.${nonce}.tmp`;

  const deadline = now() + timeoutMs;
  for (;;) {
    const record: LockRecord = { pid, nonce, acquired_at_ms: now() };
    let created = false;
    try {
      writeFileSync(tmpPath, JSON.stringify(record));
      try {
        linkSync(tmpPath, lockPath); // EEXIST = someone else holds it
        created = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    } finally {
      unlinkQuiet(tmpPath);
    }

    // Whether the link won or hit EEXIST, the file decides: the nonce on disk
    // is the holder. Ours means either our link just won, or our recovery
    // substitution landed on a previous pass through this loop.
    const observed = observeLock(lockPath);
    if (observed.record?.nonce === nonce) return makeHandle(lockPath, nonce, pid);
    if (created) continue; // linked, then recovered out from under us -> retry

    if (isStale(observed, now(), staleMs, isPidAlive)) {
      const acted = recoverStale(lockPath, tmpPath, record, observed, pid, nonce, now, opts.onRecoverySubstitute);
      // The re-read at the top of the loop is what decides whether the
      // substitution was ours. Recovering is not waiting, so it costs no sleep
      // and no deadline -- unless another recoverer holds the recovery mutex,
      // in which case we yield one poll and let it finish.
      if (acted) continue;
    }

    if (now() >= deadline) {
      const ownerPid = observeLock(lockPath).record?.pid ?? observed.record?.pid ?? "unknown";
      throw new Error(`nightshift: timed out waiting for lock at ${lockPath} (held by pid ${ownerPid})`);
    }
    sleep(pollMs);
  }
}

/** Recover a lock judged stale by substituting our record for it, in place and
 * atomically, serialized against other recoverers by the recovery mutex.
 * Returns true if this process got to attempt the recovery (the caller
 * re-reads to learn whether the substitution was ours), false if another
 * recoverer held the mutex and the caller should wait a poll instead. */
function recoverStale(
  lockPath: string,
  tmpPath: string,
  record: LockRecord,
  observed: LockObservation,
  pid: number,
  nonce: string,
  now: () => number,
  onSubstitute?: () => void,
): boolean {
  const mutexPath = `${lockPath}.recovery`;
  if (!tryAcquireRecoveryMutex(mutexPath, pid, nonce, now)) return false;
  try {
    // Confirm INSIDE the mutex, right before acting: the confirm-read + rename
    // pair below is not a compare-and-swap on its own, so without the mutex two
    // recoverers could both pass this check before either renames, and the
    // second would silently replace the first's now-live record.
    if (!sameBytes(observeLock(lockPath), observed)) return true;

    try {
      writeFileSync(tmpPath, JSON.stringify(record));
      // rename(2) replaces the name atomically: at no instant does lockPath fail
      // to exist, so no waiter's create can win in a gap, and no reader can see a
      // partial record. Contrast unlink-then-create, which is exactly such a gap.
      renameSync(tmpPath, lockPath);
      onSubstitute?.();
    } finally {
      unlinkQuiet(tmpPath); // already renamed away on the happy path -> ENOENT
    }
    return true;
  } finally {
    releaseRecoveryMutex(mutexPath, nonce);
  }
}

/** Create the recovery mutex atomically-with-content (temp + link(2), exactly
 * like the lock itself: an open('wx')-then-write mutex is briefly a zero-length
 * file, which rivals read as abandoned and blind-clear -- reintroducing the
 * double-recovery the mutex exists to prevent). An existing mutex is honored
 * (-> false) only while its record is readable AND its age is in
 * [0, RECOVERY_MUTEX_STALE_MS): unreadable, too old, or future-dated (a
 * backwards clock step -- otherwise a leaked future-dated mutex wedges
 * recovery forever) means its owner crashed; clear it and try once more. */
function tryAcquireRecoveryMutex(
  mutexPath: string,
  pid: number,
  nonce: string,
  now: () => number,
): boolean {
  const tmp = `${mutexPath}.${pid}.${nonce}.tmp`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let linked = false;
    try {
      writeFileSync(tmp, JSON.stringify({ pid, nonce, acquired_at_ms: now() }));
      try {
        linkSync(tmp, mutexPath);
        linked = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    } finally {
      unlinkQuiet(tmp);
    }
    if (linked) return true;
    const holder = observeLock(mutexPath).record;
    const age = holder === undefined ? Number.NaN : now() - holder.acquired_at_ms;
    const fresh = holder !== undefined && age >= 0 && age < RECOVERY_MUTEX_STALE_MS;
    if (fresh) return false;
    unlinkQuiet(mutexPath); // crashed recoverer -> clear, retry once
  }
  return false;
}

function releaseRecoveryMutex(mutexPath: string, nonce: string): void {
  const record = observeLock(mutexPath).record;
  // Unlink only what is provably ours. An unreadable record here means the
  // mutex is not the one we link(2)ed (ours always has content) -- leave it to
  // the staleness clear rather than blind-unlink someone else's.
  if (record === undefined || record.nonce !== nonce) return;
  unlinkQuiet(mutexPath);
}

function makeHandle(lockPath: string, nonce: string, pid: number): LockHandle {
  return {
    release(): void {
      const record = observeLock(lockPath).record;
      if (record === undefined || record.nonce !== nonce) return; // gone, or no longer ours -> no-op
      unlinkQuiet(lockPath);
    },
    assertHeld(): void {
      const record = observeLock(lockPath).record;
      if (record === undefined || record.nonce !== nonce) {
        const holder = record === undefined ? "no one" : `pid ${record.pid}`;
        throw new Error(
          `nightshift: lock at ${lockPath} lost by pid ${pid} (now held by ${holder}); ` +
            `aborting before any further durable write`,
        );
      }
    },
  };
}
