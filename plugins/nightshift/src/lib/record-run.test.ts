import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRecord, type RecordOpts } from "./record-run.js";
import { readJsonl } from "./io.js";
import { acquireLock } from "./lock.js";
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

// ── provenance assert ───────────────────────────────────────────────────────
// decisions.json must carry this run's own identity (run_id/lane/date, sourced
// from run-meta). A mismatch must abort before the FIRST durable append: no
// runs file, no findings file, and the registry left byte-identical.

describe("runRecord — provenance assert", () => {
  const regContent = `vectors:
  - id: ND-SEC-05
    title: IDOR
    kind: vector
    area: ["app/x"]
    weight: critical
    interval_days: 7
    owner: security
    last_reviewed: 2026-06-11
    status: stale
`;

  function seedRegistry(): string {
    const regPath = join(dir, "vectors.yml");
    writeFileSync(regPath, regContent);
    return regPath;
  }

  it("aborts before any append when decisions.run_id does not match run-meta run_id", () => {
    const regPath = seedRegistry();
    const decisions: Decisions = {
      run_id: "ns-STALE-OTHER-RUN",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-05") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    expect(() =>
      runRecord(baseOpts(decisions, { registryPath: regPath, reviewedIds: ["ND-SEC-05"] })),
    ).toThrow(/run_id/);
    expect(existsSync(join(dir, "metrics", "runs"))).toBe(false);
    expect(existsSync(join(dir, "metrics", "findings"))).toBe(false);
    expect(readFileSync(regPath, "utf8")).toBe(regContent); // byte-identical
  });

  it("throws when decisions.lane does not match run-meta lane", () => {
    const regPath = seedRegistry();
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "design",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-05") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    expect(() =>
      runRecord(baseOpts(decisions, { registryPath: regPath, reviewedIds: ["ND-SEC-05"] })),
    ).toThrow(/lane/);
    expect(existsSync(join(dir, "metrics", "runs"))).toBe(false);
    expect(readFileSync(regPath, "utf8")).toBe(regContent);
  });

  it("throws when decisions.date does not match run-meta date", () => {
    const regPath = seedRegistry();
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-20",
      decisions: [{ decision: "new", finding: cand("ND-SEC-05") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    expect(() =>
      runRecord(baseOpts(decisions, { registryPath: regPath, reviewedIds: ["ND-SEC-05"] })),
    ).toThrow(/date/);
    expect(existsSync(join(dir, "metrics", "runs"))).toBe(false);
    expect(readFileSync(regPath, "utf8")).toBe(regContent);
  });
});

// ── run_id uniqueness (idempotency) ─────────────────────────────────────────
// The launcher flow is record -> record-cost -> dashboard -> clean; a failure
// AFTER record invites a retry that must not double-append.

describe("runRecord — run_id uniqueness", () => {
  it("second call with the same run_id throws 'already recorded'; nothing new is written", () => {
    const decisions1: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-20") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    runRecord(baseOpts(decisions1));

    const decisions2: Decisions = {
      run_id: "ns-2026-06-21-sec-01", // same run_id as decisions1 — a retry
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-21") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    expect(() => runRecord(baseOpts(decisions2))).toThrow(/already recorded/);

    const runs = readJsonl(join(dir, "metrics", "runs", "2026-06.jsonl"));
    expect(runs).toHaveLength(1);
    const findings = readJsonl<Finding>(join(dir, "metrics", "findings", "2026-06.jsonl"));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.dedupe_key.surface).toBe("ND-SEC-20"); // decisions2 never landed
  });

  it("detects a duplicate run_id seeded in a different month's shard", () => {
    const runsDir = join(dir, "metrics", "runs");
    mkdirSync(runsDir, { recursive: true });
    // A prior run with this id landed in May; today's date rolled into June.
    writeFileSync(
      join(runsDir, "2026-05.jsonl"),
      JSON.stringify({ run_id: "ns-2026-06-21-sec-01", date: "2026-05-30" }) + "\n",
    );
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [],
      counts: { confirmed: 0, recurring: 0, suppressed: 0 },
    };
    expect(() => runRecord(baseOpts(decisions))).toThrow(/already recorded/);
    // nothing landed in the June shard
    expect(existsSync(join(dir, "metrics", "runs", "2026-06.jsonl"))).toBe(false);
  });
});

// ── interleaved-run isolation ───────────────────────────────────────────────
// Two independent runs sharing one metrics dir + registry must never bleed
// into each other's records, finding lines, or registry stamps.

