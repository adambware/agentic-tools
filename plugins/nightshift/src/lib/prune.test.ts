import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, existsSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prune, openEvidenceRetainSet } from "./prune.js";
import { appendJsonl } from "./io.js";
import type { Finding } from "./types.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-prune-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-21T00:00:00Z").getTime();

/** Create `name` under dir with mtime `ageDays` old relative to NOW. */
function touch(target: string, name: string, ageDays: number): void {
  const p = join(target, name);
  mkdirSync(target, { recursive: true });
  writeFileSync(p, "x");
  const t = (NOW - ageDays * DAY_MS) / 1000;
  utimesSync(p, t, t);
}

/** Create a nested file at `relPath` (posix, may contain "/") under target. */
function touchNested(target: string, relPath: string): void {
  const p = join(target, ...relPath.split("/"));
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "x");
}

describe("prune: missing dir", () => {
  it("returns empty removed/kept and does not throw", () => {
    const res = prune(join(dir, "nope"), { kind: "time", keep: 5, maxAgeDays: 7 });
    expect(res).toEqual({ removed: [], kept: [] });
  });
});

describe("prune: time policy", () => {
  it("keeps <=keep most-recent entries within maxAgeDays", () => {
    const target = join(dir, "runs");
    // 3 entries, all young; keep=2 -> oldest of the three is dropped by rank.
    touch(target, "a", 0);
    touch(target, "b", 1);
    touch(target, "c", 2);
    const res = prune(target, { kind: "time", keep: 2, maxAgeDays: 30 }, { now: () => NOW });
    expect(res.kept.sort()).toEqual(["a", "b"]);
    expect(res.removed).toEqual(["c"]);
    expect(existsSync(join(target, "a"))).toBe(true);
    expect(existsSync(join(target, "c"))).toBe(false);
  });

  it("drops entries older than maxAgeDays even within the top `keep`", () => {
    const target = join(dir, "runs");
    touch(target, "fresh", 1);
    touch(target, "stale", 10); // within rank (keep=5) but too old
    const res = prune(target, { kind: "time", keep: 5, maxAgeDays: 7 }, { now: () => NOW });
    expect(res.kept).toEqual(["fresh"]);
    expect(res.removed).toEqual(["stale"]);
  });

  it("eventually prunes an old entry that also fails the age bound outside top N", () => {
    const target = join(dir, "runs");
    for (let i = 0; i < 5; i++) touch(target, `recent-${i}`, i); // ranks 0-4, all <7d
    touch(target, "old-failed-run", 10); // rank 5th oldest, and >7d old either way
    const res = prune(target, { kind: "time", keep: 5, maxAgeDays: 7 }, { now: () => NOW });
    expect(res.removed).toContain("old-failed-run");
    expect(res.kept).not.toContain("old-failed-run");
  });

  it("removes directories recursively", () => {
    const target = join(dir, "runs");
    const sub = join(target, "run-dir");
    mkdirSync(join(sub, "nested"), { recursive: true });
    writeFileSync(join(sub, "nested", "f.txt"), "x");
    const t = (NOW - 30 * DAY_MS) / 1000;
    utimesSync(sub, t, t);
    const res = prune(target, { kind: "time", keep: 0, maxAgeDays: 7 }, { now: () => NOW });
    expect(res.removed).toEqual(["run-dir"]);
    expect(existsSync(sub)).toBe(false);
  });
});

