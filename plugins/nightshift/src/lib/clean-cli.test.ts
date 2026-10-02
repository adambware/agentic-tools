// CLI-shell tests for bin/clean: verify the argv/exit-code contract of the
// thin shell over lib/clean-run (E4). The prune/containment logic itself is
// covered by clean-run.test.ts; here we exercise the shell's own paths:
// requireArg exit 2, the --status validation, and success exit 0.
//
// Tests spawn the already-built bin/clean.mjs (committed artifact), mirroring
// record-cli.test.ts. This only passes once the integration stage has built
// bin/clean.mjs from src/bin/clean.ts — that is expected to fail locally
// until then.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve to <plugin-root>/bin/clean.mjs
const BIN = join(__dirname, "..", "..", "bin", "clean.mjs");

let dir: string;
let runRoot: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-cleancli-"));
  runRoot = join(dir, ".run");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runCli(argv: string[]): { code: number | null; stderr: string } {
  const result = spawnSync("node", [BIN, ...argv], { encoding: "utf8" });
  return { code: result.status, stderr: result.stderr ?? "" };
}

describe("bin/clean argv + exit-code contract", () => {
  it("exits 2 and names --run-root in stderr when --run-root is missing", () => {
    const { code, stderr } = runCli(["--run-id", "ns-01", "--status", "success"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/run-root/);
  });

  it("exits 2 and names --run-id in stderr when --run-id is missing", () => {
    const { code, stderr } = runCli(["--run-root", runRoot, "--status", "success"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/run-id/);
  });

  it("exits 2 and names --status in stderr when --status is missing", () => {
    const { code, stderr } = runCli(["--run-root", runRoot, "--run-id", "ns-01"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/status/);
  });

  it("exits 2 when --status is neither success nor failure", () => {
    const { code, stderr } = runCli([
      "--run-root",
      runRoot,
      "--run-id",
      "ns-01",
      "--status",
      "bogus",
    ]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/status/);
  });

  it("exits 2 when the run id escapes the run root", () => {
    const { code, stderr } = runCli([
      "--run-root",
      runRoot,
      "--run-id",
      "../evil",
      "--status",
      "success",
    ]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/clean:/);
  });

  it("exits 0, deletes the run dir, and reports the summary line on success", () => {
    const runId = "ns-2026-06-21-sec-01";
    mkdirSync(join(runRoot, runId), { recursive: true });
    writeFileSync(join(runRoot, runId, "marker.txt"), "x");
    const { code, stderr } = runCli([
      "--run-root",
      runRoot,
      "--run-id",
      runId,
      "--status",
      "success",
    ]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/clean: run=ns-2026-06-21-sec-01 deleted=true pruned=\d+/);
  });

  it("exits 0 and reports deleted=false when status=failure", () => {
    const runId = "ns-2026-06-21-sec-02";
    mkdirSync(join(runRoot, runId), { recursive: true });
    writeFileSync(join(runRoot, runId, "marker.txt"), "x");
    const { code, stderr } = runCli([
      "--run-root",
      runRoot,
      "--run-id",
      runId,
      "--status",
      "failure",
    ]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/clean: run=ns-2026-06-21-sec-02 deleted=false pruned=\d+/);
  });
});
