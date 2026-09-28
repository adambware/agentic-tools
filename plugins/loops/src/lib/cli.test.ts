import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, USAGE } from "./cli.js";

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

  it("starts a new line after a torn last row instead of gluing onto it", async () => {
    const out = join(tmp, "loops.jsonl");
    writeFileSync(out, '{"schema":1}\n{"partial":');
    expect((await run(["--projects-dir", FIXTURES, "--out", out, "--now", NOW])).code).toBe(0);
    const lines = readFileSync(out, "utf8").split("\n");
    expect(lines).toHaveLength(4); // good row, torn row, new row, and the final newline
    expect(lines[1]).toBe('{"partial":');
    expect(JSON.parse(lines[2]!).window_end).toBe(NOW);
    expect(lines[3]).toBe("");
  });

  it.skipIf(process.getuid?.() === 0)("counts an unreadable project dir once in bad_files", async () => {
    const proj = join(tmp, "projects", "p");
    mkdirSync(proj, { recursive: true });
    chmodSync(proj, 0o000);
    try {
      const r = await run(["--projects-dir", join(tmp, "projects"), "--now", NOW, "--dry-run"]);
      expect(JSON.parse(r.stdout).parse.bad_files).toBe(1);
    } finally {
      chmodSync(proj, 0o755);
    }
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
    // Date.parse would accept both: "Sep 28" as 2001, a zone-less time as local.
    expect((await run(["--now", "Sep 28", "--dry-run"])).code).toBe(2);
    // ...and it rolls impossible dates over (02-30 is March 2, 24:00 the next day).
    expect((await run(["--now", "2026-02-30T10:00Z", "--dry-run"])).code).toBe(2);
    expect((await run(["--now", "2026-09-28T24:00Z", "--dry-run"])).code).toBe(2);
    expect((await run(["--now", "2026-09-28T09:00:00.000+02:00", "--projects-dir", tmp, "--dry-run"])).code).toBe(0);
    expect((await run(["--now", "2026-09-28T09:00", "--dry-run"])).code).toBe(2);
    expect((await run(["--dryrun"])).code).toBe(2);
  });

  it("rejects a value flag with no value instead of reading it as the path 'true'", async () => {
    for (const argv of [["--out"], ["--out", "--dry-run"], ["--projects-dir"], ["--session"], ["--now"]]) {
      const r = await run(argv);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`error: ${argv[0]} needs a value`);
      expect(r.stdout).toBe("");
    }
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

  it("--help prints usage and exits 0, even beside unknown flags; a stray positional is rejected by name", async () => {
    const help = await run(["--help", "--bogus"]);
    expect(help).toEqual({ code: 0, stdout: USAGE, stderr: "" });
    const stray = await run(["--dry-run", "extra", "positional"]);
    expect(stray.code).toBe(2);
    expect(stray.stderr).toContain("unknown argument extra positional");
    expect(stray.stderr).toContain(USAGE);
    expect(stray.stdout).toBe("");
    const lead = await run(["stray", "--dry-run"]);
    expect(lead.code).toBe(2);
    expect(lead.stderr).toContain("unknown argument stray");
  });

  it("refuses a --projects-dir that is a file or missing, naming it on stderr", async () => {
    const file = join(tmp, "a-file");
    writeFileSync(file, "");
    const asFile = await run(["--projects-dir", file, "--now", NOW, "--dry-run"]);
    expect(asFile.code).toBe(1);
    expect(asFile.stderr).toBe(`error: cannot read --projects-dir ${file}: not a directory\n`);
    const missing = await run(["--projects-dir", join(tmp, "nope"), "--now", NOW, "--dry-run"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/^error: cannot read --projects-dir .*nope: ENOENT/);
  });

  it("--session fails on a missing file, a directory, or an unreadable file; reports a null peak with no usage", async () => {
    const missing = await run(["--session", join(tmp, "gone.jsonl")]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/cannot read --session .*gone\.jsonl: ENOENT/);
    const asDir = await run(["--session", tmp]);
    expect(asDir.code).toBe(1);
    expect(asDir.stderr).toContain("not a file");

    const f = join(tmp, "s.jsonl");
    writeFileSync(f, JSON.stringify({ type: "user", uuid: "u1", timestamp: NOW }) + "\n");
    const noUsage = await run(["--session", f]);
    expect(noUsage.code).toBe(0);
    expect(JSON.parse(noUsage.stdout).deduped).toEqual({ records: 1, messages: 0, compactions: 0, context_peak: null });

    if (process.getuid?.() !== 0) {
      chmodSync(f, 0o000);
      try {
        const locked = await run(["--session", f]);
        expect(locked.code).toBe(1);
        expect(locked.stderr).toBe(`error: cannot read --session ${f}\n`);
        expect(locked.stdout).toBe("");
      } finally {
        chmodSync(f, 0o644);
      }
    }
  });

  it("defaults --projects-dir and --out under $HOME/.claude and prints exactly the appended line", async () => {
    const prevHome = process.env.HOME;
    process.env.HOME = tmp;
    try {
      mkdirSync(join(tmp, ".claude", "projects"), { recursive: true });
      const r = await run(["--now", NOW]);
      expect(r.code).toBe(0);
      const out = join(tmp, ".claude", "metrics", "loops.jsonl");
      expect(readFileSync(out, "utf8")).toBe(r.stdout);
      expect(JSON.parse(r.stdout).w30.sessions.n).toBe(0);
    } finally {
      process.env.HOME = prevHome;
    }
  });
});
