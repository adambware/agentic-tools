import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClean } from "./clean-run.js";

let dir: string;
let runRoot: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-clean-"));
  runRoot = join(dir, ".run");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-21T00:00:00Z").getTime();

function makeRunDir(runId: string, ageDays = 0): string {
  const p = join(runRoot, runId);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "marker.txt"), "x");
  const t = (NOW - ageDays * DAY_MS) / 1000;
  utimesSync(p, t, t);
  return p;
}

describe("runClean: status handling", () => {
  it("deletes the run dir on success", () => {
    const runId = "ns-2026-06-21-sec-01";
    const p = makeRunDir(runId);
    const res = runClean({ runRoot, runId, status: "success", now: () => NOW });
    expect(res.deletedRunDir).toBe(true);
    expect(existsSync(p)).toBe(false);
  });

  it("keeps the run dir on failure", () => {
    const runId = "ns-2026-06-21-sec-02";
    const p = makeRunDir(runId);
    const res = runClean({ runRoot, runId, status: "failure", now: () => NOW });
    expect(res.deletedRunDir).toBe(false);
    expect(existsSync(p)).toBe(true);
  });

  it("deletedRunDir is false when the run dir never existed (success)", () => {
    const res = runClean({
      runRoot,
      runId: "never-existed",
      status: "success",
      now: () => NOW,
    });
    expect(res.deletedRunDir).toBe(false);
  });
});

describe("runClean: path containment", () => {
  it("rejects a run id that escapes the root via ../", () => {
    expect(() =>
      runClean({ runRoot, runId: "../evil", status: "success", now: () => NOW }),
    ).toThrow();
    // nothing should have been touched
    expect(existsSync(runRoot)).toBe(false);
  });

  it("rejects an absolute-path run id", () => {
    expect(() =>
      runClean({ runRoot, runId: "/etc/passwd", status: "success", now: () => NOW }),
    ).toThrow();
  });

  it("rejects a run id containing a path separator", () => {
    expect(() =>
      runClean({ runRoot, runId: "a/b", status: "success", now: () => NOW }),
    ).toThrow();
  });

  it("rejects a run id that resolves to the run root itself", () => {
    expect(() =>
      runClean({ runRoot, runId: ".", status: "success", now: () => NOW }),
    ).toThrow();
  });

  it("rejects an empty runRoot instead of silently resolving to cwd", () => {
    expect(() =>
      runClean({ runRoot: "", runId: "ns-2026-06-21-sec-01", status: "success", now: () => NOW }),
    ).toThrow();
  });

  it("rejects a blank (whitespace-only) runRoot", () => {
    expect(() =>
      runClean({ runRoot: "   ", runId: "ns-2026-06-21-sec-01", status: "success", now: () => NOW }),
    ).toThrow();
  });
});

describe("runClean: prune-after-clean", () => {
  it("prunes the run root down to the keep=5/maxAgeDays=7 policy", () => {
    // 5 recent run dirs (kept) + 1 stale (>7d, pruned) besides the active one.
    for (let i = 0; i < 5; i++) makeRunDir(`recent-${i}`, i);
    makeRunDir("stale-old", 10);
    const res = runClean({
      runRoot,
      runId: "active-run",
      status: "failure",
      now: () => NOW,
    });
    expect(res.pruned.removed).toContain("stale-old");
    expect(res.pruned.kept.length).toBeLessThanOrEqual(5);
  });

  it("eventually prunes a failed run dir once it ages past maxAgeDays", () => {
    const runId = "ns-2026-06-10-sec-01";
    makeRunDir(runId, 10); // already 10 days old at "now"
    const res = runClean({ runRoot, runId, status: "failure", now: () => NOW });
    // failure keeps it in this call...
    expect(res.deletedRunDir).toBe(false);
    // ...but the trailing prune sweeps it since it's outside maxAgeDays.
    expect(res.pruned.removed).toContain(runId);
    expect(existsSync(join(runRoot, runId))).toBe(false);
  });
});
