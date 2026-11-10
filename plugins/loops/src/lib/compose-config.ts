// The one place loops talks to Compose: `docker compose version` says whether Compose is there at all, and
// `docker compose config` says what one run's project name is. No result carries Compose's own text (it can echo an
// interpolated secret); a failed probe carries the command to rerun instead, and a required variable's name, which is
// the one piece of Compose's stderr ever read into a result, as `config -q`, which never prints the
// model. Every probe, and every rerun, runs with Compose's remote loaders off. The policy lives in env-checks.ts.
import { shQuote, type RunResult, type Runner } from "./proc.js";

/** Whether Compose can be asked at all: `unavailable` is a SKIP upstream, `error` a FAIL. */
export type ComposeVersion = { version: string } | { unavailable: string } | { error: string };

export type ComposeErrorKind = "timeout" | "abend" | "gone" | "tooOld" | "exit" | "interp" | "json" | "noName";
/** A `docker compose config` probe that failed: how, in loops' words, and where to rerun it to see Compose's own message. */
export interface ComposeError {
  error: string;
  kind: ComposeErrorKind;
  /** The probe with `-q` in place of `--format json` (Compose's error, never the model), shell-quoted (no cd, no env). */
  cmd: string;
  /** The directory it ran from. */
  cwd: string;
  /** The COMPOSE_* names `scrub` removed for this probe; absent when none were. */
  scrubbed?: string[];
  /** kind "interp": the variable a `${VAR:?}` or `${VAR?}` reference requires (only its name, never a value). */
  variable?: string;
}
/** What `docker compose config` says the project name is, that it found no compose file, or why it could not say. */
export type ComposeName = { name: string } | { noFile: true } | ComposeError;

export interface ComposeNameOpts {
  /** Compose's cwd. */
  root: string;
  /** Configured `[compose] files`, relative to root, passed as `-f` in order. Omit/empty = plain `docker compose` (Compose's own discovery). */
  files?: string[];
  /** The environment Compose runs with, passed through as is unless `scrub`. */
  env: NodeJS.ProcessEnv;
  /** Run without every COMPOSE_* in env, as another checkout's shell would. */
  scrub?: boolean;
  run: Runner;
}

/**
 * Set on every probe, over the shell's value and after any scrub: Compose then loads no git or OCI `include` or
 * `extends.file`, whose URL can carry an interpolated secret, and an explicit value beats the checkout's .env.
 * A blocked load is an ordinary exit 1.
 */
export const REMOTE_OFF = { COMPOSE_EXPERIMENTAL_GIT_REMOTE: "0", COMPOSE_EXPERIMENTAL_OCI_REMOTE: "0", GIT_ALLOW_PROTOCOL: "file" };
export const isSwitch = (k: string): boolean => Object.hasOwn(REMOTE_OFF, k);

// Same value as PROBE_TIMEOUT_MS in env-checks.ts.
export const COMPOSE_CONFIG_TIMEOUT_MS = 10_000;

// A Compose older than --no-env-resolution rejects the flag. It still runs stacks, so this is an error, not "unavailable".
// Read from stderr: a spoofed line can only turn a probe into a FAIL, never into a name.
const TOO_OLD = /^(?:docker: )?unknown flag:? --no-env-resolution\b/m;
// Warnings from Compose (`time=… level=warning`) and from the Docker CLI (`WARNING: Error parsing config file …`)
// come before the failure and are not it.
const WARNING_LINES = [/^time=.* level=warning/, /^WARNING: /];
// The Docker CLI without the compose plugin: it rejects `--short` on the `docker compose` stub, or does not know the command.
const NO_PLUGIN = /^(?:docker: )?(?:unknown flag:? --short\b|'compose' is not a docker command|unknown command: docker compose)/m;
// Plain `docker compose` (no -f) found no compose file in the cwd or above it. The corpus pins this wording.
const NO_FILE = "no configuration file provided: not found";
// `${VAR:?msg}` or `${VAR?msg}` with VAR unset (or empty, for `:?`). Compose 5.5 prints one line, `error while
// interpolating <path>: required variable VAR is missing a value[: msg]`, where msg is interpolated and so can hold a
// secret (even a lookalike "required variable <secret> is missing"): only the first match on that line is read, and
// only the name in it.
const REQUIRED = /^(?:error while interpolating [^\n]*?: )?required variable (\w+) is missing a value/;

/** True for a Runner call that is a `composeName` probe (for test stubs). */
export function isComposeConfigCall(cmd: string, args: string[]): boolean {
  return cmd === "docker" && args[0] === "compose" && args.includes("config");
}

/** True for a Runner call that is the `composeVersion` probe (for test stubs). */
export function isComposeVersionCall(cmd: string, args: string[]): boolean {
  return cmd === "docker" && args[0] === "compose" && args[1] === "version";
}

