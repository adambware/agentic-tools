// A7 retention — what survives a run, and where it lives.
//
// TWO POLICIES, ONE MECHANISM (A1's prune()):
//
//   $OPS/logs/            time-based. Launcher logs are diagnostic, valuable for
//                         days, worthless after that, and referenced by nothing.
//   $OPS/evidence/<repo>/ lifecycle-based. A screenshot is retained while any
//                         finding that cites it is unresolved, and pruned once
//                         it is. A time rule here would guarantee dead links on
//                         exactly the OLDEST open findings — the ones most
//                         likely to have aged out of a keep-N window.
//
// WHY THE COPY EXISTS AT ALL. The reviewer writes evidence into the run dir
// (.nightshift/.run/<id>/surfaces/<sid>/evidence/…), which bin/clean DELETES on
// a successful run. Evidence that stayed there would be gone the moment the run
// it proves succeeded. So `ns` copies it out before clean, content-addressed by
// sha256 of the bytes, so the same screenshot recurring across many runs is
// stored once.
//
// PRUNE PER REPO, NEVER ACROSS THE STORE. The retain set can only be built from
// a repo's OWN metrics dir. Pruning all of $OPS/evidence/ from one repo's
// findings would delete every other repo's evidence — and would do it silently
// on the very night a second repo's clone happened to be unavailable. So the
// prune unit is $OPS/evidence/<repo>/, and a repo whose metrics cannot be read
// is skipped entirely rather than treated as "references nothing".
//
// KNOWN GAP, DELIBERATELY LEFT FOR A8 (see docs/v3/a7-ops-launcher.md): this
// module relocates the BYTES, not the POINTER. `finding.evidence` still holds
// the run-dir path bin/record wrote, so the dashboard resolves it against $OPS,
// misses, and renders the "evidence no longer on disk" state. Closing that needs
// a decision A7 has no business taking alone — either the workflow instructs the
// reviewer to write a stable path, or the recorded pointer is rewritten after
// record under the per-repo lock. Both touch durable state owned by A1/A4, and
// the first real design run (A8) is where the choice can actually be observed.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import type { Finding } from "./types.js";
import { dedupeKeyString, isOpen } from "./dedupekey.js";
import { foldFindings, readAllFindings } from "./findings-store.js";
import { openEvidenceRetainSet, prune, type PruneResult } from "./prune.js";

/** Log retention: recent enough to diagnose last night, bounded enough to forget. */
export const LOG_KEEP = 20;
export const LOG_MAX_AGE_DAYS = 14;

/** Characters of the sha256 hex digest used in the stored filename. */
const HASH_CHARS = 16;

export interface CopiedEvidence {
  /** The value as recorded in the finding (the reviewer's run-dir path). */
  recorded: string;
  /** Absolute source path it resolved to. */
  from: string;
  /** Path relative to the evidence ROOT, e.g. "novudesk/9f3c….png". */
  stored: string;
  bytes: number;
  /** True when an identical-content file was already in the store. */
  deduped: boolean;
}

export interface RetainEvidenceOpts {
  /** This run's scratch dir: .nightshift/.run/<run_id>. */
  runDir: string;
  /** Repo root — recorded evidence paths are resolved against it first. */
  repoRoot: string;
  /** The pack's metrics dir, for reading which findings are open. */
  metricsDir: string;
  /** $OPS/evidence. */
  evidenceRoot: string;
  /** Display name; the per-repo subdirectory and the prune unit. */
  repoName: string;
}

export interface RetainEvidenceResult {
  copied: CopiedEvidence[];
  /** Recorded values that named nothing copyable, with why. */
  skipped: { recorded: string; reason: string }[];
  pruned: PruneResult;
}

/**
 * Every evidence value cited by a currently-OPEN finding.
 *
 * Openness folds per canonical dedupe_key across all shards (last line with no
 * resolved_at = open) — but the values are collected from EVERY line of an open
 * key, not just the last. A recurring bump whose candidate omitted the optional
 * `evidence` field would otherwise drop the original screenshot while the
 * finding it proves is still open. Same rule prune.ts's retain set uses, for
 * exactly the same reason; they must not drift.
 */
export function openEvidenceValues(metricsDir: string): string[] {
  const all: Finding[] = readAllFindings(metricsDir);
  const openKeys = new Set(
    [...foldFindings(all).values()].filter(isOpen).map((f) => dedupeKeyString(f.dedupe_key)),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of all) {
    if (!f.evidence) continue;
    if (!openKeys.has(dedupeKeyString(f.dedupe_key))) continue;
    if (seen.has(f.evidence)) continue;
    seen.add(f.evidence);
    out.push(f.evidence);
  }
  return out;
}

/** True iff `child` resolves strictly inside `parent`. */
function inside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Copy the evidence cited by open findings out of this run's scratch dir into
 * $OPS/evidence/<repo>/, content-addressed, then lifecycle-prune that repo's
 * subdirectory.
 *
 * ONLY files that resolve INSIDE `runDir` are copied. A recorded evidence value
 * is a free-form, agent-authored string; treating it as a path to copy from
 * anywhere on disk would turn "log a finding" into "exfiltrate a file into a
 * directory the dashboard publishes links to". Symlinks are refused for the
 * same reason — the link may resolve inside the run dir while its target does
 * not. Everything refused is reported in `skipped`, never dropped in silence.
 *
 * The evidence ROOT gets the same suspicion before any of that: if
 * $OPS/evidence/<repo> already exists and is a symlink or a plain file rather
 * than a real directory, this throws instead of copying or pruning through
 * it — see the guard at the top of the function body for why.
 */
