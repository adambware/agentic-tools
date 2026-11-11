// `loops` dispatcher: `zone`, `env-check`, `--version`.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { envCheckMain } from "./env-check.js";
import { redactHome, run, UsageError, type Deps } from "./proc.js";
import { escapeCtl } from "./text.js";
import { VERSION } from "./version.js";
import { zoneMain } from "./zone-cli.js";

const USAGE = `loops ${VERSION}
usage: loops <command> [options]
  zone       [--base REF] [--committed] [--paths P... | --stdin [-z]] [--file F] [--json] [--explain]
  env-check  [--static] [--json] [--quiet] [--require-checks[=IDS]] [--compose-project]
  --version`;

export function realDeps(): Deps {
  return {
    run,
    cwd: process.cwd(),
    env: process.env,
    readStdin: () => readFileSync(0, "utf8"),
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
}

/** Exit codes: 0 ok, 1 an env-check FAIL, 2 usage or config error. */
export function main(argv: string[], d: Deps = realDeps()): number {
  const [cmd, ...rest] = argv;
  // Printed as is after the error line: our own text, kept on its own lines.
  let usage: string | undefined;
  try {
    if (cmd === "--version" || cmd === "-V") d.out(`loops ${VERSION}`);
    else if (cmd === "-h" || cmd === "--help") d.out(USAGE);
    else if (cmd === "zone") return zoneMain(rest, d);
    else if (cmd === "env-check") return envCheckMain(rest, d);
    else {
      usage = cmd ? USAGE : USAGE.slice(USAGE.indexOf("\n") + 1);
      throw new UsageError(cmd ? `unknown command ${cmd}` : `loops ${VERSION}`);
    }
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    // The whole line is redacted, then escaped: cmd is the caller's argv, and messages relay paths and git's stderr.
    d.err(escapeCtl(redactHome(`${cmd ?? "loops"}: ${e.message}`, d.env.HOME || homedir())));
    if (usage) d.err(usage);
    return 2;
  }
}
