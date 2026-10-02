// Real-multiprocess stress for the lock. Single-process tests can only check
// the interleavings they script; the defects this file guards against were
// syscall-window races between separate processes, so the only honest test
// spawns real ones. Children run the BUILT lock (bundled once in beforeAll --
// node cannot import the TS source) and prove mutual exclusion the same way an
// OS would: an O_EXCL sentinel that must never already exist when a holder
// enters the critical section.
//
// The tuning matters. The races here are single-syscall windows, so the
// sentinel-overlap check is a sampling experiment and its sensitivity is the
// sample rate: a very short critical section (a 50us spin, not a millisecond
// sleep) to maximise acquisitions, and pollMs: 0 so waiters re-read the lock
// file continuously. Calibrated against the ORIGINAL (pre-link(2))
// implementation, which it catches at 1-4 violations per ~650 acquisitions.
// It has near-ZERO power against unserialized-recovery regressions (removing
// the recovery mutex passed the overlap check 10/10 at these hold times) --
// which is why the load-bearing assertion below is the SUBSTITUTION COUNT
// instead: every injected stale lock admits exactly one substitution under
// serialized recovery, while unserialized recoverers pile substitutions on
// each other's live records (~7x, measured in 10/10 control runs). Keep the
// hold short, the poll at 0, and the substitution invariant if you touch this.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLock } from "./lock.js";

const RUN_MS = 5000;
const CHILDREN = 8;

let dir: string;
let driverPath: string;

/** The child driver. Plain JS (children can't load TS) and imports nothing but
 * node builtins plus the bundled lock, so what it exercises is the lock alone. */
const DRIVER = `
import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { acquireLock } from "./lock.mjs";

const [lockPath, sentinelPath, endAtRaw] = process.argv.slice(2);
const endAt = Number(endAtRaw);
const me = String(process.pid);

/** Busy-wait, not a sleep: the critical section has to be wide enough that two
 * simultaneous holders overlap, but short enough to keep acquisitions cheap. */
function spin(ns) {
  const end = process.hrtime.bigint() + BigInt(ns);
  while (process.hrtime.bigint() < end);
}

let acquisitions = 0;
let violations = 0;
let timeouts = 0;
let substitutions = 0;

while (Date.now() < endAt) {
  let release;
  try {
    // staleMs stays large: age-based stealing of a live holder is the lock's
    // documented residual, not something this test should manufacture.
    release = acquireLock(lockPath, {
      timeoutMs: 5000,
      pollMs: 0,
      staleMs: 30 * 60000,
      onRecoverySubstitute: () => substitutions++,
    });
  } catch {
    timeouts++;
    continue;
  }
  try {
    let fd;
    try {
      fd = openSync(sentinelPath, "wx"); // EEXIST == someone else is inside
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      violations++;
      continue; // do NOT unlink: the sentinel is theirs
    }
    writeSync(fd, me);
    closeSync(fd);
    spin(50000);
    try {
      if (readFileSync(sentinelPath, "utf8") !== me) violations++;
    } catch {
      violations++; // vanished under us
    }
    unlinkSync(sentinelPath);
    acquisitions++;
  } finally {
    release.release();
  }
}

process.stdout.write(JSON.stringify({ acquisitions, violations, timeouts, substitutions }));
`;

interface ChildResult {
  acquisitions: number;
  violations: number;
  timeouts: number;
  substitutions: number;
}

function runChild(lockPath: string, sentinelPath: string, endAt: number): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driverPath, lockPath, sentinelPath, String(endAt)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`driver exited ${code}: ${err}`));
      try {
        resolve(JSON.parse(out) as ChildResult);
      } catch {
        reject(new Error(`unparseable driver output: ${out}\n${err}`));
      }
    });
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plant junk in the lock file the only safe way: legitimately acquire it,
 * overwrite the record, then abandon it without releasing. That injects a
 * broken/dead lock for the children to recover without ever clobbering a live
 * holder's record (which would be a test-manufactured violation, not a bug). */