describe("runRecord — interleaved-run isolation", () => {
  it("run A then run B against the same metrics dir + registry stay fully isolated", () => {
    const regPath = join(dir, "vectors.yml");
    writeFileSync(
      regPath,
      `vectors:
  - id: ND-SEC-A
    title: A
    kind: vector
    area: ["app/a"]
    weight: critical
    interval_days: 7
    owner: security
    last_reviewed: 2026-06-01
    status: stale
  - id: ND-SEC-B
    title: B
    kind: vector
    area: ["app/b"]
    weight: critical
    interval_days: 7
    owner: security
    last_reviewed: 2026-06-01
    status: stale
`,
    );

    const decisionsA: Decisions = {
      run_id: "ns-2026-06-21-sec-A",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-A") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    const decisionsB: Decisions = {
      run_id: "ns-2026-06-22-sec-B",
      lane: "security",
      date: "2026-06-22",
      decisions: [{ decision: "new", finding: cand("ND-SEC-B") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };

    runRecord(
      baseOpts(decisionsA, {
        runId: "ns-2026-06-21-sec-A",
        date: "2026-06-21",
        ts: "2026-06-21T07:00:00Z",
        registryPath: regPath,
        reviewedIds: ["ND-SEC-A"],
      }),
    );
    runRecord(
      baseOpts(decisionsB, {
        runId: "ns-2026-06-22-sec-B",
        date: "2026-06-22",
        ts: "2026-06-22T07:00:00Z",
        registryPath: regPath,
        reviewedIds: ["ND-SEC-B"],
      }),
    );

    const runs = readJsonl<RunMetrics>(join(dir, "metrics", "runs", "2026-06.jsonl"));
    expect(runs).toHaveLength(2);
    expect(runs[0]!.run_id).toBe("ns-2026-06-21-sec-A");
    expect(runs[1]!.run_id).toBe("ns-2026-06-22-sec-B");

    const findings = readJsonl<Finding>(join(dir, "metrics", "findings", "2026-06.jsonl"));
    const findingA = findings.find((f) => f.dedupe_key.surface === "ND-SEC-A");
    const findingB = findings.find((f) => f.dedupe_key.surface === "ND-SEC-B");
    expect(findingA?.run_id).toBe("ns-2026-06-21-sec-A");
    expect(findingB?.run_id).toBe("ns-2026-06-22-sec-B");

    const yml = readFileSync(regPath, "utf8");
    expect(yml).toMatch(/id: ND-SEC-A[\s\S]*?last_reviewed: 2026-06-21/);
    expect(yml).toMatch(/id: ND-SEC-B[\s\S]*?last_reviewed: 2026-06-22/);
  });
});

// ── per-repo lock ────────────────────────────────────────────────────────────
// Held across the uniqueness scan + all appends. We simulate "another live
// process holding the lock" by acquiring it ourselves first (with a fake owner
// pid) and NOT releasing — exactly what a crashed-but-not-dead holder looks
// like — then let runRecord's own acquisition time out against it.

describe("runRecord — per-repo lock", () => {
  it("times out and writes nothing while the lock is held; succeeds once it's released", () => {
    const lockPath = join(dir, "metrics", ".lock");
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-01",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-30") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };

    const release = acquireLock(lockPath, { pid: 99999 });
    try {
      expect(() =>
        runRecord(
          baseOpts(decisions, {
            lockPath,
            lock: { timeoutMs: 50, pollMs: 10, isPidAlive: () => true },
          }),
        ),
      ).toThrow();
      expect(existsSync(join(dir, "metrics", "runs"))).toBe(false);
      expect(existsSync(join(dir, "metrics", "findings"))).toBe(false);
    } finally {
      release.release();
    }

    // lock is free now -> runRecord succeeds
    const res = runRecord(baseOpts(decisions, { lockPath }));
    expect(res.findingsAppended).toBe(1);
  });
});

// ── format validation ───────────────────────────────────────────────────────
// date flows into monthOf() -> the metrics file path; run_id flows into the
// claim filename below. Both must be rejected before either builds a path, so
// a malicious value can never escape metricsDir (path-injection hardening).

