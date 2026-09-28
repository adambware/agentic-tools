// loop-metrics CLI logic. src/bin/loop-metrics.ts is a thin wrapper around main().
import { appendFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildRow, WIDEST_WINDOW_MS } from "./row.js";
import { collectSessionFiles, collectSessions, emptyCounters } from "./session.js";
import { collectWorkflows } from "./workflow.js";

export const USAGE =
  "usage: loop-metrics [--projects-dir DIR] [--out FILE] [--now ISO] [--dry-run] [--session FILE]\n";

const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** ISO-8601 with a zone and a real calendar time: Date.parse rolls 02-30 and 24:00 over. */
function isIsoWithZone(s: string): boolean {
  const m = ISO_WITH_ZONE.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === h && t.getUTCMinutes() === mi;
}

const VALUE_FLAGS =new Set(["projects-dir", "out", "now", "session"]);
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
    // Date.parse is lenient ("Sep 28" is 2001; a zone-less time is local), so require ISO with a zone.
    now = isIsoWithZone(args.now) ? Date.parse(args.now) : NaN;
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
      mkdirSync(dirname(out), { recursive: true });
      // One O_APPEND write: the whole line or nothing.
      appendFileSync(out, line);
    } catch (e) {
      io.stderr(`error: cannot append to --out ${out}: ${(e as Error).message}\n`);
      return 1;
    }
  }
  io.stdout(line);
  return 0;
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
