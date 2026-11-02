import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeName, composeVersion, isComposeConfigCall, isComposeVersionCall, rerun, type ComposeError, type ComposeErrorKind } from "./compose-config.js";
import { run, type RunResult, type Runner } from "./proc.js";
import { canary } from "./testkit.js";

type Call = { cmd: string; args: string[]; opts: Parameters<Runner>[2] };
const res = (o: Partial<RunResult>): RunResult => ({ code: 0, stdout: "", stderr: "", timedOut: false, ...o });
function stub(r: RunResult) {
  const calls: Call[] = [];
  const run: Runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return r;
  };
  return { run, calls };
}
const json = (v: unknown) => res({ stdout: JSON.stringify(v) });

describe("the real runner's null exit codes", () => {
  // composeVersion reads "unavailable" only from notFound: a docker killed by a signal must not pass for one that is absent.
  it("marks a command that is not there as notFound, and a killed one with its signal", () => {
    expect(run("loops-no-such-command-xyz", [])).toMatchObject({ code: null, notFound: true, timedOut: false });
    expect(run("sh", ["-c", "kill -9 $$"])).toMatchObject({ code: null, notFound: false, abend: "SIGKILL", timedOut: false });
    expect(run("sh", ["-c", "exit 3"])).toMatchObject({ code: 3, notFound: false, abend: undefined });
  });
});

const ERR = { cmd: "docker compose config --no-env-resolution -q", cwd: "/r" };
// Set on every probe: Compose's git and OCI loaders off, and git limited to local repos.
const OFF = { COMPOSE_EXPERIMENTAL_GIT_REMOTE: "0", COMPOSE_EXPERIMENTAL_OCI_REMOTE: "0", GIT_ALLOW_PROTOCOL: "file" };
const OFF_ENV = "COMPOSE_EXPERIMENTAL_GIT_REMOTE=0 COMPOSE_EXPERIMENTAL_OCI_REMOTE=0 GIT_ALLOW_PROTOCOL=file";
const failed = (kind: string, error: string) => ({ error, kind, ...ERR });

describe("composeVersion with a stubbed runner", () => {
  it("asks `docker compose version --short` from the given cwd with the 10s timeout", () => {
    const { run, calls } = stub(res({ stdout: "5.1.2\n" }));
    const env = { PATH: "/bin" };
    expect(composeVersion(run, "/some/root", env)).toEqual({ version: "5.1.2" });
    expect(calls).toEqual([{ cmd: "docker", args: ["compose", "version", "--short"], opts: { cwd: "/some/root", env, timeoutMs: 10_000 } }]);
    expect(isComposeVersionCall(calls[0]!.cmd, calls[0]!.args)).toBe(true);
    expect(isComposeConfigCall(calls[0]!.cmd, calls[0]!.args)).toBe(false);
  });

  it("is unavailable when docker is not there or exits non-zero, and an error on a timeout, a signal or EACCES", () => {
    const v = (o: Partial<RunResult>) => composeVersion(stub(res(o)).run, "/r");
    expect(v({ code: null, notFound: true, abend: "ENOENT" })).toEqual({ unavailable: "docker is not installed" });
    // A missing compose plugin: docker rejects the --short flag. Its stderr is not copied.
    expect(v({ code: 125, stderr: "unknown flag: --short\n" })).toEqual({ unavailable: "docker compose version exited 125" });
    expect(v({ code: 1, stderr: "docker: 'compose' is not a docker command.\n" })).toEqual({ unavailable: "docker compose version exited 1" });
    expect(v({ code: null, timedOut: true, abend: "ETIMEDOUT" })).toEqual({ error: "docker compose version timed out after 10s" });
    expect(v({ code: null, abend: "SIGKILL" })).toEqual({ error: "docker compose version was killed (SIGKILL)" });
    expect(v({ code: null, abend: "EACCES" })).toEqual({ error: "docker compose version could not run (EACCES)" });
  });
});

