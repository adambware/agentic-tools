// appendRow's rare failure paths, which a real filesystem will not produce on demand: node:fs is
// mocked so a write can come up short and a sync can fail.
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    closeSync: vi.fn(actual.closeSync),
    writeSync: vi.fn(actual.writeSync),
    fsyncSync: vi.fn(actual.fsyncSync),
  };
});

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "projects");
const GSTACK_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "gstack", "projects");
const NOW = "2026-09-01T00:00:00.000Z";

async function run(out: string) {
  let stdout = "";
  let stderr = "";
  const argv = ["--projects-dir", FIXTURES, "--gstack-dir", GSTACK_FIXTURES, "--out", out, "--now", NOW];
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

/** The path behind each fsync'd fd: the latest open before that sync that returned it (fds are reused). */
function syncedPaths(): string[] {
  const open = vi.mocked(fs.openSync).mock;
  const opens = open.calls.map((c, i) => ({ path: String(c[0]), fd: open.results[i]!.value, at: open.invocationCallOrder[i]! }));
  const sync = vi.mocked(fs.fsyncSync).mock;
  return sync.calls.map(([fd], i) => opens.filter((o) => o.fd === fd && o.at < sync.invocationCallOrder[i]!).pop()!.path);
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loops-cli-fs-"));
});
afterEach(async () => {
  // Reset, not just clear: a once-stub a failed test never reached must not fire in the next test.
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(fs.openSync).mockReset().mockImplementation(actual.openSync);
  vi.mocked(fs.closeSync).mockReset().mockImplementation(actual.closeSync);
  vi.mocked(fs.writeSync).mockReset().mockImplementation(actual.writeSync);
  vi.mocked(fs.fsyncSync).mockReset().mockImplementation(actual.fsyncSync);
  rmSync(tmp, { recursive: true, force: true });
});

