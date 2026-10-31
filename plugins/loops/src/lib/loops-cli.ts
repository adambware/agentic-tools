// `loops` dispatcher: `zone`, `env-check`, `--version`.
import { readFileSync } from "node:fs";
import { envCheckMain } from "./env-check.js";
import { run, UsageError, type Deps } from "./proc.js";
import { VERSION } from "./version.js";
import { zoneMain } from "./zone-cli.js";

const USAGE = `loops ${VERSION}
usage: loops <command> [options]
  zone       [--base REF] [--committed] [--paths P... | --stdin [-z]] [--file F] [--json] [--explain]
  env-check  [--static] [--json] [--quiet] [--compose-project]
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
  try {
    if (cmd === "--version" || cmd === "-V") d.out(`loops ${VERSION}`);
    else if (cmd === "-h" || cmd === "--help") d.out(USAGE);
    else if (cmd === "zone") return zoneMain(rest, d);
    else if (cmd === "env-check") return envCheckMain(rest, d);
    else throw new UsageError(cmd ? `unknown command ${cmd}\n${USAGE}` : USAGE);
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    d.err(`${cmd ?? "loops"}: ${e.message}`);
    return 2;
  }
}
