// Full-branch tests for retain.ts: what evidence a run keeps, where it lives,
// and the one invariant that must never regress — evidence a currently-open
// finding cites must outlive the SAME invocation's prune of stale evidence.
// Pattern mirrors prune.test.ts / clean-run.test.ts: tmpdir fixtures written by
// the test, findings appended as real jsonl lines via appendJsonl (never a
// literal file the test doesn't control), one case per refusal branch.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  utimesSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { appendJsonl } from "./io.js";
import type { Finding } from "./types.js";
import { openEvidenceValues, retainEvidence, retainLogs, evidenceBytes } from "./retain.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-retain-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-21T00:00:00Z").getTime();

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function baseFinding(over: Partial<Finding> & Pick<Finding, "dedupe_key">): Finding {
  return {
    severity: "high",
    confidence: "high",
    needs_human_verification: false,
    first_seen: "2026-06-01",
    last_seen: "2026-06-01",
    run_id: "ns-2026-06-01-design-01",
    ...over,
  };
}

/** Append one finding line into <metricsDir>/findings/2026-06.jsonl. */
function writeFinding(metricsDir: string, f: Finding): void {
  appendJsonl(join(metricsDir, "findings", "2026-06.jsonl"), f);
}

/** Write `content` at a run-dir-relative path, creating parent dirs. */
function writeRunFile(runDir: string, relPath: string, content: string): string {
  const p = join(runDir, ...relPath.split("/"));
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
}

