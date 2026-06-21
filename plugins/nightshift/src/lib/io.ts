// Deterministic, crash-safe file I/O for the stateful path (E6).
// Every write is atomic: write a temp file, fsync it, atomic-rename over the
// target. A jsonl append is a single fully-formed line appended with O_APPEND.
// A killed process therefore never leaves a half-written record.
import {
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  readFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";

/** Atomic write: temp + fsync + rename. Never leaves a partial target file. */
export function atomicWrite(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // Same directory so rename(2) is atomic (same filesystem). pid-free name keeps
  // builds reproducible; a stray temp from a crash is harmless and overwritten.
  const tmp = join(dirname(path), `.${basename(path)}.tmp`);
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/** Append one NDJSON line atomically (O_APPEND single write = whole line or nothing). */
export function appendJsonl(path: string, record: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n");
}

/** Read an NDJSON file into records. Missing file -> []. Blank lines skipped. */
export function readJsonl<T = unknown>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

/** Parse a YAML file. Missing file -> undefined. Throws on malformed YAML. */
export function readYaml<T = unknown>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return parseYaml(readFileSync(path, "utf8")) as T;
}

/** Parse a JSON file. Missing file -> undefined. */
export function readJson<T = unknown>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  atomicWrite(path, JSON.stringify(value, null, 2) + "\n");
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}
