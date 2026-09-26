// Exercises makeGitRunner against a REAL throwaway git repo (not a stub) —
// this is the exact function the TODO ("Change detection uses a date, not the
// reviewed SHA") fixed, and the bug only reproduces against real git rev-list
// --before semantics, which a stub can't exhibit.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeGitRunner } from "./git.js";

let dir: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

/** Commits `file` with `contents`, dated `date` (YYYY-MM-DD, noon UTC), and
 *  returns the resulting HEAD sha. */
function commit(file: string, contents: string, date: string): string {
  writeFileSync(join(dir, file), contents);
  git("add", file);
  const isoDate = `${date}T12:00:00`;
  execFileSync("git", ["-C", dir, "commit", "-m", `touch ${file}`], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-git-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("makeGitRunner", () => {
  it("returns [] when neither sha nor date is given", () => {
    commit("a.txt", "1", "2026-06-01");
    const runner = makeGitRunner(dir);
    expect(runner.changedFilesSince({})).toEqual([]);
  });

  it("diffs directly from an exact sha, catching a same-day commit landing AFTER the review", () => {
    // This is the bug the TODO describes: a date-derived baseline resolves to
    // "the commit at/before 23:59:59 on that day" via `rev-list --before`, so
    // a second same-day commit becomes its OWN baseline and its changes never
    // show up in the diff. Diffing from the exact reviewed sha has no such gap.
    const reviewedSha = commit("a.txt", "1", "2026-06-10");
    commit("b.txt", "1", "2026-06-10"); // same calendar day, after the "review"
    const runner = makeGitRunner(dir);
    expect(runner.changedFilesSince({ sha: reviewedSha, date: "2026-06-10" })).toEqual(["b.txt"]);
  });

  it("reproduces the date-only blind spot when no sha is recorded (documents why the fix was needed)", () => {
    const reviewedSha = commit("a.txt", "1", "2026-06-10");
    commit("b.txt", "1", "2026-06-10");
    const runner = makeGitRunner(dir);
    // Old behavior, date only: the same-day commit is invisible.
    expect(runner.changedFilesSince({ date: "2026-06-10" })).toEqual([]);
    // New behavior, sha present: it is caught.
    expect(runner.changedFilesSince({ sha: reviewedSha, date: "2026-06-10" })).toEqual(["b.txt"]);
  });

  it("falls back to the date-derived baseline when no sha is recorded yet", () => {
    commit("a.txt", "1", "2026-06-01");
    commit("b.txt", "1", "2026-06-15");
    const runner = makeGitRunner(dir);
    expect(runner.changedFilesSince({ date: "2026-06-01" })).toEqual(["b.txt"]);
  });

  it("falls back to the date-derived baseline when the sha fails to resolve", () => {
    commit("a.txt", "1", "2026-06-01");
    commit("b.txt", "1", "2026-06-15");
    const runner = makeGitRunner(dir);
    const unknownSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    expect(runner.changedFilesSince({ sha: unknownSha, date: "2026-06-01" })).toEqual(["b.txt"]);
  });

  it("returns [] for an unresolvable sha with no date fallback", () => {
    commit("a.txt", "1", "2026-06-01");
    const runner = makeGitRunner(dir);
    const unknownSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    expect(runner.changedFilesSince({ sha: unknownSha })).toEqual([]);
  });

  it("returns [] outside a git repository (no-git fallback)", () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "ns-nogit-"));
    try {
      const runner = makeGitRunner(nonGitDir);
      expect(runner.changedFilesSince({ date: "2026-06-01" })).toEqual([]);
      expect(runner.changedFilesSince({ sha: "abc1234" })).toEqual([]);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("caches the result per baseline", () => {
    const reviewedSha = commit("a.txt", "1", "2026-06-01");
    commit("b.txt", "1", "2026-06-02");
    const runner = makeGitRunner(dir);
    expect(runner.changedFilesSince({ sha: reviewedSha })).toEqual(["b.txt"]);
    // A later commit must not change an already-cached answer for this sha.
    commit("c.txt", "1", "2026-06-03");
    expect(runner.changedFilesSince({ sha: reviewedSha })).toEqual(["b.txt"]);
  });
});