describe("prune: lifecycle policy", () => {
  it("retains exactly the retain set (flat layout)", () => {
    const target = join(dir, "evidence");
    touch(target, "keep-me.png", 100);
    touch(target, "drop-me.png", 0);
    const res = prune(target, { kind: "lifecycle", retain: new Set(["keep-me.png"]) });
    expect(res.kept).toEqual(["keep-me.png"]);
    expect(res.removed).toEqual(["drop-me.png"]);
  });

  it("(a) survives the real nested <repo>/<hash>.png layout without deleting the whole tree", () => {
    const target = join(dir, "evidence");
    touchNested(target, "acme/a1b2c3d4.png");
    touchNested(target, "acme/deadbeef.png");
    touchNested(target, "novudesk/cafef00d.png");
    // retain holds only the one file still referenced by an open finding.
    const res = prune(target, {
      kind: "lifecycle",
      retain: new Set(["acme/a1b2c3d4.png"]),
    });
    expect(res.kept).toEqual(["acme/a1b2c3d4.png"]);
    expect(res.removed.sort()).toEqual(["acme/deadbeef.png", "novudesk/cafef00d.png"]);
    expect(existsSync(join(target, "acme", "a1b2c3d4.png"))).toBe(true);
    expect(existsSync(join(target, "acme", "deadbeef.png"))).toBe(false);
    // novudesk's only file was removed, so its now-empty dir is swept too.
    expect(existsSync(join(target, "novudesk"))).toBe(false);
    // acme still holds a retained file, so its dir survives.
    expect(existsSync(join(target, "acme"))).toBe(true);
  });

  it("empty dirs are removed after pruning, but not the pruned dir itself", () => {
    const target = join(dir, "evidence");
    touchNested(target, "onlyrepo/x.png");
    const res = prune(target, { kind: "lifecycle", retain: new Set() });
    expect(res.removed).toEqual(["onlyrepo/x.png"]);
    expect(existsSync(join(target, "onlyrepo"))).toBe(false);
    expect(existsSync(target)).toBe(true);
    expect(readdirSync(target)).toEqual([]);
  });

  it("basename-only retention keeps a file at any depth", () => {
    const target = join(dir, "evidence");
    touchNested(target, "repo/nested/deeper/shot-abc123.png");
    const res = prune(target, { kind: "lifecycle", retain: new Set(["shot-abc123.png"]) });
    expect(res.kept).toEqual(["repo/nested/deeper/shot-abc123.png"]);
    expect(res.removed).toEqual([]);
    expect(existsSync(join(target, "repo", "nested", "deeper", "shot-abc123.png"))).toBe(true);
  });
});

