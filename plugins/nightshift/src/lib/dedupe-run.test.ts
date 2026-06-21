import { describe, it, expect } from "vitest";
import { dedupe } from "./dedupe-run.js";
import type { CandidateFinding, Finding, Suppression } from "./types.js";

function candidate(surface: string, extra: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    dedupe_key: { surface, symptom: "sym", root_cause: "rc" },
    severity: "high",
    confidence: "high",
    needs_human_verification: true,
    ...extra,
  };
}

function openFinding(surface: string, first_seen: string): Finding {
  return {
    ...candidate(surface),
    first_seen,
    last_seen: first_seen,
    run_id: "old",
  };
}

const base = { run_id: "ns-1", lane: "security" as const, today: "2026-06-21" };

describe("dedupe", () => {
  it("marks a fresh candidate as new (confirmed)", () => {
    const res = dedupe({ ...base, candidates: [candidate("A")], openFindings: [], suppressions: [] });
    expect(res.decisions[0]!.decision).toBe("new");
    expect(res.counts).toEqual({ confirmed: 1, recurring: 0, suppressed: 0 });
  });

  it("marks a candidate matching an open finding as recurring and carries first_seen", () => {
    const res = dedupe({
      ...base,
      candidates: [candidate("A")],
      openFindings: [openFinding("A", "2026-06-10")],
      suppressions: [],
    });
    const d = res.decisions[0]!;
    expect(d.decision).toBe("recurring");
    expect(d.decision === "recurring" && d.first_seen).toBe("2026-06-10");
    expect(res.counts.recurring).toBe(1);
    expect(res.counts.confirmed).toBe(0);
  });

  it("does not treat a resolved finding as an open match", () => {
    const resolved: Finding = { ...openFinding("A", "2026-06-01"), resolved_at: "2026-06-10" };
    const res = dedupe({
      ...base,
      candidates: [candidate("A")],
      openFindings: [resolved],
      suppressions: [],
    });
    // foldFindings already drops resolved upstream; here openFindings is raw, so the
    // matcher must itself ignore resolved findings.
    expect(res.decisions[0]!.decision).toBe("new");
  });

  it("suppresses a candidate matching an active suppression", () => {
    const supp: Suppression = {
      dedupe_key: { surface: "A", symptom: "sym", root_cause: "rc" },
      reason: "accepted",
      expires: "2026-07-01",
      approved_by: "lead",
    };
    const res = dedupe({
      ...base,
      candidates: [candidate("A")],
      openFindings: [],
      suppressions: [supp],
    });
    expect(res.decisions[0]!.decision).toBe("suppressed");
    expect(res.counts.suppressed).toBe(1);
  });

  it("ignores an expired suppression", () => {
    const supp: Suppression = {
      dedupe_key: { surface: "A", symptom: "sym", root_cause: "rc" },
      reason: "accepted",
      expires: "2026-06-01", // before today
      approved_by: "lead",
    };
    const res = dedupe({
      ...base,
      candidates: [candidate("A")],
      openFindings: [],
      suppressions: [supp],
    });
    expect(res.decisions[0]!.decision).toBe("new");
  });

  it("suppression takes precedence over an open match", () => {
    const supp: Suppression = {
      dedupe_key: { surface: "A", symptom: "sym", root_cause: "rc" },
      reason: "accepted",
      expires: "2026-07-01",
      approved_by: "lead",
    };
    const res = dedupe({
      ...base,
      candidates: [candidate("A")],
      openFindings: [openFinding("A", "2026-06-10")],
      suppressions: [supp],
    });
    expect(res.decisions[0]!.decision).toBe("suppressed");
  });
});