describe("composeName with a stubbed runner", () => {
  it("asks plain `docker compose config` when no files are configured", () => {
    const { run, calls } = stub(json({ name: "app" }));
    composeName({ root: "/r", env: {}, run });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("docker");
    expect(calls[0]!.args).toEqual(["compose", "config", "--no-env-resolution", "--format", "json"]);
    expect(isComposeConfigCall(calls[0]!.cmd, calls[0]!.args)).toBe(true);
    expect(isComposeVersionCall(calls[0]!.cmd, calls[0]!.args)).toBe(false);
  });

  it("passes configured files as -f in order, before the subcommand", () => {
    const { run, calls } = stub(json({ name: "app" }));
    composeName({ root: "/r", files: ["a.yml", "sub/b.yml"], env: {}, run });
    expect(calls[0]!.args).toEqual([
      "compose", "-f", "a.yml", "-f", "sub/b.yml", "config", "--no-env-resolution", "--format", "json",
    ]);
  });

  it("treats an empty files list as plain", () => {
    const { run, calls } = stub(json({ name: "app" }));
    composeName({ root: "/r", files: [], env: {}, run });
    expect(calls[0]!.args).not.toContain("-f");
  });

  it("never passes -p, --no-interpolate or -q", () => {
    const { run, calls } = stub(json({ name: "app" }));
    composeName({ root: "/r", files: ["a.yml"], env: {}, run });
    for (const bad of ["-p", "--project-name", "--no-interpolate", "-q", "--quiet"]) expect(calls[0]!.args).not.toContain(bad);
  });

  it("passes cwd, env and the 10s timeout through as given, plus the remote loaders off", () => {
    const env = { PATH: "/bin", COMPOSE_FILE: "x.yml" };
    const { run, calls } = stub(json({ name: "app" }));
    composeName({ root: "/some/root", env, run });
    expect(calls[0]!.opts).toEqual({ cwd: "/some/root", env: { ...env, ...OFF }, timeoutMs: 10_000 });
    expect(env).toEqual({ PATH: "/bin", COMPOSE_FILE: "x.yml" });
  });

  it("turns the remote loaders off on every probe, as is and scrubbed, over the shell's own values, and never lists them as scrubbed", () => {
    const env = { PATH: "/bin", COMPOSE_FILE: "x.yml", COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1", COMPOSE_EXPERIMENTAL_OCI_REMOTE: "true", GIT_ALLOW_PROTOCOL: "file:https:ssh" };
    for (const scrub of [false, true]) {
      const { run, calls } = stub(res({ code: 1 }));
      const out = composeName({ root: "/r", env, scrub, run }) as ComposeError;
      expect(calls[0]!.opts!.env).toEqual({ PATH: "/bin", ...(scrub ? {} : { COMPOSE_FILE: "x.yml" }), ...OFF });
      expect(out.scrubbed).toEqual(scrub ? ["COMPOSE_FILE"] : undefined);
    }
    // A shell whose only COMPOSE_* is a switch has nothing scrubbed.
    const { run, calls } = stub(res({ code: 1 }));
    expect(composeName({ root: "/r", env: { PATH: "/bin", COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1" }, scrub: true, run })).toEqual(failed("exit", "docker compose config exited 1"));
    expect(calls[0]!.opts!.env).toEqual({ PATH: "/bin", ...OFF });
  });

  it("with scrub, runs without every COMPOSE_* (empty ones too) and names them on an error", () => {
    const env = { PATH: "/bin", COMPOSE_PROJECT_NAME: "", COMPOSE_FILE: "x.yml", DOCKER_HOST: "unix:///d" };
    const { run, calls } = stub(res({ code: 1 }));
    expect(composeName({ root: "/r", env, scrub: true, run })).toEqual({ ...failed("exit", "docker compose config exited 1"), scrubbed: ["COMPOSE_FILE", "COMPOSE_PROJECT_NAME"] });
    expect(calls[0]!.opts!.env).toEqual({ PATH: "/bin", DOCKER_HOST: "unix:///d", ...OFF });
    // Nothing to remove: no scrubbed list, and the env goes through with only the switches added.
    const plain = { PATH: "/bin" };
    const s = stub(res({ code: 1 }));
    expect(composeName({ root: "/r", env: plain, scrub: true, run: s.run })).toEqual(failed("exit", "docker compose config exited 1"));
    expect(s.calls[0]!.opts!.env).toEqual({ ...plain, ...OFF });
  });

  it("returns the name on exit 0", () => {
    expect(composeName({ root: "/r", env: {}, run: stub(json({ name: "app-node", services: {} })).run })).toEqual({ name: "app-node" });
  });

  it("ignores stderr warnings on exit 0", () => {
    const r = res({ stdout: JSON.stringify({ name: "app" }), stderr: 'time=2026-01-01T00:00:00Z level=warning msg="x"\n' });
    expect(composeName({ root: "/r", env: {}, run: stub(r).run })).toEqual({ name: "app" });
  });

  it("errors when the name is empty or not a string", () => {
    for (const v of [{ name: "" }, { name: 5 }, { name: null }, {}, [], null]) {
      expect(composeName({ root: "/r", env: {}, run: stub(json(v)).run })).toEqual(failed("noName", "docker compose config printed no project name"));
    }
  });

  it("errors on invalid JSON", () => {
    for (const stdout of ["not json", ""]) {
      expect(composeName({ root: "/r", env: {}, run: stub(res({ stdout })).run })).toEqual(failed("json", "docker compose config printed invalid JSON"));
    }
  });

  it("reports a timeout as an error naming 10s", () => {
    const out = composeName({ root: "/r", env: {}, run: stub(res({ code: null, timedOut: true })).run });
    expect(out).toEqual(failed("timeout", "docker compose config timed out after 10s"));
  });

  it("reports a run killed by a signal or by overflowing its output, or that could not run, as an abend", () => {
    for (const abend of ["SIGKILL", "ENOBUFS"]) {
      expect(composeName({ root: "/r", env: {}, run: stub(res({ code: null, abend })).run })).toEqual(failed("abend", `docker compose config was killed (${abend})`));
    }
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: null, abend: "EACCES" })).run })).toEqual(failed("abend", "docker compose config could not run (EACCES)"));
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: null })).run })).toEqual(failed("abend", "docker compose config could not run (no exit code)"));
  });

  // composeVersion already found docker, so ENOENT at spawn is the cwd: an error, never "unavailable".
  it("reports a spawn ENOENT as the directory being gone", () => {
    const out = composeName({ root: "/r", env: {}, run: stub(res({ code: null, notFound: true, abend: "ENOENT" })).run });
    expect(out).toEqual(failed("gone", "docker compose config could not start (its directory is gone)"));
  });

  it("reports a vanished cwd as gone with the real runner", () => {
    const gone = join(realpathSync(tmpdir()), `loops-gone-${process.pid}-${Date.now()}`);
    expect(composeName({ root: gone, env: { PATH: process.env.PATH }, run })).toMatchObject({ kind: "gone", cwd: gone });
  });

  it("reports a Compose too old for --no-env-resolution as tooOld, and a docker without the plugin the same way", () => {
    for (const stderr of ["unknown flag: --no-env-resolution\nSee 'docker compose config --help'.\n", "WARNING: x\ndocker: unknown flag: --no-env-resolution\n"]) {
      expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 125, stderr })).run })).toEqual(failed("tooOld", "docker compose config is too old (needs --no-env-resolution)"));
    }
    // Compose naming the flag inside its own message is the file's error, and its text is not copied.
    const echoed = 'invalid image "unknown flag: --no-env-resolution"\n';
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 1, stderr: echoed })).run })).toEqual(failed("exit", "docker compose config exited 1"));
  });

  it("never copies Compose's stderr, even a line holding an interpolated secret", () => {
    const stderr = "services.db.ports: invalid port hunter2hunter2:5432\n";
    const out = composeName({ root: "/r", env: { DB_PASSWORD: "hunter2hunter2" }, run: stub(res({ code: 1, stderr })).run });
    expect(out).toEqual(failed("exit", "docker compose config exited 1"));
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("is noFile only when the whole stderr, warnings dropped, is Compose's not-found line", () => {
    const at = (code: number, stderr: string) => composeName({ root: "/r", env: {}, run: stub(res({ code, stderr })).run });
    expect(at(1, "no configuration file provided: not found\n")).toEqual({ noFile: true });
    expect(at(1, 'time=2026-01-01T00:00:00Z level=warning msg="a"\nno configuration file provided: not found\n')).toEqual({ noFile: true });
    // The Docker CLI's own warning (a bad DOCKER_CONFIG) comes before Compose's line.
    expect(at(1, "WARNING: Error parsing config file (/x/config.json): invalid character\nno configuration file provided: not found\n")).toEqual({ noFile: true });
    // A spoofed first line, more after it, or a different wording is a failure.
    for (const stderr of [
      "no configuration file provided: not found\nservices.web.image must be a string\n",
      "invalid image \"x\"\nno configuration file provided: not found\n",
      "no configuration file provided: not found in /x\n",
      "  WARNING: indented is not a warning line\nno configuration file provided: not found\n",
    ]) expect(at(1, stderr)).toEqual(failed("exit", "docker compose config exited 1"));
    expect(at(17, "")).toEqual(failed("exit", "docker compose config exited 17"));
  });

  // The rerun is `-q` (Compose's error, never the model with its .env values) with the remote loaders off.
  it("carries the shell-quoted rerun command and its cwd, which rerun turns into the fix", () => {
    const out = composeName({ root: "/a dir/it's", files: ["x y.yml"], env: { COMPOSE_FILE: "z" }, scrub: true, run: stub(res({ code: 1 })).run });
    expect(out).toMatchObject({ cmd: "docker compose -f 'x y.yml' config --no-env-resolution -q", cwd: "/a dir/it's", scrubbed: ["COMPOSE_FILE"] });
    expect(rerun(out as ComposeError)).toBe(`cd '/a dir/it'\\''s' && env -u COMPOSE_FILE ${OFF_ENV} docker compose -f 'x y.yml' config --no-env-resolution -q`);
    expect(rerun(failed("exit", "x") as ComposeError)).toBe(`cd /r && env ${OFF_ENV} docker compose config --no-env-resolution -q`);
    expect(rerun(out as ComposeError)).not.toContain("--format");
    // A name env(1) can set but `export` cannot is still one word.
    expect(rerun({ ...(out as ComposeError), scrubbed: ["COMPOSE_A B"] })).toContain(`&& env -u 'COMPOSE_A B' ${OFF_ENV} docker compose`);
  });

  it("isComposeConfigCall rejects other docker and non-docker calls", () => {
    expect(isComposeConfigCall("docker", ["ps"])).toBe(false);
    expect(isComposeConfigCall("docker", ["compose", "up"])).toBe(false);
    expect(isComposeConfigCall("git", ["compose", "config"])).toBe(false);
  });
});

