// Directory pruning (v3 plan §9.8). Two policies share one mechanism because
// both answer the same question ("which files in this dir survive?") even
// though they weigh different evidence:
//
//   - time: used for .nightshift/.run/ (per-run scratch) and later
//     $OPS/logs/ — recency-and-age bounded, no external state to consult.
//     Operates on dir's immediate children only.
//
//   - lifecycle: used for $OPS/evidence/ (A7). Evidence files are
//     content-addressed and referenced by open findings; a time-based rule
//     would guarantee dead dashboard links on exactly the oldest open
//     findings (the ones most likely to have aged out of a keep-N window).
//     So evidence is retained while any referencing finding is unresolved,
//     and pruned once resolved_at is set — lifecycle-bound, not age-bound.
//     Operates recursively: the real layout is $OPS/evidence/<repo>/<hash>.png,
//     so a lifecycle prune that only looked at immediate children would see
//     "<repo>" (a directory that can never be "in" a retain set of file
//     basenames) and delete every repo's whole evidence tree.
import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { dedupeKeyString, isOpen } from "./dedupekey.js";
import { foldFindings, readAllFindings } from "./findings-store.js";

export type PrunePolicy =
  | { kind: "time"; keep: number; maxAgeDays: number }
  | { kind: "lifecycle"; retain: ReadonlySet<string> };

export interface PruneResult {
  // time: basenames of dir's immediate children, removal order.
  // lifecycle: posix relpaths from dir, removal order.
  removed: string[];
  kept: string[]; // same units as removed, arbitrary order
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Prune `dir` per `policy`. Missing dir is a no-op (nothing to prune yet).
 * time mode inspects only dir's immediate children and deletes losers
 * recursively (a child may itself be a directory tree). lifecycle mode walks
 * dir recursively and deletes individual files (see pruneLifecycle below),
 * then removes any directories left empty by those deletions.
 */
export function prune(
  dir: string,
  policy: PrunePolicy,
  opts?: { now?: () => number },
): PruneResult {
  if (!existsSync(dir)) return { removed: [], kept: [] };
  if (policy.kind === "lifecycle") return pruneLifecycle(dir, policy.retain);

  const now = opts?.now ?? Date.now;
  const entries = readdirSync(dir);
  const keepSet = computeTimeKeepSet(dir, entries, policy, now());

  const removed: string[] = [];
  const kept: string[] = [];
  for (const name of entries) {
    if (keepSet.has(name)) {
      kept.push(name);
    } else {
      rmSync(join(dir, name), { recursive: true, force: true });
      removed.push(name);
    }
  }
  return { removed, kept };
}

// Rank entries by mtime descending; keep iff rank < keep AND age <= maxAgeDays.
// Both conditions must hold — a top-N-recent entry that is still too old is
// dropped, same as an entry outside the top N regardless of age.
function computeTimeKeepSet(
  dir: string,
  entries: string[],
  policy: { keep: number; maxAgeDays: number },
  now: number,
): Set<string> {
  // lstat, never stat: a symlink child ranks by the link's own mtime, and a
  // dangling link cannot ENOENT the whole prune mid-flight.
  const withMtime = entries.map((name) => ({
    name,
    mtimeMs: lstatSync(join(dir, name)).mtimeMs,
  }));
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const keepSet = new Set<string>();
  withMtime.forEach(({ name, mtimeMs }, rank) => {
    const ageDays = (now - mtimeMs) / MS_PER_DAY;
    if (rank < policy.keep && ageDays <= policy.maxAgeDays) keepSet.add(name);
  });
  return keepSet;
}

// Walk `dir` recursively; a leaf is kept iff its posix relpath from `dir` is
// in `retain`, OR its bare basename is in `retain`, OR any ancestor directory
// relpath is in `retain` (an evidence value may name a directory of artifacts;
// its contents must survive as a unit). The basename and ancestor fallbacks
// are deliberate over-retention: openEvidenceRetainSet adds every lookup form
// precisely so representation drift between how a path was stored and how
// it's found on disk can only ever keep an extra file, never lose one that's
// still referenced by an open finding. Deleting non-retained leaves then
// removing directories left empty bottom-up (never `dir` itself) keeps the
// tree tidy without ever touching a directory that still holds evidence.
//
// Symlinks are NEVER followed (lstat, not stat): a symlink-to-directory is a
// leaf here, so the walk can never recurse -- and delete -- outside `dir`
// through a planted or accidental link. Deleting a non-retained symlink
// removes the link only, never its target; a dangling link is likewise just a
// leaf, not an ENOENT that aborts the prune half-done.
function pruneLifecycle(dir: string, retain: ReadonlySet<string>): PruneResult {
  const removed: string[] = [];
  const kept: string[] = [];

  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const abs = join(current, name);
      if (lstatSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      const relPath = toPosixRelative(dir, abs);
      // Match on NFC: macOS filesystems may hand back NFD names while the
      // stored evidence value (and so the retain set) is NFC, and a unicode
      // normalization mismatch must never read as "unreferenced".
      const relNfc = relPath.normalize("NFC");
      const nameNfc = name.normalize("NFC");
      if (retain.has(relNfc) || retain.has(nameNfc) || underRetainedDir(retain, relNfc)) {
        kept.push(relPath);
      } else {
        rmSync(abs, { force: true });
        removed.push(relPath);
      }
    }
  };
  walk(dir);
  removeEmptyDirs(dir);

