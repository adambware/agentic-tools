// CLI-shell tests for bin/eval-planted: the argv / exit-code contract of the thin
// shell over lib/planted-eval (scoring itself is covered by planted-eval.test.ts).
// REPORT-ONLY: exit 0 whatever the score, 2 only on a usage or input error.
// Spawns the committed, built bin/eval-planted.mjs, like clean-cli.test.ts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..", "..");
const BIN = join(PLUGIN_ROOT, "bin", "eval-planted.mjs");
const KEY = join(PLUGIN_ROOT, "examples", "novudesk", "eval", "answer-key.yml");

let dir: string;
let cands: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-evalcli-"));
  cands = join(dir, "candidates.tier2.json");
  writeFileSync(
    cands,
    JSON.stringify([
      {
        dedupe_key: { surface: "ND-SEC-05", symptom: "s", root_cause: "r" },
        severity: "high",
        confidence: "high",
        needs_human_verification: true,
        location: "app/controllers/tickets_controller.rb:7",
      },
    ]),
  );
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runCli(argv: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [BIN, ...argv], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("bin/eval-planted argv + exit-code contract", () => {
  it("scores and exits 0, as text by default and as JSON with --json", () => {
    const text = runCli(["--key", KEY, "--findings", cands]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("caught: 1/4 planted");
    const json = runCli(["--key", KEY, "--findings", cands, "--json"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ gating: false, caught: 1, planted_total: 4 });
  });

  it("exits 0 on a zero score: the eval never gates", () => {
    writeFileSync(cands, "[]");
    const r = runCli(["--key", KEY, "--findings", cands]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("caught: 0/4 planted");
  });

  it.each([
    ["no --key", ["--findings", "CANDS"], /key/],
    ["no --findings", ["--key", KEY], /findings/],
    ["a missing findings path", ["--key", KEY, "--findings", "/nonexistent/x.json"], /not found/],
    ["a negative --slack", ["--key", KEY, "--findings", "CANDS", "--slack", "-1"], /--slack/],
    ["a non-integer --slack", ["--key", KEY, "--findings", "CANDS", "--slack", "2.5"], /--slack/],
    ["a bare --run-id", ["--key", KEY, "--findings", "CANDS", "--run-id"], /--run-id needs a value/],
    ["--run-id on run candidates", ["--key", KEY, "--findings", "CANDS", "--run-id", "r1"], /--run-id needs logged findings/],
  ])("exits 2 on %s", (_name, argv, msg) => {
    const r = runCli((argv as string[]).map((a) => (a === "CANDS" ? cands : a)));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^(eval-planted|error): /);
    expect(r.stderr).toMatch(msg as RegExp);
    expect(r.stdout).toBe("");
  });

  it("--slack widens the planted range", () => {
    writeFileSync(cands, readCands().replace(":7", ":13")); // PV-03 range 6-9
    expect(runCli(["--key", KEY, "--findings", cands, "--json"]).stdout).toContain('"caught": 0');
    expect(runCli(["--key", KEY, "--findings", cands, "--json", "--slack", "4"]).stdout).toContain('"caught": 1');
  });
});

function readCands(): string {
  return JSON.stringify(JSON.parse(readFileSync(cands, "utf8")));
}
