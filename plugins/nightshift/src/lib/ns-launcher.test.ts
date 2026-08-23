// Integration probes for bin/ns (A7 / T4, T8, T11, T22).
//
// These spawn the REAL launcher against the REAL engine bins — lane-plan,
// select, workflow-args, record-cost, retain, dashboard and clean all actually
// run. The only thing stubbed is `claude` itself (via NIGHTSHIFT_CLAUDE), which
// is exactly the boundary worth stubbing: everything on this side of it is ours
// and testable, everything past it costs money and needs a network.
//
// WHY THESE EXIST AS INTEGRATION TESTS AND NOT UNIT TESTS. Every invariant here
// is a property of the SEQUENCE, not of any one function:
//
//   T22   the dashboard is regenerated on the success path, on the headless-
//         failure path, AND on the preflight-refusal path. A unit test of
//         bin/dashboard proves it renders; only this proves `ns` calls it when
//         the run died. A failed run that left yesterday's dashboard looking
//         fresh is the silent staleness this whole system exists to prevent.
//   T8    a design lane pointed at a non-loopback or production environment is
//         refused BEFORE a model is invoked, with the tool's own reason on
//         stderr. Proven by asserting the stub `claude` was never called.
//   OBL-1 lane-plan is invoked as `--pack .nightshift` with cwd at the repo
//         root. Proven by its OUTPUT: the emitted registry path is repo-root-
//         relative, which is only true if both halves held. Any other --pack
//         would silently pair one pack's registry with another pack's metrics.
//   OBL-2 the guard is armed launcher-side (it cannot self-arm) — asserted from
//         the env the stub `claude` actually received.
//   OBL-3 a FRESH run id per attempt, and one pinned NIGHTSHIFT_TODAY.
//   T11   the args spliced into the workflow are chunked by the config's cap.
import { describe, it, expect, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..", "..");
const NS = join(PLUGIN_ROOT, "bin", "ns");
const NOVUDESK_PACK = join(PLUGIN_ROOT, "examples", "novudesk", ".nightshift");

const TODAY = "2026-08-23";

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

interface Fixture {
  root: string;
  opsDir: string;
  repoDir: string;
  packDir: string;
  runRoot: string;
  dashboard: string;
  probeLog: string;
  claudeStub: string;
}

/**
 * A stub `claude` that records exactly what the launcher handed it — argv, cwd,
 * and the three environment variables the workflow sandbox cannot set for
 * itself — then emits a headless result envelope.
 *
 * NS_STUB_MODE controls the outcome:
 *   ok       a valid envelope, exit 0
 *   fail     exit 1 having written NOTHING (the realistic crash: the CLI dies
 *            before it can emit an envelope, so bin/record-cost has to fall back)
 *   badjson  exit 1 having written a truncated envelope
 */
function writeClaudeStub(path: string): void {
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      "const rec = {",
      "  argv: process.argv.slice(2),",
      "  cwd: process.cwd(),",
      "  env: {",
      "    NIGHTSHIFT_RUN_ID: process.env.NIGHTSHIFT_RUN_ID,",
      "    NIGHTSHIFT_LANE_RUN: process.env.NIGHTSHIFT_LANE_RUN,",
      "    NIGHTSHIFT_TODAY: process.env.NIGHTSHIFT_TODAY,",
      "  },",
      "  // Whatever this session was handed on stdin. A headless `claude -p` READS",
      "  // piped stdin, so if the launcher's own work list is on it, the first",
      "  // session eats the rest of the night's sweep.",
      "  stdin: (() => { try { return fs.readFileSync(0, \"utf8\"); } catch (e) { return \"\"; } })(),",
      "};",
      'fs.appendFileSync(process.env.NS_PROBE_LOG, JSON.stringify(rec) + "\\n");',
      'const mode = process.env.NS_STUB_MODE || "ok";',
      "if (mode === \"sleep\") { const until = Date.now() + 30000; while (Date.now() < until) { try { require('node:child_process').execFileSync('sleep', ['0.2']); } catch (e) { break; } } }",
      'if (mode === "fail") process.exit(1);',
      'if (mode === "badjson") { process.stdout.write(\'{"is_error\'); process.exit(1); }',
      "process.stdout.write(JSON.stringify({",
      "  is_error: false,",
      '  subtype: "success",',
      "  total_cost_usd: 1.23,",
      "  usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 },",
      "}));",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

/** $OPS + a copy of the worked novudesk pack, both lanes enabled in config. */
function setup(opts?: { maxConcurrent?: number; lanes?: string[]; dashboardOut?: string }): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ns-launcher-"));
  tmpDirs.push(root);
  const opsDir = join(root, "ops");
  mkdirSync(opsDir, { recursive: true });
  const repoDir = join(root, "novudesk");
  const packDir = join(repoDir, ".nightshift");
  cpSync(NOVUDESK_PACK, packDir, { recursive: true });

  const lanes = opts?.lanes ?? ["security", "design"];
  writeFileSync(
    join(opsDir, "config.yml"),
    [
      "repos:",
      "  - name: novudesk",
      `    path: "${repoDir}"`,
      `    lanes: [${lanes.join(", ")}]`,
      "    enabled: true",
      "dashboard:",
      `  out: ${opts?.dashboardOut ?? "dashboard.html"}`,
      "  open_after_run: false",
      "sentinel:",
      "  enabled: false",
      "  hour: 7",
      "  cooldown_days: 2",
      "  weekly_floor_days: 7",
      `max_concurrent_reviewers: ${opts?.maxConcurrent ?? 3}`,
      "",
    ].join("\n"),
  );

  const claudeStub = join(root, "claude-stub.js");
  writeClaudeStub(claudeStub);

  return {
    root,
    opsDir,
    repoDir,
    packDir,
    runRoot: join(packDir, ".run"),
    dashboard: join(opsDir, opts?.dashboardOut ?? "dashboard.html"),
    probeLog: join(root, "probe.jsonl"),
    claudeStub,
  };
}

function runNs(
  fx: Fixture,
  args: string[],
  env: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(NS, args, {
    encoding: "utf8",
    cwd: fx.root,
    env: {
      ...process.env,
      NIGHTSHIFT_ENGINE: PLUGIN_ROOT,
      NIGHTSHIFT_OPS: fx.opsDir,
      NIGHTSHIFT_CLAUDE: fx.claudeStub,
      NIGHTSHIFT_TODAY: TODAY,
      NS_PROBE_LOG: fx.probeLog,
      ...env,
    },
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Everything the stub `claude` recorded, in call order. */
function claudeCalls(fx: Fixture): {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  stdin?: string;
}[] {
  if (!existsSync(fx.probeLog)) return [];
  return readFileSync(fx.probeLog, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

function costLines(fx: Fixture): Record<string, unknown>[] {
  const p = join(fx.packDir, "metrics", "costs.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

function runDirs(fx: Fixture): string[] {
  if (!existsSync(fx.runRoot)) return [];
  return readdirSync(fx.runRoot);
}

/** Make the design lane unsafe in the copied pack's manifest. */
function setBrowser(fx: Fixture, baseUrl: string, environment: string | null): void {
  const p = join(fx.packDir, "manifest.yml");
  let text = readFileSync(p, "utf8");
  text = text.replace(/^(\s*)base_url:.*$/m, `$1base_url: "${baseUrl}"`);
  text =
    environment === null
      ? text.replace(/^\s*environment:.*$\n/m, "")
      : text.replace(/^(\s*)environment:.*$/m, `$1environment: ${environment}`);
  writeFileSync(p, text);
}

// ---------------------------------------------------------------------------
// Sanity — the harness itself is not vacuous
// ---------------------------------------------------------------------------

describe("probe harness sanity", () => {
  it("bin/ns exists and is executable", () => {
    expect(existsSync(NS)).toBe(true);
    const { code, stdout } = runNs(setup(), ["--version"]);
    expect(code).toBe(0);
    // `ns` reports the ENGINE's version, not one of its own — it ships with the
    // engine and is meaningless apart from it, so a separate number could drift.
    expect(stdout).toMatch(/^ns \(nightshift engine .+\)/);
  });

  it("the stub claude really does get invoked on a normal run (otherwise every 'never invoked' assertion below is worthless)", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"]);
    expect(claudeCalls(fx).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T22 — the dashboard regenerates on EVERY exit path
// ---------------------------------------------------------------------------

describe("T22: the dashboard is regenerated on every exit path", () => {
  it("SUCCESS path: dashboard written, cost row ok, run dir cleaned", () => {
    const fx = setup();
    const { code, stderr } = runNs(fx, ["run", "novudesk", "security", "--no-open"]);
    expect(code).toBe(0);
    expect(existsSync(fx.dashboard)).toBe(true);
    expect(readFileSync(fx.dashboard, "utf8")).toContain("<!doctype html>");

    const costs = costLines(fx);
    const mine = costs[costs.length - 1]!;
    expect(mine.status).toBe("ok");
    expect(mine.usd).toBe(1.23);
    expect(mine.source).toBe("cli-json");

    // Success drops the scratch dir (bin/clean stays success-only).
    expect(runDirs(fx)).toEqual([]);
    expect(stderr).toMatch(/-> success/);
  });

  it("FAILURE path: the headless call dies, and the dashboard is STILL regenerated", () => {
    const fx = setup();
    const { code, stderr } = runNs(fx, ["run", "novudesk", "security", "--no-open"], {
      NS_STUB_MODE: "fail",
    });
    expect(code).not.toBe(0);
    // The load-bearing assertion: a failed run must not leave a stale dashboard.
    expect(existsSync(fx.dashboard)).toBe(true);
    expect(readFileSync(fx.dashboard, "utf8")).toContain("<!doctype html>");
    expect(stderr).toMatch(/-> failure/);
  });

  it("FAILURE path: a cost row is still written, with status error, BEFORE the dashboard reads it", () => {
    const fx = setup();
    const before = costLines(fx).length;
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const after = costLines(fx);
    expect(after.length).toBe(before + 1);
    const mine = after[after.length - 1]!;
    expect(mine.status).toBe("error");
    expect(mine.usd).toBe(0);
    // The fallback names itself, so nobody reads the 0 as a measured cost.
    expect(String(mine.terminal_reason)).toMatch(/envelope unusable or absent/);
  });

  it("FAILURE path: a truncated envelope is handled the same way (no exit-2 dead end)", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "badjson" });
    const costs = costLines(fx);
    expect(costs[costs.length - 1]!.status).toBe("error");
    expect(existsSync(fx.dashboard)).toBe(true);
  });

  it("FAILURE path: the run dir is KEPT so there is exactly one thing to diagnose", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    expect(runDirs(fx).length).toBe(1);
  });

  it("PREFLIGHT-REFUSAL path: the dashboard is regenerated even though nothing ran", () => {
    const fx = setup();
    setBrowser(fx, "https://staging.novudesk.example", "local");
    const { code } = runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(code).not.toBe(0);
    expect(existsSync(fx.dashboard)).toBe(true);
  });

  it("PREFLIGHT-REFUSAL path writes NO cost row — a $0 error row would drag the cost trend down for free", () => {
    const fx = setup();
    const before = costLines(fx).length;
    setBrowser(fx, "https://staging.novudesk.example", "local");
    runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(costLines(fx).length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// T8 — design preflight refuses fail-fast, before any model call
// ---------------------------------------------------------------------------

describe("T8: design preflight refuses an unsafe environment before a model is invoked", () => {
  it("refuses a non-loopback base_url, names it on stderr, and NEVER invokes claude", () => {
    const fx = setup();
    setBrowser(fx, "https://staging.novudesk.example", "local");
    const { code, stderr } = runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/PREFLIGHT REFUSED/);
    expect(stderr).toMatch(/is not a LOOPBACK host/);
    expect(stderr).toContain("staging.novudesk.example");
    // Fail FAST means fail before spending anything.
    expect(claudeCalls(fx)).toEqual([]);
  });

  it("refuses a production base_url", () => {
    const fx = setup();
    setBrowser(fx, "https://novudesk.example", "local");
    const { code, stderr } = runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/is not a LOOPBACK host/);
    expect(claudeCalls(fx)).toEqual([]);
  });

  it("refuses when the explicit non-production assertion is absent, even on loopback", () => {
    const fx = setup();
    setBrowser(fx, "http://localhost:3000", null);
    const { code, stderr } = runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/browser\.environment is missing/);
    expect(claudeCalls(fx)).toEqual([]);
  });

  it('refuses environment: staging by name — "up" is not "safe to mutate"', () => {
    const fx = setup();
    setBrowser(fx, "http://localhost:3000", "staging");
    const { code, stderr } = runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/not yours to submit forms against/);
    expect(claudeCalls(fx)).toEqual([]);
  });

  it("runs the design lane when BOTH assertions hold (the refusals above are not blanket)", () => {
    const fx = setup();
    setBrowser(fx, "http://novudesk.localhost:3000", "local");
    const { code } = runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(code).toBe(0);
    expect(claudeCalls(fx).length).toBe(1);
  });

  it("an unsafe design manifest does NOT block the security lane (T8 is design-only)", () => {
    const fx = setup();
    setBrowser(fx, "https://novudesk.example", "production");
    const { code } = runNs(fx, ["run", "novudesk", "security", "--no-open"]);
    expect(code).toBe(0);
    expect(claudeCalls(fx).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Launcher obligations the sandboxed workflow cannot meet itself
// ---------------------------------------------------------------------------

describe("launcher obligations", () => {
  it("OBLIGATION 1: lane-plan ran with --pack .nightshift from the repo root (the emitted registry is repo-root-relative)", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const dir = join(fx.runRoot, runDirs(fx)[0]!);
    const plan = JSON.parse(readFileSync(join(dir, "lane-plan.json"), "utf8"));
    // An absolute --pack, or a cwd anywhere else, produces an ABSOLUTE registry
    // here — which the workflow would then pair with its hardcoded repo-root-
    // relative PACK/RUN literals in the same record and rollup command lines.
    expect(plan.registry).toBe(".nightshift/registries/vectors.yml");
  });

  it("OBLIGATION 1: the launcher source passes the literal `--pack .nightshift`, never an absolute path", () => {
    const src = readFileSync(NS, "utf8");
    expect(src).toContain("--pack .nightshift");
    expect(src).not.toMatch(/--pack "\$/);
  });

  it("OBLIGATION 2: the guard is armed launcher-side — the headless session sees NIGHTSHIFT_LANE_RUN=1 and a run id", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"]);
    const call = claudeCalls(fx)[0]!;
    expect(call.env.NIGHTSHIFT_LANE_RUN).toBe("1");
    expect(call.env.NIGHTSHIFT_RUN_ID).toBeTruthy();
    expect(call.env.NIGHTSHIFT_TODAY).toBe(TODAY);
  });

  it("OBLIGATION 2: the run id in the env is THIS run's scratch dir name", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const call = claudeCalls(fx)[0]!;
    expect(runDirs(fx)).toEqual([call.env.NIGHTSHIFT_RUN_ID]);
  });

  it("OBLIGATION 3: a FRESH run id per attempt — a retry never reuses the previous run dir", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const calls = claudeCalls(fx);
    expect(calls.length).toBe(2);
    // merge-candidates has no notion of artifact freshness: a reused run dir
    // would resurrect the first attempt's artifacts as the retry's coverage.
    expect(calls[0]!.env.NIGHTSHIFT_RUN_ID).not.toBe(calls[1]!.env.NIGHTSHIFT_RUN_ID);
    expect(runDirs(fx).length).toBe(2);
  });

  it("OBLIGATION 3: `run <repo> all` pins ONE NIGHTSHIFT_TODAY across both lanes", () => {
    const fx = setup();
    setBrowser(fx, "http://novudesk.localhost:3000", "local");
    runNs(fx, ["run", "novudesk", "all", "--no-open"]);
    const calls = claudeCalls(fx);
    expect(calls.length).toBe(2);
    expect(calls[0]!.env.NIGHTSHIFT_TODAY).toBe(calls[1]!.env.NIGHTSHIFT_TODAY);
    // ...but a fresh run id for each.
    expect(calls[0]!.env.NIGHTSHIFT_RUN_ID).not.toBe(calls[1]!.env.NIGHTSHIFT_RUN_ID);
  });

  it("the headless session is invoked from the REPO ROOT (the workflow's PACK/RUN literals are repo-root-relative)", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"]);
    // realpathSync: macOS hands back /private/var for a /var tmpdir, so the
    // raw fixture path and the child's cwd are spelled differently.
    expect(claudeCalls(fx)[0]!.cwd).toBe(realpathSync(fx.repoDir));
  });

  it("the headless invocation asks for JSON output and a scoped tool grant", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"]);
    const argv = claudeCalls(fx)[0]!.argv;
    expect(argv).toContain("-p");
    expect(argv).toContain("--output-format");
    expect(argv).toContain("json");
    expect(argv).toContain("--allowedTools");
    // No wildcard grant: the scoped grant, not the fail-open guard, is the
    // real perimeter (plan §9.12).
    expect(argv).not.toContain("*");
  });
});

// ---------------------------------------------------------------------------
// T11 — the args spliced into the workflow
// ---------------------------------------------------------------------------

describe("T11: the args handed to the workflow are chunked by the config cap", () => {
  it("writes args.json with exactly the five keys the workflow reads", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const dir = join(fx.runRoot, runDirs(fx)[0]!);
    const args = JSON.parse(readFileSync(join(dir, "args.json"), "utf8"));
    expect(Object.keys(args).sort()).toEqual([
      "agents",
      "lane",
      "registry",
      "run_id",
      "surface_chunks",
    ]);
    expect(args.lane).toBe("security");
    expect(args.agents.reviewer).toBe("security-reviewer");
  });

  it("chunks by max_concurrent_reviewers: cap 1 serializes, cap 99 is one chunk", () => {
    const one = setup({ maxConcurrent: 1 });
    runNs(one, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const argsOne = JSON.parse(
      readFileSync(join(one.runRoot, runDirs(one)[0]!, "args.json"), "utf8"),
    );
    const total = argsOne.surface_chunks.flat().length;
    expect(argsOne.surface_chunks.length).toBe(total);

    const wide = setup({ maxConcurrent: 99 });
    runNs(wide, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const argsWide = JSON.parse(
      readFileSync(join(wide.runRoot, runDirs(wide)[0]!, "args.json"), "utf8"),
    );
    expect(argsWide.surface_chunks.length).toBe(1);
    expect(argsWide.surface_chunks[0].length).toBe(total);
  });

  it("every surface in every chunk carries the dispatch the workflow spreads into agent()", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const args = JSON.parse(
      readFileSync(join(fx.runRoot, runDirs(fx)[0]!, "args.json"), "utf8"),
    );
    for (const s of args.surface_chunks.flat()) {
      expect(typeof s.id).toBe("string");
      expect(s.dispatch.model).toBeTruthy();
      expect(["low", "medium", "high"]).toContain(s.dispatch.effort);
      expect(s.dispatch.maxTurns).toBeGreaterThan(0);
    }
  });

  it("the prompt points the session at THIS run's args.json and the engine's workflow", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"], { NS_STUB_MODE: "fail" });
    const runId = runDirs(fx)[0]!;
    const prompt = claudeCalls(fx)[0]!.argv.join(" ");
    expect(prompt).toContain(join(fx.runRoot, runId, "args.json"));
    expect(prompt).toContain(join(PLUGIN_ROOT, "nightshift.workflow.js"));
  });
});

// ---------------------------------------------------------------------------
// Config-level refusals — nothing runs, nothing is spent
// ---------------------------------------------------------------------------

describe("ns refuses unrunnable requests without invoking a model", () => {
  it("refuses a lane that is not enabled for the repo", () => {
    const fx = setup({ lanes: ["security"] });
    const { code, stderr } = runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/is not enabled for repo/);
    expect(claudeCalls(fx)).toEqual([]);
  });

  it("refuses an unknown repo and lists the configured ones", () => {
    const fx = setup();
    const { code, stderr } = runNs(fx, ["run", "nosuchrepo", "security", "--no-open"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/is not in the ops config/);
    expect(stderr).toContain("novudesk");
    expect(claudeCalls(fx)).toEqual([]);
  });

  it("refuses when no ops home is set at all rather than guessing one", () => {
    const fx = setup();
    const res = spawnSync(NS, ["status"], {
      encoding: "utf8",
      env: { ...process.env, NIGHTSHIFT_ENGINE: PLUGIN_ROOT, NIGHTSHIFT_OPS: "" },
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/no ops home/);
  });

  it("refuses an unknown subcommand and an unknown flag", () => {
    const fx = setup();
    expect(runNs(fx, ["frobnicate"]).code).toBe(2);
    expect(runNs(fx, ["run", "novudesk", "security", "--wat"]).code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Read-only commands
// ---------------------------------------------------------------------------

describe("ns status is read-only", () => {
  it("reports every configured repo/lane and invokes no model", () => {
    const fx = setup();
    const { code, stdout } = runNs(fx, ["status"]);
    expect(code).toBe(0);
    const verdicts = JSON.parse(stdout);
    expect(verdicts.map((v: { lane: string }) => v.lane).sort()).toEqual(["design", "security"]);
    expect(claudeCalls(fx)).toEqual([]);
  });

  it("does not create a run dir or a cost row", () => {
    const fx = setup();
    const before = costLines(fx).length;
    runNs(fx, ["status"]);
    expect(runDirs(fx)).toEqual([]);
    expect(costLines(fx).length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Regressions from A7's adversarial round. Each of these PASSED review and
// FAILED an independent refuter that actually ran the launcher — which is why
// every one of them is pinned here rather than fixed and forgotten.
// ---------------------------------------------------------------------------

describe("regression: an interrupt STOPS the run", () => {
  it("SIGTERM ends the attempt instead of finalizing and carrying on to the model", async () => {
    const fx = setup();
    // A POSIX shell resumes at the next command when a trap handler merely
    // returns. The old handler ran finalize() and returned, so the run went on
    // to invoke the model AFTER the operator (or `timeout`) asked it to stop —
    // and because finalize had already marked the attempt done with
    // NS_MODEL_INVOKED still 0, that model call was never billed to any row.
    const child = spawn(NS, ["run", "novudesk", "security", "--no-open"], {
      cwd: fx.root,
      env: {
        ...process.env,
        NIGHTSHIFT_ENGINE: PLUGIN_ROOT,
        NIGHTSHIFT_OPS: fx.opsDir,
        NIGHTSHIFT_CLAUDE: fx.claudeStub,
        NIGHTSHIFT_TODAY: TODAY,
        NS_PROBE_LOG: fx.probeLog,
        NS_STUB_MODE: "sleep",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Signal as soon as the trap is armed — the "ns: run <id>:" line is printed
    // one command later, so seeing it means the window is open.
    await new Promise<void>((resolve) => {
      let seen = "";
      const done = (): void => resolve();
      child.stderr.on("data", (b: Buffer) => {
        seen += b.toString();
        if (/ns: run \S+:/.test(seen)) done();
      });
      child.on("exit", done);
    });
    child.kill("SIGTERM");
    const code = await new Promise<number>((resolve) => {
      child.on("exit", (c, sig) => resolve(c ?? (sig ? 143 : -1)));
    });

    expect(code).not.toBe(0);
    // The run must not have gone on to spend money after the signal.
    expect(claudeCalls(fx)).toEqual([]);
    // ...and the dashboard is still refreshed on the way out.
    expect(existsSync(fx.dashboard)).toBe(true);
  }, 30_000);
});

describe("regression: `ns run --due` does not feed its work list to the model session", () => {
  it("sweeps EVERY due pair — the first headless session must not eat the rest", () => {
    const fx = setup();
    setBrowser(fx, "http://novudesk.localhost:3000", "local");
    const { code } = runNs(fx, ["run", "--due", "--no-open"]);
    expect(code).toBe(0);
    const calls = claudeCalls(fx);
    // Both configured lanes are overdue in the worked pack, so both must run.
    expect(calls.length).toBe(2);
    // The smoking gun: the first session's stdin used to hold "novudesk design".
    for (const call of calls) {
      expect(call.stdin ?? "").toBe("");
    }
    const ids = calls.map((c) => c.env.NIGHTSHIFT_RUN_ID);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("regression: the dashboard refreshes even when the TARGET never resolved", () => {
  for (const [label, args] of [
    ["an unknown repo", ["run", "nosuchrepo", "security", "--no-open"]],
    ["a lane not enabled for the repo", ["run", "novudesk", "design", "--no-open"]],
  ] as const) {
    it(`regenerates the dashboard on ${label}`, () => {
      const fx = setup({ lanes: ["security"] });
      runNs(fx, ["run", "novudesk", "security", "--no-open"]); // seed a dashboard
      rmSync(fx.dashboard, { force: true });
      const { code } = runNs(fx, [...args]);
      expect(code).not.toBe(0);
      // "the clone or the pack vanished" is exactly the staleness the living
      // document exists to surface — skipping it leaves yesterday's page
      // looking fresh tomorrow morning.
      expect(existsSync(fx.dashboard)).toBe(true);
    });
  }

  it("regenerates the dashboard when the pack itself has been removed", () => {
    const fx = setup();
    runNs(fx, ["run", "novudesk", "security", "--no-open"]);
    rmSync(fx.dashboard, { force: true });
    rmSync(fx.packDir, { recursive: true, force: true });
    const { code, stderr } = runNs(fx, ["run", "novudesk", "security", "--no-open"]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/no \.nightshift pack/);
    expect(existsSync(fx.dashboard)).toBe(true);
  });
});

describe("regression: a preflight refusal leaves nothing behind in the operator's repo", () => {
  it("creates no run dir — four refused attempts used to leave four untracked dirs", () => {
    const fx = setup();
    setBrowser(fx, "https://staging.novudesk.example", "local");
    for (let i = 0; i < 3; i++) {
      expect(runNs(fx, ["run", "novudesk", "design", "--no-open"]).code).not.toBe(0);
    }
    expect(runDirs(fx)).toEqual([]);
  });

  it("the pack ships a .gitignore for .run/, so a kept failure dir is never accidental commit fodder", () => {
    const fx = setup();
    const ignore = readFileSync(join(fx.packDir, ".gitignore"), "utf8");
    expect(ignore).toContain(".run/");
  });
});

describe("regression: a RELATIVE ops home still works after the run cd's to the repo", () => {
  it("--ops with a relative path resolves to an absolute one before anything cd's", () => {
    const fx = setup();
    const res = spawnSync(NS, ["run", "novudesk", "security", "--no-open", "--ops", "ops"], {
      encoding: "utf8",
      cwd: fx.root, // ops/ is relative to here; the run then cd's to the repo
      env: {
        ...process.env,
        NIGHTSHIFT_ENGINE: PLUGIN_ROOT,
        NIGHTSHIFT_OPS: "",
        NIGHTSHIFT_CLAUDE: fx.claudeStub,
        NIGHTSHIFT_TODAY: TODAY,
        NS_PROBE_LOG: fx.probeLog,
      },
    });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toMatch(/No such file or directory/);
    expect(existsSync(fx.dashboard)).toBe(true);
    expect(claudeCalls(fx).length).toBe(1);
  });
});

describe("regression: the configured dashboard filename is honoured on EVERY path", () => {
  it("a target-less refusal writes the configured out name, not a second default file", () => {
    // Writing the hardcoded default here would quietly maintain a SECOND
    // dashboard beside the configured one — the stale-looking page problem
    // again, one filename over.
    const fx = setup({ dashboardOut: "living.html", lanes: ["security"] });
    const { code } = runNs(fx, ["run", "novudesk", "design", "--no-open"]);
    expect(code).not.toBe(0);
    expect(existsSync(join(fx.opsDir, "living.html"))).toBe(true);
    expect(existsSync(join(fx.opsDir, "dashboard.html"))).toBe(false);
  });

  it("a successful run writes it too", () => {
    const fx = setup({ dashboardOut: "living.html" });
    expect(runNs(fx, ["run", "novudesk", "security", "--no-open"]).code).toBe(0);
    expect(existsSync(join(fx.opsDir, "living.html"))).toBe(true);
    expect(existsSync(join(fx.opsDir, "dashboard.html"))).toBe(false);
  });
});

describe("regression: an interactive session's status follows the session", () => {
  it("a failed --interactive run is a FAILURE, so clean keeps the dir you opened it to inspect", () => {
    const fx = setup();
    const { code } = runNs(fx, ["run", "novudesk", "security", "--interactive", "--no-open"], {
      NS_STUB_MODE: "fail",
    });
    expect(code).not.toBe(0);
    expect(runDirs(fx).length).toBe(1);
    // Interactive runs produce no JSON envelope, so no cost row is invented for
    // them — `ns cost add` is the documented path.
    expect(costLines(fx).filter((c) => String(c.run_id).startsWith("2026")).length).toBe(0);
  });

  it("a successful --interactive run still cleans up", () => {
    const fx = setup();
    expect(runNs(fx, ["run", "novudesk", "security", "--interactive", "--no-open"]).code).toBe(0);
    expect(runDirs(fx)).toEqual([]);
  });
});

describe("regression: `ns digest` is least-privilege", () => {
  it("grants a narrower tool set than a review run and never Bash or Agent", () => {
    const fx = setup();
    // The digest skill is Read/Glob/Grep and writes one markdown file. The
    // read-only guard is deliberately NOT armed for it: the guard denies writes
    // outside .nightshift/, which is exactly where the digest has to land.
    const stub = join(fx.root, "digest-stub.js");
    // The stub honours the write the real session would make (the launcher now
    // verifies the file exists rather than announcing a path that is not there).
    writeFileSync(
      stub,
      [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        "const argv = process.argv.slice(2);",
        'fs.appendFileSync(process.env.NS_PROBE_LOG, JSON.stringify({ argv, cwd: process.cwd(), env: {} }) + "\\n");',
        'const out = /file path "([^"]+)"/.exec(argv.join(" "));',
        'if (out) fs.writeFileSync(out[1], "# digest\\n");',
        "",
      ].join("\n"),
    );
    chmodSync(stub, 0o755);
    const { code } = runNs(fx, ["digest", "novudesk"], { NIGHTSHIFT_CLAUDE: stub });
    expect(code).toBe(0);
    const argv = claudeCalls(fx)[0]!.argv;
    const grant = argv[argv.indexOf("--allowedTools") + 1]!;
    expect(grant).toBe("Read,Glob,Grep,Write");
    expect(grant).not.toMatch(/Bash|Agent|Workflow/);
    expect(existsSync(join(fx.opsDir, "digests", "novudesk.md"))).toBe(true);
  });

  it("refuses loudly when the session wrote no digest instead of announcing a file that is not there", () => {
    const fx = setup();
    const stub = join(fx.root, "silent-stub.js");
    writeFileSync(stub, "#!/usr/bin/env node\nprocess.exit(0);\n");
    chmodSync(stub, 0o755);
    const { code, stderr } = runNs(fx, ["digest", "novudesk"], { NIGHTSHIFT_CLAUDE: stub });
    expect(code).toBe(2);
    expect(stderr).toMatch(/wrote no file/);
  });
});
