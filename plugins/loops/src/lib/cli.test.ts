import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "projects");
const NOW = "2026-09-01T00:00:00.000Z";

async function run(argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loops-cli-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loop-metrics", () => {
  it("--dry-run prints the fixtures row and writes nothing", async () => {
    const out = join(tmp, "metrics", "loops.jsonl");
    const r = await run(["--projects-dir", FIXTURES, "--out", out, "--now", NOW, "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toMatchSnapshot();
    expect(existsSync(out)).toBe(false);
  });

  it("creates a missing out dir and appends one line per run", async () => {
    const out = join(tmp, "metrics", "loops.jsonl");
    for (let i = 0; i < 2; i++) {
      const r = await run(["--projects-dir", FIXTURES, "--out", out, "--now", NOW]);
      expect(r.code).toBe(0);
    }
    const lines = readFileSync(out, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).schema).toBe(1);
  });

  it("fails without a row when --out is unwritable", async () => {
    const blocker = join(tmp, "a-file");
    writeFileSync(blocker, "");
    const r = await run(["--projects-dir", FIXTURES, "--out", join(blocker, "loops.jsonl"), "--now", NOW]);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/cannot append/);
  });

  it("fails without a row when --projects-dir is missing", async () => {
    const out = join(tmp, "loops.jsonl");
    const r = await run(["--projects-dir", join(tmp, "nope"), "--out", out, "--now", NOW]);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(existsSync(out)).toBe(false);
  });

  it("writes a valid zero row for an existing empty projects dir", async () => {
    const r = await run(["--projects-dir", tmp, "--now", NOW, "--dry-run"]);
    expect(r.code).toBe(0);
    const row = JSON.parse(r.stdout);
    expect(row.w30.sessions.n).toBe(0);
    expect(row.w30.workflows.tokens_median).toBeNull();
  });

  it("rejects a bad --now and unknown flags", async () => {
    expect((await run(["--now", "yesterday", "--dry-run"])).code).toBe(2);
    expect((await run(["--dryrun"])).code).toBe(2);
  });

  it("--session shows the naive counts inflated over the deduped ones", async () => {
    const r = await run(["--session", join(FIXTURES, "-home-user-proj-a", "s1.jsonl")]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.deduped).toEqual({ records: 6, messages: 2, compactions: 1, context_peak: 3052 });
    expect(report.naive).toEqual({ usage_records: 6, compactions: 2 });
    expect(report.naive.usage_records).toBeGreaterThan(report.deduped.messages);
    expect(report.parse).toEqual({ bad_lines: 1, bad_files: 0, bad_records: 0, dup_records: 3 });
  });
});
