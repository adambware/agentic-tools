// Session transcript parsing: ~/.claude/projects/<project>/*.jsonl (top level only;
// <session>/subagents/ transcripts are separate contexts and are excluded).
//
// The rules this parser must not break (docs/wave0-plan.md, "Parser rules"):
//   1. Records are deduped by `uuid` across the whole run. Resumes replay records
//      within a file and forks copy them across files, so files are read in order of
//      their first record's timestamp and the first occurrence wins.
//   2. Usage is deduped by `message.id` (fallback `requestId`, then `uuid`). One API
//      message is written as one record per content block, each with a new uuid and
//      the same `usage`, so uuid dedupe alone still double-counts.
//   3. Only numeric fields and ids are read; message text never is.
//   4. Malformed input is counted, never fatal.
import { createReadStream, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseIso } from "./time.js";

export interface ParseCounters {
  bad_lines: number;
  bad_files: number;
  bad_records: number;
  dup_records: number;
}

export function emptyCounters(): ParseCounters {
  return { bad_lines: 0, bad_files: 0, bad_records: 0, dup_records: 0 };
}

/** One session after dedupe. Times are epoch ms. */
export interface SessionStats {
  file: string;
  /** Timestamp of every unique record that carries a valid one (window membership). */
  recordTimes: number[];
  /** One entry per unique API message: [timestamp, context size]. */
  messages: Array<[number, number]>;
  /** Timestamp of each unique compact_boundary record. */
  compactions: number[];
  /** Undeduped counts, for `--session` validation only. */
  naive: { usage_records: number; compact_records: number };
}

export interface SessionCollection {
  sessions: SessionStats[];
  parse: ParseCounters;
}

/** Top-level session transcripts under every project dir, mtime >= sinceMs. */
export function listSessionFiles(projectsDir: string, sinceMs: number, parse: ParseCounters): string[] {
  const files: string[] = [];
  for (const project of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = join(projectsDir, project.name);
    let entries;
    try {
      entries = readdirSync(projectDir, { withFileTypes: true });
    } catch {
      parse.bad_files++;
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const path = join(projectDir, e.name);
      try {
        if (statSync(path).mtimeMs < sinceMs) continue;
      } catch {
        parse.bad_files++;
        continue;
      }
      files.push(path);
    }
  }
  return files;
}

export async function collectSessions(projectsDir: string, sinceMs: number): Promise<SessionCollection> {
  const parse = emptyCounters();
  const files = listSessionFiles(projectsDir, sinceMs, parse);
  return collectSessionFiles(files, parse);
}