describe("appendRow", () => {
  it("truncates a short write back, so it cannot tear next week's row", async () => {
    const out = join(tmp, "loops.jsonl");
    writeFileSync(out, '{"schema":1}\n');
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    // Write only the first 10 bytes, as a full disk would.
    vi.mocked(fs.writeSync).mockImplementationOnce(((fd: number, buf: Buffer) => actual.writeSync(fd, buf, 0, 10)) as typeof fs.writeSync);
    const r = await run(out);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^error: cannot append to --out .*: short write \(10 of \d+ bytes\)\n$/);
    expect(readFileSync(out, "utf8")).toBe('{"schema":1}\n');
  });

  // Value: protects=a row appended by another run after our short write is never truncated away; fails_when=the size check before ftruncate is dropped, cutting the other run's row; why_new=the short-write test above has no concurrent append; seam=none
  it("never truncates a row another run appended after a short write, though our fragment stays glued to it", async () => {
    const out = join(tmp, "loops.jsonl");
    writeFileSync(out, '{"schema":1}\n');
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fs.writeSync).mockImplementationOnce(((fd: number, buf: Buffer) => {
      const n = actual.writeSync(fd, buf, 0, 10);
      actual.appendFileSync(out, '{"other":1}\n');
      return n;
    }) as typeof fs.writeSync);
    const r = await run(out);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/short write \(10 of \d+ bytes\)/);
    // Cutting back would take the other run's row with it, so our 10 bytes stay: a known limit.
    expect(readFileSync(out, "utf8")).toBe('{"schema":1}\n{"schema":{"other":1}\n');
  });

  // Value: protects=the file's dir entry is synced on every run, not only when this run created it; fails_when=the dir sync is gated on creating the file again; why_new=an earlier run may have created the file and died before syncing its entry; seam=none
  it("syncs the file's dir on every run, not only the one that created the file", async () => {
    const out = join(tmp, "loops.jsonl");
    expect((await run(out)).code).toBe(0);
    expect(syncedPaths()).toEqual([out, tmp]);
    vi.mocked(fs.openSync).mockClear();
    vi.mocked(fs.fsyncSync).mockClear();
    expect((await run(out)).code).toBe(0);
    expect(syncedPaths()).toEqual([out, tmp]);
  });

  it("syncs every directory it created for a new file, up to the one that already existed", async () => {
    const out = join(tmp, "a", "b", "loops.jsonl");
    expect((await run(out)).code).toBe(0);
    expect(syncedPaths()).toEqual([out, join(tmp, "a", "b"), join(tmp, "a"), tmp]);
  });

  it("stops syncing at the dir that already existed when only some were made", async () => {
    mkdirSync(join(tmp, "a"));
    const out = join(tmp, "a", "b", "loops.jsonl");
    expect((await run(out)).code).toBe(0);
    expect(syncedPaths()).toEqual([out, join(tmp, "a", "b"), join(tmp, "a")]);
  });

  it("syncs the dirs it made even when a concurrent run created and filled the file first", async () => {
    const out = join(tmp, "a", "loops.jsonl");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    // Another run creates the file and writes its row between our mkdir and our open.
    vi.mocked(fs.openSync).mockImplementationOnce(((path: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      actual.writeFileSync(out, '{"other":1}\n');
      return actual.openSync(path, flags ?? "r", mode);
    }) as typeof fs.openSync);
    expect((await run(out)).code).toBe(0);
    // The row, then a/ (its entry for the file) and tmp (its new entry for a/).
    expect(syncedPaths()).toEqual([out, join(tmp, "a"), tmp]);
  });

  it("keeps the not-durable message when closing the file also fails after a failed sync", async () => {
    const out = join(tmp, "loops.jsonl");
    writeFileSync(out, "");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
      throw new Error("EIO: i/o error, fsync");
    });
    vi.mocked(fs.closeSync).mockImplementationOnce((fd: number) => {
      actual.closeSync(fd);
      throw new Error("EIO: i/o error, close");
    });
    const r = await run(out);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(`error: --out ${out}: row written but may not be on disk: EIO: i/o error, fsync\n`);
  });

  it("calls a synced row not confirmed durable when closing the file fails", async () => {
    const out = join(tmp, "loops.jsonl");
    writeFileSync(out, "");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fs.closeSync).mockImplementationOnce((fd: number) => {
      actual.closeSync(fd);
      throw new Error("EIO: i/o error, close");
    });
    const r = await run(out);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(`error: --out ${out}: row written but may not be on disk: EIO: i/o error, close\n`);
    expect(readFileSync(out, "utf8").trimEnd().split("\n")).toHaveLength(1);
  });

  it("says a row whose sync failed was written but may not be on disk", async () => {
    const out = join(tmp, "loops.jsonl");
    writeFileSync(out, "");
    vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("EIO: i/o error, fsync"), { code: "EIO" });
    });
    const r = await run(out);
    expect(r.code).toBe(1);
    // The row still goes to stdout, so the log has a copy to check the file against.
    expect(r.stdout).toBe(readFileSync(out, "utf8"));
    expect(r.stderr).toBe(`error: --out ${out}: row written but may not be on disk: EIO: i/o error, fsync\n`);
    expect(readFileSync(out, "utf8").trimEnd().split("\n")).toHaveLength(1);
  });

  it("says the same when the file's dir entry cannot be synced for an I/O error", async () => {
    const out = join(tmp, "loops.jsonl");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fs.fsyncSync)
      .mockImplementationOnce(actual.fsyncSync)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("EIO: i/o error, fsync"), { code: "EIO" });
      });
    const r = await run(out);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("row written but may not be on disk: EIO");
    expect(readFileSync(out, "utf8").trimEnd().split("\n")).toHaveLength(1);
  });

  // Value: protects=a filesystem that cannot sync directories does not fail every run; fails_when=dir-sync errors like EINVAL/EACCES are reported as not durable again; why_new=the I/O-error test above covers only real failures; seam=none
  it("treats a filesystem that cannot sync or open directories as best effort", async () => {
    const out = join(tmp, "loops.jsonl");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fs.fsyncSync)
      .mockImplementationOnce(actual.fsyncSync)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("EINVAL: invalid argument, fsync"), { code: "EINVAL" });
      });
    expect((await run(out)).code).toBe(0);
    vi.mocked(fs.openSync).mockImplementation(((path: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      if (flags === "r") throw Object.assign(new Error("EACCES: permission denied, open"), { code: "EACCES" });
      return actual.openSync(path, flags ?? "r", mode);
    }) as typeof fs.openSync);
    const r = await run(out);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(readFileSync(out, "utf8").trimEnd().split("\n")).toHaveLength(2);
  });

  // Value: protects=a real I/O error opening the dir to sync it is reported not-durable, not swallowed as best effort; fails_when=the open catch ignores every code instead of only the NO_DIR_SYNC set; why_new=best-effort test only throws EACCES on open; seam=none
  it("reports a dir that cannot be opened for an I/O error as not durable, not best effort", async () => {
    const out = join(tmp, "loops.jsonl");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fs.openSync).mockImplementation(((path: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      if (flags === "r") throw Object.assign(new Error("EIO: i/o error, open"), { code: "EIO" });
      return actual.openSync(path, flags ?? "r", mode);
    }) as typeof fs.openSync);
    const r = await run(out);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(`error: --out ${out}: row written but may not be on disk: EIO: i/o error, open\n`);
    expect(readFileSync(out, "utf8").trimEnd().split("\n")).toHaveLength(1);
  });
});
