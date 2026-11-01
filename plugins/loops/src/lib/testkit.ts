// Test helpers: synthetic tmp git repos and worktrees, PATH shims, and injected Deps.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isComposeConfigCall } from "./compose-config.js";
import { run, type Deps, type Runner, type RunResult } from "./proc.js";

export const tmp = (): string => realpathSync(mkdtempSync(join(tmpdir(), "loops-test-")));

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
}

/** Write a file (creating dirs); `exec` sets the 0755 bit. */
export function put(root: string, rel: string, content: string, exec = false): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
  if (exec) chmodSync(join(root, rel), 0o755);
}

/** A git repo on branch `main` in a directory named `dir`, with `files` committed (a name ending in `*` is executable). */
export function repo(files: Record<string, string> = { "README.md": "x\n" }, dir = "app-node"): string {
  const root = join(tmp(), dir);
  mkdirSync(root);
  sh(root, "init", "-q", "-b", "main");
  for (const [f, c] of Object.entries(files)) put(root, f.replace(/\*$/, ""), c, f.endsWith("*"));
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  return root;
}

/** A PATH shim: an executable `name` that runs `body` (sh). Returns the dir to prepend to PATH. */
export function shim(name: string, body: string, dir = tmp()): string {
  put(dir, name, `#!/bin/sh\n${body}\n`, true);
  return dir;
}

export function deps(cwd: string, env: Record<string, string> = {}, stdin = ""): { d: Deps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const d: Deps = {
    run,
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent-home", ...env },
    readStdin: () => stdin,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  return { d, out, err };
}

/** What the stubbed `docker compose config` answers for one checkout: the project name, Compose's error line (`<root>` stands for the checkout path), or why Compose cannot run. */
export type ComposeAnswer = string | { error: string } | { unavailable: "docker" | "plugin" };
/** Answers keyed by checkout root; one answer serves both probe shapes unless the configured (`-f`) and plain probes differ. */
export type ComposeAnswers = Record<string, ComposeAnswer | { cfg?: ComposeAnswer; plain?: ComposeAnswer }>;
export interface ComposeCall {
  cwd: string;
  /** The `-f` files, in order; empty for a plain probe. */
  files: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * A Runner that answers `docker compose config` from `answers` (what real Compose v5.1.2 returned for the fixture),
 * records each probe in `calls`, and hands every other command to `inner`. A root without an answer throws, so a
 * missing fixture is loud instead of a silent FAIL.
 */
export function composeStub(answers: ComposeAnswers, calls: ComposeCall[] = [], inner: Runner = run): Runner {
  const byRoot = new Map(Object.entries(answers).map(([k, v]) => [realpathSync(k), v]));
  const res = (code: number | null, stdout = "", stderr = ""): RunResult => ({ code, stdout, stderr, timedOut: false });
  return (cmd, args, opts) => {
    if (!isComposeConfigCall(cmd, args)) return inner(cmd, args, opts);
    const cwd = opts?.cwd ?? process.cwd();
    const files = args.flatMap((a, i) => (a === "-f" ? [args[i + 1]!] : []));
    calls.push({ cwd, files, env: opts?.env ?? {} });
    const entry = byRoot.get(realpathSync(cwd));
    const shaped = typeof entry === "object" && !("error" in entry) && !("unavailable" in entry);
    const a = shaped ? (files.length ? entry.cfg : entry.plain) : entry;
    if (a === undefined) throw new Error(`composeStub: no answer for ${files.length ? `docker compose -f ${files.join(" -f ")}` : "plain docker compose"} config in ${cwd}`);
    if (typeof a === "string") return res(0, JSON.stringify({ name: a, services: {} }));
    if ("error" in a) return res(1, "", `${a.error.split("<root>").join(cwd)}\n`);
    return a.unavailable === "docker" ? res(null) : res(1, "", "docker: unknown command: docker compose\n\nRun 'docker --help' for more information\n");
  };
}
