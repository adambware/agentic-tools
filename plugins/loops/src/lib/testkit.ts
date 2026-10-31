// Test helpers: synthetic tmp git repos and worktrees, PATH shims, and injected Deps.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run, type Deps } from "./proc.js";

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

/** A git repo on branch `main` with `files` committed (a name ending in `*` is executable). */
export function repo(files: Record<string, string> = { "README.md": "x\n" }): string {
  const root = join(tmp(), "app-node");
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
