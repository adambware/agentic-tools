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
import { collectReviews, type LensCollection } from "./lens.js";
import { buildRow, WIDEST_WINDOW_MS } from "./row.js";
import { collectSessionFiles, collectSessions, emptyCounters } from "./session.js";
import { parseIso } from "./time.js";
import { collectWorkflows } from "./workflow.js";

export const USAGE =
  "usage: loop-metrics [--projects-dir DIR] [--gstack-dir DIR] [--out FILE] [--now ISO] [--dry-run] [--session FILE]\n";

const VALUE_FLAGS = new Set(["projects-dir", "gstack-dir", "out", "now", "session"]);
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

  // No gstack install (the default dir is missing) gives `lenses: null`, not zeros. Any other
  // failure, or a missing dir that was asked for by name, is a wrong path: refuse.
  const gstackDir = args["gstack-dir"] ?? join(homedir(), ".gstack", "projects");
  let readLenses = true;
  try {
    if (!statSync(gstackDir).isDirectory()) throw new Error("not a directory");
    readdirSync(gstackDir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (args["gstack-dir"] !== undefined || code !== "ENOENT") {
      io.stderr(`error: cannot read --gstack-dir ${gstackDir}: ${(e as Error).message}\n`);
      return 1;
    }
    readLenses = false;
  }

  const since = now - WIDEST_WINDOW_MS;
  let line: string;
  try {
    const { sessions, parse } = await collectSessions(projectsDir, since);
    const runs = collectWorkflows(projectsDir, since, parse);
    let lenses: LensCollection | null = null;
    try {
      if (readLenses) lenses = collectReviews(gstackDir, since);
    } catch (e) {
      io.stderr(`error: cannot read --gstack-dir ${gstackDir}: ${(e as Error).message}\n`);
      return 1;
    }
    line = JSON.stringify(buildRow(sessions, runs, parse, now, lenses)) + "\n";
  } catch (e) {
    // The pre-check above passed, so the dir changed under us: still no row for a quiet week.
    io.stderr(`error: cannot read --projects-dir ${projectsDir}: ${(e as Error).message}\n`);
    return 1;
  }

  if (args["dry-run"] === undefined) {
    try {
      appendRow(out, line);
    } catch (e) {
      // After a failed sync the row is in the file: "cannot append" would invite a rerun that
      // records the week twice.
      if (!(e instanceof NotDurableError)) {
        io.stderr(`error: cannot append to --out ${out}: ${(e as Error).message}\n`);
        return 1;
      }
      // Print the row anyway, so the log keeps a copy to check the file against.
      io.stdout(line);
      io.stderr(`error: --out ${out}: ${e.message}\n`);
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
 * reported, since this file is the only history; so is the file's directory entry, every run (an
 * earlier run may have created the file and died before syncing it), and the entry of every
 * directory this run made for it, or a crash could lose them along with the row.
 */
function appendRow(out: string, line: string): void {
  const madeDir = mkdirSync(dirname(out), { recursive: true });
  const fd = openSync(out, "a+");
  let synced = false;
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    const torn = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
    const data = Buffer.from((torn ? "\n" : "") + line);
    let written = 0;
    try {
      written = writeSync(fd, data);
    } finally {
      // A failing fstat/truncate here must not mask the write error that brought us here.
      try {
        if (written !== data.length && fstatSync(fd).size === size + written) ftruncateSync(fd, size);
      } catch {
        if (written === data.length) throw new Error("write succeeded but its length could not be confirmed");
      }
    }
    if (written !== data.length) throw new Error(`short write (${written} of ${data.length} bytes)`);
    durably(() => fsyncSync(fd));
    synced = true;
  } finally {
    // A failing close must not mask the error in flight (a not-durable row must not read as
    // "cannot append"); after a synced row it means the row is in the file but unconfirmed.
    try {
      closeSync(fd);
    } catch (e) {
      if (synced) durably(() => { throw e; });
    }
  }
  // From the file's dir up to the parent of the first dir mkdir made: each holds an entry this run
  // (or an earlier one that died) may have added. Dirs an earlier run made above the file's own are
  // not revisited.
  const top = madeDir === undefined ? dirname(out) : dirname(madeDir);
  durably(() => {
    for (let dir = dirname(out); ; dir = dirname(dir)) {
      syncDir(dir);
      if (dir === top || dir === dirname(dir)) break;
    }
  });
}

/** Errors meaning this filesystem (or this dir's permissions) cannot sync a directory at all. */
const NO_DIR_SYNC = new Set(["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EACCES"]);

/** Sync one directory's entries. Best effort where directories cannot be synced (some network and
 * FUSE mounts, Windows, an unlistable dir): failing every run there would invite reruns that
 * record a week twice. A real I/O error still throws. */
function syncDir(dir: string): void {
  let dirFd: number;
  try {
    dirFd = openSync(dir, "r");
  } catch (e) {
    if (NO_DIR_SYNC.has((e as NodeJS.ErrnoException).code ?? "")) return;
    throw e;
  }
  try {
    fsyncSync(dirFd);
  } catch (e) {
    if (!NO_DIR_SYNC.has((e as NodeJS.ErrnoException).code ?? "")) throw e;
  } finally {
    closeSync(dirFd);
  }
}

/** The row was written but a sync failed, so it may not be on disk (or survive a crash). */
class NotDurableError extends Error {}

function durably(sync: () => void): void {
  try {
    sync();
  } catch (e) {
    throw new NotDurableError(`row written but may not be on disk: ${(e as Error).message}`);
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
