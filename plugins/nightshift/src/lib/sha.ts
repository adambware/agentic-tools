// Dependency-free so validate.ts can share it without pulling the git runner
// (and node:child_process) into every bundle that validates.
/**
 * A commit sha as `git rev-parse` prints it (full or abbreviated hex). The
 * registry that carries `last_reviewed_sha` lives in the REVIEWED repo, so the
 * value is not trusted: interpolated into `${sha}..HEAD` a value like
 * `--output=/some/path` would be parsed by `git diff` as an option (argv
 * option injection, not shell injection), and a ref name like `main` would
 * silently resolve to the wrong baseline. Anything that is not hex is treated
 * exactly like an unresolvable sha: fall back to the date baseline.
 */
export const SHA_RE = /^[0-9a-f]{7,64}$/i;
