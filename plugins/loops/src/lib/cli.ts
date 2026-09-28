// loop-metrics CLI logic. src/bin/loop-metrics.ts is a thin wrapper around main().
import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildRow, WIDEST_WINDOW_MS } from "./row.js";
import { collectSessionFiles, collectSessions, emptyCounters } from "./session.js";
import { parseIso } from "./time.js";
import { collectWorkflows } from "./workflow.js";

export const USAGE =
  "usage: loop-metrics [--projects-dir DIR] [--out FILE] [--now ISO] [--dry-run] [--session FILE]\n";

const VALUE_FLAGS = new Set(["projects-dir", "out", "now", "session"]);
const BARE_FLAGS = new Set(["dry-run", "help"]);

/**
 * Strict flag parser. A value flag needs a value (a bare `--out` must not append to a file
 * named "true"), and a bare flag never takes one (`--dry-run extra` rejects `extra`).
 */
function parseCli(argv: string[]): { args: Record<string, string> } | { error: string } {
  const args: Record<string, string> = {};
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const key = a.startsWith("--") ? a.slice(2) : undefined;
    if (key !== undefined && BARE_FLAGS.has(key)) {
      args[key] = "true";
    } else if (key !== undefined && VALUE_FLAGS.has(key)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return { error: `error: ${a} needs a value\n${USAGE}` };
      args[key] = next;
      i++;
    } else {
      unknown.push(a);
    }
  }
  if (unknown.length > 0) return { error: `error: unknown argument ${unknown.join(" ")}\n${USAGE}` };
  return { args };
}

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

const processIo: Io = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

/** Returns the exit code. */
export async function main(argv: string[], io: Io = processIo): Promise<number> {
  if (argv.includes("--help")) {
    io.stdout(USAGE);
    return 0;
  }
  const parsed = parseCli(argv);
  if ("error" in parsed) {
    io.stderr(parsed.error);
    return 2;
  }
  const { args } = parsed;

  let now = Date.now();
  if (args.now !== undefined) {
    now = parseIso(args.now) ?? NaN;
    if (!Number.isFinite(now)) {
      io.stderr(`error: --now is not an ISO timestamp: ${args.now}\n`);
      return 2;
    }
  }

  if (args.session !== undefined) return sessionReport(args.session, io);

  const projectsDir = args["projects-dir"] ?? join(homedir(), ".claude", "projects");
  const out = args.out ?? join(homedir(), ".claude", "metrics", "loops.jsonl");

  // A wrong path must not record a quiet week: refuse rather than write a zero row.
  try {
    if (!statSync(projectsDir).isDirectory()) throw new Error("not a directory");
    readdirSync(projectsDir);
  } catch (e) {
    io.stderr(`error: cannot read --projects-dir ${projectsDir}: ${(e as Error).message}\n`);
    return 1;
  }

  const since = now - WIDEST_WINDOW_MS;
  const { sessions, parse } = await collectSessions(projectsDir, since);
  const runs = collectWorkflows(projectsDir, since, parse);
  const line = JSON.stringify(buildRow(sessions, runs, parse, now)) + "\n";

  if (args["dry-run"] === undefined) {
    try {
      appendRow(out, line);
    } catch (e) {
      io.stderr(`error: cannot append to --out ${out}: ${(e as Error).message}\n`);
      return 1;
    }
  }
  io.stdout(line);
  return 0;
}

/**
 * Append one row to the history. A file whose last byte is not "\n" (a torn write, a hand edit)
 * gets one first, so the row never glues onto it. A failed or short write is truncated back, so it
 * cannot tear next week's row either, but only while the file still ends where this write left
 * it: another run's row appended since then is never cut. The row is synced before success is
 * reported, since this file is the only history.
 */
function appendRow(out: string, line: string): void {
  mkdirSync(dirname(out), { recursive: true });
  const fd = openSync(out, "a+");
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    const torn = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
    const data = Buffer.from((torn ? "\n" : "") + line);
    let written = 0;
    try {
      written = writeSync(fd, data);
    } finally {
      if (written !== data.length && fstatSync(fd).size === size + written) ftruncateSync(fd, size);
    }
    if (written !== data.length) throw new Error(`short write (${written} of ${data.length} bytes)`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Stats for one transcript, deduped and naive side by side (manual validation). */
async function sessionReport(file: string, io: Io): Promise<number> {
  try {
    if (!statSync(file).isFile()) throw new Error("not a file");
  } catch (e) {
    io.stderr(`error: cannot read --session ${file}: ${(e as Error).message}\n`);
    return 1;
  }
  const { sessions, parse } = await collectSessionFiles([file], emptyCounters());
  const s = sessions[0];
  if (!s) {
    io.stderr(`error: cannot read --session ${file}\n`);
    return 1;
  }
  const peak = s.messages.reduce((m, [, c]) => (c > m ? c : m), -1);
  const report = {
    file,
    deduped: {
      records: s.recordTimes.length,
      messages: s.messages.length,
      compactions: s.compactions.length,
      context_peak: peak < 0 ? null : peak,
    },
    naive: {
      usage_records: s.naive.usage_records,
      compactions: s.naive.compact_records,
    },
    parse,
  };
  io.stdout(JSON.stringify(report, null, 2) + "\n");
  return 0;
}