describe("openEvidenceRetainSet", () => {
  function baseFinding(over: Partial<Finding>): Finding {
    return {
      dedupe_key: { surface: "s", symptom: "sym", root_cause: "rc" },
      severity: "high",
      confidence: "high",
      needs_human_verification: false,
      first_seen: "2026-06-01",
      last_seen: "2026-06-01",
      run_id: "ns-2026-06-01-design-01",
      ...over,
    };
  }

  it("collects all path forms for an open finding's evidence field (nested layout)", () => {
    const metricsDir = join(dir, "metrics");
    appendJsonl(
      join(metricsDir, "findings", "2026-06.jsonl"),
      baseFinding({
        dedupe_key: { surface: "s1", symptom: "sym", root_cause: "rc" },
        evidence: "evidence/acme/shot-abc123.png",
      }),
    );
    const set = openEvidenceRetainSet(metricsDir);
    expect(set).toEqual(
      new Set(["evidence/acme/shot-abc123.png", "acme/shot-abc123.png", "shot-abc123.png"]),
    );
  });

  it("adds only the basename for an absolute evidence path", () => {
    const metricsDir = join(dir, "metrics");
    appendJsonl(
      join(metricsDir, "findings", "2026-06.jsonl"),
      baseFinding({
        dedupe_key: { surface: "s-abs", symptom: "sym", root_cause: "rc" },
        evidence: "/abs/path/to/shot-abc123.png",
      }),
    );
    expect(openEvidenceRetainSet(metricsDir)).toEqual(new Set(["shot-abc123.png"]));
  });

  it("ignores resolved findings", () => {
    const metricsDir = join(dir, "metrics");
    appendJsonl(
      join(metricsDir, "findings", "2026-06.jsonl"),
      baseFinding({
        dedupe_key: { surface: "s2", symptom: "sym", root_cause: "rc" },
        evidence: "shot-resolved.png",
        resolved_at: "2026-06-15",
      }),
    );
    expect(openEvidenceRetainSet(metricsDir)).toEqual(new Set());
  });

  it("ignores findings without an evidence field", () => {
    const metricsDir = join(dir, "metrics");
    appendJsonl(
      join(metricsDir, "findings", "2026-06.jsonl"),
      baseFinding({ dedupe_key: { surface: "s3", symptom: "sym", root_cause: "rc" } }),
    );
    expect(openEvidenceRetainSet(metricsDir)).toEqual(new Set());
  });

  it("(b) a recurring bump without an evidence field still retains the original screenshot", () => {
    const metricsDir = join(dir, "metrics");
    const key = { surface: "s4", symptom: "sym", root_cause: "rc" };
    // First sighting carries evidence; the recurring bump (LWW-last line for
    // this key) omits it, as run-loop.md's optional-evidence candidates do.
    appendJsonl(
      join(metricsDir, "findings", "2026-06.jsonl"),
      baseFinding({ dedupe_key: key, evidence: "evidence/repo/original.png", first_seen: "2026-06-01" }),
    );
    appendJsonl(
      join(metricsDir, "findings", "2026-06.jsonl"),
      baseFinding({ dedupe_key: key, last_seen: "2026-06-10" }), // no evidence field
    );
    const set = openEvidenceRetainSet(metricsDir);
    expect(set.has("original.png")).toBe(true);
    expect(set.has("repo/original.png")).toBe(true);
    expect(set.has("evidence/repo/original.png")).toBe(true);
  });

  it("a resolved-everywhere key's evidence is pruned from a nested layout", () => {
    const metricsDir = join(dir, "metrics");
    appendJsonl(
      join(metricsDir, "findings", "2026-06.jsonl"),
      baseFinding({
        dedupe_key: { surface: "s5", symptom: "sym", root_cause: "rc" },
        evidence: "evidence/repo/resolved-shot.png",
        resolved_at: "2026-06-20",
      }),
    );
    const retain = openEvidenceRetainSet(metricsDir);
    expect(retain.has("resolved-shot.png")).toBe(false);

    const target = join(dir, "evidence-out");
    touchNested(target, "repo/resolved-shot.png");
    touchNested(target, "repo/still-open.png");
    // "still-open.png" isn't referenced by any finding here but stands in for
    // a file another open key retains; only the resolved key's file is gone.
    const res = prune(target, {
      kind: "lifecycle",
      retain: new Set(["repo/still-open.png"]),
    });
    expect(res.removed).toEqual(["repo/resolved-shot.png"]);
    expect(res.kept).toEqual(["repo/still-open.png"]);
  });

  it("(c) a missing findings dir throws and nothing is deleted", () => {
    const metricsDir = join(dir, "metrics-missing");
    expect(() => openEvidenceRetainSet(metricsDir)).toThrow();

    // Sanity: a caller that (bug) ignored the throw and pruned with an
    // empty retain set would wipe the tree — confirm the guard fires before
    // that ever happens by asserting evidence untouched when we don't prune.
    const target = join(dir, "evidence-guarded");
    touchNested(target, "repo/must-survive.png");
    expect(existsSync(join(target, "repo", "must-survive.png"))).toBe(true);
  });

  it("(c) a metricsDir that exists but has no findings subdir also throws", () => {
    const metricsDir = join(dir, "metrics-empty");
    mkdirSync(metricsDir, { recursive: true });
    expect(() => openEvidenceRetainSet(metricsDir)).toThrow();
  });
});

