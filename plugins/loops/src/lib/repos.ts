// Per-repo metrics: the private repo list, merged PRs from `gh`, and which transcripts belong
// to which repo. Repo names and paths live only in the private config, never in this code.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseIso } from "./time.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RepoConfig {
  /** GitHub owner/name. */
  slug: string;
  /** Absolute path of the main checkout. */
  path: string;
  /** Repo-specific bookkeeping files (exact paths) that never count toward an escape. */
  escape_ignore: string[];
}

export interface LoopsConfig {
  repos: RepoConfig[];
}

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Read and validate the config. `~` expands to the home dir; a relative path resolves against
 * the config file's own dir. Throws on anything malformed: a bad config must not record repos as
 * quiet.
 */
export function loadConfig(file: string): LoopsConfig {
  const json: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (json === null || typeof json !== "object" || !Array.isArray((json as Record<string, unknown>).repos)) {
    throw new Error("config needs a repos array");
  }
  const seen = new Set<string>();
  const repos = ((json as Record<string, unknown>).repos as unknown[]).map((r, i) => {
    const e = r as Record<string, unknown> | null;
    if (e === null || typeof e !== "object" || typeof e.slug !== "string" || !SLUG.test(e.slug)) {
      throw new Error(`repos[${i}]: slug must be owner/name`);
    }
    if (typeof e.path !== "string" || e.path === "") throw new Error(`repos[${i}]: path must be a string`);
    if (seen.has(e.slug)) throw new Error(`repos[${i}]: duplicate slug ${e.slug}`);
    const ignore = e.escape_ignore ?? [];
    if (!Array.isArray(ignore) || !ignore.every((x) => typeof x === "string")) {
      throw new Error(`repos[${i}]: escape_ignore must be a list of paths`);
    }
    seen.add(e.slug);
    const p = e.path === "~" ? homedir() : e.path.startsWith("~/") ? join(homedir(), e.path.slice(2)) : e.path;
    return { slug: e.slug, path: isAbsolute(p) ? resolve(p) : resolve(dirname(file), p), escape_ignore: ignore as string[] };
  });
  return { repos };
}

/**
 * The project dir name Claude Code gives a cwd: every character outside [A-Za-z0-9] becomes "-".
 * Lossy ("a-b" and "a/b" collide), so two configured repos can in principle share a key; the
 * config is the user's own list, and such a pair would show up as identical session counts.
 */
export function projectKey(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

/** A project dir belongs to a repo when it is the checkout itself or one of its
 * `.claude/worktrees/` worktrees. A sibling that merely shares the prefix does not. */
export function ownsProject(repoPath: string, project: string): boolean {
  const key = projectKey(repoPath);
  return project === key || project.startsWith(`${key}--claude-worktrees-`);
}

export interface MergedPr {
  number: number;
  title: string;
  mergedAt: number;
  files: string[];
}

/** Validate `gh pr list --json number,title,mergedAt,files` output. Throws on a shape change. */
export function parsePrList(json: unknown): MergedPr[] {
  if (!Array.isArray(json)) throw new Error("gh output is not an array");
  return json.map((p, i) => {
    const e = p as Record<string, unknown> | null;
    const mergedAt = typeof e?.mergedAt === "string" ? parseIso(e.mergedAt) : undefined;
    if (e === null || typeof e !== "object" || typeof e.number !== "number" || typeof e.title !== "string" || mergedAt === undefined || !Array.isArray(e.files)) {
      throw new Error(`gh pr ${i}: unexpected shape`);
    }
    const files = (e.files as unknown[]).map((f) => (f as Record<string, unknown> | null)?.path);
    if (!files.every((f): f is string => typeof f === "string")) throw new Error(`gh pr #${e.number}: file without a path`);
    return { number: e.number, title: e.title, mergedAt, files };
  });
}

/** Far above any real month; reaching it means the list may be cut short. */
export const PR_LIMIT = 1000;

export type RunGh = (args: string[]) => string;

/** A stalled `gh` must not hang the scheduled job: past this, the repo is recorded as unknown. */
export const GH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * launchd's PATH is /usr/bin:/bin:/usr/sbin:/sbin, which has no `gh`. Prepend the usual install
 * dirs so the scheduled job finds it.
 */
export const runGh: RunGh = (args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    timeout: GH_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? "/usr/bin:/bin"}` },
  });

/** PRs merged at or after sinceMs (the search is by day, so filter to the ms). */
export function fetchMergedPrs(slug: string, sinceMs: number, gh: RunGh = runGh): MergedPr[] {
  const day = new Date(sinceMs).toISOString().slice(0, 10);
  const out = gh([
    "pr", "list", "-R", slug, "--state", "merged", "--search", `merged:>=${day}`,
    "--limit", String(PR_LIMIT), "--json", "number,title,mergedAt,files",
  ]);
  const prs = parsePrList(JSON.parse(out));
  if (prs.length >= PR_LIMIT) throw new Error(`${PR_LIMIT}+ merged PRs: the list may be cut short`);
  return prs.filter((p) => p.mergedAt >= sinceMs);
}

/**
 * A revert or fix-forward, by title: "Revert ...", "fix: ...", "fix(scope): ...", "Fix ...",
 * "hotfix ...", with an optional leading version ("v1.2.3 fix(x): ..."). A title-only proxy:
 * a fix PR named otherwise is missed.
 */
const FIX_TITLE = /^\s*(v?\d+(\.\d+)*\s+)?(revert|fix|hotfix)\b/i;

export function isFixPr(pr: MergedPr): boolean {
  return FIX_TITLE.test(pr.title);
}

/** How long after a merge a fix touching its files counts against it. */
export const ESCAPE_DAYS = 14;

/**
 * Files whose overlap says nothing about a defect. Nearly every PR touches the bookkeeping (a
 * release bumps VERSION, the changelog, the manifest), and a fix that adds a test to an existing
 * test file does not make the PR that last edited that file the culprit.
 */
const BOOKKEEPING =
  /(^|\/)(VERSION|package\.json|plugin\.json|marketplace\.json|[^/]*\.lock|package-lock\.json|pnpm-lock\.yaml|go\.sum)$|\.(md|mdx|txt|snap)$|(^|\/)(__tests__|__snapshots__|tests?|spec)\/|\.(test|spec)\.[A-Za-z]+$/i;

export function isBookkeeping(path: string): boolean {
  return BOOKKEEPING.test(path);
}

/** An escape_ignore entry is an exact path, or a directory prefix when it ends in "/". */
function ignored(path: string, ignore: readonly string[]): boolean {
  return isBookkeeping(path) || ignore.some((x) => (x.endsWith("/") ? path.startsWith(x) : path === x));
}

/**
 * Blame-like: a fix or revert PR merged within ESCAPE_DAYS after this one counts against it only
 * when, for some file both touched, this PR was the LAST one to touch that file before the fix.
 * Without that rule one fix to a big shared file blames every PR that edited it that fortnight.
 */
export function escaped(pr: MergedPr, all: MergedPr[], ignore: readonly string[] = []): boolean {
  const until = pr.mergedAt + ESCAPE_DAYS * DAY_MS;
  for (const fix of all) {
    if (fix.number === pr.number || fix.mergedAt <= pr.mergedAt || fix.mergedAt > until || !isFixPr(fix)) continue;
    for (const file of fix.files) {
      if (ignored(file, ignore) || !pr.files.includes(file)) continue;
      const later = all.some(
        (o) => o.number !== pr.number && o.number !== fix.number && o.mergedAt > pr.mergedAt && o.mergedAt < fix.mergedAt && o.files.includes(file),
      );
      if (!later) return true;
    }
  }
  return false;
}
