// Process and flag helpers shared by `loops zone` and `loops env-check`. Commands that spawn
// (git, tool version probes, local checks) go through the injected Runner, like RunGh in repos.ts.
import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Bad usage, bad config or an unreadable repo: the CLI prints it to stderr and exits 2. */
export class UsageError extends Error {}

export interface RunOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}
export interface RunResult {
  /** null when the process could not start or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
export type Runner = (cmd: string, args: string[], opts?: RunOpts) => RunResult;

export const run: Runner = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut };
};

/** Everything a subcommand touches outside its own logic, injected so tests need no real process state. */
export interface Deps {
  run: Runner;
  cwd: string;
  env: NodeJS.ProcessEnv;
  readStdin: () => string;
  out: (s: string) => void;
  err: (s: string) => void;
}

/** stdout of a successful git command, else null. */
export function git(r: Runner, cwd: string, args: string[]): string | null {
  const res = r("git", args, { cwd });
  return res.code === 0 ? res.stdout : null;
}

/** The repo's top-level dir, or null outside a git repo. */
export function repoRoot(r: Runner, cwd: string): string | null {
  return git(r, cwd, ["rev-parse", "--show-toplevel"])?.trim() || null;
}

export function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** First executable `name` on `pathVar`, or null. */
export function which(name: string, pathVar: string | undefined): string | null {
  for (const dir of (pathVar ?? "").split(delimiter)) {
    if (dir && isExecutable(join(dir, name))) return join(dir, name);
  }
  return null;
}

type Flags = Record<string, boolean | string | string[]>;

/**
 * Tiny flag parser. `--x` and `-z` set bool flags; `--x v` / `--x=v` set value flags; list flags
 * take every following arg up to the next flag (or everything after `--`). Anything else is a
 * UsageError.
 */
export function parseFlags(argv: string[], spec: { bool?: string[]; value?: string[]; list?: string[] }): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--?([A-Za-z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!m) throw new UsageError(`unexpected argument ${arg}`);
    const [, name = "", inline] = m;
    if (spec.bool?.includes(name) && inline === undefined) out[name] = true;
    else if (spec.value?.includes(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`--${name} needs a value`);
      out[name] = v;
    } else if (spec.list?.includes(name) && inline === undefined) {
      const items: string[] = [];
      while (i + 1 < argv.length) {
        const next = argv[i + 1]!;
        if (next === "--") {
          items.push(...argv.slice(i + 2));
          i = argv.length;
        } else if (next.startsWith("-") && next !== "-") break;
        else {
          items.push(next);
          i++;
        }
      }
      out[name] = items;
    } else throw new UsageError(`unknown flag ${arg}`);
  }
  return out;
}
