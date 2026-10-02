// bin/validate — load a file and validate each record against a named schema.
// Exits 0 on success, 1 on validation failure (workflow aborts), 2 on usage/IO
// error. Thin argv shell over lib/validate-cli (zero decision logic here).
//
// Usage:
//   node bin/validate.mjs --schema <name> --file <path> [--format json|yaml|jsonl]
import { parseArgs, requireArg } from "../lib/args.js";
import { runValidate } from "../lib/validate-cli.js";
import { SCHEMA_NAMES } from "../lib/validate.js";
import type { SchemaName } from "../lib/validate.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const schema = requireArg(args, "schema");
  const filePath = requireArg(args, "file");

  if (!(SCHEMA_NAMES as string[]).includes(schema)) {
    process.stderr.write(
      `validate: unknown schema '${schema}' (expected: ${SCHEMA_NAMES.join("|")})\n`,
    );
    process.exit(2);
  }

  const format = args.format as "json" | "yaml" | "jsonl" | undefined;

  try {
    const res = runValidate({ schema: schema as SchemaName, filePath, format });
    if (res.ok) {
      process.stderr.write(`validate: OK ${res.count} record(s) [${schema}]\n`);
      process.exit(0);
    } else {
      for (const err of res.errors) {
        process.stderr.write(`validate: ${err}\n`);
      }
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`validate: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
