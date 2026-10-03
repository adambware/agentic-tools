import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectReviews, normalizeLens, parseReview } from "./lens.js";

const TS = "2026-08-30T12:00:00Z";
const review = (extra: Record<string, unknown> = {}) => ({ skill: "review", timestamp: TS, ...extra });

describe("normalizeLens", () => {
  it("folds case, padding and underscores onto gstack's dashed names", () => {
    expect(normalizeLens(" Red_Team ")).toBe("red-team");
    expect(normalizeLens("api_contract")).toBe("api-contract");
  });
});

describe("parseReview", () => {
  it("ignores records that are not reviews, without counting them", () => {
    expect(parseReview({ skill: "ship", timestamp: TS })).toEqual({ ok: false, badRecords: 0 });
    expect(parseReview({ skill: "adversarial-review", timestamp: TS, findings: [] })).toEqual({ ok: false, badRecords: 0 });
  });

  it("counts a review it cannot put in a window: missing, zone-less or impossible timestamp", () => {
    for (const timestamp of [undefined, null, "2026-08-30T12:00:00", "2026-02-30T12:00:00Z", 1_700_000_000_000]) {
      expect(parseReview({ skill: "review", timestamp })).toEqual({ ok: false, badRecords: 1 });
    }
  });

  it("reads specialists: dispatched counts, not-dispatched lenses, normalized names", () => {
    const p = parseReview(
      review({
        specialists: {
          testing: { dispatched: true, findings: 3, critical: 1, informational: 2 },
          red_team: { dispatched: true, findings: 0, critical: 0 },
          design: { dispatched: false, reason: "scope" },
        },
      }),
    );
    expect(p).toEqual({
      ok: true,
      badRecords: 0,
      review: {
        ts: Date.parse(TS),
        specialists: [
          { lens: "testing", dispatched: true, reported: 3, reportedCritical: 1 },
          { lens: "red-team", dispatched: true, reported: 0, reportedCritical: 0 },
          { lens: "design", dispatched: false, reported: 0, reportedCritical: 0 },
        ],
        findings: null,
      },
    });
  });

  it("tells an empty specialists block (army skipped, {} or []) from a missing one", () => {
    const empty = parseReview(review({ specialists: {} }));
    const emptyArray = parseReview(review({ specialists: [] }));
    const none = parseReview(review());
    expect(empty.ok && empty.review.specialists).toEqual([]);
    expect(emptyArray).toMatchObject({ ok: true, badRecords: 0, review: { specialists: [] } });
    expect(none.ok && none.review.specialists).toBeNull();
  });

  it("counts malformed specialists as drift and keeps the well-formed lenses", () => {
    const p = parseReview(
      review({
        specialists: {
          skipped: "review-army skipped (budget)", // a string where an object belongs
          testing: { dispatched: "yes" }, // dispatched not boolean
          security: { dispatched: true }, // findings missing
          performance: { dispatched: true, findings: -1, critical: 1.5 }, // bad counts
          "bad name!": { dispatched: false },
          maintainability: { dispatched: true, findings: 2 }, // critical absent: old logs, not drift
        },
      }),
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.badRecords).toBe(6);
    expect(p.review.specialists).toEqual([
      { lens: "security", dispatched: true, reported: 0, reportedCritical: 0 },
      { lens: "performance", dispatched: true, reported: 0, reportedCritical: 0 },
      { lens: "maintainability", dispatched: true, reported: 2, reportedCritical: 0 },
    ]);
  });

  it("counts a non-object specialists block as drift", () => {
    for (const specialists of ["skipped", [{ testing: {} }], 3]) {
      const p = parseReview(review({ specialists }));
      expect(p.ok && p.badRecords).toBe(1);
      expect(p.ok && p.review.specialists).toBeNull();
    }
  });

  it("attributes findings by fingerprint category, severity and action", () => {
    const p = parseReview(
      review({
        findings: [
          { fingerprint: "src/a.ts:10:testing", severity: "INFORMATIONAL", action: "auto-fixed" },
          { fingerprint: "src/b.ts:red_team", severity: "critical", action: "skipped" },
          { fingerprint: "src/c.ts:4:stale-comment", severity: "P1", action: "fixed" },
          { fingerprint: "maintainability", action: "deferred" },
          { file: "src/d.ts", severity: "P2", action: "asked" },
        ],
      }),
    );
    expect(p.ok && p.badRecords).toBe(0);
    expect(p.ok && p.review.findings).toEqual([
      { lens: "testing", action: "auto-fixed", critical: false },
      { lens: "red-team", action: "skipped", critical: true },
      { lens: null, action: "fixed", critical: true },
      { lens: "maintainability", action: "other", critical: false },
      { lens: null, action: "other", critical: false },
    ]);
  });

  it("counts an unknown or missing action and a non-object finding as drift", () => {
    const p = parseReview(review({ findings: [{ fingerprint: "a:testing", action: "ignored" }, { fingerprint: "a:testing" }, "x", null] }));
    expect(p.ok && p.badRecords).toBe(4);
    expect(p.ok && p.review.findings).toEqual([
      { lens: "testing", action: "other", critical: false },
      { lens: "testing", action: "other", critical: false },
    ]);
  });

  it("treats a numeric findings field (older logs) as no list, not drift", () => {
    const p = parseReview(review({ findings: 3 }));
    expect(p).toMatchObject({ ok: true, badRecords: 0, review: { findings: null } });
  });
});

