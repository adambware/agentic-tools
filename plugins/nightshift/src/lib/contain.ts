// Physical path containment for the per-run fan-out (v3 plan §9.12 / T6).
//
// node:path resolve() is LEXICAL — it normalizes "../" but never touches the
// filesystem, so a symlink at surfaces/<sid> (or at surfaces/ itself) is
// "inside" the run dir textually while its target lives anywhere. The A4
// adversarial round proved this end to end: a symlinked surface dir let
// bin/tier2-gate WRITE outside the run dir and let bin/merge-candidates ingest
// artifacts from outside it — stamping a never-reviewed surface green (the
// exact §9.16 harm through the §9.12 door). These helpers are the physical
// layer that the lexical checks in the callers cannot provide. prune.ts uses
// lstat for the same threat; this module is the shared equivalent for the
// merge/tier2 paths.
//
// Threat shape: symlinks cannot be created by judgment agents (Read/Grep/Glob/
// Write only), but plumbing agents run Bash, failed run dirs are kept on disk
// for diagnosis (clean-run.ts), and packs are operator-editable — so links are
// reachable state, not a theoretical case. TOCTOU between lstat and the
// subsequent read/write is out of scope: chain stages run sequentially.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/** lstat that treats ENOENT as "absent" instead of throwing. */
function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Refuse to READ through a symlink. writeJson is rename-based (a symlinked
 * target is replaced, not followed), so writes need no file-level check — but
 * readJson follows links, which would ingest content from outside the run dir
 * into the durable path.
 */
export function assertNotSymlink(path: string, where: string): void {
  const st = lstatOrNull(path);
  if (st !== null && st.isSymbolicLink()) {
    throw new Error(
      `${where}: ${path} is a symlink — refusing (containment cannot be verified through links)`,
    );
  }
}

/**
 * Resolve <runDir>/surfaces/<sid> with BOTH containment layers:
 *
 *  1. lexical — resolve() prefix check (catches "../" shapes even when nothing
 *     exists on disk yet);
 *  2. physical — no symlink at surfaces/ or at the sid dir itself, and, when
 *     the dir exists, realpathSync(dir) must still land inside
 *     realpathSync(runDir) (catches a link anywhere along the chain).
 *
 * The id itself must already be charset-gated by the caller (isSafeId): the
 * layers fail independently, so a gap in any one of them is not a breach.
 * Returns the lexical dir path for the caller to join() artifacts onto.
 */
export function containedSurfaceDir(runDir: string, sid: string, where: string): string {
  const rootResolved = resolve(runDir);
  const surfacesDir = resolve(runDir, "surfaces");
  const dir = resolve(surfacesDir, sid);
  if (!dir.startsWith(rootResolved + sep)) {
    throw new Error(`${where}: surface id escapes the run dir: ${sid}`);
  }
  for (const p of [surfacesDir, dir]) {
    const st = lstatOrNull(p);
    if (st !== null && st.isSymbolicLink()) {
      throw new Error(
        `${where}: ${p} is a symlink — refusing (containment cannot be verified through links)`,
      );
    }
  }
  if (existsSync(dir)) {
    // realpath resolves EVERY link in the chain (including one above runDir,
    // which an operator may legitimately have — both sides resolve through it
    // consistently). runDir must exist for a meaningful run, so realpathSync
    // on it throwing is itself a correct loud failure.
    const realDir = realpathSync(dir);
    const realRoot = realpathSync(rootResolved);
    if (!realDir.startsWith(realRoot + sep)) {
      throw new Error(
        `${where}: surfaces/${sid} physically resolves outside the run dir ` +
          `(${realDir}) — refusing`,
      );
    }
  }
  return dir;
}

/**
 * Case-fold collision gate for ids that become path segments. Darwin/APFS (and
 * Windows) are case-insensitive: "AUTH" and "auth" are distinct ids to the
 * engine but ONE directory to the filesystem, so the second writer silently
 * clobbers the first's artifacts. Rejected on every platform — a pack that
 * only merges cleanly on a case-sensitive filesystem is a portability bug.
 * Throws naming both colliding ids; call once per id in insertion order.
 */
export function assertNoCaseFoldCollision(
  seenFolded: Map<string, string>,
  id: string,
  where: string,
): void {
  const folded = id.toLowerCase();
  const prior = seenFolded.get(folded);
  if (prior !== undefined && prior !== id) {
    throw new Error(
      `${where}: surface ids "${prior}" and "${id}" collide case-insensitively — ` +
        `they map to one directory on a case-insensitive filesystem`,
    );
  }
  seenFolded.set(folded, id);
}
