// lib/run-outcome — the success predicate `ns` gates on (v3 A7 Part 2).
//
// The invariant under test is narrow and deliberate: a run succeeded iff it left
// BOTH halves of its durable evidence — bin/record's row AND bin/rollup's
// completion sentinel. Not "the CLI exited 0", not "the workflow returned
// complete", not "a result.json exists" — those were all TRUE for the first real
// run, which reviewed nothing. And not the row on its own either: record appends
// it before its own registry rewrite and before rollup, so a row with no
// sentinel is a chain that stopped halfway.
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { markRunComplete } from "./run-complete.js";
import { runOutcome, runRowShortfall } from "./run-outcome.js";
import type { RunMetrics } from "./types.js";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(PLUGIN_ROOT, "bin", "run-outcome.mjs");

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function row(runId: string, over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    run_id: runId,
    ts: "2026-08-23T20:00:00.000Z",
    date: "2026-08-23",
    lane: "security",
    pack_sha: "abc",
    selected: 2,
    reviewed: 2,
    findings_created: 1,
    confirmed: 1,
    rejected_tier1: 0,
    rejected_tier2: 0,
    suppressed: 0,
    usage_by_model: {},
    usage_spent: 0,
    elapsed: 0,
    ...over,
  };
}

/**
 * A metrics dir with the given run rows, keyed by month shard.
 *
 * Every row is ALSO stamped complete, because that is the state a finished run
 * actually leaves on disk: record's row plus rollup's sentinel. Pass
 * `{ stamp: false }` for the half-finished state — record ran, something after
 * it did not — which is the whole reason the sentinel exists.
 */