function sha16(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// openEvidenceValues
// ---------------------------------------------------------------------------

describe("openEvidenceValues", () => {
  it("returns the evidence of an OPEN finding", () => {
    const metricsDir = join(dir, "metrics");
    writeFinding(
      metricsDir,
      baseFinding({ dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" }, evidence: "shot.png" }),
    );
    expect(openEvidenceValues(metricsDir)).toEqual(["shot.png"]);
  });

  it("excludes a RESOLVED finding (later line with resolved_at set for the same dedupe_key)", () => {
    // Sanity-not-vacuous companion to the case above: same shape of fixture,
    // only resolved_at differs, and the output must flip from present to gone.
    const metricsDir = join(dir, "metrics");
    const key = { surface: "s1", symptom: "x", root_cause: "y" };
    writeFinding(metricsDir, baseFinding({ dedupe_key: key, evidence: "shot.png" }));
    writeFinding(
      metricsDir,
      baseFinding({ dedupe_key: key, evidence: "shot.png", last_seen: "2026-06-10", resolved_at: "2026-06-10" }),
    );
    expect(openEvidenceValues(metricsDir)).toEqual([]);
  });

  it("INCLUDES an evidence value from an EARLIER line of a still-open key whose latest line omitted `evidence`", () => {
    // The recurring-bump case the module header calls out by name: a candidate
    // that re-fires an already-open key without re-supplying `evidence` (the
    // field is optional) must not make the original screenshot vanish from the
    // retain set while the finding it proves is still open. Regressing this
    // silently drops the evidence the very next time a finding recurs.
    const metricsDir = join(dir, "metrics");
    const key = { surface: "s1", symptom: "x", root_cause: "y" };
    writeFinding(
      metricsDir,
      baseFinding({ dedupe_key: key, evidence: "original.png", first_seen: "2026-06-01" }),
    );
    writeFinding(
      metricsDir,
      baseFinding({ dedupe_key: key, last_seen: "2026-06-10" }), // no evidence field, still open
    );
    expect(openEvidenceValues(metricsDir)).toEqual(["original.png"]);
  });

  it("dedupes repeats — two different open findings citing the identical evidence value appear once", () => {
    const metricsDir = join(dir, "metrics");
    writeFinding(
      metricsDir,
      baseFinding({ dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" }, evidence: "shared.png" }),
    );
    writeFinding(
      metricsDir,
      baseFinding({ dedupe_key: { surface: "s2", symptom: "x", root_cause: "y" }, evidence: "shared.png" }),
    );
    expect(openEvidenceValues(metricsDir)).toEqual(["shared.png"]);
  });
});

// ---------------------------------------------------------------------------
// retainEvidence — layout + fixture builder shared by the rest of this file
// ---------------------------------------------------------------------------

interface Layout {
  runRoot: string;
  runDir: string;
  repoRoot: string;
  metricsDir: string;
  evidenceRoot: string;
  repoName: string;
  repoEvidenceDir: string;
}

function makeLayout(runId = "ns-2026-06-21-design-01"): Layout {
  const runRoot = join(dir, ".run");
  const runDir = join(runRoot, runId);
  mkdirSync(runDir, { recursive: true });
  const repoRoot = join(dir, "repo"); // deliberately has none of the fixture files
  const metricsDir = join(dir, "metrics");
  const evidenceRoot = join(dir, "ops-evidence");
  const repoName = "acme";
  return { runRoot, runDir, repoRoot, metricsDir, evidenceRoot, repoName, repoEvidenceDir: join(evidenceRoot, repoName) };
}

describe("retainEvidence: happy path", () => {
  it("copies .run/<id>/surfaces/<sid>/evidence/shot.png to <evidenceRoot>/<repo>/<16-hex>.png, byte-identical", () => {
    const l = makeLayout();
    const content = "pretend-png-bytes";
    const src = writeRunFile(l.runDir, "surfaces/s1/evidence/shot.png", content);
    writeFinding(
      l.metricsDir,
      baseFinding({
        dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" },
        evidence: "surfaces/s1/evidence/shot.png", // run-dir-relative spelling
      }),
    );

    const res = retainEvidence({
      runDir: l.runDir,
      repoRoot: l.repoRoot,
      metricsDir: l.metricsDir,
      evidenceRoot: l.evidenceRoot,
      repoName: l.repoName,
    });

    expect(res.copied).toHaveLength(1);
    const [entry] = res.copied;
    expect(entry!.stored).toBe(`${l.repoName}/${sha16(content)}.png`);
    expect(entry!.deduped).toBe(false);
    expect(entry!.from).toBe(src);

    const destPath = join(l.evidenceRoot, entry!.stored);
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, "utf8")).toEqual(readFileSync(src, "utf8"));
  });
});

describe("retainEvidence: content addressing", () => {
  it("two different recorded values with identical file CONTENT collapse to one stored file; the second reports deduped:true", () => {
    const l = makeLayout();
    const sameContent = "identical-bytes-across-two-screenshots";
    writeRunFile(l.runDir, "surfaces/s1/evidence/a.png", sameContent);
    writeRunFile(l.runDir, "surfaces/s2/evidence/b.png", sameContent);
    writeFinding(
      l.metricsDir,
      baseFinding({ dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" }, evidence: "surfaces/s1/evidence/a.png" }),
    );
    writeFinding(
      l.metricsDir,
      baseFinding({ dedupe_key: { surface: "s2", symptom: "x", root_cause: "y" }, evidence: "surfaces/s2/evidence/b.png" }),
    );

    const res = retainEvidence({
      runDir: l.runDir,
      repoRoot: l.repoRoot,
      metricsDir: l.metricsDir,
      evidenceRoot: l.evidenceRoot,
      repoName: l.repoName,
    });

    expect(res.copied).toHaveLength(2);
    expect(res.copied[0]!.stored).toBe(res.copied[1]!.stored);
    expect(res.copied[0]!.deduped).toBe(false);
    expect(res.copied[1]!.deduped).toBe(true);
    // Only one physical file was ever written for the two recorded values.
    expect(readdirSync(l.repoEvidenceDir)).toEqual([`${sha16(sameContent)}.png`]);
  });
});

describe("retainEvidence: SECURITY — refuses evidence pointing outside the run dir", () => {
  it("a traversal ('../../secret.txt') that escapes runDir is NOT copied and lands in `skipped`", () => {
    // This is the "log a finding -> exfiltrate a file into a directory the
    // dashboard publishes links to" case named in the module header. Without
    // the inside() gate, a recorded value is just an agent-authored string —
    // treating it as trustworthy would let a compromised reviewer smuggle any
    // file on disk into the evidence store's public link surface.
    const l = makeLayout();
    const secret = join(dir, "secret.txt");
    writeFileSync(secret, "top secret contents");
    const recorded = "../../secret.txt"; // runDir = <dir>/.run/<id>, two ups = <dir>
    writeFinding(
      l.metricsDir,
      baseFinding({ dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" }, evidence: recorded }),
    );

    const res = retainEvidence({
      runDir: l.runDir,
      repoRoot: l.repoRoot,
      metricsDir: l.metricsDir,
      evidenceRoot: l.evidenceRoot,
      repoName: l.repoName,
    });

    expect(res.copied).toEqual([]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]!.recorded).toBe(recorded);
    // Nothing was ever copied, so the repo evidence dir was never even created.
    expect(existsSync(l.repoEvidenceDir)).toBe(false);
  });

  it("an absolute path to a file elsewhere in the tmpdir is NOT copied and lands in `skipped`", () => {
    const l = makeLayout();
    const secret = join(dir, "another-secret.txt");
    writeFileSync(secret, "also top secret");
    writeFinding(
      l.metricsDir,
      baseFinding({ dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" }, evidence: secret }),
    );

    const res = retainEvidence({
      runDir: l.runDir,
      repoRoot: l.repoRoot,
      metricsDir: l.metricsDir,
      evidenceRoot: l.evidenceRoot,
      repoName: l.repoName,
    });

    expect(res.copied).toEqual([]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]!.recorded).toBe(secret);
    expect(existsSync(l.repoEvidenceDir)).toBe(false);
  });
});

describe("retainEvidence: symlink safety", () => {
  it("a symlink inside the run dir is refused and reported in `skipped`, even though its target has real content", () => {
    // The link may resolve inside runDir while its target does not — inside()
    // alone can't catch that, so the source is lstat'd and any symlink refused
    // outright, exactly mirroring prune.ts's own symlink-never-followed rule.
    const l = makeLayout();
    const target = join(dir, "outside-target.png");
    writeFileSync(target, "real bytes");
    const linkRel = "surfaces/s1/evidence/link.png";
    const linkAbs = join(l.runDir, ...linkRel.split("/"));
    mkdirSync(join(linkAbs, ".."), { recursive: true });
    symlinkSync(target, linkAbs);
    writeFinding(
      l.metricsDir,
      baseFinding({ dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" }, evidence: linkRel }),
    );

    const res = retainEvidence({
      runDir: l.runDir,
      repoRoot: l.repoRoot,
      metricsDir: l.metricsDir,
      evidenceRoot: l.evidenceRoot,
      repoName: l.repoName,
    });

    expect(res.copied).toEqual([]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]!.recorded).toBe(linkRel);
    expect(res.skipped[0]!.reason).toMatch(/symlink/);
    expect(existsSync(l.repoEvidenceDir)).toBe(false);
  });
});

describe("retainEvidence: SECURITY — refuses a symlinked repo evidence ROOT", () => {
  it("$OPS/evidence/<repo> is a symlink to a directory elsewhere: throws, and nothing under the target is touched", () => {
    // The scenario the module header's ROOT GUARD comment names: a stale or
    // planted $OPS/evidence/<repo> link. Without the guard, mkdirSync/
    // copyFileSync would write THROUGH the link, and the trailing lifecycle
    // prune() — whose symlink defense only makes symlink CHILDREN leaves, and
    // never validates the root it's handed — would existsSync/readdirSync
    // straight through it and delete every non-retained file at the link's
    // TARGET. The outside file below stands in for exactly that: it must
    // survive, and the call must refuse loudly instead of silently no-oping.
    const l = makeLayout();
    const outsideTarget = join(dir, "elsewhere-evidence-store");
    mkdirSync(outsideTarget, { recursive: true });
    const outsideFile = join(outsideTarget, "unrelated-and-must-survive.png");
    writeFileSync(outsideFile, "bytes that must not be deleted");
    mkdirSync(l.evidenceRoot, { recursive: true });
    symlinkSync(outsideTarget, l.repoEvidenceDir);

    const newContent = "brand new evidence for a still-open finding";
    writeRunFile(l.runDir, "surfaces/s1/evidence/new.png", newContent);
    writeFinding(
      l.metricsDir,
      baseFinding({ dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" }, evidence: "surfaces/s1/evidence/new.png" }),
    );

    expect(() =>
      retainEvidence({
        runDir: l.runDir,
        repoRoot: l.repoRoot,
        metricsDir: l.metricsDir,
        evidenceRoot: l.evidenceRoot,
        repoName: l.repoName,
      }),
    ).toThrow(/symlink/);

    // Nothing at the link's target was deleted, and nothing was copied through it.
    expect(existsSync(outsideFile)).toBe(true);
    expect(readdirSync(outsideTarget)).toEqual(["unrelated-and-must-survive.png"]);
  });
});

describe("retainEvidence: SECURITY — refuses a repo evidence ROOT that is a plain file", () => {
  it("$OPS/evidence/<repo> exists as a regular file (not a directory): throws rather than mkdir/copy through it", () => {
    const l = makeLayout();
    mkdirSync(l.evidenceRoot, { recursive: true });
    writeFileSync(l.repoEvidenceDir, "not a directory");

    writeRunFile(l.runDir, "surfaces/s1/evidence/new.png", "content");
    writeFinding(
      l.metricsDir,
      baseFinding({ dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" }, evidence: "surfaces/s1/evidence/new.png" }),
    );

    expect(() =>
      retainEvidence({
        runDir: l.runDir,
        repoRoot: l.repoRoot,
        metricsDir: l.metricsDir,
        evidenceRoot: l.evidenceRoot,
        repoName: l.repoName,
      }),
    ).toThrow(/not a directory/);

    // The file was left exactly as it was — no truncation, no directory swap.
    expect(readFileSync(l.repoEvidenceDir, "utf8")).toBe("not a directory");
  });
});

describe("retainEvidence: missing file", () => {
  it("a recorded value naming a file that does not exist is reported in `skipped`, not thrown", () => {
    const l = makeLayout();
    writeFinding(
      l.metricsDir,
      baseFinding({
        dedupe_key: { surface: "s1", symptom: "x", root_cause: "y" },
        evidence: "surfaces/s1/evidence/never-written.png",
      }),
    );

    expect(() =>
      retainEvidence({
        runDir: l.runDir,
        repoRoot: l.repoRoot,
        metricsDir: l.metricsDir,
        evidenceRoot: l.evidenceRoot,
        repoName: l.repoName,
      }),
    ).not.toThrow();

    const res = retainEvidence({
      runDir: l.runDir,
      repoRoot: l.repoRoot,
      metricsDir: l.metricsDir,
      evidenceRoot: l.evidenceRoot,
      repoName: l.repoName,
    });
    expect(res.copied).toEqual([]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]!.recorded).toBe("surfaces/s1/evidence/never-written.png");
  });
});

describe("retainEvidence: PRUNE INTERACTION (load-bearing)", () => {
  it("deletes a now-resolved finding's stored evidence while the file just copied for a still-open finding SURVIVES", () => {
    // This is the scenario the module's "KNOWN GAP" comment and prune.ts's
    // over-retention design both exist to protect. The hash rename (source
    // basename "new.png" -> stored "<16-hex>.png") means the OLD basename
    // fallback in openEvidenceRetainSet can never match a freshly-made copy —
    // so if retainEvidence forgot to fold `copied` into the retain set before
    // calling prune(), the trailing lifecycle prune would delete every file
    // this very invocation just wrote, on every single run.
    const l = makeLayout();

    // A stale file left behind by a PRIOR run, for a finding that has since
    // been resolved. Its basename is what a naive (pre-hash-rename) retain
    // check might expect to match — it must NOT survive.
    mkdirSync(l.repoEvidenceDir, { recursive: true });
    const staleName = "staleaaaaaaaaaa.png";
    writeFileSync(join(l.repoEvidenceDir, staleName), "old, no-longer-referenced bytes");
    writeFinding(
      l.metricsDir,
      baseFinding({
        dedupe_key: { surface: "resolved-surface", symptom: "x", root_cause: "y" },
        evidence: staleName,
        resolved_at: "2026-06-20",
      }),
    );

    // A currently open finding whose evidence lives in THIS run's scratch dir
    // and must be copied out and then survive the same call's prune.
    const newContent = "brand new evidence for a finding that is still open";
    writeRunFile(l.runDir, "surfaces/s2/evidence/new.png", newContent);
    writeFinding(
      l.metricsDir,
      baseFinding({
        dedupe_key: { surface: "open-surface", symptom: "x", root_cause: "y" },
        evidence: "surfaces/s2/evidence/new.png",
      }),
    );

    const res = retainEvidence({
      runDir: l.runDir,
      repoRoot: l.repoRoot,
      metricsDir: l.metricsDir,
      evidenceRoot: l.evidenceRoot,
      repoName: l.repoName,
    });

    expect(res.copied).toHaveLength(1);
    const newStored = res.copied[0]!.stored;
    expect(newStored).toBe(`${l.repoName}/${sha16(newContent)}.png`);

    // The stale, now-unreferenced file for the resolved finding is gone.
    expect(res.pruned.removed).toContain(staleName);
    expect(existsSync(join(l.repoEvidenceDir, staleName))).toBe(false);

    // The file copied THIS invocation, for the still-open finding, survives.
    const newBasename = newStored.slice(l.repoName.length + 1);
    expect(res.pruned.kept).toContain(newBasename);
    expect(existsSync(join(l.repoEvidenceDir, newBasename))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// retainLogs
// ---------------------------------------------------------------------------

describe("retainLogs", () => {
  function touch(target: string, name: string, ageDays: number): void {
    mkdirSync(target, { recursive: true });
    const p = join(target, name);
    writeFileSync(p, "x");
    const t = (NOW - ageDays * DAY_MS) / 1000;
    utimesSync(p, t, t);
  }

  it("time-prunes, honoring `keep` and `maxAgeDays`", () => {
    const logsDir = join(dir, "logs");
    touch(logsDir, "a.log", 0);
    touch(logsDir, "b.log", 1);
    touch(logsDir, "c.log", 2); // outside keep:2 by rank
    const res = retainLogs(logsDir, { keep: 2, maxAgeDays: 30, now: () => NOW });
    expect(res.kept.sort()).toEqual(["a.log", "b.log"]);
    expect(res.removed).toEqual(["c.log"]);
  });

  it("time-prunes an entry that ages past maxAgeDays even though it ranks within keep", () => {
    const logsDir = join(dir, "logs");
    touch(logsDir, "fresh.log", 1);
    touch(logsDir, "stale.log", 20); // within keep:5 by rank, but > maxAgeDays:14
    const res = retainLogs(logsDir, { keep: 5, maxAgeDays: 14, now: () => NOW });
    expect(res.kept).toEqual(["fresh.log"]);
    expect(res.removed).toEqual(["stale.log"]);
  });

  it("a missing logs dir is a no-op, not an error", () => {
    const res = retainLogs(join(dir, "no-such-logs-dir"), { now: () => NOW });
    expect(res).toEqual({ removed: [], kept: [] });
  });
});

// ---------------------------------------------------------------------------
// evidenceBytes
// ---------------------------------------------------------------------------

describe("evidenceBytes", () => {
  it("sums a directory tree recursively", () => {
    const target = join(dir, "evidence");
    mkdirSync(join(target, "acme"), { recursive: true });
    writeFileSync(join(target, "acme", "one.png"), "hello"); // 5 bytes
    mkdirSync(join(target, "acme", "sub"), { recursive: true });
    writeFileSync(join(target, "acme", "sub", "two.png"), "hi"); // 2 bytes
    expect(evidenceBytes(target)).toBe(7);
  });

  it("returns 0 for a missing dir", () => {
    expect(evidenceBytes(join(dir, "nope"))).toBe(0);
  });

  it("skips symlinks — a linked file's bytes are not double-counted or counted at all", () => {
    // Sanity-not-vacuous: without the skip, this total would be 5 (real.png)
    // + the linked file's size, proving the guard actually changes the sum
    // rather than happening to agree with it.
    const target = join(dir, "evidence");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "real.png"), "hello"); // 5 bytes
    const linkedTarget = join(dir, "elsewhere.png");
    writeFileSync(linkedTarget, "this content is much longer than five bytes");
    symlinkSync(linkedTarget, join(target, "link.png"));
    expect(evidenceBytes(target)).toBe(5);
  });
});
