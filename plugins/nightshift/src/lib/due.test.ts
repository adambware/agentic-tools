// Full-branch tests for laneDue/dueSweep — the ONE place "is this repo+lane
// due?" is answered (both `ns run --due` and A9's sentinel read it). The
// module header documents a strict evaluation order (first match wins, so the
// operator reads the STRONGEST reason); that order is exactly what this file
// pins down, one branch per test, plus the "unrunnable never throws" family
// and the dueSweep fan-out rules. Pattern mirrors lane-plan.test.ts (tmpdir +
// literal YAML fixtures written by the test, not depend on examples/*).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { laneDue, dueSweep } from "./due.js";
import { readOpsConfig } from "./ops-config.js";
import type { OpsConfig, OpsRepo } from "./ops-config.js";
import type { GitRunner } from "./git.js";
import type { Lane, RunMetrics } from "./types.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-due-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// "Today" is fixed so every staleness/cooldown/floor computation in this file
// is deterministic — no test may depend on the wall clock.
const TODAY = "2026-06-21";

/** YYYY-MM-DD `n` days before TODAY, in UTC — matches daysBetween's own math. */
function daysAgo(n: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Fixture builders — minimal literal YAML/JSONL, written fresh per test.
// ---------------------------------------------------------------------------

/** <dir>/<name>/.nightshift/{registries,metrics/runs} — nothing else assumed. */
function makeRepoDir(name: string): string {
  const repoPath = join(dir, name);
  mkdirSync(join(repoPath, ".nightshift", "registries"), { recursive: true });
  mkdirSync(join(repoPath, ".nightshift", "metrics", "runs"), { recursive: true });
  return repoPath;
}

function writeManifest(repoPath: string, k: Partial<Record<Lane, unknown>>): void {
  const lines = ["pack_format: 1", "project: probe", "window_budget_k:"];
  for (const [lane, v] of Object.entries(k)) lines.push(`  ${lane}: ${v}`);
  writeFileSync(join(repoPath, ".nightshift", "manifest.yml"), lines.join("\n") + "\n");
}

/** One vectors.yml entry. `area` defaults to something only this id's own
 *  "changed" fixture path will match, so cross-test area globs never collide. */
function vectorEntry(id: string, opts: { area?: string[]; interval_days?: number; last_reviewed?: string } = {}): string {
  const area = opts.area ?? [`app/${id}/*`];
  const areaYaml = area.map((a) => `"${a}"`).join(", ");
  const lastReviewedLine = opts.last_reviewed ? `    last_reviewed: ${opts.last_reviewed}\n` : "";
  return (
    `  - id: ${id}\n    title: T ${id}\n    kind: vector\n    area: [${areaYaml}]\n    ` +
    `weight: high\n    interval_days: ${opts.interval_days ?? 30}\n    owner: security\n${lastReviewedLine}`
  );
}

function vectorsYaml(entries: string[]): string {
  return `vectors:\n${entries.join("")}`;
}

function writeRegistry(repoPath: string, lane: Lane, yaml: string): void {
  const file = lane === "security" ? "vectors.yml" : "flows.yml";
  writeFileSync(join(repoPath, ".nightshift", "registries", file), yaml);
}

function runRecord(lane: Lane, date: string): RunMetrics {
  return {
    run_id: `ns-${date}-${lane}-01`,
    ts: `${date}T00:00:00Z`,
    date,
    lane,
    pack_sha: "deadbeef",
    selected: 1,
    reviewed: 1,
    findings_created: 0,
    confirmed: 0,
    rejected_tier1: 0,
    rejected_tier2: 0,
    suppressed: 0,
    usage_by_model: {},
    usage_spent: 0,
    elapsed: 0,
  };
}

/** Writes metrics/runs/<month>.jsonl (one shard). Call once per month needed. */
function writeRunShard(repoPath: string, month: string, records: RunMetrics[]): void {
  const p = join(repoPath, ".nightshift", "metrics", "runs", `${month}.jsonl`);
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function gitStub(changed: string[]): GitRunner {
  return { changedFilesSince: () => changed };
}

function makeOpsRepo(name: string, path: string, opts: Partial<OpsRepo> = {}): OpsRepo {
  return { name, path, enabled: true, lanes: ["security"], ...opts };
}

const DEFAULT_SENTINEL = { enabled: false, hour: 7, cooldown_days: 2, weekly_floor_days: 7 };

function makeConfig(repos: OpsRepo[], sentinel: Partial<OpsConfig["sentinel"]> = {}): OpsConfig {
  return {
    repos,
    dashboard: { out: "dashboard.html", open_after_run: true },
    sentinel: { ...DEFAULT_SENTINEL, ...sentinel },
    max_concurrent_reviewers: 3,
  };
}

// ---------------------------------------------------------------------------
// The predicate, in the order laneDue evaluates it.
// ---------------------------------------------------------------------------

describe("laneDue: predicate order and reasons", () => {
  it('cooldown OUTRANKS a fresh diff — the case that stops a dirty tree re-firing every invocation', () => {
    const repoPath = makeRepoDir("cooldown-repo");
    writeManifest(repoPath, { security: 1 });
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1", { last_reviewed: daysAgo(1) })]));
    writeRunShard(repoPath, "2026-06", [runRecord("security", daysAgo(1))]); // 1d ago, inside cooldown_days=2
    const repo = makeOpsRepo("cooldown-repo", repoPath);
    const config = makeConfig([repo]); // cooldown_days: 2

    const verdict = laneDue(repo, "security", {
      config,
      today: TODAY,
      // A file under V1's own area IS in the working diff — if cooldown did not
      // outrank "changed" this would come back due:true, reason:"changed".
      gitFor: () => gitStub(["app/V1/index.ts"]),
    });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("cooldown");
    expect(verdict.detail).toMatch(/cooldown/);
  });

  it("never-run -> due (no run record at all for this lane)", () => {
    const repoPath = makeRepoDir("never-run-repo");
    writeManifest(repoPath, { security: 1 });
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1")]));
    // metrics/runs left empty — no shard files written.
    const repo = makeOpsRepo("never-run-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(true);
    expect(verdict.reason).toBe("never-run");
    expect(verdict.last_run_date).toBeUndefined();
  });

  it("overdue -> due (a selected surface's staleness >= 1), independent of any diff", () => {
    const repoPath = makeRepoDir("overdue-repo");
    writeManifest(repoPath, { security: 1 });
    // interval 7d, last reviewed 10d ago -> staleness 10/7 ~= 1.43 >= 1.
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1", { interval_days: 7, last_reviewed: daysAgo(10) })]));
    writeRunShard(repoPath, "2026-06", [runRecord("security", daysAgo(5))]); // outside cooldown(2), inside floor(7)
    const repo = makeOpsRepo("overdue-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(true);
    expect(verdict.reason).toBe("overdue");
    expect(verdict.overdue).toBe(1);
    expect(verdict.detail).toMatch(/1 of 1 selected surface/);
  });

  it("changed -> due (a selected surface's area intersects the working diff), when nothing is overdue", () => {
    const repoPath = makeRepoDir("changed-repo");
    writeManifest(repoPath, { security: 1 });
    // interval 30d, reviewed yesterday -> staleness ~0.03, nowhere near overdue.
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1", { interval_days: 30, last_reviewed: daysAgo(1) })]));
    writeRunShard(repoPath, "2026-06", [runRecord("security", daysAgo(5))]); // outside cooldown(2), inside floor(7)
    const repo = makeOpsRepo("changed-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub(["app/V1/index.ts"]) });

    expect(verdict.due).toBe(true);
    expect(verdict.reason).toBe("changed");
    expect(verdict.changed).toBe(1);
    expect(verdict.detail).toMatch(/1 of 1 selected surface/);
  });

  it("weekly-floor -> due (nothing overdue/changed, but last run is past weekly_floor_days)", () => {
    const repoPath = makeRepoDir("floor-repo");
    writeManifest(repoPath, { security: 1 });
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1", { interval_days: 30, last_reviewed: daysAgo(1) })]));
    writeRunShard(repoPath, "2026-06", [runRecord("security", daysAgo(10))]); // >= weekly_floor_days(7)
    const repo = makeOpsRepo("floor-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(true);
    expect(verdict.reason).toBe("weekly-floor");
    expect(verdict.detail).toMatch(/10d ago/);
    expect(verdict.detail).toMatch(/floor: 7d/);
  });

  it('not-due -> false, and the detail names the days remaining until the weekly floor', () => {
    // SANITY (not vacuous): reuses the exact "nothing overdue, nothing changed"
    // shape as the weekly-floor test above but with sinceRun still short of the
    // floor — proving the overdue/changed heuristics genuinely CAN come back
    // empty (verdict.overdue===0, verdict.changed===0) rather than always firing.
    const repoPath = makeRepoDir("not-due-repo");
    writeManifest(repoPath, { security: 1 });
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1", { interval_days: 30, last_reviewed: daysAgo(1) })]));
    writeRunShard(repoPath, "2026-06", [runRecord("security", daysAgo(4))]); // cooldown(2) <= 4 < floor(7)
    const repo = makeOpsRepo("not-due-repo", repoPath);
    const config = makeConfig([repo]);

    // The changed file is real but does NOT match V1's area glob — proves
    // anyGlobMatch is actually being consulted, not short-circuited to true.
    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub(["unrelated/other.ts"]) });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("not-due");
    expect(verdict.overdue).toBe(0);
    expect(verdict.changed).toBe(0);
    expect(verdict.detail).toMatch(/3d until the weekly floor fires/); // floor(7) - sinceRun(4)
  });
});

// ---------------------------------------------------------------------------
// nothing-selected — due-ness cannot exist for a lane with nothing to review.
// ---------------------------------------------------------------------------

describe("laneDue: nothing-selected", () => {
  it("window_budget_k = 0 -> not due, even with entries in the registry", () => {
    const repoPath = makeRepoDir("k-zero-repo");
    writeManifest(repoPath, { security: 0 });
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1")]));
    const repo = makeOpsRepo("k-zero-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("nothing-selected");
    expect(verdict.detail).toMatch(/window_budget_k\.security is 0/);
  });

  it("an empty registry -> not due, even with a positive K", () => {
    const repoPath = makeRepoDir("empty-registry-repo");
    writeManifest(repoPath, { security: 5 });
    writeRegistry(repoPath, "security", "vectors: []\n");
    const repo = makeOpsRepo("empty-registry-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("nothing-selected");
    expect(verdict.detail).toMatch(/no entries selected/);
    expect(verdict.detail).toMatch(/seed the registry/);
  });
});

// ---------------------------------------------------------------------------
// unrunnable — every operator-fixable pack problem, and it must NEVER throw.
// ---------------------------------------------------------------------------

describe("laneDue: unrunnable (never throws)", () => {
  it("no .nightshift dir at all", () => {
    const repoPath = join(dir, "no-pack-repo");
    mkdirSync(repoPath, { recursive: true }); // repo exists, but nothing was ever onboarded
    const repo = makeOpsRepo("no-pack-repo", repoPath);
    const config = makeConfig([repo]);

    expect(() => laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) })).not.toThrow();
    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });
    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("unrunnable");
    expect(verdict.detail).toMatch(/no \.nightshift pack/);
  });

  it("window_budget_k.security is missing entirely from the manifest", () => {
    const repoPath = makeRepoDir("missing-k-repo");
    writeFileSync(join(repoPath, ".nightshift", "manifest.yml"), "pack_format: 1\nproject: probe\n");
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1")]));
    const repo = makeOpsRepo("missing-k-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("unrunnable");
    expect(verdict.detail).toMatch(/window_budget_k\.security is missing or not a non-negative integer/);
  });

  it("window_budget_k.security is negative", () => {
    const repoPath = makeRepoDir("negative-k-repo");
    writeManifest(repoPath, { security: -1 });
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1")]));
    const repo = makeOpsRepo("negative-k-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("unrunnable");
    expect(verdict.detail).toMatch(/window_budget_k\.security is missing or not a non-negative integer/);
  });

  it("window_budget_k.security is not an integer", () => {
    const repoPath = makeRepoDir("float-k-repo");
    writeManifest(repoPath, { security: 1.5 });
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1")]));
    const repo = makeOpsRepo("float-k-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("unrunnable");
    expect(verdict.detail).toMatch(/window_budget_k\.security is missing or not a non-negative integer/);
  });

  it("the lane's registry file does not exist", () => {
    const repoPath = makeRepoDir("missing-registry-repo");
    writeManifest(repoPath, { security: 1 });
    // registries/vectors.yml deliberately never written.
    const repo = makeOpsRepo("missing-registry-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("unrunnable");
    expect(verdict.detail).toMatch(/registry not found/);
  });

  it("the registry file is malformed YAML", () => {
    const repoPath = makeRepoDir("malformed-registry-repo");
    writeManifest(repoPath, { security: 1 });
    writeRegistry(repoPath, "security", "not: valid: yaml: [::\n");
    const repo = makeOpsRepo("malformed-registry-repo", repoPath);
    const config = makeConfig([repo]);

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.due).toBe(false);
    expect(verdict.reason).toBe("unrunnable");
    expect(verdict.detail).toMatch(/is malformed/);
  });
});

// ---------------------------------------------------------------------------
// lastRunDate — max by the DATE FIELD across shards, never by shard filename,
// and scoped to the requested lane only.
// ---------------------------------------------------------------------------

describe("laneDue: lastRunDate picks the max by date field, ignoring the other lane", () => {
  it("a later date backfilled into an EARLIER-named shard still wins, and a later date on the OTHER lane is ignored", () => {
    const repoPath = makeRepoDir("multi-shard-repo");
    writeManifest(repoPath, { security: 1 });
    writeRegistry(repoPath, "security", vectorsYaml([vectorEntry("V1", { interval_days: 30, last_reviewed: daysAgo(1) })]));
    // 2026-05.jsonl (the OLDER-named shard) holds the NEWER security date — this
    // is only correct if lastRunDate compares the `date` field, not the shard
    // name or file iteration order.
    writeRunShard(repoPath, "2026-05", [runRecord("security", "2026-06-10")]);
    // 2026-06.jsonl holds an OLDER security date, plus a `design` row dated
    // LATER than both security rows — if the lane filter were broken, this
    // design row would win and the verdict below would come back "cooldown"
    // instead of "not-due" (sinceRun would be 1 day, not 11).
    writeRunShard(repoPath, "2026-06", [runRecord("security", "2026-06-01"), runRecord("design", "2026-06-20")]);
    const repo = makeOpsRepo("multi-shard-repo", repoPath);
    const config = makeConfig([repo], { weekly_floor_days: 30 }); // keep sinceRun(11) short of the floor

    const verdict = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdict.last_run_date).toBe("2026-06-10");
    expect(verdict.days_since_run).toBe(11); // daysBetween("2026-06-10", TODAY)
    expect(verdict.reason).toBe("not-due"); // NOT "cooldown" — proves the design row was ignored
  });
});

// ---------------------------------------------------------------------------
// dueSweep — the fan-out over config.repos x repo.lanes.
// ---------------------------------------------------------------------------

describe("dueSweep", () => {
  it("skips disabled repos entirely and skips lanes not listed for a repo", () => {
    // Built via readOpsConfig on a real config.yml (not an OpsConfig literal) so
    // this test also proves due.ts composes with ops-config.ts's reader, not
    // just with a hand-built object shaped like its output.
    const repoZ = join(dir, "repoZ");
    const repoA = join(dir, "repoA"); // disabled — path is never even touched
    const repoM = join(dir, "repoM");
    mkdirSync(repoZ, { recursive: true });
    mkdirSync(repoM, { recursive: true });
    const configPath = join(dir, "config.yml");
    writeFileSync(
      configPath,
      [
        "repos:",
        `  - name: repoZ`,
        `    path: ${repoZ}`,
        `    enabled: true`,
        `    lanes: [design, security]`,
        `  - name: repoA`,
        `    path: ${repoA}`,
        `    enabled: false`,
        `    lanes: [security]`,
        `  - name: repoM`,
        `    path: ${repoM}`,
        `    enabled: true`,
        `    lanes: [security]`,
        "dashboard: { out: dashboard.html, open_after_run: true }",
        "sentinel: { enabled: false, hour: 7, cooldown_days: 2, weekly_floor_days: 7 }",
        "max_concurrent_reviewers: 3",
        "",
      ].join("\n"),
    );
    const loaded = readOpsConfig(configPath);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const verdicts = dueSweep({ config: loaded.config, today: TODAY, gitFor: () => gitStub([]) });

    // repoZ contributes both its lanes, repoM only the one it lists, and repoA
    // (disabled) contributes NOTHING — not even an "unrunnable" row — and
    // repoM:design never appears since it wasn't in repoM's `lanes:`.
    expect(new Set(verdicts.map((v) => `${v.repo}:${v.lane}`))).toEqual(
      new Set(["repoZ:security", "repoZ:design", "repoM:security"]),
    );
    expect(verdicts).toHaveLength(3);
    expect(verdicts.some((v) => v.repo === "repoA")).toBe(false);
  });

  it("preserves config order (repos) then repo.lanes array order (lanes) exactly as given", () => {
    // readOpsConfig normalizes `lanes:` to a fixed [security, design] order
    // (ops-config.ts's LANES table), so it cannot exercise dueSweep's own
    // "iterate repo.lanes in the order it's given" behavior. This test builds
    // OpsRepo literals directly, with lanes in the OPPOSITE of that fixed
    // order, to prove dueSweep itself does no reordering of its own.
    const repoBPath = join(dir, "repoB");
    const repoCPath = join(dir, "repoC");
    mkdirSync(repoBPath, { recursive: true });
    mkdirSync(repoCPath, { recursive: true });
    const repoB = makeOpsRepo("repoB", repoBPath, { lanes: ["design", "security"] });
    const repoC = makeOpsRepo("repoC", repoCPath, { lanes: ["security"] });
    const config = makeConfig([repoB, repoC]);

    const verdicts = dueSweep({ config, today: TODAY, gitFor: () => gitStub([]) });

    expect(verdicts.map((v) => `${v.repo}:${v.lane}`)).toEqual(["repoB:design", "repoB:security", "repoC:security"]);
  });

  it("does not throw when one repo is unrunnable — the other repos still get verdicts", () => {
    const okPath = makeRepoDir("ok-repo");
    writeManifest(okPath, { security: 1 });
    writeRegistry(okPath, "security", vectorsYaml([vectorEntry("V1")]));
    const badPath = join(dir, "bad-repo"); // never onboarded — no .nightshift at all
    mkdirSync(badPath, { recursive: true });

    const config = makeConfig([makeOpsRepo("ok-repo", okPath), makeOpsRepo("bad-repo", badPath)]);

    let verdicts: ReturnType<typeof dueSweep> = [];
    expect(() => {
      verdicts = dueSweep({ config, today: TODAY, gitFor: () => gitStub([]) });
    }).not.toThrow();

    expect(verdicts).toHaveLength(2);
    const ok = verdicts.find((v) => v.repo === "ok-repo");
    const bad = verdicts.find((v) => v.repo === "bad-repo");
    expect(ok?.due).toBe(true);
    expect(ok?.reason).toBe("never-run");
    expect(bad?.due).toBe(false);
    expect(bad?.reason).toBe("unrunnable");
  });
});

// ---------------------------------------------------------------------------
// last run + cost — `ns status` shows both, per a7-ops-launcher.md's spec for it.
// ---------------------------------------------------------------------------

function writeCosts(repoPath: string, rows: Record<string, unknown>[]): void {
  const metrics = join(repoPath, ".nightshift", "metrics");
  mkdirSync(metrics, { recursive: true });
  writeFileSync(join(metrics, "costs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function costRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    run_id: "r",
    lane: "security",
    date: TODAY,
    ts: `${TODAY}T00:00:00.000Z`,
    usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    source: "cli-json",
    status: "ok",
    ...over,
  };
}

describe("laneDue reports the last run's cost with its status", () => {
  function seed(name: string): { repo: OpsRepo; config: OpsConfig; repoPath: string } {
    const repoPath = makeRepoDir(name);
    writeManifest(repoPath, { security: 1 });
    writeRegistry(
      repoPath,
      "security",
      vectorsYaml([vectorEntry("V1", { interval_days: 7, last_reviewed: daysAgo(10) })]),
    );
    writeRunShard(repoPath, "2026-06", [runRecord("security", daysAgo(5))]);
    const repo = makeOpsRepo(name, repoPath);
    return { repo, config: makeConfig([repo]), repoPath };
  }

  it("picks the newest row for THIS lane by ts, ignoring the other lane and older rows", () => {
    const { repo, config, repoPath } = seed("cost-newest");
    writeCosts(repoPath, [
      costRow({ run_id: "d1", lane: "design", ts: `${TODAY}T23:00:00.000Z`, usd: 9.99 }),
      costRow({ run_id: "s0", ts: `${TODAY}T01:00:00.000Z`, usd: 0.11 }),
      costRow({ run_id: "s1", ts: `${TODAY}T02:00:00.000Z`, usd: 1.5 }),
    ]);
    const v = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });
    expect(v.last_run_usd).toBe(1.5);
    expect(v.last_run_status).toBe("ok");
  });

  it("labels a FAILED run's row — an unlabelled usd 0 would read as 'this lane is free'", () => {
    const { repo, config, repoPath } = seed("cost-failed");
    writeCosts(repoPath, [
      costRow({ run_id: "s2", usd: 0, status: "error", terminal_reason: "envelope unusable" }),
    ]);
    const v = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });
    expect(v.last_run_usd).toBe(0);
    expect(v.last_run_status).toBe("error");
  });

  it("omits both fields when no cost row exists (never a misleading 0)", () => {
    const { repo, config } = seed("cost-none");
    const v = laneDue(repo, "security", { config, today: TODAY, gitFor: () => gitStub([]) });
    expect(v.last_run_usd).toBeUndefined();
    expect(v.last_run_status).toBeUndefined();
  });
});