export function retainEvidence(opts: RetainEvidenceOpts): RetainEvidenceResult {
  const { runDir, repoRoot, metricsDir, evidenceRoot, repoName } = opts;
  const repoEvidenceDir = join(evidenceRoot, repoName);

  // ROOT GUARD, before any copy or prune touches repoEvidenceDir. The per-file
  // symlink checks below (and prune.ts's lstat-not-stat walk) only defend
  // symlink CHILDREN — a symlink or plain file sitting at $OPS/evidence/<repo>
  // itself is never examined by either. mkdirSync({recursive:true}) FOLLOWS an
  // existing symlink and no-ops instead of erroring, copyFileSync then writes
  // through it, and prune()'s existsSync/readdirSync do the same — so a stale
  // link (last night's repo rename, a bad manual mv) or a planted one turns
  // ordinary retention into "copy evidence into, and lifecycle-delete every
  // non-retained file under, wherever that link points". lstat, never
  // stat/existsSync, so a dangling symlink (target already gone) is still
  // caught rather than read as "doesn't exist yet". A repo evidence dir that
  // doesn't exist at all is the normal first-run case (mkdirSync creates it
  // below); a real directory is the normal steady-state case; anything else
  // is refused. Refusing must be LOUD, not a silent no-op that leaves the
  // caller believing evidence was retained when it wasn't -- so this throws,
  // same as openEvidenceRetainSet's MISCONFIG GUARD in prune.ts. bin/retain.ts
  // already catches thrown errors here, prints them to stderr, and sets exit
  // 2; bin/ns's finalize() (step 2) already treats a non-zero retain.mjs exit
  // as non-fatal and logs "retention reported a problem ... continuing to the
  // dashboard" — so throwing costs nothing on the "must not abort the
  // finalizer" contract while making the refusal impossible to miss in the
  // run log, unlike folding it into `skipped` (which is scoped to individual
  // recorded evidence values, not the whole store).
  let rootStat: ReturnType<typeof lstatSync> | undefined;
  try {
    rootStat = lstatSync(repoEvidenceDir);
  } catch {
    rootStat = undefined; // ENOENT — nothing there yet, the normal first-run case
  }
  if (rootStat !== undefined && !rootStat.isDirectory()) {
    const what = rootStat.isSymbolicLink() ? "a symlink" : "not a directory";
    throw new Error(
      `retainEvidence: refusing to touch ${repoEvidenceDir} — it exists and is ${what}, not a real directory. ` +
        `Copying through it or pruning through it could write or delete files outside the evidence store. ` +
        `Remove or fix it by hand before the next run.`,
    );
  }

  const copied: CopiedEvidence[] = [];
  const skipped: { recorded: string; reason: string }[] = [];

  for (const recorded of openEvidenceValues(metricsDir)) {
    // Two spellings the reviewer could plausibly have written: repo-relative
    // (what the workflow's prompt asks for) and run-dir-relative.
    const candidates = [resolve(repoRoot, recorded), resolve(runDir, recorded)];
    const source = candidates.find((c) => inside(runDir, c) && existsSync(c));
    if (source === undefined) {
      skipped.push({
        recorded,
        reason: `no readable file inside ${runDir} — either already copied by an earlier run, or the reviewer wrote it outside this run's evidence dir`,
      });
      continue;
    }
    const st = lstatSync(source);
    if (st.isSymbolicLink()) {
      skipped.push({ recorded, reason: `refused: ${source} is a symlink` });
      continue;
    }
    if (!st.isFile()) {
      skipped.push({ recorded, reason: `refused: ${source} is not a regular file` });
      continue;
    }

    const digest = sha256File(source).slice(0, HASH_CHARS);
    const stored = `${digest}${extname(source).toLowerCase()}`;
    const dest = join(repoEvidenceDir, stored);
    const deduped = existsSync(dest);
    if (!deduped) {
      mkdirSync(repoEvidenceDir, { recursive: true });
      copyFileSync(source, dest);
    }
    copied.push({
      recorded,
      from: source,
      stored: `${repoName}/${stored}`,
      bytes: st.size,
      deduped,
    });
  }

  // Retain set = what A1's rule already retains (recorded relpath / basename /
  // enclosing dir forms) PLUS the content-addressed names this copy produced.
  // The hash rename means the basename fallback can never match a copy, so
  // omitting these would delete every file the same invocation just wrote.
  const retain = new Set(openEvidenceRetainSet(metricsDir));
  for (const c of copied) {
    retain.add(c.stored);
    retain.add(c.stored.slice(repoName.length + 1));
  }

  const pruned = prune(repoEvidenceDir, { kind: "lifecycle", retain });
  return { copied, skipped, pruned };
}

/** Time-prune $OPS/logs/. Missing dir is a no-op, not an error. */
export function retainLogs(
  logsDir: string,
  opts?: { keep?: number; maxAgeDays?: number; now?: () => number },
): PruneResult {
  return prune(
    logsDir,
    { kind: "time", keep: opts?.keep ?? LOG_KEEP, maxAgeDays: opts?.maxAgeDays ?? LOG_MAX_AGE_DAYS },
    { now: opts?.now },
  );
}

/** Byte total of a directory tree, for the summary line. Symlinks are skipped. */
export function evidenceBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(abs);
      else total += st.size;
    }
  };
  walk(dir);
  return total;
}