function metrics(
  shards: Record<string, RunMetrics[]> = {},
  opts: { stamp?: boolean } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "run-outcome-"));
  tmpDirs.push(dir);
  const runsDir = join(dir, "runs");
  mkdirSync(runsDir, { recursive: true });
  for (const [month, rows] of Object.entries(shards)) {
    writeFileSync(join(runsDir, `${month}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    if (opts.stamp === false) continue;
    for (const r of rows) {
      markRunComplete(dir, r.run_id, { ts: r.ts, date: r.date, lane: r.lane });
    }
  }
  return dir;
}

describe("runOutcome", () => {
  it("a run with a row is recorded", () => {
    const dir = metrics({ "2026-08": [row("R1")] });
    const out = runOutcome(dir, "R1");
    expect(out.recorded).toBe(true);
    expect(out.run?.reviewed).toBe(2);
  });

  it("a run with NO row is not recorded, and says why in terms an operator can act on", () => {
    const dir = metrics({ "2026-08": [row("SOMEONE-ELSE")] });
    const out = runOutcome(dir, "R1");
    expect(out.recorded).toBe(false);
    expect(out.reason).toMatch(/record chain did not complete/);
    expect(out.reason).toMatch(/whatever the session reported/);
  });

  it("finds a row in ANY month shard — a run that straddled a month boundary still succeeded", () => {
    const dir = metrics({ "2026-07": [row("OLD")], "2026-08": [row("R1")] });
    expect(runOutcome(dir, "R1").recorded).toBe(true);
    expect(runOutcome(dir, "OLD").recorded).toBe(true);
  });

  it("a row that reviewed 0 of 2 selected is NOT a success — it was paid for and stamped nothing", () => {
    // The third real run. Both reviewers were cut off before writing, so
    // merge-candidates unioned nothing, the chain completed cleanly, and the row
    // honestly says reviewed 0. Honest is not the same as successful.
    const dir = metrics({ "2026-08": [row("R1", { selected: 2, reviewed: 0 })] });
    const out = runOutcome(dir, "R1");
    expect(out.recorded).toBe(false);
    expect(out.reason).toMatch(/reviewed 0 of 2 selected/);
    // The row is still handed back — the caller can log what actually happened.
    expect(out.run?.selected).toBe(2);
  });

  it("a PARTIAL review is still a success — one surface reviewed is coverage earned", () => {
    // §9.16: a crashed surface simply stays stale and is re-selected next run.
    // Failing the whole run for it would throw away the surface that did land.
    const dir = metrics({ "2026-08": [row("R1", { selected: 2, reviewed: 1 })] });
    expect(runOutcome(dir, "R1").recorded).toBe(true);
  });

  it("selected 0 is a quiet night, not a failure", () => {
    const dir = metrics({ "2026-08": [row("R1", { selected: 0, reviewed: 0 })] });
    expect(runOutcome(dir, "R1").recorded).toBe(true);
  });

  it("a row with NO completion sentinel is not recorded — the chain stopped after record", () => {
    // The exact shape of the bug: record appended its row, then its own registry
    // rewrite (or the rollup chained after it) failed. Reading the row alone
    // called that a success, which deleted the run dir holding the diagnosis.
    const dir = metrics({ "2026-08": [row("R1")] }, { stamp: false });
    const out = runOutcome(dir, "R1");
    expect(out.recorded).toBe(false);
    expect(out.reason).toMatch(/never stamped complete/);
    // The row still comes back, so the launcher can log what DID get counted.
    expect(out.run?.run_id).toBe("R1");
  });

  it("names the two steps that could have failed, so the log points somewhere", () => {
    const dir = metrics({ "2026-08": [row("R1")] }, { stamp: false });
    expect(runOutcome(dir, "R1").reason).toMatch(/registry rewrite, or rollup/);
  });

  it("one run's sentinel does not vouch for another's", () => {
    const dir = metrics({ "2026-08": [row("R1"), row("R2")] }, { stamp: false });
    markRunComplete(dir, "R1", { ts: "2026-08-23T20:00:00.000Z", date: "2026-08-23", lane: "security" });
    expect(runOutcome(dir, "R1").recorded).toBe(true);
    expect(runOutcome(dir, "R2").recorded).toBe(false);
  });

  it("a sentinel with no run row is still not a success — both halves or neither", () => {
    const dir = metrics({}, { stamp: false });
    markRunComplete(dir, "R1", { ts: "2026-08-23T20:00:00.000Z", date: "2026-08-23", lane: "security" });
    const out = runOutcome(dir, "R1");
    expect(out.recorded).toBe(false);
    expect(out.reason).toMatch(/no run row/);
  });

  it("the row-level rule is reported ahead of the sentinel when both are wrong", () => {
    // A reviewed-nothing run that ALSO never completed: the operator is better
    // served by the specific "you paid for nothing" phrasing than by "incomplete".
    const dir = metrics({ "2026-08": [row("R1", { selected: 2, reviewed: 0 })] }, { stamp: false });
    expect(runOutcome(dir, "R1").reason).toMatch(/reviewed 0 of 2 selected/);
  });

  it("a metrics dir with no runs/ at all is not recorded, not a crash", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-outcome-"));
    tmpDirs.push(dir);
    expect(runOutcome(dir, "R1").recorded).toBe(false);
  });

  it("ignores non-.jsonl entries so runs/.claims/ is never read as a shard", () => {
    // record-run.ts puts its atomic claims under runs/.claims/. Reading that as a
    // shard would either crash or, worse, let a claim masquerade as a run row —
    // reporting success for a run that took the claim and then aborted.
    const dir = metrics({ "2026-08": [row("R1")] });
    mkdirSync(join(dir, "runs", ".claims"), { recursive: true });
    writeFileSync(join(dir, "runs", ".claims", "R2"), JSON.stringify(row("R2")));
    expect(runOutcome(dir, "R1").recorded).toBe(true);
    expect(runOutcome(dir, "R2").recorded).toBe(false);
  });

  it("an empty run id is not recorded rather than matching something", () => {
    const dir = metrics({ "2026-08": [row("R1")] });
    expect(runOutcome(dir, "").recorded).toBe(false);
    expect(runOutcome(dir, "   ").recorded).toBe(false);
  });

  it("never writes: the metrics dir is byte-identical afterwards", () => {
    const dir = metrics({ "2026-08": [row("R1")] });
    const before = spawnSync("find", [dir, "-type", "f"], { encoding: "utf8" }).stdout;
    runOutcome(dir, "R1");
    runOutcome(dir, "NOPE");
    expect(spawnSync("find", [dir, "-type", "f"], { encoding: "utf8" }).stdout).toBe(before);
  });
});

// The half of the outcome rule bin/dashboard also applies. It is exported so the
// living document cannot render the launcher's failure as a green "ok" line —
// which it did, with the dollar amount beside it, for exactly the rows below.
describe("runRowShortfall", () => {
  it("a row that reviewed 0 of 2 selected reports the shortfall", () => {
    expect(runRowShortfall(row("R1", { selected: 2, reviewed: 0 }))).toBe(
      "reviewed 0 of 2 selected",
    );
  });

  it("a PARTIAL review has no shortfall — one surface reviewed is coverage earned", () => {
    expect(runRowShortfall(row("R1", { selected: 2, reviewed: 1 }))).toBeUndefined();
  });

  it("selected 0 is a quiet night, not a shortfall", () => {
    expect(runRowShortfall(row("R1", { selected: 0, reviewed: 0 }))).toBeUndefined();
  });

  it("runOutcome embeds the SAME phrase, so the two surfaces cannot word it differently", () => {
    const r = row("R1", { selected: 3, reviewed: 0 });
    const dir = metrics({ "2026-08": [r] });
    const shortfall = runRowShortfall(r);
    expect(shortfall).toBe("reviewed 0 of 3 selected");
    expect(runOutcome(dir, "R1").reason).toContain(shortfall!);
  });
});

describe("bin/run-outcome", () => {
  function run(args: string[]): { code: number; stdout: string; stderr: string } {
    const r = spawnSync("node", [BIN, ...args], { encoding: "utf8" });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  it("exits 0 when the row exists", () => {
    const dir = metrics({ "2026-08": [row("R1")] });
    const r = run(["--metrics-dir", dir, "--run-id", "R1"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/recorded: reviewed 2 of 2/);
  });

  it("exits 1 — not 2 — when the row is absent: that is an answer, not a usage error", () => {
    // `ns` distinguishes them: 1 means the run failed, 2 would mean the launcher
    // called the tool wrong and the operator should see a different message.
    const dir = metrics({ "2026-08": [] });
    expect(run(["--metrics-dir", dir, "--run-id", "R1"]).code).toBe(1);
  });

  it("exits 2 on missing arguments", () => {
    expect(run([]).code).toBe(2);
    expect(run(["--metrics-dir", "/tmp"]).code).toBe(2);
  });

  it("--json emits the outcome on stdout for anything that wants to read it", () => {
    const dir = metrics({ "2026-08": [row("R1", { reviewed: 5 })] });
    const r = run(["--metrics-dir", dir, "--run-id", "R1", "--json"]);
    const parsed = JSON.parse(r.stdout) as { recorded: boolean; run: RunMetrics };
    expect(parsed.recorded).toBe(true);
    expect(parsed.run.reviewed).toBe(5);
  });

  it("without --json it stays quiet on stdout — the exit code is the interface", () => {
    const dir = metrics({ "2026-08": [row("R1")] });
    expect(run(["--metrics-dir", dir, "--run-id", "R1"]).stdout).toBe("");
  });
});
