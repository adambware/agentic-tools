// Git change detection for change_flag (run-loop.md step 1). Isolated + injectable
// so selection stays deterministic under test (pass a stub GitRunner; the "no-git"
// branch is just a runner that returns []).
import { execFileSync } from "node:child_process";

export interface ReviewBaseline {
  /** Exact commit reviewed last time (registry `last_reviewed_sha`), when known. */
  sha?: string;
  /** `last_reviewed` date — used only when `sha` is absent or fails to resolve. */
  date?: string;
}

export interface GitRunner {
  /**
   * Files changed since a review baseline. `sha` is preferred and diffed
   * directly (`git diff --name-only <sha>..HEAD`) — an exact baseline immune
   * to the same-day-commit blind spot a date-derived baseline has (a commit
   * landing after a review but on the same calendar day previously became its
   * OWN baseline via `--before=<date>T23:59:59`, so its own changes never
   * appeared in the diff). Falls back to the date-derived baseline only when
   * no sha is recorded yet (e.g. an entry reviewed before `last_reviewed_sha`
   * existed) or the sha fails to resolve (shallow clone, rewritten history).
   * [] when neither baseline resolves (never reviewed, no-git, unknown sha
   * with no date, or a real no-op diff).
   */
  changedFilesSince(baseline: ReviewBaseline): string[];
}

export function makeGitRunner(repo: string): GitRunner {
  const cache = new Map<string, string[]>();

  /** Diff `commit..HEAD`. Returns undefined (not []) on failure so callers can
   *  tell "no changes" apart from "commit didn't resolve" and fall back. */
  function diffFromCommit(commit: string): string[] | undefined {
    try {
      const out = execFileSync(
        "git",
        ["-C", repo, "diff", "--name-only", `${commit}..HEAD`],
        // stdio: ignore stderr so "fatal: bad revision" etc. never leaks to the
        // workflow's output; a failure here is an expected fallback trigger.
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out.split("\n").map((s) => s.trim()).filter(Boolean);
    } catch {
      return undefined;
    }
  }

  function changedFilesSinceDate(date: string): string[] {
    const cacheKey = `date:${date}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    let files: string[] = [];
    try {
      const commit = execFileSync(
        "git",
        ["-C", repo, "rev-list", "-1", `--before=${date}T23:59:59`, "HEAD"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (commit) files = diffFromCommit(commit) ?? [];
    } catch {
      files = []; // no-git / detached / shallow -> change_flag falls back to staleness
    }
    cache.set(cacheKey, files);
    return files;
  }

  return {
    changedFilesSince({ sha, date }) {
      if (sha) {
        const cacheKey = `sha:${sha}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        const files = diffFromCommit(sha);
        if (files !== undefined) {
          cache.set(cacheKey, files);
          return files;
        }
        // sha didn't resolve (e.g. shallow clone missing that commit, or
        // rewritten history) -> fall through to the date-derived baseline
        // rather than silently treating the surface as unchanged.
      }
      if (!date) return []; // never reviewed and no sha -> no baseline; staleness already max
      return changedFilesSinceDate(date);
    },
  };
}
