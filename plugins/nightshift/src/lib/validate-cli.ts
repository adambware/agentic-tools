// Orchestration for bin/validate: load a file, validate each record against a
// named schema, return ok/errors/count. Pure of process.argv so it is fully
// unit-testable. The CLI shell (src/bin/validate.ts) only parses args.
import { existsSync } from "node:fs";
import { validateArtifact } from "./validate.js";
import type { SchemaName } from "./validate.js";
import { readJson, readJsonl, readYaml } from "./io.js";

export type { SchemaName };

const KNOWN_LIST_KEYS = ["vectors", "flows", "suppressions", "entries"] as const;

type Format = "json" | "yaml" | "jsonl";

function inferFormat(filePath: string): Format {
  if (filePath.endsWith(".jsonl")) return "jsonl";
  if (filePath.endsWith(".yml") || filePath.endsWith(".yaml")) return "yaml";
  return "json";
}

/**
 * Unwrap a single-key object wrapper like {vectors:[...]}, {flows:[...]},
 * {suppressions:[...]}, or {entries:[...]} into the inner array. If the value
 * is not a non-array object with exactly one of those keys, return as-is.
 */
function maybeUnwrap(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return value;
  const key = keys[0];
  if (key === undefined) return value;
  if ((KNOWN_LIST_KEYS as readonly string[]).includes(key)) {
    return obj[key];
  }
  return value;
}

export interface RunValidateOpts {
  schema: SchemaName;
  filePath: string;
  format?: Format;
}

export interface RunValidateResult {
  ok: boolean;
  errors: string[];
  count: number;
}

export function runValidate(opts: RunValidateOpts): RunValidateResult {
  if (!existsSync(opts.filePath)) {
    throw new Error(`file not found: ${opts.filePath}`);
  }

  const format = opts.format ?? inferFormat(opts.filePath);

  let data: unknown;
  if (format === "jsonl") {
    data = readJsonl(opts.filePath);
  } else if (format === "yaml") {
    data = maybeUnwrap(readYaml(opts.filePath));
  } else {
    data = maybeUnwrap(readJson(opts.filePath));
  }

  const count = Array.isArray(data) ? data.length : 1;
  const result = validateArtifact(opts.schema, data);

  return { ok: result.ok, errors: result.errors, count };
}
