// CLI-shell tests for bin/record: verify the argv/exit-code contract of the
// thin shell over lib/record-run (E4). The decision logic in runRecord is
// covered by record-run.test.ts; here we exercise the shell's own paths:
// requireArg exit 2, the existsSync guards (decisions/run-meta not found),
// and the success exit 0.
//
// Tests spawn the already-built bin/record.mjs (committed artifact), mirroring
// run-meta-cli.test.ts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve to <plugin-root>/bin/record.mjs
const BIN = join(__dirname, "..", "..", "bin", "record.mjs");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-recordcli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a valid decisions.json and return its path. */
function writeDecisions(): string {
  const p = join(dir, "decisions.json");
  writeFileSync(
    p,
    JSON.stringify({
      run_id: "ns-2026-06-21-sec-test",
      lane: "security",
      date: "2026-06-21",
      decisions: [
        {
          decision: "new",
          finding: {
            dedupe_key: { surface: "s", symptom: "sym", root_cause: "rc" },
            severity: "critical",
            confidence: "high",
            needs_human_verification: true,
          },
        },
      ],
      counts: { confirmed: 1, recurring: 0, suppressed: 0 },
    }) + "\n",
  );
  return p;
}

/** Write a valid run.json (RunMeta) and return its path. */
function writeRunMeta(): string {
  const p = join(dir, "run.json");
  writeFileSync(
    p,
    JSON.stringify({
      run_id: "ns-2026-06-21-sec-test",
      lane: "security",
      date: "2026-06-21",
      ts: "2026-06-21T07:00:00Z",
      pack_sha: "no-git",
      selected: 1,
      reviewed: 1,
      rejected_tier1: 0,
      rejected_tier2: 0,
      reviewed_ids: ["s"],
      usage_by_model: {},
      usage_spent: 0,
      elapsed: 0,
    }) + "\n",
  );
  return p;
}

/** Full valid args except for caller overrides (undefined drops the flag). */
function fullArgs(overrides: Record<string, string | undefined> = {}): string[] {
  const defaults: Record<string, string> = {
    "--decisions": writeDecisions(),
    "--run-meta": writeRunMeta(),
    "--metrics-dir": join(dir, "metrics"),
  };
  const merged = { ...defaults, ...overrides };
  const argv: string[] = [];
  for (const [flag, value] of Object.entries(merged)) {
    if (value !== undefined) argv.push(flag, value);
  }
  return argv;
}

function runCli(argv: string[]): { code: number | null; stderr: string } {
  const result = spawnSync("node", [BIN, ...argv], {
    encoding: "utf8",
    env: { ...process.env, NIGHTSHIFT_TODAY: "2026-06-21" },
  });
  return { code: result.status, stderr: result.stderr ?? "" };
}

describe("bin/record argv + exit-code contract", () => {
  it("exits 2 and names --decisions in stderr when --decisions is missing", () => {
    const argv = fullArgs({ "--decisions": undefined });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/decisions/);
  });

  it("exits 2 and names --metrics-dir in stderr when --metrics-dir is missing", () => {
    const argv = fullArgs({ "--metrics-dir": undefined });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/metrics-dir/);
  });

  it("exits 2 with 'decisions not found' when the decisions path does not exist", () => {
    const argv = fullArgs({ "--decisions": join(dir, "no-such-decisions.json") });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/decisions not found/);
  });

  it("exits 2 with 'run-meta not found' when the run-meta path does not exist", () => {
    const argv = fullArgs({ "--run-meta": join(dir, "no-such-run.json") });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/run-meta not found/);
  });

  it("exits 0 and reports the logged count on a valid run", () => {
    const argv = fullArgs();
    const { code, stderr } = runCli(argv);
    expect(code).toBe(0);
    expect(stderr).toMatch(/logged=1/);
    expect(stderr).toMatch(/run=ns-2026-06-21-sec-test/);
  });
});
