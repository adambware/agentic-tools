// CLI-shell tests for bin/record-cost: the argv/exit-code contract of the thin
// shell over lib/record-cost-run (logic covered by record-cost-run.test.ts).
// Tests spawn the already-built bin/record-cost.mjs, mirroring record-cli.test.ts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJsonl } from "./io.js";
import type { CostRecord } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..", "..");
const BIN = join(PLUGIN_ROOT, "bin", "record-cost.mjs");
const ERROR_ENVELOPE = join(PLUGIN_ROOT, "fixtures", "cli-envelope-error.json");
const SUCCESS_ENVELOPE = join(PLUGIN_ROOT, "fixtures", "cli-envelope-success.json");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-recordcostcli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync("node", [BIN, ...args], { encoding: "utf8" });
}

function baseArgs(extra: string[]): string[] {
  return [
    "--metrics-dir",
    dir,
    "--run-id",
    "ns-2026-06-21-sec-01",
    "--lane",
    "security",
    "--date",
    "2026-06-21",
    "--ts",
    "2026-06-21T07:00:00Z",
    ...extra,
  ];
}

describe("bin/record-cost", () => {
  it("exits 2 when required args are missing", () => {
    const res = run(["--lane", "security"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/missing required/);
  });

  it("exits 2 when the envelope file does not exist", () => {
    const res = run(baseArgs(["--json", join(dir, "nope.json")]));
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/envelope not found/);
  });

  it("exits 2 when given neither --json nor --usd", () => {
    const res = run(baseArgs([]));
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/envelope or a manual/);
  });

  it("success envelope: exits 0 and appends an ok line", () => {
    const res = run(baseArgs(["--json", SUCCESS_ENVELOPE]));
    expect(res.status).toBe(0);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.status).toBe("ok");
    expect(lines[0]!.usd).toBe(1.8421);
    expect(lines[0]!.source).toBe("cli-json");
  });

  it("FAILED-run envelope (is_error:true, subtype:'success'): exits 0, records status:'error'", () => {
    // Recording a failed run's cost is a SUCCESS of record-cost — exit 0, error row.
    const res = run(baseArgs(["--json", ERROR_ENVELOPE]));
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/status=|error/);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.status).toBe("error");
    expect(lines[0]!.terminal_reason).toBe("api_error");
    expect(lines[0]!.usd).toBe(0);
  });

  it("manual source: --usd appends a manual ok line", () => {
    const res = run(baseArgs(["--usd", "2.75", "--output-tokens", "1200"]));
    expect(res.status).toBe(0);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!).toMatchObject({
      source: "manual",
      status: "ok",
      usd: 2.75,
      output_tokens: 1200,
      input_tokens: 0,
    });
  });

  it("exits 2 when --json and --usd are both given (mutually exclusive)", () => {
    const res = run(baseArgs(["--json", SUCCESS_ENVELOPE, "--usd", "1.00"]));
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/mutually exclusive/);
  });

  it("exits 2 on a non-numeric --usd", () => {
    const res = run(baseArgs(["--usd", "lots"]));
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/--usd must be a number/);
  });
});

// ---------------------------------------------------------------------------
// A7: --fallback-error-reason. A crashed headless run leaves no envelope file,
// or a half-written/unparseable one. Without the flag the pre-A7 behaviour is
// unchanged: exit 2, nothing appended. With it, `ns` gets a status:"error" cost
// row instead of silence, so the dashboard's verdict strip reads "a run
// failed" rather than "no run happened" (T22).
// ---------------------------------------------------------------------------

describe("bin/record-cost: --fallback-error-reason", () => {
  it("missing envelope file + flag: exits 0 and appends one error row", () => {
    const res = run(
      baseArgs(["--json", join(dir, "nope.json"), "--fallback-error-reason", "crashed run"]),
    );
    expect(res.status).toBe(0);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.status).toBe("error");
    expect(lines[0]!.usd).toBe(0);
    expect(lines[0]!.terminal_reason).toContain("crashed run");
  });

  it("missing envelope file WITHOUT the flag: exits 2 and appends NOTHING (unchanged pre-A7 behaviour)", () => {
    const res = run(baseArgs(["--json", join(dir, "nope.json")]));
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/envelope not found/);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(0);
  });

  it("invalid JSON in the envelope file + flag: exits 0 and appends one error row", () => {
    const badJsonPath = join(dir, "bad.json");
    writeFileSync(badJsonPath, "{ not json", "utf8");
    const res = run(
      baseArgs(["--json", badJsonPath, "--fallback-error-reason", "unparseable envelope"]),
    );
    expect(res.status).toBe(0);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.status).toBe("error");
    expect(lines[0]!.terminal_reason).toContain("unparseable envelope");
  });

  it("invalid JSON WITHOUT the flag: exits 2 and appends nothing", () => {
    const badJsonPath = join(dir, "bad.json");
    writeFileSync(badJsonPath, "{ not json", "utf8");
    const res = run(baseArgs(["--json", badJsonPath]));
    expect(res.status).toBe(2);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(0);
  });

  it("REGRESSION: FAILED-run envelope (is_error:true, subtype:'success') with the flag set records status:'error' via the real path, not the fallback", () => {
    // The envelope IS usable here, so the fallback must never fire. Proven by
    // the terminal_reason being the envelope's own "api_error", not the flag's
    // reason string.
    const res = run(baseArgs(["--json", ERROR_ENVELOPE, "--fallback-error-reason", "unused"]));
    expect(res.status).toBe(0);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.status).toBe("error");
    expect(lines[0]!.terminal_reason).toBe("api_error");
  });

  it("GOOD envelope with the flag set: records the real ok row, never masked by the fallback", () => {
    const res = run(baseArgs(["--json", SUCCESS_ENVELOPE, "--fallback-error-reason", "unused"]));
    expect(res.status).toBe(0);
    const lines = readJsonl<CostRecord>(join(dir, "costs.jsonl"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.status).toBe("ok");
    expect(lines[0]!.usd).toBe(1.8421);
  });
});
