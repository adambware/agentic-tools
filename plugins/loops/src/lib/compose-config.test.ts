import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { composeName, isComposeConfigCall, isNoFile, type ComposeName } from "./compose-config.js";
import { run, type RunResult, type Runner } from "./proc.js";

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

describe("composeName with a stubbed runner", () => {
  it("asks plain `docker compose config` when no files are configured", () => {
    const { run, calls } = stub(json({ name: "app" }));
    composeName({ root: "/r", env: {}, run });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("docker");
    expect(calls[0]!.args).toEqual(["compose", "config", "--no-env-resolution", "--format", "json"]);
    expect(isComposeConfigCall(calls[0]!.cmd, calls[0]!.args)).toBe(true);
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

  it("passes cwd, env and the 10s timeout through as given", () => {
    const env = { PATH: "/bin", COMPOSE_FILE: "x.yml" };
    const { run, calls } = stub(json({ name: "app" }));
    composeName({ root: "/some/root", env, run });
    expect(calls[0]!.opts).toEqual({ cwd: "/some/root", env, timeoutMs: 10_000 });
    expect(calls[0]!.opts!.env).toBe(env);
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
      expect(composeName({ root: "/r", env: {}, run: stub(json(v)).run })).toEqual({
        error: "docker compose config printed no project name",
      });
    }
  });

  it("errors on invalid JSON", () => {
    expect(composeName({ root: "/r", env: {}, run: stub(res({ stdout: "not json" })).run })).toEqual({
      error: "docker compose config printed invalid JSON",
    });
    expect(composeName({ root: "/r", env: {}, run: stub(res({ stdout: "" })).run })).toEqual({
      error: "docker compose config printed invalid JSON",
    });
  });

  it("reports a timeout as an error naming 10s", () => {
    const out = composeName({ root: "/r", env: {}, run: stub(res({ code: null, timedOut: true })).run });
    expect(out).toEqual({ error: "docker compose config timed out after 10s" });
  });

  it("reports a failed spawn as docker not installed", () => {
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: null })).run })).toEqual({
      unavailable: "docker is not installed",
    });
  });

  it("reports a missing compose plugin as unavailable", () => {
    for (const stderr of ["docker: unknown command: docker compose\n", "docker: 'compose' is not a docker command.\nSee 'docker --help'\n"]) {
      expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 1, stderr })).run })).toEqual({
        unavailable: "compose plugin is not installed",
      });
    }
  });

  it("uses the last non-warning stderr line as the error", () => {
    const stderr =
      'time=2026-01-01T00:00:00Z level=warning msg="The \\"X\\" variable is not set."\n' +
      "required variable Y is missing a value: set it\n";
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 1, stderr })).run })).toEqual({
      error: "required variable Y is missing a value: set it",
    });
  });

  it("skips a trailing warning and blank lines when picking the error line", () => {
    const stderr = "project name must not be empty\ntime=2026-01-01T00:00:00Z level=warning msg=\"later\"\n\n";
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 1, stderr })).run })).toEqual({
      error: "project name must not be empty",
    });
  });

  it("names the exit code when stderr has only warnings", () => {
    const stderr = 'time=2026-01-01T00:00:00Z level=warning msg="a"\ntime=2026-01-01T00:00:01Z level=warning msg="b"\n';
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 1, stderr })).run })).toEqual({
      error: "docker compose config exited 1",
    });
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 17, stderr: "" })).run })).toEqual({
      error: "docker compose config exited 17",
    });
  });

  it("handles a trailing newline without yielding an empty error", () => {
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 1, stderr: "boom\n" })).run })).toEqual({ error: "boom" });
    expect(composeName({ root: "/r", env: {}, run: stub(res({ code: 1, stderr: "boom" })).run })).toEqual({ error: "boom" });
  });

  it("isNoFile recognises only Compose's not-found line", () => {
    expect(isNoFile({ error: "no configuration file provided: not found" })).toBe(true);
    expect(isNoFile({ error: "project name must not be empty" })).toBe(false);
    expect(isNoFile({ name: "app" })).toBe(false);
    expect(isNoFile({ unavailable: "docker is not installed" })).toBe(false);
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
  want: ComposeName;
};

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
  { title: "name: 123 (non-string scalar) is rejected by the schema", files: { "compose.yaml": named("123") }, want: { error: "validating <root>/compose.yaml: name must be a string" } },
  { title: "name: 123 quoted is a valid name", files: { "compose.yaml": named('"123"') }, want: { name: "123" } },
  // A mapping fails at YAML decode, before validation, so the line has no file path (Compose-version-specific wording).
  { title: "name: as a mapping fails to decode", files: { "compose.yaml": `name:\n  a: b\n${SVC}` }, want: { error: "line 2: cannot construct !!map into string" } },

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
  // No default file in the cwd or above it: plain Compose runs nothing. The policy keys on this exact line (isNoFile).
  { title: "no compose file anywhere up from the cwd is 'no configuration file provided'", files: { "deploy/stack.yml": SVC }, want: { error: "no configuration file provided: not found" } },
  { title: "no compose file anywhere up from a subdirectory either", sub: "deploy", files: { "deploy/stack.yml": SVC }, want: { error: "no configuration file provided: not found" } },
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
  { title: "missing env_file passes with --no-env-resolution", files: { "compose.yaml": named("app-env") .replace("image: nginx\n", "image: nginx\n    env_file: .env.local\n") }, want: { name: "app-env" } },
  { title: "service image ${X:?} with X unset is Compose's error", files: { "compose.yaml": "services:\n  web:\n    image: \"${X:?}\"\n" }, want: { error: "error while interpolating services.web.image: required variable X is missing a value" } },
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
    const got = composeName({ root, files: row.composeFiles, env: { ...baseEnv(), ...row.env }, run });
    // Compose prints absolute paths in some errors; keep the expectations machine-independent.
    const shown = "error" in got ? { error: got.error.split(checkout).join("<root>") } : got;
    expect(shown).toEqual(row.want);
  });
});
