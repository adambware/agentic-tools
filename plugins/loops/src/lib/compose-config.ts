// The one place loops talks to Compose: it asks `docker compose config` for the project name and
// classifies the outcome as name / error / unavailable. The policy (what to do with each) lives in env-checks.ts.
import type { Runner } from "./proc.js";

/** What `docker compose config` says the project name is, or why it could not say. */
export type ComposeName = { name: string } | { error: string } | { unavailable: string };

export interface ComposeNameOpts {
  /** Checkout root: Compose's cwd. */
  root: string;
  /** Configured `[compose] files`, relative to root, passed as `-f` in order. Omit/empty = plain `docker compose` (Compose's own discovery). */
  files?: string[];
  /** The environment Compose runs with, passed through as is (the caller decides the shape). */
  env: NodeJS.ProcessEnv;
  run: Runner;
}

// Same value as PROBE_TIMEOUT_MS in env-checks.ts.
export const COMPOSE_CONFIG_TIMEOUT_MS = 10_000;

// Docker prints one of these when the compose plugin is missing (the binary exists, exit 1).
const PLUGIN_MISSING = /unknown command: docker compose|'compose' is not a docker command|is not a docker command/i;
// A Compose older than --no-env-resolution rejects the flag: it cannot answer, which is not the file's fault.
const TOO_OLD = /unknown flag:? --no-env-resolution/;
// Compose's own warnings come first on stderr and are not the failure.
const WARNING_LINE = /^time=.* level=warning/;
// Plain `docker compose` (no -f) found no compose file in the cwd or above it. The corpus pins this wording.
const NO_FILE = /^no configuration file provided\b/;

/** True for a Runner call that is a `composeName` probe (for test stubs). */
export function isComposeConfigCall(cmd: string, args: string[]): boolean {
  return cmd === "docker" && args[0] === "compose" && args.includes("config");
}

/** True when the answer is Compose saying it found no compose file: a plain run there runs nothing, so there is no name to collide with. */
export function isNoFile(r: ComposeName): boolean {
  return "error" in r && NO_FILE.test(r.error);
}

export function composeName(o: ComposeNameOpts): ComposeName {
  // --no-env-resolution drops only the missing-env_file failure, which is not about the name. No -p, no
  // --no-interpolate (it changes the name), no -q (it prints nothing).
  const fileArgs = (o.files ?? []).flatMap((f) => ["-f", f]);
  const args = ["compose", ...fileArgs, "config", "--no-env-resolution", "--format", "json"];
  const r = o.run("docker", args, { cwd: o.root, env: o.env, timeoutMs: COMPOSE_CONFIG_TIMEOUT_MS });
  // A timed-out process also has code null, so this check comes first.
  if (r.timedOut) return { error: `docker compose config timed out after ${COMPOSE_CONFIG_TIMEOUT_MS / 1000}s` };
  if (r.code === null) return { unavailable: "docker is not installed" };
  if (r.code !== 0) {
    if (PLUGIN_MISSING.test(r.stderr)) return { unavailable: "compose plugin is not installed" };
    if (TOO_OLD.test(r.stderr)) return { unavailable: "docker compose is too old (needs config --no-env-resolution)" };
    const line = r.stderr
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !WARNING_LINE.test(l))
      .pop();
    return { error: line ?? `docker compose config exited ${r.code}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { error: "docker compose config printed invalid JSON" };
  }
  const name = (parsed as { name?: unknown } | null)?.name;
  if (typeof name !== "string" || name === "") return { error: "docker compose config printed no project name" };
  return { name };
}
