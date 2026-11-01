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

// Docker prints one of these lines when the compose plugin is missing (the binary exists, exit 1). Anchored to the
// start of Docker's own line, so Compose echoing a file's text cannot pass for it.
const PLUGIN_MISSING = /^docker: (?:unknown command: docker compose|'compose' is not a docker command)/m;
// A Compose older than --no-env-resolution rejects the flag. It still runs stacks, so this is an error, not "unavailable".
const TOO_OLD = /^(?:docker: )?unknown flag:? --no-env-resolution\b/m;
const TOO_OLD_ERROR = "docker compose is too old (needs config --no-env-resolution)";
// Not secrets: paths that read better as they are, and Compose's own settings, which its errors name on purpose.
const PLAIN_VARS = new Set(["PATH", "HOME", "PWD", "OLDPWD", "TMPDIR", "SHELL", "USER", "LOGNAME", "DOCKER_CONFIG", "DOCKER_HOST", "DOCKER_CONTEXT"]);
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

/** True when the answer is a Compose too old to answer: the fix is to upgrade it, not to touch the file. */
export function isTooOld(r: ComposeName): boolean {
  return "error" in r && r.error === TOO_OLD_ERROR;
}

/** Compose may echo an interpolated value (a password in a bad port, say): any env value of 8+ characters shows as ${NAME}. */
function redact(line: string, env: NodeJS.ProcessEnv): string {
  const secrets = Object.entries(env)
    .filter((e): e is [string, string] => !PLAIN_VARS.has(e[0]) && !e[0].startsWith("COMPOSE_") && (e[1]?.length ?? 0) >= 8)
    .sort((a, b) => b[1].length - a[1].length);
  return secrets.reduce((l, [k, v]) => l.split(v).join(`\${${k}}`), line);
}

export function composeName(o: ComposeNameOpts): ComposeName {
  // --no-env-resolution drops only the missing-env_file failure, which is not about the name. No -p, no
  // --no-interpolate (it changes the name), no -q (it prints nothing).
  const fileArgs = (o.files ?? []).flatMap((f) => ["-f", f]);
  const args = ["compose", ...fileArgs, "config", "--no-env-resolution", "--format", "json"];
  const r = o.run("docker", args, { cwd: o.root, env: o.env, timeoutMs: COMPOSE_CONFIG_TIMEOUT_MS });
  // A timed-out process also has code null, so this check comes first.
  if (r.timedOut) return { error: `docker compose config timed out after ${COMPOSE_CONFIG_TIMEOUT_MS / 1000}s` };
  // Only a docker that is not there is "unavailable"; one killed by a signal or by its output overflowing is an error.
  if (r.code === null) return r.notFound ? { unavailable: "docker is not installed" } : { error: `docker compose config was killed (${r.abend ?? "no exit code"})` };
  if (r.code !== 0) {
    if (PLUGIN_MISSING.test(r.stderr)) return { unavailable: "compose plugin is not installed" };
    if (TOO_OLD.test(r.stderr)) return { error: TOO_OLD_ERROR };
    const line = r.stderr
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !WARNING_LINE.test(l))
      .pop();
    return { error: line ? redact(line, o.env) : `docker compose config exited ${r.code}` };
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