// ---- Differential corpus: the same wrapper against the real `docker compose config`. ----
// Every expected value below was recorded from Compose v5.1.2 (no daemon needed). The point is that the
// policy in env-checks.ts leans on what Compose says, so a Compose upgrade that changes a rule fails here.
const composeAvailable = spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
const requireCompose = process.env.LOOPS_REQUIRE_COMPOSE === "1";

describe.runIf(requireCompose)("compose differential corpus is required", () => {
  // CI sets LOOPS_REQUIRE_COMPOSE=1 so a runner without the plugin fails instead of silently skipping the corpus.
  it("compose is available when required", () => {
    expect(composeAvailable).toBe(true);
  });
});

const SVC = "services:\n  web:\n    image: nginx\n";
const named = (n: string) => `name: ${n}\n${SVC}`;

type Row = {
  title: string;
  /** Basename of the checkout dir (default "app-node"). */
  dir?: string;
  files: Record<string, string>;
  /** Run from this subdirectory of the checkout dir (default: the checkout dir itself). */
  sub?: string;
  composeFiles?: string[];
  env?: Record<string, string>;
  /** Point DOCKER_CONFIG at a directory whose config.json does not parse (its cli-plugins still link to the real ones). */
  badDockerConfig?: true;
  want: Want;
  /** The answer another Compose version gives for the same fixture (both recorded, either accepted). */
  alt?: Want;
};
/** A failure is compared by its kind only: composeName never copies Compose's text. */
type Want = { name: string } | { noFile: true } | { kind: ComposeErrorKind };

