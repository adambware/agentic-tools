import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