describe("runRecord — format validation", () => {
  function decisionsWith(date: string, runId: string): Decisions {
    return {
      run_id: runId,
      lane: "security",
      date,
      decisions: [{ decision: "new", finding: cand("ND-SEC-40") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
  }

  it("rejects a path-traversal date and creates nothing", () => {
    const decisions = decisionsWith("../../..", "ns-2026-06-21-sec-40");
    expect(() =>
      runRecord(baseOpts(decisions, { date: "../../..", runId: "ns-2026-06-21-sec-40" })),
    ).toThrow(/date/);
    expect(existsSync(join(dir, "metrics"))).toBe(false);
  });

  it("rejects a slash-bearing date and creates nothing", () => {
    const decisions = decisionsWith("2026/06/21", "ns-2026-06-21-sec-41");
    expect(() =>
      runRecord(baseOpts(decisions, { date: "2026/06/21", runId: "ns-2026-06-21-sec-41" })),
    ).toThrow(/date/);
    expect(existsSync(join(dir, "metrics"))).toBe(false);
  });

  it("accepts a calendar-invalid but format-valid date (format-only check)", () => {
    // "99" is not a real day, but the check is format-only (\d{2}), not calendar
    // validity — it exists to close path escapes, not to validate real dates.
    const decisions = decisionsWith("2026-06-99", "ns-2026-06-21-sec-42");
    const res = runRecord(baseOpts(decisions, { date: "2026-06-99", runId: "ns-2026-06-21-sec-42" }));
    expect(res.findingsAppended).toBe(1);
  });

  it("rejects a path-traversal run_id and creates nothing", () => {
    const decisions = decisionsWith("2026-06-21", "../x");
    expect(() =>
      runRecord(baseOpts(decisions, { date: "2026-06-21", runId: "../x" })),
    ).toThrow(/run_id/);
    expect(existsSync(join(dir, "metrics"))).toBe(false);
  });

  it("rejects a run_id containing a space and creates nothing", () => {
    const decisions = decisionsWith("2026-06-21", "a b");
    expect(() =>
      runRecord(baseOpts(decisions, { date: "2026-06-21", runId: "a b" })),
    ).toThrow(/run_id/);
    expect(existsSync(join(dir, "metrics"))).toBe(false);
  });
});

// ── atomic run_id claim ─────────────────────────────────────────────────────
// The jsonl scan above only reads runs/*.jsonl, so it can't see a crash
// between the findings append and the runs-row append. The claim file
// (created with O_CREAT|O_EXCL, before either append) is the uniqueness token
// that survives that crash window: it's created once, never deleted, and a
// retry against an existing claim is refused loudly rather than silently
// re-appending.

describe("runRecord — atomic run_id claim", () => {
  it("writes a claim file with parseable ts/date/lane on success", () => {
    const decisions: Decisions = {
      run_id: "ns-2026-06-21-sec-50",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-50") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    runRecord(baseOpts(decisions, { runId: "ns-2026-06-21-sec-50" }));
    const claimPath = join(dir, "metrics", "runs", ".claims", "ns-2026-06-21-sec-50");
    expect(existsSync(claimPath)).toBe(true);
    const claim = JSON.parse(readFileSync(claimPath, "utf8").trim());
    expect(claim).toEqual({ ts: "2026-06-21T07:00:00Z", date: "2026-06-21", lane: "security" });
  });

  it("crash-window retry: claim survives a lost runs shard and refuses the retry without re-appending", () => {
    const decisions1: Decisions = {
      run_id: "ns-2026-06-21-sec-51",
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-51") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    runRecord(baseOpts(decisions1, { runId: "ns-2026-06-21-sec-51" }));

    // Simulate the crash window: the runs/<month>.jsonl shard the uniqueness
    // scan reads is gone (e.g. wiped by whatever killed the process), but the
    // claim — the durable token — survives.
    rmSync(join(dir, "metrics", "runs", "2026-06.jsonl"));
    expect(existsSync(join(dir, "metrics", "runs", ".claims", "ns-2026-06-21-sec-51"))).toBe(true);

    const decisions2: Decisions = {
      run_id: "ns-2026-06-21-sec-51", // same run_id — a retry
      lane: "security",
      date: "2026-06-21",
      decisions: [{ decision: "new", finding: cand("ND-SEC-52") }],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    };
    expect(() => runRecord(baseOpts(decisions2, { runId: "ns-2026-06-21-sec-51" }))).toThrow(
      /claim exists/,
    );

    // Nothing new landed: the shard the scan would have used is still absent,
    // and findings only has decisions1's entry (from before the simulated crash).
    expect(existsSync(join(dir, "metrics", "runs", "2026-06.jsonl"))).toBe(false);
    const findings = readJsonl<Finding>(join(dir, "metrics", "findings", "2026-06.jsonl"));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.dedupe_key.surface).toBe("ND-SEC-51"); // decisions2 never landed
  });
});