const rows: Row[] = [
  // --- directory normalization (no name: anywhere) ---
  // Compose lowercases and drops characters outside [a-z0-9_-]: the dot goes, the underscore stays.
  { title: "dir name 'My.Repo-WT_1' is lowercased and stripped of '.'", dir: "My.Repo-WT_1", files: { "compose.yaml": SVC }, want: { name: "myrepo-wt_1" } },
  // A leading dot is stripped, not rejected: '.hidden' becomes 'hidden'.
  { title: "dir name '.hidden' loses its dot", dir: ".hidden", files: { "compose.yaml": SVC }, want: { name: "hidden" } },

  // --- name: forms ---
  { title: "top-level name: literal", files: { "compose.yaml": named("app-prod") }, want: { name: "app-prod" } },
  { title: "name: interpolated from a shell variable", files: { "compose.yaml": named("${PROJ_X}") }, env: { PROJ_X: "from-shell" }, want: { name: "from-shell" } },
  { title: "name: interpolated from .env", files: { "compose.yaml": named("${PROJ_X}"), ".env": "PROJ_X=from-dotenv\n" }, want: { name: "from-dotenv" } },
  // An empty name: is not an error: Compose falls back to the directory name.
  { title: "name: \"\" falls back to the directory name", files: { "compose.yaml": named('""') }, want: { name: "app-node" } },
  // Surprise: an unquoted integer name is NOT stringified; Compose's schema rejects it (quote it to get "123").
  // Recorded line: "validating <root>/compose.yaml: name must be a string".
  { title: "name: 123 (non-string scalar) is rejected by the schema", files: { "compose.yaml": named("123") }, want: { kind: "exit" } },
  { title: "name: 123 quoted is a valid name", files: { "compose.yaml": named('"123"') }, want: { name: "123" } },
  // A mapping fails at YAML decode, before validation ("line 2: cannot construct !!map into string" on v5.1.2, "unmarshal" on v2.38.2).
  { title: "name: as a mapping fails to decode", files: { "compose.yaml": `name:\n  a: b\n${SVC}` }, want: { kind: "exit" } },

  // --- .env forms for COMPOSE_PROJECT_NAME ---
  { title: ".env quoted value", files: { "compose.yaml": SVC, ".env": 'COMPOSE_PROJECT_NAME="quoted-name"\n' }, want: { name: "quoted-name" } },
  { title: ".env with an export prefix", files: { "compose.yaml": SVC, ".env": "export COMPOSE_PROJECT_NAME=exported\n" }, want: { name: "exported" } },
  { title: ".env inline comment is stripped", files: { "compose.yaml": SVC, ".env": "COMPOSE_PROJECT_NAME=commented # not part of the name\n" }, want: { name: "commented" } },
  // Unlike the shell, an empty COMPOSE_PROJECT_NAME= line in .env does not hide name: (it is as if unset).
  { title: ".env COMPOSE_PROJECT_NAME= (empty) is ignored, name: wins", files: { "compose.yaml": named("from-file"), ".env": "COMPOSE_PROJECT_NAME=\n" }, want: { name: "from-file" } },
  { title: ".env COMPOSE_PROJECT_NAME= (empty) with no name: falls back to the dir name", files: { "compose.yaml": SVC, ".env": "COMPOSE_PROJECT_NAME=\n" }, want: { name: "app-node" } },
  { title: ".env with a UTF-8 BOM at the start", files: { "compose.yaml": SVC, ".env": "﻿COMPOSE_PROJECT_NAME=bom-name\n" }, want: { name: "bom-name" } },
  { title: ".env with CRLF line endings", files: { "compose.yaml": SVC, ".env": "COMPOSE_PROJECT_NAME=crlf-name\r\nOTHER=1\r\n" }, want: { name: "crlf-name" } },

  // --- precedence ---
  { title: ".env beats name:", files: { "compose.yaml": named("from-file"), ".env": "COMPOSE_PROJECT_NAME=from-dotenv\n" }, want: { name: "from-dotenv" } },
  { title: "shell COMPOSE_PROJECT_NAME beats .env and name:", files: { "compose.yaml": named("from-file"), ".env": "COMPOSE_PROJECT_NAME=from-dotenv\n" }, env: { COMPOSE_PROJECT_NAME: "from-shell" }, want: { name: "from-shell" } },
  // Surprise: an empty shell COMPOSE_PROJECT_NAME hides the .env value (Compose falls to name:, else the dir
  // name), though it is not itself used as the name. This is why the policy tells the developer to unset it.
  { title: "shell COMPOSE_PROJECT_NAME= (empty) hides .env", files: { "compose.yaml": SVC, ".env": "COMPOSE_PROJECT_NAME=from-dotenv\n" }, env: { COMPOSE_PROJECT_NAME: "" }, want: { name: "app-node" } },
  { title: "shell COMPOSE_PROJECT_NAME= (empty) falls through to name:", files: { "compose.yaml": named("from-file"), ".env": "COMPOSE_PROJECT_NAME=from-dotenv\n" }, env: { COMPOSE_PROJECT_NAME: "" }, want: { name: "from-file" } },

  // --- file discovery ---
  // Only compose.override.yml is merged beside compose.yml; docker-compose.override.yml is not loaded (its name: "override-b" never shows).
  { title: "implicit override: compose.override.yml loads, docker-compose.override.yml does not", files: { "compose.yml": named("base"), "compose.override.yml": named("override-a"), "docker-compose.override.yml": named("override-b") }, want: { name: "override-a" } },
  // Compose walks up from the cwd to find the file, so a subdirectory of a checkout resolves to the parent's project.
  { title: "parent directory discovery from a subdirectory", sub: "pkg/api", files: { "compose.yaml": named("from-parent") }, want: { name: "from-parent" } },
  // The project directory is the directory holding the discovered file, so the dir-name fallback is the parent's name, not the cwd's.
  { title: "parent directory discovery falls back to the parent's directory name", dir: "App-Parent", sub: "pkg/api", files: { "compose.yaml": SVC }, want: { name: "app-parent" } },
  // No default file in the cwd or above it: plain Compose runs nothing. noFile keys on this exact line.
  { title: "no compose file anywhere up from the cwd is 'no configuration file provided'", files: { "deploy/stack.yml": SVC }, want: { noFile: true } },
  { title: "no compose file anywhere up from a subdirectory either", sub: "deploy", files: { "deploy/stack.yml": SVC }, want: { noFile: true } },
  // An unparsable DOCKER_CONFIG makes the Docker CLI print `WARNING: Error parsing config file …` before Compose's line.
  { title: "no compose file under a DOCKER_CONFIG that does not parse is still noFile", files: { "deploy/stack.yml": SVC }, badDockerConfig: true, want: { noFile: true } },
  // The policy probes plain runs from the first configured file's directory: a default file there names the project after it.
  { title: "plain run from the first file's directory finds the default file there", sub: "deploy", files: { "deploy/compose.yml": SVC }, want: { name: "deploy" } },
  // Walking up, Compose reads the cwd's .env first and then the one beside the file it found.
  { title: "plain run from a subdirectory reads the .env beside the parent file it found", sub: "deploy", files: { "compose.yaml": named("app-prod"), ".env": "COMPOSE_PROJECT_NAME=app-live\n", "deploy/stack.yml": SVC }, want: { name: "app-live" } },
  { title: "plain run from a subdirectory prefers the cwd's own .env", sub: "deploy", files: { "compose.yaml": named("app-prod"), ".env": "COMPOSE_PROJECT_NAME=app-live\n", "deploy/.env": "COMPOSE_PROJECT_NAME=deployenv\n", "deploy/stack.yml": SVC }, want: { name: "deployenv" } },
  { title: "COMPOSE_FILE with two files joined by ':'", files: { "a.yml": named("first"), "b.yml": named("second") }, env: { COMPOSE_FILE: "a.yml:b.yml" }, want: { name: "second" } },
  { title: "COMPOSE_FILE with a custom COMPOSE_PATH_SEPARATOR", files: { "a.yml": named("first"), "b.yml": named("second") }, env: { COMPOSE_FILE: "a.yml;b.yml", COMPOSE_PATH_SEPARATOR: ";" }, want: { name: "second" } },
  { title: "two default files: compose.yaml wins over compose.yml", files: { "compose.yaml": named("from-yaml"), "compose.yml": named("from-yml") }, want: { name: "from-yaml" } },
  { title: "-f a -f b: the last name: wins", files: { "a.yml": named("first"), "b.yml": named("second") }, composeFiles: ["a.yml", "b.yml"], want: { name: "second" } },
  // Configured -f files beat COMPOSE_FILE in the environment.
  { title: "-f beats COMPOSE_FILE", files: { "a.yml": named("first"), "b.yml": named("second") }, composeFiles: ["a.yml"], env: { COMPOSE_FILE: "b.yml" }, want: { name: "first" } },

  // --- failures that are, and are not, about the name ---
  // v5.1.2 skips the missing env_file under --no-env-resolution; v2.38.2 (the ubuntu-latest runner) still fails on it, so there e.project FAILs as `docker compose up` would.
  { title: "missing env_file passes with --no-env-resolution on v5; v2.38 still fails", files: { "compose.yaml": named("app-env") .replace("image: nginx\n", "image: nginx\n    env_file: .env.local\n") }, want: { name: "app-env" }, alt: { kind: "exit" } },
  // Recorded line: "error while interpolating services.web.image: required variable X is missing a value".
  { title: "service image ${X:?} with X unset is Compose's error", files: { "compose.yaml": "services:\n  web:\n    image: \"${X:?}\"\n" }, want: { kind: "exit" } },
];