  return { removed, kept };
}

// True iff some proper prefix of relPath (at a '/' boundary) is retained --
// i.e. the leaf lives under a directory an open finding names as evidence.
function underRetainedDir(retain: ReadonlySet<string>, relPath: string): boolean {
  for (let i = relPath.indexOf("/"); i !== -1; i = relPath.indexOf("/", i + 1)) {
    if (retain.has(relPath.slice(0, i))) return true;
  }
  return false;
}

function toPosixRelative(base: string, abs: string): string {
  return relative(base, abs).split(sep).join("/");
}

// Post-order removal of directories emptied by pruneLifecycle's deletions.
// Never removes `dir` itself, even if pruning left it empty. lstat so a
// symlink-to-directory is skipped, not descended into (or rmdir'd -> ENOTDIR).
function removeEmptyDirs(dir: string): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (!lstatSync(abs).isDirectory()) continue;
    removeEmptyDirs(abs);
    if (readdirSync(abs).length === 0) rmdirSync(abs);
  }
}

/**
 * Relpath and basename forms of the evidence files referenced by currently-
 * open findings, for matching against prune()'s lifecycle mode.
 *
 * MISCONFIG GUARD: throws if `metricsDir` or `metricsDir/findings` does not
 * exist, rather than returning an empty set. A caller that passed a wrong or
 * mistyped path must fail loud — a silent retain=∅ would prune every
 * evidence file on disk instead of surfacing the misconfiguration.
 *
 * Openness folds every line per canonical dedupe_key across all month
 * shards (last line with no resolved_at = open). But the retain set is built
 * from EVERY line of an open key, not just the last: a recurring bump whose
 * candidate omits the optional evidence field would otherwise drop the
 * original screenshot from the retain set while the finding is still open.
 * For each such evidence value we add every representation it might be
 * looked up by — full relpath, that relpath with a leading
 * "<evidenceDirName>/" segment stripped, and the bare basename — so drift
 * between how a path was stored and how prune() encounters it on disk can
 * only cause over-retention, never the loss of live evidence.
 */
export function openEvidenceRetainSet(
  metricsDir: string,
  opts?: { evidenceDirName?: string },
): Set<string> {
  if (!existsSync(metricsDir) || !existsSync(join(metricsDir, "findings"))) {
    throw new Error(`openEvidenceRetainSet: metrics dir not found: ${metricsDir}`);
  }
  const evidenceDirName = opts?.evidenceDirName ?? "evidence";

  const allLines = readAllFindings(metricsDir);
  const openKeys = new Set(
    [...foldFindings(allLines).values()].filter(isOpen).map((f) => dedupeKeyString(f.dedupe_key)),
  );

  const out = new Set<string>();
  for (const f of allLines) {
    if (!f.evidence) continue;
    if (!openKeys.has(dedupeKeyString(f.dedupe_key))) continue;
    addRetainForms(out, f.evidence, evidenceDirName);
  }
  return out;
}

// The evidence value is a free-form, agent-authored string (schemas impose no
// shape), while pruneLifecycle matches against CANONICAL walk relpaths — so
// every form inserted here is canonicalized first (separators unified, `.`/`..`
// and empty segments resolved, NFC-normalized). Without that, any non-canonical
// spelling of a DIRECTORY-valued evidence path ("evidence//repo/run-1",
// "evidence\\repo\\run-1", a trailing slash, an absolute path) has no
// directory form underRetainedDir can match — the basename fallback only saves
// files — and the whole directory's contents are deleted while the finding is
// still open. Canonicalizing on insert keeps the guarantee one-sided again:
// drift can only over-retain, never lose live evidence.
function addRetainForms(out: Set<string>, evidencePath: string, evidenceDirName: string): void {
  const isAbsolute = /^[/\\]|^[A-Za-z]:/.test(evidencePath);
  const segments = canonicalSegments(evidencePath);
  if (segments.length === 0) return; // "", ".", "a/.." — nothing retainable
  const leaf = segments[segments.length - 1]!;

  if (isAbsolute) {
    // Can't relativize against the pruned dir directly, but the LAST
    // <evidenceDirName> segment anchors a usable suffix: "/ops/evidence/r/x"
    // yields "r/x", which is exactly the walk relpath when pruning
    // .../evidence. The basename alone only protects files, not directories.
    const anchor = segments.lastIndexOf(evidenceDirName);
    if (anchor !== -1 && anchor < segments.length - 1) out.add(segments.slice(anchor + 1).join("/"));
    out.add(leaf);
    return;
  }

  const relForm = segments.join("/");
  out.add(relForm);
  if (segments[0] === evidenceDirName && segments.length > 1) out.add(segments.slice(1).join("/"));
  out.add(leaf);
}

// Split on either separator style, drop empty and "." segments, resolve ".."
// against what precedes it (a leading ".." has nothing to pop and is dropped),
// and NFC-normalize each segment to match the walk side.
function canonicalSegments(path: string): string[] {
  const stack: string[] = [];
  for (const raw of path.split(/[\\/]+/)) {
    const seg = raw.normalize("NFC");
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack;
}