describe("prune: symlink safety (lifecycle + time)", () => {
  it("never follows a symlink-to-directory out of the pruned tree", () => {
    // Layout: evidence/acme/keep.png plus evidence/linked -> ../precious.
    // The old statSync walk recursed through the link and deleted the target's
    // contents; lstat treats the link as a leaf, so the target stays intact
    // and only the link itself is subject to retention.
    const evidence = join(dir, "evidence");
    const precious = join(dir, "precious");
    touchNested(evidence, "acme/keep.png");
    touchNested(precious, "README.md");
    symlinkSync(precious, join(evidence, "linked"));

    const res = prune(evidence, { kind: "lifecycle", retain: new Set(["acme/keep.png"]) });

    expect(existsSync(join(precious, "README.md"))).toBe(true); // target untouched
    expect(existsSync(join(evidence, "linked"))).toBe(false); // unretained link removed (link only)
    expect(existsSync(join(evidence, "acme", "keep.png"))).toBe(true);
    expect(res.removed).toEqual(["linked"]);
  });

  it("a dangling symlink neither aborts the lifecycle walk nor survives unretained", () => {
    const evidence = join(dir, "evidence");
    touchNested(evidence, "acme/keep.png");
    touchNested(evidence, "acme/drop.png");
    symlinkSync(join(dir, "no-such-target"), join(evidence, "dangling"));

    const res = prune(evidence, { kind: "lifecycle", retain: new Set(["acme/keep.png"]) });

    expect(res.removed.sort()).toEqual(["acme/drop.png", "dangling"]);
    expect(existsSync(join(evidence, "acme", "keep.png"))).toBe(true);
  });

  it("a dangling symlink in the run root does not abort a time prune", () => {
    touch(dir, "run-old", 10);
    symlinkSync(join(dir, "no-such-target"), join(dir, "dangling-run"));
    // Ranks by the link's own (fresh) mtime; must not ENOENT mid-scan.
    const res = prune(dir, { kind: "time", keep: 5, maxAgeDays: 7 }, { now: () => NOW });
    expect(res.removed).toContain("run-old");
    expect(res.kept).toContain("dangling-run");
  });

  it("an evidence value naming a DIRECTORY retains everything inside it", () => {
    const evidence = join(dir, "evidence");
    touchNested(evidence, "acme/run-123/before.png");
    touchNested(evidence, "acme/run-123/after.png");
    touchNested(evidence, "acme/stale.png");
    // Retain forms for evidence "evidence/acme/run-123" include the
    // stripped relpath "acme/run-123"; leaves under it must survive.
    const res = prune(evidence, { kind: "lifecycle", retain: new Set(["acme/run-123"]) });
    expect(existsSync(join(evidence, "acme", "run-123", "before.png"))).toBe(true);
    expect(existsSync(join(evidence, "acme", "run-123", "after.png"))).toBe(true);
    expect(res.removed).toEqual(["acme/stale.png"]);
  });
});

describe("prune: refuses a symlinked or non-directory root", () => {
  it("throws under the time policy when dir is a symlink to a real directory", () => {
    const precious = join(dir, "precious");
    touch(precious, "must-survive.txt", 0);
    const linkedRoot = join(dir, "linked-root");
    symlinkSync(precious, linkedRoot);

    expect(() => prune(linkedRoot, { kind: "time", keep: 0, maxAgeDays: 0 }, { now: () => NOW })).toThrow();
    expect(existsSync(join(precious, "must-survive.txt"))).toBe(true);
  });

  it("throws under the lifecycle policy when dir is a symlink to a real directory", () => {
    const precious = join(dir, "precious");
    touchNested(precious, "repo/must-survive.png");
    const linkedRoot = join(dir, "linked-root");
    symlinkSync(precious, linkedRoot);

    expect(() => prune(linkedRoot, { kind: "lifecycle", retain: new Set() })).toThrow();
    expect(existsSync(join(precious, "repo", "must-survive.png"))).toBe(true);
  });

  it("throws when dir exists but is a plain file, not a directory", () => {
    const filePath = join(dir, "not-a-dir");
    writeFileSync(filePath, "x");

    expect(() => prune(filePath, { kind: "time", keep: 5, maxAgeDays: 7 }, { now: () => NOW })).toThrow();
    expect(() => prune(filePath, { kind: "lifecycle", retain: new Set() })).toThrow();
    expect(existsSync(filePath)).toBe(true);
  });
});