describe.skipIf(!composeAvailable)("composeName against real docker compose config", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "loops-compose-")));
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  // Compose settings in the developer's own shell must not leak into a row; DOCKER_* stays so credential/config setup works.
  const baseEnv = (): NodeJS.ProcessEnv => {
    const e: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
    for (const [k, v] of Object.entries(process.env)) if (k.startsWith("DOCKER_")) e[k] = v;
    return e;
  };

  let n = 0;
  it.each(rows)("$title", (row) => {
    const checkout = join(base, `row${n++}`, row.dir ?? "app-node");
    for (const [rel, body] of Object.entries(row.files)) {
      mkdirSync(dirname(join(checkout, rel)), { recursive: true });
      writeFileSync(join(checkout, rel), body);
    }
    const root = row.sub ? join(checkout, row.sub) : checkout;
    mkdirSync(root, { recursive: true });
    const env = { ...baseEnv(), ...row.env };
    if (row.badDockerConfig) {
      const cfg = join(checkout, "..", "docker-config");
      mkdirSync(cfg);
      writeFileSync(join(cfg, "config.json"), "{bad");
      // Docker finds a user-installed compose plugin under DOCKER_CONFIG; keep the real one reachable.
      const plugins = join(process.env.DOCKER_CONFIG ?? join(homedir(), ".docker"), "cli-plugins");
      if (existsSync(plugins)) symlinkSync(plugins, join(cfg, "cli-plugins"));
      env.DOCKER_CONFIG = cfg;
    }
    const got = composeName({ root, files: row.composeFiles, env, run });
    const shown = "error" in got ? { kind: got.kind } : got;
    // `alt` is the answer another Compose version gives for the same fixture; both are recorded, either is the oracle.
    expect([row.want, ...(row.alt ? [row.alt] : [])]).toContainEqual(shown);
  });

  /** A checkout under `base` with `files` written; returns its path. */
  const at = (dir: string, files: Record<string, string>): string => {
    const checkout = join(base, dir, "app-node");
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(checkout, rel)), { recursive: true });
      writeFileSync(join(checkout, rel), body);
    }
    return checkout;
  };
  const sh = (cmd: string, env: NodeJS.ProcessEnv) => spawnSync("sh", ["-c", cmd], { env, encoding: "utf8", timeout: 20_000 });
  const notWarning = (s: string) => s.split("\n").filter((l) => !WARNING_LINES.some((w) => w.test(l))).join("\n").trim();
  const WARNING_LINES = [/^time=.* level=warning/, /^WARNING: /];

  it("the rerun fix shows Compose's error and never prints the resolved model or a .env secret", () => {
    const root = at("rerun-secret", { "compose.yaml": "services:\n  web:\n    image: nginx\n    environment:\n      SECRET: ${SECRET}\n", ".env": "SECRET=loops-canary-7f3a\n" });
    // A timeout is transient: rerun, the probe succeeds.
    const e = composeName({ root, env: baseEnv(), run: () => res({ code: null, timedOut: true }) }) as ComposeError;
    const r = sh(rerun(e), baseEnv());
    expect([r.status, r.stdout]).toEqual([0, ""]);
    expect(r.stdout + r.stderr).not.toContain("loops-canary-7f3a");
  });

  let m = 0;
  it.each(rows.filter((r) => "kind" in r.want && !r.alt))("$title: the rerun exits non-zero with Compose's error on stderr and nothing on stdout", (row) => {
    const root = at(`rerun${m++}`, row.files);
    const env = { ...baseEnv(), ...row.env };
    const got = composeName({ root, files: row.composeFiles, env, run });
    expect(got).toMatchObject({ kind: "exit" });
    const r = sh(rerun(got as ComposeError), env);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(notWarning(r.stderr)).not.toBe("");
  });

  describe("remote includes and extends", () => {
    // A git URL whose path carries a shell variable: a fetch would send its value to the server.
    let srv: Awaited<ReturnType<typeof canary>>;
    beforeEach(async () => {
      srv = await canary();
    });
    afterEach(() => srv.close());
    const SECRET = "loops-canary-5e1d";
    const remotes = (): [string, Record<string, string>][] => [
      ["include", { "compose.yaml": `include:\n  - http://127.0.0.1:${srv.port}/x-\${LOOPS_CANARY}.git\n${SVC}` }],
      ["extends.file", { "compose.yaml": `services:\n  web:\n    extends:\n      file: http://127.0.0.1:${srv.port}/ext-\${LOOPS_CANARY}.git\n      service: web\n` }],
    ];
    let k = 0;
    it("a probe, as is or scrubbed, fetches nothing, even with COMPOSE_EXPERIMENTAL_GIT_REMOTE=1 in the shell or the checkout's .env: exit", () => {
      for (const [what, files] of remotes()) {
        const shell = at(`remote${k++}`, files);
        const dotenv = at(`remote${k++}`, { ...files, ".env": "COMPOSE_EXPERIMENTAL_GIT_REMOTE=1\nCOMPOSE_EXPERIMENTAL_OCI_REMOTE=1\nGIT_ALLOW_PROTOCOL=http\n" });
        const env = { ...baseEnv(), LOOPS_CANARY: SECRET };
        const got = [
          composeName({ root: shell, env: { ...env, COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1" }, run }),
          composeName({ root: shell, env: { ...env, COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1" }, scrub: true, run }),
          composeName({ root: dotenv, env, scrub: true, run }),
        ];
        expect([what, ...got.map((g) => ("error" in g ? g.kind : g))]).toEqual([what, "exit", "exit", "exit"]);
        expect(JSON.stringify(got)).not.toContain(SECRET);
        expect([what, srv.hits()]).toEqual([what, 0]);
        // The fix's rerun fetches nothing either.
        const r = sh(rerun(got[2] as ComposeError), env);
        expect([what, r.status === 0, srv.hits()]).toEqual([what, false, 0]);
      }
    });
  });
});
