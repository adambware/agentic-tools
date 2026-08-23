// bin/dashboard — regenerate THE living document: one self-contained local HTML
// file covering every configured repo (v3 A6). Thin argv shell over
// lib/dashboard-cli (zero decision logic here). Exit 0 on success, 2 on
// usage/IO error.
//
// Usage:
//   node bin/dashboard.mjs --config $OPS/config.yml --out $OPS/dashboard.html \
//     [--today YYYY-MM-DD] [--ts <iso>] [--engine-version <v>]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireArg, resolveToday } from "../lib/args.js";
import { runDashboard } from "../lib/dashboard-cli.js";

function defaultEngineVersion(): string {
  // The bundled artifact lives in <plugin>/bin/; package.json sits beside it.
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const today = resolveToday(args);
  const ts = args.ts ?? new Date().toISOString();
  const generatedAt = ts.slice(0, 16).replace("T", " ");
  try {
    const res = runDashboard({
      configPath: requireArg(args, "config"),
      outPath: requireArg(args, "out"),
      today,
      generatedAt,
      engineVersion: args["engine-version"] ?? defaultEngineVersion(),
    });
    process.stderr.write(`dashboard: wrote ${res.outPath}\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`dashboard: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
