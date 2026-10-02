import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "./lock.js";

let dir: string;
let lockDir: string;
let lockPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-lock-"));
  lockDir = join(dir, "sub");
  lockPath = join(lockDir, ".lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A fake clock + no-op sleep pair: sleep(ms) advances the same clock the lock
 * code reads via now(), so a real test runs in microseconds while still
 * exercising the poll-until-timeout path deterministically. */
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function readRecord(path = lockPath) {
  return JSON.parse(readFileSync(path, "utf8")) as { pid: number; nonce: string; acquired_at_ms: number };
}

/** The temp file is private to one acquisition and must never outlive it, so
 * every test can assert the lock dir holds nothing but the lock. */
function scratchLeftovers(): string[] {
  if (!existsSync(lockDir)) return [];
  return readdirSync(lockDir).filter((f) => f.endsWith(".tmp"));
}

/** Seed a lock file directly, bypassing acquireLock (parent dir must exist). */
function seedLock(content: string): void {
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(lockPath, content);
}

describe("acquireLock / release", () => {
  it("acquire then release removes the lock file", () => {
    const release = acquireLock(lockPath, { pid: 111 });
    expect(existsSync(lockPath)).toBe(true);
    const record = readRecord();
    expect(record.pid).toBe(111);
    expect(typeof record.acquired_at_ms).toBe("number");

    release.release();
    expect(existsSync(lockPath)).toBe(false);
    expect(scratchLeftovers()).toEqual([]);
  });

  it("the lock file is a complete record the instant acquire returns", () => {
    // The whole point of link(2)-with-content: there is no window where the
    // published lock is empty or half-written, so a concurrent acquirer can
    // never read it as corrupt (= stale) and delete a live lock.
    const release = acquireLock(lockPath, { pid: 111 });
    const record = readRecord();
    expect(record.pid).toBe(111);
    expect(record.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(typeof record.acquired_at_ms).toBe("number");
    expect(scratchLeftovers()).toEqual([]); // temp already cleaned up
    release.release();
  });

  it("two acquisitions by the same pid get different nonces", () => {
    const release1 = acquireLock(lockPath, { pid: 111 });
    const first = readRecord().nonce;
    release1.release();
    const release2 = acquireLock(lockPath, { pid: 111 });
    expect(readRecord().nonce).not.toBe(first);
    release2.release();
  });

  it("second acquire while held (live pid) times out and throws with the owner pid in the message", () => {
    const clock = fakeClock();
    const release1 = acquireLock(lockPath, {
      pid: 111,
      now: clock.now,
      isPidAlive: () => true,
    });

    let sleeps = 0;
    expect(() =>
      acquireLock(lockPath, {
        pid: 222,
        now: clock.now,
        sleep: (ms) => {
          sleeps++;
          clock.advance(ms);
        },
        isPidAlive: () => true,
        timeoutMs: 1000,
        pollMs: 200,
      }),
    ).toThrow(/lock at .*sub\/\.lock.*pid 111/s);
    expect(sleeps).toBeGreaterThan(0);

    release1.release();
  });

  it("a waiting acquire succeeds after the holder releases mid-wait", () => {
    const clock = fakeClock();
    const release1 = acquireLock(lockPath, {
      pid: 111,
      now: clock.now,
      isPidAlive: () => true,
    });

    let released = false;
    const release2 = acquireLock(lockPath, {
      pid: 222,
      now: clock.now,
      isPidAlive: () => true,
      timeoutMs: 5000,
      pollMs: 200,
      sleep: (ms) => {
        clock.advance(ms);
        if (!released) {
          released = true;
          release1.release(); // holder releases mid-wait; next retry should succeed
        }
      },
    });

    expect(readRecord().pid).toBe(222);

    release2.release();
  });

  it("recovers a stale lock whose owner pid is dead", () => {
    const clock = fakeClock();
    const release1 = acquireLock(lockPath, {
      pid: 999,
      now: clock.now,
      isPidAlive: () => false, // owner pid 999 is dead
    });
    // release1 above already wrote+returned; simulate the holder crashing by
    // NOT calling release1() and instead re-acquiring as a different owner.
    void release1;

    let sleeps = 0;
    const release2 = acquireLock(lockPath, {
      pid: 222,
      now: clock.now,
      isPidAlive: () => false,
      sleep: () => {
        sleeps++;
      },
      timeoutMs: 5000,
      pollMs: 200,
    });

    // Recovered immediately, no polling needed.
    expect(sleeps).toBe(0);
    expect(readRecord().pid).toBe(222);
    expect(scratchLeftovers()).toEqual([]);

    release2.release();
  });

  it("recovers a stale lock by age (injected now)", () => {
    const clock = fakeClock(0);
    const release1 = acquireLock(lockPath, {
      pid: 111,
      now: clock.now,
      isPidAlive: () => true, // owner is alive, but the lock will still age out
    });
    void release1;

    clock.advance(31 * 60_000); // past the 30-minute default staleMs

    let sleeps = 0;
    const release2 = acquireLock(lockPath, {
      pid: 222,
      now: clock.now,
      isPidAlive: () => true,
      sleep: () => {
        sleeps++;
      },
      timeoutMs: 5000,
      pollMs: 200,
    });

    expect(sleeps).toBe(0); // recovered on the first retry, no waiting
    expect(readRecord().pid).toBe(222);

    release2.release();
  });

  it("recovers a lock file with corrupt content (via the steal path)", () => {
    const clock = fakeClock();
    seedLock("{ not valid json");

    let sleeps = 0;
    const release = acquireLock(lockPath, {
      pid: 222,
      now: clock.now,
      isPidAlive: () => true,
      sleep: () => {
        sleeps++;
      },
      timeoutMs: 5000,
      pollMs: 200,
    });

    expect(sleeps).toBe(0);
    expect(readRecord().pid).toBe(222);
    expect(scratchLeftovers()).toEqual([]); // the stolen junk is gone, not orphaned

    release.release();
  });

  it("treats a record missing the nonce field as corrupt and recovers it", () => {
    // A lock file written by an older build has no nonce; it is unreadable to
    // us, which is the corrupt-is-stale path.
    seedLock(JSON.stringify({ pid: 111, acquired_at_ms: 0 }));

    let sleeps = 0;
    const release = acquireLock(lockPath, {
      pid: 222,
      isPidAlive: () => true,
      sleep: () => {
        sleeps++;
      },
    });

    expect(sleeps).toBe(0);
    expect(readRecord().pid).toBe(222);
    release.release();
  });

  it("leaves a live lock alone when it replaces the stale one it had judged", () => {
    // The dangerous interleaving: we read a stale record, and before we act on
    // it the lock is replaced by a fresh live one (the usual cause: another
    // acquirer judged the same stale lock and recovered it first). Recovery
    // must notice and leave the live lock completely untouched.
    const stale = { pid: 999, nonce: "stalenonce", acquired_at_ms: 0 };
    const live = { pid: 777, nonce: "livenonce", acquired_at_ms: 0 };
    seedLock(JSON.stringify(stale));

    const clock = fakeClock(0);
    let swapped = false;
    let sleeps = 0;

    expect(() =>
      acquireLock(lockPath, {
        pid: 222,
        now: clock.now,
        isPidAlive: (p) => {
          if (p === stale.pid) {
            // We are inside the staleness judgement of the record we just read;
            // swap a live lock in underneath, which is exactly the window the
            // confirm-before-substitute check exists to close.
            if (!swapped) {
              swapped = true;
              writeFileSync(lockPath, JSON.stringify(live));
            }
            return false; // ...and the record we read is stale
          }
          return true; // pid 777 is alive
        },
        sleep: (ms) => {
          sleeps++;
          clock.advance(ms);
        },
        timeoutMs: 1000,
        pollMs: 200,
      }),
    ).toThrow(/pid 777/);

    expect(swapped).toBe(true);
    expect(readRecord()).toEqual(live); // untouched, not even briefly moved aside
    expect(sleeps).toBeGreaterThan(0); // and we went back to waiting for it
    expect(scratchLeftovers()).toEqual([]);
  });

  it("release is idempotent (second call is a no-op)", () => {
    const release = acquireLock(lockPath, { pid: 111 });
    release.release();
    expect(existsSync(lockPath)).toBe(false);
    expect(() => release.release()).not.toThrow();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("release refuses to unlink a lock now owned by another pid", () => {
    const clock = fakeClock();
    const release1 = acquireLock(lockPath, {
      pid: 111,
      now: clock.now,
      isPidAlive: () => false, // will be recovered as stale below
    });

    // Simulate stale-recovery handing the lock to a different owner (222)
    // without release1 ever running.
    void release1;
    const release2 = acquireLock(lockPath, {
      pid: 222,
      now: clock.now,
      isPidAlive: () => false,
      sleep: () => {},
    });

    // release1's stale record has already been replaced; calling it now must
    // NOT delete pid 222's live lock.
    release1.release();
    expect(existsSync(lockPath)).toBe(true);
    expect(readRecord().pid).toBe(222);

    release2.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("release refuses to unlink a re-acquired lock with the same pid but a new nonce", () => {
    // pid is not identity: the same process re-acquiring after a recovery gets
    // a new nonce, and the stale holder's release() must not touch it.
    const release1 = acquireLock(lockPath, { pid: 111 });
    const impostor = { pid: 111, nonce: "someone-elses-acquisition", acquired_at_ms: 0 };
    writeFileSync(lockPath, JSON.stringify(impostor));

    release1.release();
    expect(readRecord()).toEqual(impostor); // same pid, different acquisition -> left alone
  });
});

describe("assertHeld", () => {
  it("is quiet while the lock is ours and throws after it is recovered away", () => {
    const handle = acquireLock(lockPath, { pid: 111 });
    expect(() => handle.assertHeld()).not.toThrow();
    // Simulate an age-based recovery landing someone else's record.
    writeFileSync(lockPath, JSON.stringify({ pid: 222, nonce: "thief", acquired_at_ms: 0 }));
    expect(() => handle.assertHeld()).toThrow(/lock at .* lost by pid 111 .*pid 222/);
    handle.release(); // must be a no-op: the lock is no longer ours
    expect(existsSync(lockPath)).toBe(true);
  });

  it("throws naming 'no one' when the lock file is gone entirely", () => {
    const handle = acquireLock(lockPath, { pid: 111 });
    rmSync(lockPath);
    expect(() => handle.assertHeld()).toThrow(/now held by no one/);
  });
});

describe("recovery mutex", () => {
  it("a leaked FUTURE-dated recovery mutex cannot wedge recovery (backwards clock step)", () => {
    const clock = fakeClock(1_000_000);
    seedLock(JSON.stringify({ pid: 999, nonce: "dead", acquired_at_ms: 0 })); // dead-pid stale lock
    writeFileSync(
      lockPath + ".recovery",
      JSON.stringify({ pid: 998, nonce: "ghost", acquired_at_ms: clock.now() + 60_000 }),
    );
    const handle = acquireLock(lockPath, {
      pid: 222,
      now: clock.now,
      isPidAlive: () => false,
      sleep: (ms) => clock.advance(ms),
      timeoutMs: 5000,
      pollMs: 200,
    });
    expect(readRecord().pid).toBe(222); // recovered despite the leaked mutex
    expect(existsSync(lockPath + ".recovery")).toBe(false);
    handle.release();
  });

  it("a crashed recoverer's fresh mutex pauses recovery, then is cleared at its 5s staleness", () => {
    const clock = fakeClock(10_000);
    seedLock(JSON.stringify({ pid: 999, nonce: "dead", acquired_at_ms: 0 }));
    writeFileSync(
      lockPath + ".recovery",
      JSON.stringify({ pid: 998, nonce: "ghost", acquired_at_ms: clock.now() }),
    );
    let sleeps = 0;
    const handle = acquireLock(lockPath, {
      pid: 222,
      now: clock.now,
      isPidAlive: () => false,
      sleep: (ms) => {
        sleeps++;
        clock.advance(ms);
      },
      timeoutMs: 60_000,
      pollMs: 200,
    });
    expect(sleeps).toBeGreaterThan(0); // honored the live mutex before it went stale
    expect(readRecord().pid).toBe(222);
    handle.release();
  });

  it("counts exactly one substitution per recovered stale lock via onRecoverySubstitute", () => {
    seedLock("{ not valid json");
    let subs = 0;
    const handle = acquireLock(lockPath, {
      pid: 222,
      isPidAlive: () => true,
      onRecoverySubstitute: () => subs++,
    });
    expect(subs).toBe(1);
    handle.release();
    // A plain uncontended acquire substitutes nothing.
    const handle2 = acquireLock(lockPath, { pid: 222, onRecoverySubstitute: () => subs++ });
    expect(subs).toBe(1);
    handle2.release();
  });
});