describe("collectReviews", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "loops-lens-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const write = (repo: string, name: string, lines: string[]) => {
    mkdirSync(join(tmp, repo), { recursive: true });
    const path = join(tmp, repo, name);
    writeFileSync(path, lines.join("\n") + "\n");
    return path;
  };

  it("reads only *-reviews.jsonl one level down, and dedupes identical lines across files", () => {
    const line = JSON.stringify(review({ specialists: {} }));
    write("a", "main-reviews.jsonl", [line, "", JSON.stringify({ skill: "ship", timestamp: TS })]);
    write("b", "copy-reviews.jsonl", [line]);
    write("b", "notes.jsonl", [JSON.stringify(review())]);
    writeFileSync(join(tmp, "top-reviews.jsonl"), line + "\n");
    const { reviews, parse } = collectReviews(tmp, 0);
    expect(reviews).toHaveLength(1);
    expect(parse).toEqual({ bad_lines: 0, bad_files: 0, bad_records: 0, dup_records: 1 });
  });

  it("counts unparseable and non-object lines, including a pretty-printed record's lines", () => {
    write("a", "x-reviews.jsonl", ["[1,2]", "null", "{", '  "skill":"review",', "}", JSON.stringify(review())]);
    const { reviews, parse } = collectReviews(tmp, 0);
    expect(reviews).toHaveLength(1);
    expect(parse.bad_lines).toBe(5);
  });

  it("keeps a U+2028 inside a JSON string in one record", () => {
    write("a", "x-reviews.jsonl", [JSON.stringify(review({ note: "a b" }))]);
    const { reviews, parse } = collectReviews(tmp, 0);
    expect(reviews).toHaveLength(1);
    expect(parse.bad_lines).toBe(0);
  });

  it("skips files last modified before the widest window", () => {
    const old = write("a", "old-reviews.jsonl", [JSON.stringify(review())]);
    utimesSync(old, new Date(1000), new Date(1000));
    write("a", "new-reviews.jsonl", [JSON.stringify(review({ timestamp: "2026-08-31T00:00:00Z" }))]);
    expect(collectReviews(tmp, 10_000).reviews).toHaveLength(1);
  });

  it("throws when the gstack dir itself is unreadable", () => {
    expect(() => collectReviews(join(tmp, "missing"), 0)).toThrow(/ENOENT/);
  });

  it.skipIf(process.getuid?.() === 0)("counts an unreadable repo dir or log file in bad_files", () => {
    write("a", "x-reviews.jsonl", [JSON.stringify(review())]);
    const f = write("b", "y-reviews.jsonl", [JSON.stringify(review())]);
    mkdirSync(join(tmp, "c"));
    chmodSync(f, 0o000);
    chmodSync(join(tmp, "c"), 0o000);
    try {
      const { reviews, parse } = collectReviews(tmp, 0);
      expect(reviews).toHaveLength(1);
      expect(parse.bad_files).toBe(2);
    } finally {
      chmodSync(f, 0o644);
      chmodSync(join(tmp, "c"), 0o755);
    }
  });
});
