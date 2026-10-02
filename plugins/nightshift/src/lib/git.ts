// Git change detection for change_flag (run-loop.md step 1). Isolated + injectable
// so selection stays deterministic under test (pass a stub GitRunner; the "no-git"
// branch is just a runner that returns []).
import { execFileSync } from "node:child_process";

export interface GitRunner {
  /** Files changed between the commit at/near `sinceDate` and HEAD. [] if unknown. */
  changedFilesSince(sinceDate: string | undefined): string[];
}

export function makeGitRunner(repo: string): GitRunner {
  const cache = new Map<string, string[]>();
  return {
    changedFilesSince(sinceDate) {
      if (!sinceDate) return []; // never reviewed -> no baseline; staleness already max
      const cached = cache.get(sinceDate);
      if (cached) return cached;
      let files: string[] = [];
      try {
        // stdio: ignore stderr so "fatal: not a git repository" never leaks to the
        // workflow's output; a failure here is the expected no-git fallback.
        const commit = execFileSync(
          "git",
          ["-C", repo, "rev-list", "-1", `--before=${sinceDate}T23:59:59`, "HEAD"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();
        if (commit) {
          const out = execFileSync(
            "git",
            ["-C", repo, "diff", "--name-only", `${commit}..HEAD`],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
          );
          files = out.split("\n").map((s) => s.trim()).filter(Boolean);
        }
      } catch {
        files = []; // no-git / detached / shallow -> change_flag falls back to staleness
      }
      cache.set(sinceDate, files);
      return files;
    },
  };
}
