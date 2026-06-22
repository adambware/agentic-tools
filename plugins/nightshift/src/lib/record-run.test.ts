import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRecord, type RecordOpts } from "./record-run.js";
import { readJsonl } from "./io.js";
import type { Decisions } from "./dedupe-run.js";
import type { CandidateFinding, Finding, RunMetrics } from "./types.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-record-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cand(surface: string): CandidateFinding {
  return {
    dedupe_key: { surface, symptom: "sym", root_cause: "rc" },
    severity: "critical",
    confidence: "high",
    needs_human_verification: true,
  };
}

function baseOpts(decisions: Decisions, over: Partial<RecordOpts> = {}): RecordOpts {
  return {
    decisions,
    metricsDir: join(dir, "metrics"),
    reviewedIds: [],
    runId: "ns-2026-06-21-sec-01",
    lane: "security",
    date: "2026-06-21",
    ts: "2026-06-21T07:00:00Z",
    packSha: "abc1234",
    selected: 1,
    reviewed: 1,
    rejectedTier1: 0,
    rejectedTier2: 0,
    usageByModel: { haiku: 2 },
    usageSpent: 0.1,
    elapsed: 60,
    ...over,
  };
}

describe("runRecord", () => {
  it("appends a new finding with first_seen=last_seen=today and the run record", () => {
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-05") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    const res = runRecord(baseOpts(decisions));
    expect(res.findingsAppended).toBe(1);

    const findings = readJsonl<Finding>(join(dir, "metrics", "findings", "2026-06.jsonl"));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.first_seen).toBe("2026-06-21");
    expect(findings[0]!.last_seen).toBe("2026-06-21");
    expect(findings[0]!.run_id).toBe("ns-2026-06-21-sec-01");

    const runs = readJsonl<{ confirmed: number; suppressed: number }>(
      join(dir, "metrics", "runs", "2026-06.jsonl"),
    );
    expect(runs[0]!.confirmed).toBe(1);
    expect(runs[0]!.suppressed).toBe(0);
  });

  it("bumps last_seen but carries first_seen forward for a recurring finding", () => {
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "recurring", finding: cand("ND-SEC-02"), first_seen: "2026-06-10" }],
      counts: { confirmed: 0, recurring: 1, suppressed: 0 },
    };
    const res = runRecord(baseOpts(decisions));
    expect(res.recurringBumped).toBe(1);
    const findings = readJsonl<Finding>(join(dir, "metrics", "findings", "2026-06.jsonl"));
    expect(findings[0]!.first_seen).toBe("2026-06-10");
    expect(findings[0]!.last_seen).toBe("2026-06-21");
  });

  it("does not log a suppressed decision", () => {
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "suppressed", finding: cand("ND-SEC-03") }],
      counts: { confirmed: 0, recurring: 0, suppressed: 1 },
    };
    const res = runRecord(baseOpts(decisions));
    expect(res.findingsAppended).toBe(0);
    expect(readJsonl(join(dir, "metrics", "findings", "2026-06.jsonl"))).toEqual([]);
    const runs = readJsonl<{ suppressed: number }>(join(dir, "metrics", "runs", "2026-06.jsonl"));
    expect(runs[0]!.suppressed).toBe(1);
  });

  it("updates reviewed entries' last_reviewed and status in the registry", () => {
    const regPath = join(dir, "vectors.yml");
    writeFileSync(
      regPath,
      `# header comment preserved
vectors:
  - id: ND-SEC-05
    title: IDOR
    kind: vector
    area: ["app/x"]
    weight: critical
    interval_days: 7
    owner: security
    last_reviewed: 2026-06-11
    status: stale
`,
    );
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-05") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    runRecord(baseOpts(decisions, { registryPath: regPath, reviewedIds: ["ND-SEC-05"] }));
    const yml = readFileSync(regPath, "utf8");
    expect(yml).toContain("# header comment preserved"); // comments survive
    expect(yml).toContain("last_reviewed: 2026-06-21");
    // has an open finding on its surface -> open-findings
    expect(yml).toContain("status: open-findings");
  });

  it("marks a reviewed entry green when it has no open findings", () => {
    const regPath = join(dir, "vectors.yml");
    writeFileSync(
      regPath,
      `vectors:
  - id: ASVS-AUTH-01
    title: Auth
    kind: vector
    area: ["app/x"]
    weight: critical
    interval_days: 7
    owner: security
    last_reviewed: 2026-06-01
    status: stale
`,
    );
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [],
      counts: { confirmed: 0, recurring: 0, suppressed: 0 },
    };
    runRecord(baseOpts(decisions, { registryPath: regPath, reviewedIds: ["ASVS-AUTH-01"] }));
    expect(readFileSync(regPath, "utf8")).toContain("status: green");
  });

  // ── findings_created identity tests ────────────────────────────────────────
  // findings_created = confirmed + recurring + rejected_tier1 + rejected_tier2
  // (= proposed_count - suppressed)

  it("findings_created identity: clean-slate — 1 confirmed, 0 rejected, 0 suppressed", () => {
    // proposed_count=1, survivors=1, suppressed=0 → findings_created should be 1
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-10") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    const res = runRecord(
      baseOpts(decisions, { rejectedTier1: 0, rejectedTier2: 0 }),
    );
    // confirmed(1) + recurring(0) + rejected_tier1(0) + rejected_tier2(0) = 1
    expect(res.runRecord.findings_created).toBe(1);
  });

  it("findings_created identity: suppressed candidate excluded — proposed=2, suppressed=1, rejected_tier1=0", () => {
    // proposed_count=2, survivors=2 (tier1 keeps both), dedupe suppresses 1:
    // confirmed=1, suppressed=1, rejected_tier1=0 → findings_created = 1
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [
        { decision: "new", finding: cand("ND-SEC-11") },
        { decision: "suppressed", finding: cand("ND-SEC-12") },
      ],
      counts: { confirmed: 1, recurring: 0, suppressed: 1 },
    };
    // rejected_tier1=0 (both survivors; suppression happens inside dedupe, not tier1)
    const res = runRecord(
      baseOpts(decisions, { rejectedTier1: 0, rejectedTier2: 0 }),
    );
    // confirmed(1) + recurring(0) + rejected_tier1(0) + rejected_tier2(0) = 1
    // (NOT 2, because the suppressed candidate is excluded)
    expect(res.runRecord.findings_created).toBe(1);
  });

  it("findings_created identity: recurring candidate — proposed=3, 1 recurring, 1 confirmed, rejected_tier1=1", () => {
    // proposed_count=3, survivors=2 (tier1 drops 1), dedupe: 1 confirmed + 1 recurring
    // findings_created = confirmed(1) + recurring(1) + rejected_tier1(1) + rejected_tier2(0) = 3
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [
        { decision: "new", finding: cand("ND-SEC-13") },
        { decision: "recurring", finding: cand("ND-SEC-14"), first_seen: "2026-05-01" },
      ],
      counts: { confirmed: 1, recurring: 1, suppressed: 0 },
    };
    const res = runRecord(
      baseOpts(decisions, { rejectedTier1: 1, rejectedTier2: 0 }),
    );
    expect(res.runRecord.findings_created).toBe(3);
  });

  it("findings_created identity: all survivors suppressed — proposed=2, survivors=2, suppressed=2", () => {
    // confirmed(0) + recurring(0) + rejected_tier1(0) + rejected_tier2(0) = 0
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [
        { decision: "suppressed", finding: cand("ND-SEC-15") },
        { decision: "suppressed", finding: cand("ND-SEC-16") },
      ],
      counts: { confirmed: 0, recurring: 0, suppressed: 2 },
    };
    const res = runRecord(
      baseOpts(decisions, { rejectedTier1: 0, rejectedTier2: 0 }),
    );
    expect(res.runRecord.findings_created).toBe(0);
  });
});
