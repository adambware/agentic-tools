import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRecord, type RecordOpts } from "./record-run.js";
import { readJsonl } from "./io.js";
import type { Decisions } from "./dedupe-run.js";
import type { CandidateFinding, Finding } from "./types.js";

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
    findingsCreated: 1,
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
    const res = runRecord(baseOpts(decisions, { findingsCreated: 0 }));
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
    const res = runRecord(baseOpts(decisions, { findingsCreated: 0 }));
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
    runRecord(baseOpts(decisions, { registryPath: regPath, reviewedIds: ["ASVS-AUTH-01"], findingsCreated: 0 }));
    expect(readFileSync(regPath, "utf8")).toContain("status: green");
  });
});