/** Parse the given files with run-wide dedupe. Exported for `--session` and tests. */
export async function collectSessionFiles(
  files: string[],
  parse: ParseCounters = emptyCounters(),
): Promise<SessionCollection> {
  const ordered: Array<{ file: string; first: number; copied: number; born: number }> = [];
  for (const file of files) {
    const head = await firstRecord(file);
    if (head === "unreadable") {
      parse.bad_files++;
      continue;
    }
    let born = 0;
    try {
      born = statSync(file).birthtimeMs;
    } catch {
      // Vanished since it was read: parseFile counts it.
    }
    ordered.push({ file, first: head.ts, copied: head.copied ? 1 : 0, born });
  }
  // The original owns records shared with a fork: earliest first record wins. A fork copies the
  // original from its first record, so the two tie. Then, in order: a file whose first record
  // names another session was copied; the file created first is the original (creation time is
  // 0 where the filesystem lacks it, and a copy or restore resets it); the path decides.
  ordered.sort(
    (a, b) =>
      a.first - b.first ||
      a.copied - b.copied ||
      (a.born > 0 && b.born > 0 ? a.born - b.born : 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );

  const seenUuids = new Set<string>();
  const seenMessages = new Set<string>();
  const sessions: SessionStats[] = [];
  for (const { file } of ordered) {
    const stats = await parseFile(file, seenUuids, seenMessages, parse);
    if (stats) sessions.push(stats);
  }
  return { sessions, parse };
}

/**
 * The first record with a valid timestamp: its time (+Infinity when none) and whether it names
 * a session other than this file's, as a fork's copied records do. "unreadable" on I/O error.
 */
async function firstRecord(file: string): Promise<{ ts: number; copied: boolean } | "unreadable"> {
  try {
    for await (const { text } of readLines(file)) {
      const rec = parseLine(text);
      if (!rec) continue;
      const ts = parseTimestamp(rec.timestamp);
      if (ts === undefined) continue;
      const copied = typeof rec.sessionId === "string" && rec.sessionId !== basename(file, ".jsonl");
      return { ts, copied };
    }
    return { ts: Number.POSITIVE_INFINITY, copied: false };
  } catch {
    return "unreadable";
  }
}

/**
 * Stream a file's lines, split on "\n" only. node:readline also breaks on U+2028/U+2029,
 * which JSON allows unescaped inside strings, so it cuts one record into two bad lines.
 * A trailing "\r" is left in place: JSON.parse treats it as whitespace.
 * The unfinished line is held as a list of chunks and joined once: re-concatenating and
 * re-splitting it per chunk is quadratic on multi-MB lines (inline images, big tool output).
 * A last line with no "\n" is `partial`: a live session may be mid-write.
 */
async function* readLines(file: string): AsyncGenerator<{ text: string; partial: boolean }> {
  const stream = createReadStream(file, { encoding: "utf8" });
  let pending: string[] = [];
  try {
    for await (const chunk of stream) {
      const text = chunk as string;
      let start = 0;
      for (let nl = text.indexOf("\n"); nl !== -1; nl = text.indexOf("\n", start)) {
        pending.push(text.slice(start, nl));
        yield { text: pending.join(""), partial: false };
        pending = [];
        start = nl + 1;
      }
      if (start < text.length) pending.push(text.slice(start));
    }
    if (pending.length > 0) yield { text: pending.join(""), partial: true };
  } finally {
    stream.destroy();
  }
}

async function parseFile(
  file: string,
  seenUuids: Set<string>,
  seenMessages: Set<string>,
  parse: ParseCounters,
): Promise<SessionStats | undefined> {
  const stats: SessionStats = {
    file,
    recordTimes: [],
    messages: [],
    compactions: [],
    naive: { usage_records: 0, compact_records: 0 },
  };
  try {
    for await (const { text, partial } of readLines(file)) {
      if (text.trim() === "") continue;
      const rec = parseLine(text);
      if (!rec) {
        // A torn last line is a record still being written, not drift: next week's run reads it.
        if (!partial) parse.bad_lines++;
        continue;
      }
      const usage = usageOf(rec);
      const compact = rec.type === "system" && rec.subtype === "compact_boundary";
      if (usage) stats.naive.usage_records++;
      if (compact) stats.naive.compact_records++;

      const uuid = typeof rec.uuid === "string" ? rec.uuid : undefined;
      // Every real record has a uuid; without one a replayed record cannot be deduped.
      if (uuid === undefined && (usage || compact)) parse.bad_records++;
      if (uuid !== undefined) {
        if (seenUuids.has(uuid)) {
          parse.dup_records++;
          continue;
        }
        seenUuids.add(uuid);
      }

      const ts = parseTimestamp(rec.timestamp);
      if (ts === undefined) {
        // Records we never use (titles, prompts) may legitimately lack a timestamp.
        if (usage || compact) parse.bad_records++;
        continue;
      }
      stats.recordTimes.push(ts);

      if (compact) stats.compactions.push(ts);
      if (usage) {
        const key = messageKey(rec);
        if (key !== undefined) {
          if (seenMessages.has(key)) continue;
          seenMessages.add(key);
        }
        const { ctx, bad } = contextSize(usage);
        if (bad) parse.bad_records++;
        // No context field at all is a renamed field, not a zero-token call: keep it out of peaks.
        if (ctx !== undefined) stats.messages.push([ts, ctx]);
      }
    }
  } catch {
    parse.bad_files++;
    return undefined;
  }
  return stats;
}

type Rec = Record<string, unknown>;

function parseLine(line: string): Rec | undefined {
  try {
    const v: unknown = JSON.parse(line);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined;
  } catch {
    return undefined;
  }
}

function parseTimestamp(v: unknown): number | undefined {
  return typeof v === "string" ? parseIso(v) : undefined;
}

/** Usage of a real API call. Synthetic records (API errors, interruptions) carry all-zero usage. */
function usageOf(rec: Rec): Rec | undefined {
  if (rec.type !== "assistant" || rec.isApiErrorMessage === true) return undefined;
  const message = rec.message;
  if (message === null || typeof message !== "object") return undefined;
  if ((message as Rec).model === "<synthetic>") return undefined;
  const usage = (message as Rec).usage;
  return usage !== null && typeof usage === "object" ? (usage as Rec) : undefined;
}

function messageKey(rec: Rec): string | undefined {
  const id = (rec.message as Rec).id;
  if (typeof id === "string") return `m:${id}`;
  if (typeof rec.requestId === "string") return `r:${rec.requestId}`;
  if (typeof rec.uuid === "string") return `u:${rec.uuid}`;
  return undefined;
}

const CONTEXT_FIELDS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const;

/**
 * Context size of one API call. Missing fields read as 0; a non-numeric or negative one is 0 and bad.
 * A usage object with none of the three fields is bad too: that is a renamed field, not a
 * zero-token call.
 */
function contextSize(usage: Rec): { ctx: number | undefined; bad: boolean } {
  let ctx = 0;
  let bad = false;
  let present = 0;
  for (const f of CONTEXT_FIELDS) {
    const v = usage[f];
    if (v === undefined || v === null) continue;
    present++;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) ctx += v;
    else bad = true;
  }
  return present === 0 ? { ctx: undefined, bad: true } : { ctx, bad };
}