describe("prune: retain-set canonicalization (refuter LOST cases)", () => {
  /** Run a lifecycle prune of evidence/ against a retain set built from one
   * open finding whose evidence field is `stored`, and return survival of
   * the given on-disk relpaths. */
  function survives(stored: string, diskRelPaths: string[]): boolean[] {
    const metrics = join(dir, "metrics");
    const evidence = join(dir, "evidence");
    for (const p of diskRelPaths) touchNested(evidence, p);
    const open: Finding = {
      dedupe_key: { surface: "s", symptom: "sym", root_cause: "rc" },
      severity: "medium",
      confidence: "high",
      needs_human_verification: false,
      first_seen: "2026-05-02",
      last_seen: "2026-06-20",
      run_id: "r1",
      evidence: stored,
    };
    appendJsonl(join(metrics, "findings", "2026-05.jsonl"), open);
    prune(evidence, { kind: "lifecycle", retain: openEvidenceRetainSet(metrics) });
    return diskRelPaths.map((p) => existsSync(join(evidence, ...p.split("/"))));
  }

  it("absolute DIRECTORY evidence path retains the directory's contents", () => {
    expect(survives("/abs/ops/evidence/repo/run-123", ["repo/run-123/a.png", "repo/run-123/b.png"]))
      .toEqual([true, true]);
  });

  it("trailing slash on a directory value neither loses it nor poisons the set with ''", () => {
    expect(survives("evidence/repo/run-123/", ["repo/run-123/a.png"])).toEqual([true]);
  });

  it("double slash, /./ segment, and ../ round-trip spellings all retain", () => {
    expect(survives("evidence//repo/run-1", ["repo/run-1/a.png"])).toEqual([true]);
    rmSync(join(dir, "metrics"), { recursive: true, force: true });
    expect(survives("evidence/./repo/run-2", ["repo/run-2/a.png"])).toEqual([true]);
    rmSync(join(dir, "metrics"), { recursive: true, force: true });
    expect(survives("evidence/repo/../repo/run-3", ["repo/run-3/a.png"])).toEqual([true]);
  });

  it("windows separators retain both a file and a directory value", () => {
    expect(survives("evidence\\repo\\shot.png", ["repo/shot.png"])).toEqual([true]);
    rmSync(join(dir, "metrics"), { recursive: true, force: true });
    expect(survives("evidence\\repo\\run-9", ["repo/run-9/a.png"])).toEqual([true]);
  });

  it("NFC-stored evidence retains an NFD-named file on disk", () => {
    const nfdName = "café.png"; // decomposed on disk, as APFS may report it
    expect(survives("evidence/repo/café.png", [`repo/${nfdName}`])).toEqual([true]);
  });

  it("boundary safety: a retained dir matches only at '/' boundaries, never by raw prefix", () => {
    const evidence = join(dir, "evidence");
    touchNested(evidence, "ab/x.png"); // 'ab' is NOT under retained dir 'a'
    touchNested(evidence, "a/bc/x.png"); // IS under retained dir 'a' -> kept
    touchNested(evidence, "rbc/x.png"); // 'rbc' is not 'r/b...' -> pruned
    const res = prune(evidence, { kind: "lifecycle", retain: new Set(["a", "r/b"]) });
    expect(existsSync(join(evidence, "ab", "x.png"))).toBe(false);
    expect(existsSync(join(evidence, "a", "bc", "x.png"))).toBe(true);
    expect(existsSync(join(evidence, "rbc", "x.png"))).toBe(false);
    expect(res.removed.sort()).toEqual(["ab/x.png", "rbc/x.png"]);
  });
});