/** The rerun command for a failed probe: `cd <dir> && env [-u NAME …] <REMOTE_OFF> docker compose … config … -q`. */
export function rerun(e: ComposeError): string {
  const unset = (e.scrubbed ?? []).map((n) => `-u ${shQuote(n)}`);
  const off = Object.entries(REMOTE_OFF).map(([k, v]) => `${k}=${v}`);
  return `cd ${shQuote(e.cwd)} && env ${[...unset, ...off].join(" ")} ${e.cmd}`;
}

const seconds = `${COMPOSE_CONFIG_TIMEOUT_MS / 1000}s`;
// A signal, or Node killing the child for overflowing its output, is a kill; any other spawn error (EACCES…) is not.
const abended = (r: RunResult): string =>
  r.abend?.startsWith("SIG") || r.abend === "ENOBUFS" ? `was killed (${r.abend})` : `could not run (${r.abend ?? "no exit code"})`;

/** `docker compose version --short` from `cwd`: docker missing or failing is unavailable; a timeout or an abend is an error. */
export function composeVersion(run: Runner, cwd: string, env?: NodeJS.ProcessEnv): ComposeVersion {
  const r = run("docker", ["compose", "version", "--short"], { cwd, env, timeoutMs: COMPOSE_CONFIG_TIMEOUT_MS });
  if (r.timedOut) return { error: `docker compose version timed out after ${seconds}` };
  if (r.notFound) return { unavailable: "docker is not installed" };
  if (r.code === null) return { error: `docker compose version ${abended(r)}` };
  // A missing compose plugin is docker exiting non-zero (125 for the unknown --short flag) and saying so on stderr;
  // any other non-zero exit is a docker that failed (daemon, config, crash), which is not "no Compose" and must not SKIP.
  if (r.code !== 0) {
    const why = r.stderr.split("\n").filter((l) => !WARNING_LINES.some((w) => w.test(l))).join("\n");
    return NO_PLUGIN.test(why) ? { unavailable: `docker compose version exited ${r.code}` } : { error: `docker compose version exited ${r.code}` };
  }
  return { version: r.stdout.trim() };
}

export function composeName(o: ComposeNameOpts): ComposeName {
  // The switches are overridden, not removed, so they are never named as scrubbed.
  const scrubbed = o.scrub ? Object.keys(o.env).filter((k) => k.startsWith("COMPOSE_") && !isSwitch(k)).sort() : [];
  const kept = o.scrub ? Object.fromEntries(Object.entries(o.env).filter(([k]) => !k.startsWith("COMPOSE_"))) : o.env;
  const env = { ...kept, ...REMOTE_OFF };
  // --no-env-resolution drops only the missing-env_file failure, which is not about the name. No -p, no
  // --no-interpolate (it changes the name), no -q (it prints nothing; the rerun uses it: same error and exit).
  const fileArgs = (o.files ?? []).flatMap((f) => ["-f", f]);
  const args = ["compose", ...fileArgs, "config", "--no-env-resolution", "--format", "json"];
  const r = o.run("docker", args, { cwd: o.root, env, timeoutMs: COMPOSE_CONFIG_TIMEOUT_MS });
  const fail = (kind: ComposeErrorKind, how: string, variable?: string): ComposeError => ({
    error: `docker compose config ${how}`,
    kind,
    cmd: ["docker", "compose", ...fileArgs, "config", "--no-env-resolution", "-q"].map(shQuote).join(" "),
    cwd: o.root,
    ...(scrubbed.length ? { scrubbed } : {}),
    ...(variable ? { variable } : {}),
  });
  // A timed-out process also has code null, so this check comes first.
  if (r.timedOut) return fail("timeout", `timed out after ${seconds}`);
  // composeVersion already found docker, so a spawn ENOENT here is the cwd that is gone.
  if (r.notFound) return fail("gone", "could not start (its directory is gone)");
  if (r.code === null) return fail("abend", abended(r));
  if (r.code !== 0) {
    if (TOO_OLD.test(r.stderr)) return fail("tooOld", "is too old (needs --no-env-resolution)");
    const rest = r.stderr.split("\n").filter((l) => !WARNING_LINES.some((w) => w.test(l))).join("\n").trim();
    if (rest === NO_FILE) return { noFile: true };
    const v = REQUIRED.exec(rest.split("\n")[0]!)?.[1];
    return v ? fail("interp", `exited ${r.code}: required variable ${v} is missing a value`, v) : fail("exit", `exited ${r.code}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return fail("json", "printed invalid JSON");
  }
  const name = (parsed as { name?: unknown } | null)?.name;
  if (typeof name !== "string" || name === "") return fail("noName", "printed no project name");
  return { name };
}
