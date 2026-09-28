import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectSessionFiles, collectSessions } from "./session.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loops-session-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const T = (min: number) => new Date(Date.UTC(2026, 7, 30, 10, min)).toISOString();

function assistant(uuid: string, ts: string | undefined, id: string, usage: Record<string, unknown>) {
  return { type: "assistant", uuid, timestamp: ts, requestId: `req-${id}`, message: { id, usage } };
}
function compact(uuid: string, ts: string) {
  return { type: "system", subtype: "compact_boundary", uuid, timestamp: ts };
}
function write(name: string, lines: Array<object | string>): string {
  const path = join(dir, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  return path;
}

const USAGE = { input_tokens: 3, cache_creation_input_tokens: 40, cache_read_input_tokens: 500, output_tokens: 9 };

describe("collectSessionFiles", () => {
  it("counts a message split across three records once", async () => {
    const f = write("s.jsonl", [
      assistant("a1", T(1), "m1", USAGE),
      assistant("a2", T(1), "m1", USAGE),
      assistant("a3", T(1), "m1", USAGE),
    ]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.messages).toEqual([[Date.parse(T(1)), 543]]);
    expect(sessions[0]!.naive.usage_records).toBe(3);
    expect(parse.dup_records).toBe(0);
  });

  it("falls back to requestId, then uuid, as the usage key", async () => {
    const f = write("s.jsonl", [
      { type: "assistant", uuid: "a1", timestamp: T(1), requestId: "r1", message: { usage: USAGE } },
      { type: "assistant", uuid: "a2", timestamp: T(1), requestId: "r1", message: { usage: USAGE } },
      { type: "assistant", uuid: "a3", timestamp: T(2), message: { usage: USAGE } },
      { type: "assistant", uuid: "a4", timestamp: T(2), message: { usage: USAGE } },
    ]);
    const { sessions } = await collectSessionFiles([f]);
    expect(sessions[0]!.messages).toHaveLength(3);
  });

  it("dedupes a replayed block by uuid, including its compact_boundary", async () => {
    const block = [assistant("a1", T(1), "m1", USAGE), compact("c1", T(2)), assistant("a2", T(3), "m2", USAGE)];
    const f = write("s.jsonl", [...block, ...block.slice(0, 2)]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.compactions).toHaveLength(1);
    expect(sessions[0]!.naive.compact_records).toBe(2);
    expect(parse.dup_records).toBe(2);
  });

  it("counts a malformed line and keeps the rest; an empty file is harmless", async () => {
    const f = write("s.jsonl", [assistant("a1", T(1), "m1", USAGE), '{"type":"assistant",', compact("c1", T(2))]);
    const empty = join(dir, "empty.jsonl");
    writeFileSync(empty, "");
    const { sessions, parse } = await collectSessionFiles([f, empty]);
    expect(parse.bad_lines).toBe(1);
    expect(parse.bad_files).toBe(0);
    const s = sessions.find((x) => x.file === f)!;
    expect(s.messages).toHaveLength(1);
    expect(s.compactions).toHaveLength(1);
    expect(sessions.find((x) => x.file === empty)!.recordTimes).toEqual([]);
  });

  it("splits lines on \\n only: a raw U+2028/U+2029 inside a JSON string is not a line break", async () => {
    const text = `before${String.fromCharCode(0x2028)}after${String.fromCharCode(0x2029)}end`;
    const f = write("s.jsonl", [
      { type: "user", uuid: "u1", timestamp: T(0), note: text },
      assistant("a1", T(1), "m1", { ...USAGE, note: text }),
    ]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(parse.bad_lines).toBe(0);
    expect(sessions[0]!.recordTimes).toHaveLength(2);
    expect(sessions[0]!.messages).toHaveLength(1);
  });

  it("reads a line that spans many stream chunks", async () => {
    const big = "x".repeat(1_000_000);
    const f = write("s.jsonl", [
      assistant("a1", T(1), "m1", { ...USAGE, note: big }),
      { type: "user", uuid: "u1", timestamp: T(2), note: big },
      compact("c1", T(3)),
    ]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(parse.bad_lines).toBe(0);
    expect(sessions[0]!.recordTimes).toHaveLength(3);
    expect(sessions[0]!.messages).toEqual([[Date.parse(T(1)), 543]]);
  });

  it("reads CRLF line endings", async () => {
    const f = join(dir, "crlf.jsonl");
    writeFileSync(f, [assistant("a1", T(1), "m1", USAGE), compact("c1", T(2))].map((r) => JSON.stringify(r)).join("\r\n"));
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(parse.bad_lines).toBe(0);
    expect(sessions[0]!.messages).toHaveLength(1);
    expect(sessions[0]!.compactions).toHaveLength(1);
  });

  it("skips a used record with no timestamp and reads a string token count as 0", async () => {
    const f = write("s.jsonl", [
      assistant("a1", undefined, "m1", USAGE),
      assistant("a2", T(2), "m2", { input_tokens: "12", cache_read_input_tokens: 100 }),
      { type: "custom-title", customTitle: "not a used record" },
    ]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.messages).toEqual([[Date.parse(T(2)), 100]]);
    expect(parse.bad_records).toBe(2);
  });

  it("gives records shared with a fork to the file whose first record is earlier", async () => {
    const shared = [assistant("a1", T(1), "m1", USAGE), compact("c1", T(2))];
    // The fork sorts first by name but starts later.
    const fork = write("a-fork.jsonl", [{ type: "user", uuid: "f0", timestamp: T(0) }, ...shared]);
    const original = write("b-orig.jsonl", [{ type: "user", uuid: "o0", timestamp: T(-5) }, ...shared]);
    const { sessions, parse } = await collectSessionFiles([fork, original]);
    expect(sessions.map((s) => s.file)).toEqual([original, fork]);
    expect(sessions[0]!.messages).toHaveLength(1);
    expect(sessions[0]!.compactions).toHaveLength(1);
    expect(sessions[1]!.messages).toHaveLength(0);
    expect(sessions[1]!.compactions).toHaveLength(0);
    expect(parse.dup_records).toBe(2);
  });

  it("counts non-object JSON lines as bad and skips blank lines without counting them", async () => {
    const f = write("s.jsonl", ["null", "[1,2]", "42", '"str"', "", "   ", assistant("a1", T(1), "m1", USAGE)]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(parse.bad_lines).toBe(4);
    expect(sessions[0]!.messages).toHaveLength(1);
  });

  it("ignores usage outside assistant records and on null messages; reads null fields as 0, not bad", async () => {
    const f = write("s.jsonl", [
      { type: "user", uuid: "u1", timestamp: T(1), message: { id: "mu", usage: USAGE } },
      { type: "assistant", uuid: "a0", timestamp: T(1), message: null },
      { type: "assistant", uuid: "a1", timestamp: T(1), message: { id: "mn", usage: null } },
      assistant("a2", T(2), "m2", { input_tokens: null, cache_creation_input_tokens: 7, cache_read_input_tokens: 3 }),
    ]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.messages).toEqual([[Date.parse(T(2)), 10]]);
    expect(sessions[0]!.naive.usage_records).toBe(1);
    expect(sessions[0]!.recordTimes).toHaveLength(4);
    expect(parse.bad_records).toBe(0);
  });

  it("counts every usage record that has no message id, requestId or uuid", async () => {
    const bare = { type: "assistant", timestamp: T(1), message: { usage: USAGE } };
    const f = write("s.jsonl", [bare, bare]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.messages).toHaveLength(2);
    expect(parse.dup_records).toBe(0);
  });

  it("counts a compact_boundary with a missing or unparseable timestamp as bad", async () => {
    const f = write("s.jsonl", [
      { type: "system", subtype: "compact_boundary", uuid: "c1" },
      { type: "system", subtype: "compact_boundary", uuid: "c2", timestamp: "not-a-date" },
      assistant("a1", "2026-13-45T99:00:00Z", "m1", USAGE),
      { type: "user", uuid: "u1", timestamp: "garbage" },
    ]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.compactions).toEqual([]);
    expect(sessions[0]!.messages).toEqual([]);
    expect(sessions[0]!.recordTimes).toEqual([]);
    expect(sessions[0]!.naive).toEqual({ usage_records: 1, compact_records: 2 });
    expect(parse.bad_records).toBe(3);
  });

  it("counts a missing file as a bad file and still parses the rest", async () => {
    const f = write("s.jsonl", [assistant("a1", T(1), "m1", USAGE)]);
    const { sessions, parse } = await collectSessionFiles([join(dir, "gone.jsonl"), f]);
    expect(parse.bad_files).toBe(1);
    expect(sessions.map((s) => s.file)).toEqual([f]);
  });

  it("gives a fork that copies the original from its first record to the file created first", async () => {
    const shared = [assistant("a1", T(1), "m1", USAGE), compact("c1", T(2))];
    // Same first record, so the first timestamps tie. The original is created first but sorts
    // last by name, as random session ids do.
    const original = write("z-orig.jsonl", [...shared, compact("c2", T(3))]);
    await new Promise((r) => setTimeout(r, 20));
    const fork = write("a-fork.jsonl", shared);
    const noTs = write("0-nots.jsonl", [{ type: "custom-title", uuid: "x0" }]);
    const hasBirthtime = statSync(original).birthtimeMs > 0 && statSync(fork).birthtimeMs > statSync(original).birthtimeMs;
    const { sessions } = await collectSessionFiles([noTs, fork, original]);
    // Without creation times the path decides, and the fork would win.
    const [owner, other] = hasBirthtime ? [original, fork] : [fork, original];
    expect(sessions.map((s) => s.file)).toEqual([owner, other, noTs]);
    expect(sessions[0]!.messages).toHaveLength(1);
    expect(sessions[1]!.messages).toHaveLength(0);
    if (hasBirthtime) expect(sessions[0]!.compactions).toHaveLength(2);
  });

  it("breaks a first-timestamp tie by sessionId before creation time: the copy names the original", async () => {
    // The copy is created first here, so creation time alone would pick it.
    const first = { ...assistant("a1", T(1), "m1", USAGE), sessionId: "orig" };
    const copy = write("copy.jsonl", [first]);
    await new Promise((r) => setTimeout(r, 20));
    const original = write("orig.jsonl", [first, compact("c1", T(2))]);
    const { sessions } = await collectSessionFiles([copy, original]);
    expect(sessions.map((s) => s.file)).toEqual([original, copy]);
    expect(sessions[0]!.messages).toHaveLength(1);
  });

  it("skips synthetic assistant records: all-zero usage from an API error is not a call", async () => {
    const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
    const f = write("s.jsonl", [
      { type: "assistant", uuid: "a1", timestamp: T(1), message: { id: "s1", model: "<synthetic>", usage: zero } },
      { type: "assistant", uuid: "a2", timestamp: T(2), isApiErrorMessage: true, message: { id: "s2", usage: zero } },
      assistant("a3", T(3), "m3", USAGE),
    ]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.messages).toEqual([[Date.parse(T(3)), 543]]);
    expect(sessions[0]!.recordTimes).toHaveLength(3);
    expect(sessions[0]!.naive.usage_records).toBe(1);
    expect(parse.bad_records).toBe(0);
  });

  it("skips a torn last line without counting it: a live session may be mid-write", async () => {
    const f = join(dir, "live.jsonl");
    writeFileSync(f, JSON.stringify(assistant("a1", T(1), "m1", USAGE)) + "\n" + '{"type":"assistant","uuid":"a2","timest');
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.messages).toHaveLength(1);
    expect(parse.bad_lines).toBe(0);
    // Untouched for over an hour, the same torn line is corruption, not a write in progress.
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(f, old, old);
    expect((await collectSessionFiles([f])).parse.bad_lines).toBe(1);
  });

  it("counts a negative context field as bad and leaves it out of the context size", async () => {
    const f = write("s.jsonl", [assistant("a1", T(1), "m1", { input_tokens: -5, cache_read_input_tokens: 100 })]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.messages).toEqual([[Date.parse(T(1)), 100]]);
    expect(parse.bad_records).toBe(1);
  });

  it("rejects timestamps Date.parse would bend: an impossible date or no zone is a bad record", async () => {
    const f = write("s.jsonl", [
      assistant("a1", "2026-02-30T10:00:00.000Z", "m1", USAGE),
      compact("c1", "2026-08-30T10:00:00"),
      { type: "user", uuid: "u1", timestamp: "2026-02-30T10:00:00Z" }, // unused record: not counted
      assistant("a2", T(1), "m2", USAGE),
    ]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.recordTimes).toEqual([Date.parse(T(1))]);
    expect(sessions[0]!.compactions).toEqual([]);
    expect(parse.bad_records).toBe(2);
  });

  it("counts a usage or compaction record with no uuid as bad: it cannot be deduped", async () => {
    const { uuid: _u, ...noUuid } = compact("c1", T(2));
    const f = write("s.jsonl", [noUuid, noUuid, assistant("a1", T(1), "m1", USAGE)]);
    const { sessions, parse } = await collectSessionFiles([f]);
    expect(sessions[0]!.compactions).toHaveLength(2);
    expect(parse.bad_records).toBe(2);
  });

  it("counts a usage object with none of the context fields as bad: a renamed field, not a zero", async () => {
    const f = write("s.jsonl", [assistant("a1", T(1), "m1", { inputTokens: 5, cacheReadInputTokens: 100 })]);
    const { sessions, parse } = await collectSessionFiles([f]);
    // Counted as drift, and kept out of the peaks: 0 would drag the median down.
    expect(sessions[0]!.messages).toEqual([]);
    expect(parse.bad_records).toBe(1);
  });
});

describe("collectSessions", () => {
  it("reads top-level transcripts only, never subagents/", async () => {
    write("proj/s.jsonl", [assistant("a1", T(1), "m1", USAGE)]);
    write("proj/s/subagents/agent-1.jsonl", [assistant("x1", T(1), "mx", USAGE)]);
    const { sessions } = await collectSessions(dir, 0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.file).toBe(join(dir, "proj", "s.jsonl"));
  });

  it("skips files last modified before sinceMs", async () => {
    write("proj/s.jsonl", [assistant("a1", T(1), "m1", USAGE)]);
    const { sessions } = await collectSessions(dir, Date.now() + 60_000);
    expect(sessions).toEqual([]);
  });

  it("ignores stray files at the projects root and non-.jsonl files in a project", async () => {
    write("stray.jsonl", [assistant("z1", T(1), "mz", USAGE)]);
    write("proj/notes.txt", ["hello"]);
    write("proj/s.jsonl", [assistant("a1", T(1), "m1", USAGE)]);
    mkdirSync(join(dir, "proj", "dir.jsonl"));
    const { sessions, parse } = await collectSessions(dir, 0);
    expect(sessions.map((s) => s.file)).toEqual([join(dir, "proj", "s.jsonl")]);
    expect(parse.bad_files).toBe(0);
  });

  it.skipIf(process.getuid?.() === 0)("counts an unreadable project dir as a bad file and reads the others", async () => {
    write("ok/s.jsonl", [assistant("a1", T(1), "m1", USAGE)]);
    write("locked/s.jsonl", [assistant("b1", T(1), "mb", USAGE)]);
    chmodSync(join(dir, "locked"), 0o000);
    try {
      const { sessions, parse } = await collectSessions(dir, 0);
      expect(parse.bad_files).toBe(1);
      expect(sessions.map((s) => s.file)).toEqual([join(dir, "ok", "s.jsonl")]);
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
    }
  });
});