function injectAbandonedLock(lockPath: string, content: string): void {
  const release = acquireLock(lockPath, { timeoutMs: 10_000, pollMs: 2 });
  writeFileSync(lockPath, content);
  void release; // deliberately never released; also a no-op now (nonce is gone)
}

describe("acquireLock under real multiprocess contention", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ns-lock-stress-"));
    driverPath = join(dir, "driver.mjs");
    await build({
      entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "lock.ts")],
      outfile: join(dir, "lock.mjs"),
      bundle: true,
      format: "esm",
      platform: "node",
    });
    writeFileSync(driverPath, DRIVER);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("never lets two processes into the critical section", async () => {
    const packDir = join(dir, "pack");
    const lockPath = join(packDir, ".lock");
    const sentinelPath = join(packDir, ".sentinel");
    const endAt = Date.now() + RUN_MS;

    const children = Array.from({ length: CHILDREN }, () => runChild(lockPath, sentinelPath, endAt));

    // Mid-run, drive both stale-recovery paths through live contention, MANY
    // times. This is where the old implementation broke: every waiter judges
    // the same lock stale at once, and an unserialized recovery lets two of
    // them substitute over each other (~1 double-hold per ~110 racing
    // recoveries pre-mutex). Two injections gave that defect a ~2% chance of
    // showing; a few dozen give real detection power while the recovery mutex
    // keeps the true rate at zero. Alternate corrupt bytes with a dead-pid
    // record (pid far above pid_max: process.kill(pid,0) -> ESRCH -> dead).
    await delay(500);
    let injected = 0;
    for (let i = 0; i < 25 && Date.now() < endAt - 200; i++) {
      injectAbandonedLock(
        lockPath,
        i % 2 === 0
          ? "{ not valid json"
          : JSON.stringify({ pid: 999999, nonce: `dead-${i}`, acquired_at_ms: Date.now() }),
      );
      injected++;
      await delay(60);
    }

    const results = await Promise.all(children);
    const total = results.reduce(
      (acc, r) => ({
        acquisitions: acc.acquisitions + r.acquisitions,
        violations: acc.violations + r.violations,
        timeouts: acc.timeouts + r.timeouts,
        substitutions: acc.substitutions + r.substitutions,
      }),
      { acquisitions: 0, violations: 0, timeouts: 0, substitutions: 0 },
    );

    expect(total.violations).toBe(0);
    expect(total.timeouts).toBe(0);
    // THE load-bearing recovery assertion (see file header): each injected
    // stale lock admits exactly one substitution under serialized recovery.
    // More means recoverers substituted over each other's live records --
    // deterministic ~7x signal for a de-serialized recovery path. Fewer than 1
    // would mean the recovery path never ran and the run proves nothing.
    expect(total.substitutions).toBeGreaterThanOrEqual(1);
    expect(total.substitutions).toBeLessThanOrEqual(injected);
    // Guards against a vacuously clean run. Every child must have taken the
    // lock, so all eight really contended, and the total must be big enough for
    // the sampling to mean something. It is a floor, not a throughput SLO: a
    // quiet machine lands near 400, but this file can run in parallel with the
    // other multiprocess stress test, which roughly halves it.
    expect(results.every((r) => r.acquisitions > 0)).toBe(true);
    // Floor, not a throughput SLO: ~400 alone on a quiet machine, but this file
    // runs alongside two other multiprocess stress suites whose children steal
    // the machine, and the injector holds the lock ~25 times per run itself.
    expect(total.acquisitions).toBeGreaterThan(80);
    // The temp path is private to one acquisition and the recovery mutex is
    // released on every exit path, so a real run leaves nothing behind but (at
    // most) the lock itself.
    const leftovers = existsSync(packDir)
      ? readdirSync(packDir).filter((f) => f.endsWith(".tmp") || f.endsWith(".recovery"))
      : [];
    expect(leftovers).toEqual([]);
  }, 30_000);
});
