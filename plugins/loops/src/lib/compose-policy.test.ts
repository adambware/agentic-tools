// The e.project policy corpus: real git checkouts, real `docker compose config`, the whole `loops env-check` path.
// Every expectation comes from the Compose project rule (README, "Compose project"), not from running the code; a
// row's `premise` lines pin what real Compose answers for the fixture, so a Compose change and a policy change fail
// apart. Run locally (Compose v5.1.2) and by the compose-differential CI job (v2.38.2).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeName, isComposeConfigCall } from "./compose-config.js";
import { envCheckMain } from "./env-check.js";
import { run, shQuote, type Runner } from "./proc.js";
import { canary, put, sh } from "./testkit.js";

const composeAvailable = spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
const requireCompose = process.env.LOOPS_REQUIRE_COMPOSE === "1";
// Only row 22 needs a daemon (a container to find); LOOPS_REQUIRE_COMPOSE does not cover it.
const daemon = composeAvailable && spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe.runIf(requireCompose)("compose policy corpus is required", () => {
  it("compose is available when required", () => {
    expect(composeAvailable).toBe(true);
  });
});

const SVC = "services:\n  web:\n    image: nginx\n";
const named = (n: string) => `name: ${n}\n${SVC}`;
const toml = (files: string[], derive: string) => `schema_version = 1\n[compose]\nmode = "test"\nfiles = ${JSON.stringify(files)}\nderive = "${derive}"\n`;
/** Committed files: a body is written and added, null is `git rm`. */
type Files = Record<string, string | null>;
type Derive = "slug-hash" | "dirname";

function commit(dir: string, files: Files): void {
  const added: string[] = [];
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) sh(dir, "rm", "-q", rel);
    else {
      put(dir, rel, body);
      added.push(rel);
    }
  }
  if (added.length) sh(dir, "add", "--", ...added);
  sh(dir, "commit", "-q", "-m", "row");
}

// What `derive` names a worktree (README: dirname, or slug-hash `<main, else wt>-<worktree slug>-<hash6>`).
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "");
const dirProject = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[_-]+/, "");

const base = realpathSync(mkdtempSync(join(tmpdir(), `loops-policy-${process.pid}-`)));
let rows = 0;
/** Where nested worktrees go, relative to a row's directory (Claude's layout). */
const NEST = "app-node/.claude/worktrees/";

/** A row's repo: the main checkout `<row>/app-node` on branch main with the config and `files` committed. */
function fixture(composeFiles: string[], files: Files = {}, derive: Derive = "slug-hash") {
  const home = join(base, `row${++rows}`);
  const main = join(home, "app-node");
  mkdirSync(main, { recursive: true });
  sh(main, "init", "-q", "-b", "main");
  commit(main, { ".loops/env-check.toml": toml(composeFiles, derive), ...files });
  let branches = 0;
  return {
    main,
    home,
    /** `git worktree add` at `<row>/<at>` on a new branch, with `files` committed there. */
    wt(at: string, files: Files = {}): string {
      const w = join(home, at);
      mkdirSync(dirname(w), { recursive: true });
      sh(main, "worktree", "add", "-q", "-b", `b${++branches}`, w);
      if (Object.keys(files).length) commit(w, files);
      return w;
    },
    derived(w: string): string {
      if (derive === "dirname") return dirProject(basename(dirname(join(w, composeFiles[0]!))));
      const hash = createHash("sha1").update(realpathSync(w)).digest("hex").slice(0, 6);
      return `${slug(basename(main)) || "wt"}-${slug(basename(w)).slice(0, 24)}-${hash}`;
    },
  };
}

// PATH, the real HOME (a user-installed compose plugin lives there) and DOCKER_*; never CI, never the shell's COMPOSE_*.
const baseEnv = (): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("DOCKER_")) e[k] = v;
  return e;
};
type Vars = Record<string, string>;

/** What real Compose answers for one run from `cwd` (scrub-free: pass the row's vars to see a run as is). */
function answer(cwd: string, files?: string[], vars: Vars = {}) {
  const r = composeName({ root: cwd, files, env: { ...baseEnv(), ...vars }, run });
  return "error" in r ? { kind: r.kind } : r;
}

/** The real runner, except that `docker ps` lists nothing (no row but 22 is about running stacks); records each probe's cwd. */
function quiet(probes: string[] = []): Runner {
  return (cmd, args, opts) => {
    if (cmd === "docker" && (args[0] === "ps" || (args[0] === "container" && args[1] === "ls"))) return { code: 0, stdout: "", stderr: "", timedOut: false };
    if (isComposeConfigCall(cmd, args)) probes.push(opts?.cwd ?? "");
    return run(cmd, args, opts);
  };
}

interface Want {
  level: "PASS" | "FAIL";
  /** Fragments every one of which appears in e.project's messages (all its Results, in order, joined). */
  has: (string | RegExp)[];
  /** Fragments of the fixes. */
  fix?: (string | RegExp)[];
  /** Text that must appear nowhere in the output (Compose's own words, a secret). */
  never?: string[];
  /** What `--compose-project` prints: the name it keeps (exit 0), or null when it withholds it (exit 1). */
  name: string | null;
}
type JsonResult = { level: string; id: string; message: string; fix: string | null };

/** Runs `env-check --json` and `env-check --compose-project` from `cwd` and checks e.project against `want`. */
function check(cwd: string, vars: Vars, want: Want, runner: Runner = quiet()): string {
  const call = (argv: string[], extra: Vars = {}) => {
    const env = { ...baseEnv(), ...vars, ...extra };
    const out: string[] = [];
    const err: string[] = [];
    const code = envCheckMain(argv, { run: runner, cwd, env, readStdin: () => "", out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const j = call(["--json"]);
  const rs = (JSON.parse(j.out).results as JsonResult[]).filter((r) => r.id.startsWith("e.project"));
  const text = rs.map((r) => r.message).join("\n");
  const fixes = rs.map((r) => r.fix ?? "").join("\n");
  expect(rs.length, "e.project ran").toBeGreaterThan(0);
  expect(rs.map((r) => r.level), text).not.toContain("SKIP");
  expect(rs.some((r) => r.level === "FAIL") ? "FAIL" : "PASS", text).toBe(want.level);
  for (const h of want.has) typeof h === "string" ? expect(text).toContain(h) : expect(text).toMatch(h);
  for (const h of want.fix ?? []) typeof h === "string" ? expect(fixes).toContain(h) : expect(fixes).toMatch(h);
  const p = call(["--compose-project"]);
  expect({ exit: p.code, name: p.out || null }, p.err).toEqual({ exit: want.name === null ? 1 : 0, name: want.name });
  // A kept name with a FAIL behind it: `-p N` is safe, a run without `-p` is not, and stderr says so.
  if (want.name !== null && want.level === "FAIL") expect(p.err).toContain("warning");
  // --compose-project asks Compose under --static and CI=true too, with the same answer.
  const ci = call(["--compose-project", "--static"], { CI: "true" });
  expect({ exit: ci.code, name: ci.out || null }, ci.err).toEqual({ exit: p.code, name: p.out || null });
  for (const s of want.never ?? []) expect(j.out + p.out + p.err).not.toContain(s);
  return text;
}

const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byMain = (a: string) => `would use project ${a}, which the main checkout uses`;
/** Held by a worktree: the holder's text names it (its path or its derived name, either holds `who`). */
const byPeer = (a: string, who: string) => new RegExp(`would use project ${re(a)}, which [^\\n]*${re(who)}[^\\n]* uses`);
const not = (a: string, n: string) => `would use project ${a}, not ${n}`;
const SCRUBBED = "without your shell's COMPOSE_*";
/** A probe failure says how it failed. */
const EXITED = /exit(ed)? \d+/;
/** What every rerun fix sets: Compose's remote loaders off. */
const OFF_ENV = "COMPOSE_EXPERIMENTAL_GIT_REMOTE=0 COMPOSE_EXPERIMENTAL_OCI_REMOTE=0 GIT_ALLOW_PROTOCOL=file";
const derivedPass = (n: string) => `${n} (derived: slug-hash)`;
/** The fix names `<W root>/.env` (check 4), not a subdirectory's. */
const rootEnv = (w: string) => new RegExp(`to ${re(w)}/\\.env\\b`);

describe.skipIf(!composeAvailable)("e.project policy against real docker compose", { timeout: 60_000 }, () => {
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("row 1: slug-hash worktree, compose.yml at root, no .env: PASS derived (its own dirname is its plain answer)", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    expect(answer(w, ["compose.yml"])).toEqual({ name: "w1" });
    check(w, {}, { level: "PASS", has: [derivedPass(f.derived(w))], name: f.derived(w) });
  });

  it("row 2: committed literal name: app: FAIL held by the main checkout, name kept", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("app") });
    const w = f.wt(`${NEST}w1`);
    check(w, {}, { level: "FAIL", has: [byMain("app")], name: f.derived(w) });
  });

  it("row 3 (A): name: ${APP:-app}, W .env APP=<derived>, untracked override name: prod: FAIL plain 'prod, not N'", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("${APP:-app}") });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, ".env", `APP=${n}\n`);
    put(w, "compose.override.yml", named("prod"));
    expect([answer(w, ["compose.yml"]), answer(w)]).toEqual([{ name: n }, { name: "prod" }]);
    check(w, {}, { level: "FAIL", has: [not("prod", n)], name: n });
  });

  it("row 4 (C): configured docker/dev.yml, the main checkout has it: FAIL -f run held by the main checkout", () => {
    const f = fixture(["docker/dev.yml"], { "docker/dev.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    expect([answer(f.main, ["docker/dev.yml"]), answer(join(f.main, "docker"))]).toEqual([{ name: "docker" }, { noFile: true }]);
    check(w, {}, { level: "FAIL", has: [byMain("docker")], name: f.derived(w) });
  });

  it("row 5: W .env COMPOSE_PROJECT_NAME=<derived>: PASS", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    put(w, ".env", `COMPOSE_PROJECT_NAME=${f.derived(w)}\n`);
    check(w, {}, { level: "PASS", has: [derivedPass(f.derived(w))], name: f.derived(w) });
  });

  it("row 6 (P4): W .env COMPOSE_PROJECT_NAME=feat-x: FAIL 'not N', the fix names the .env line, name kept", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, ".env", "COMPOSE_PROJECT_NAME=feat-x\n");
    check(w, {}, { level: "FAIL", has: [not("feat-x", n)], fix: [`COMPOSE_PROJECT_NAME=${n}`, rootEnv(w)], name: n });
  });

  it("row 6b (D12): W .env names W's own directory: PASS", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    put(w, ".env", "COMPOSE_PROJECT_NAME=w1\n");
    check(w, {}, { level: "PASS", has: [derivedPass(f.derived(w))], name: f.derived(w) });
  });

  it("row 7: shell COMPOSE_PROJECT_NAME distinct from every held name: PASS under the shell's name", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    check(w, { COMPOSE_PROJECT_NAME: "feat" }, { level: "PASS", has: ["feat (COMPOSE_PROJECT_NAME"], name: "feat" });
  });

  it("row 7 (held): shell COMPOSE_PROJECT_NAME equal to the main checkout's answer: FAIL, withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    expect(answer(f.main, ["compose.yml"])).toEqual({ name: "app-node" });
    check(w, { COMPOSE_PROJECT_NAME: "app-node" }, { level: "FAIL", has: [byMain("app-node")], name: null });
  });

  it("row 7b (D15): committed name: app, shell COMPOSE_PROJECT_NAME=feat: FAIL for the scrubbed runs, feat kept", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("app") });
    const w = f.wt(`${NEST}w1`);
    check(w, { COMPOSE_PROJECT_NAME: "feat" }, { level: "FAIL", has: [SCRUBBED, byMain("app")], name: "feat" });
  });

  it("row 8: derive = dirname, files docker/compose.yml: FAIL, the derived name docker is the main checkout's, withheld", () => {
    const f = fixture(["docker/compose.yml"], { "docker/compose.yml": SVC }, "dirname");
    const w = f.wt(`${NEST}w1`);
    expect(f.derived(w)).toBe("docker");
    check(w, {}, { level: "FAIL", has: [byMain("docker")], fix: ["slug-hash"], name: null });
  });

  it("row 9 (B): a peer renamed its file to compose.yaml whose name: is W's derived name: FAIL held by that worktree", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    const p = f.wt(`${NEST}p1`, { "compose.yml": null, "compose.yaml": named(n) });
    expect(answer(p)).toEqual({ name: n });
    check(w, {}, { level: "FAIL", has: [byPeer(n, "p1")], name: null });
  });

  it("row 10: two slug-hash worktrees with one basename in different parents: FAIL plain answer held by the other", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}feat`);
    const p = f.wt("elsewhere/feat");
    expect([answer(w), answer(p)]).toEqual([{ name: "feat" }, { name: "feat" }]);
    check(w, {}, { level: "FAIL", has: [/would use project feat, which (?!the main checkout)/], name: f.derived(w) });
  });

  it("row 11: the main checkout lacks the configured file but has compose.yaml name: app; W's file says app: FAIL held by the main checkout", () => {
    const f = fixture(["compose.yml"], { "compose.yaml": named("app") });
    const w = f.wt(`${NEST}w1`, { "compose.yml": named("app") });
    expect([answer(f.main), answer(w)]).toEqual([{ name: "app" }, { name: "app" }]);
    check(w, {}, { level: "FAIL", has: [byMain("app")], name: f.derived(w) });
  });

  it("row 12: a prunable peer (directory deleted): PASS, the peer is not probed, no SKIP", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`);
    rmSync(p, { recursive: true, force: true });
    const probes: string[] = [];
    check(w, {}, { level: "PASS", has: [derivedPass(f.derived(w))], name: f.derived(w) }, quiet(probes));
    expect(probes.filter((c) => c.startsWith(p))).toEqual([]);
  });

  it("row 13: shell COMPOSE_PROJECT_NAME=\"Bad Name\", configured file present: FAIL withheld, loops names the rule, no Compose text", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    expect(answer(w, ["compose.yml"], { COMPOSE_PROJECT_NAME: "Bad Name" })).toEqual({ kind: "exit" });
    check(w, { COMPOSE_PROJECT_NAME: "Bad Name" }, {
      level: "FAIL",
      has: ['COMPOSE_PROJECT_NAME "Bad Name" is not a Compose project name'],
      fix: ["unset it"],
      // Compose's line: `invalid project name "Bad Name": must consist only of lowercase alphanumeric characters, …`.
      never: ["must consist only", "invalid project name"],
      // Every run here fails on the name itself, so no -p name is safe: withheld.
      name: null,
    });
  });

  it("row 13b: Compose rejects exactly the shell names loops withholds (lowercase letters, digits, - and _; a letter or digit first)", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const valid = (s: string) => dirProject(s) === s;
    const names = ["Bad Name", "UPPER", "Upper", "_x", "-x", "_", "a.b", "a/b", "é", " a", "x_", "x-", "9", "1abc", "a_b-c9"];
    for (const n of names) {
      expect([n, answer(f.main, ["compose.yml"], { COMPOSE_PROJECT_NAME: n })]).toEqual([n, valid(n) ? { name: n } : { kind: "exit" }]);
      const p = envCheckMain(["--compose-project"], { run: quiet(), cwd: f.main, env: { ...baseEnv(), COMPOSE_PROJECT_NAME: n }, readStdin: () => "", out: () => {}, err: () => {} });
      expect([n, p]).toEqual([n, valid(n) ? 0 : 1]);
    }
  });

  it("row 14: W .env COMPOSE_FILE=other.yml (name: app) and APP=<derived>: FAIL, the plain run answers app, held by the main checkout", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("${APP:-app}"), "other.yml": named("app") });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, ".env", `COMPOSE_FILE=other.yml\nAPP=${n}\n`);
    // -f beats the .env COMPOSE_FILE, so only the plain run reads other.yml.
    expect([answer(w, ["compose.yml"]), answer(w)]).toEqual([{ name: n }, { name: "app" }]);
    check(w, {}, { level: "FAIL", has: [byMain("app")], name: n });
  });

  it("row 15: the main checkout with name: app: PASS app (compose)", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("app") });
    check(f.main, {}, { level: "PASS", has: ["app (compose)"], name: "app" });
  });

  it("row 16 (D): a .env secret interpolated into an invalid port: FAIL, and no output holds the secret", () => {
    const f = fixture(["compose.yml"], { "compose.yml": 'services:\n  db:\n    image: nginx\n    ports:\n      - "${DB_PASSWORD:-5432}:5432"\n' });
    const w = f.wt(`${NEST}w1`);
    put(w, ".env", "DB_PASSWORD=hunter2secret\n");
    expect([answer(f.main, ["compose.yml"]), answer(w, ["compose.yml"])]).toEqual([{ name: "app-node" }, { kind: "exit" }]);
    check(w, {}, { level: "FAIL", has: [EXITED], never: ["hunter2"], name: f.derived(w) });
  });

  it("row 17: from a worktree whose main checkout never had the files: PASS (the main checkout holds nothing)", () => {
    const f = fixture(["compose.yml"]);
    const w = f.wt(`${NEST}w1`, { "compose.yml": SVC });
    expect(answer(f.main)).toEqual({ noFile: true });
    check(w, {}, { level: "PASS", has: [derivedPass(f.derived(w))], name: f.derived(w) });
  });

  it("row 17b: from a main checkout that lacks the configured file: FAIL compose file missing, withheld", () => {
    const f = fixture(["compose.yml"]);
    check(f.main, {}, { level: "FAIL", has: [/no compose file found|compose file missing/], name: null });
  });

  it("row 18: nested worktree with docker/dev.yml and no root file: the plain run walks up into the main checkout, FAIL held by it", () => {
    const f = fixture(["docker/dev.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}x`, { "compose.yml": null, "docker/dev.yml": SVC });
    // The answer is the main checkout's dirname: Compose found the main checkout's compose.yml above W.
    expect([answer(f.main), answer(join(w, "docker"))]).toEqual([{ name: "app-node" }, { name: "app-node" }]);
    check(w, {}, { level: "FAIL", has: [byMain("app-node")], name: f.derived(w) });
  });

  it("row 19: empty shell COMPOSE_PROJECT_NAME and W .env naming another project: FAIL, the fix starts by unsetting it", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, ".env", "COMPOSE_PROJECT_NAME=other\n");
    // The empty shell value hides the .env one; without it the .env one is used.
    expect([answer(w, ["compose.yml"], { COMPOSE_PROJECT_NAME: "" }), answer(w, ["compose.yml"])]).toEqual([{ name: "w1" }, { name: "other" }]);
    check(w, { COMPOSE_PROJECT_NAME: "" }, {
      level: "FAIL",
      has: [SCRUBBED, not("other", n)],
      fix: [/unset the empty COMPOSE_PROJECT_NAME[^\n]*COMPOSE_PROJECT_NAME=/],
      name: n,
    });
  });

  it("row 19b (D15): empty shell COMPOSE_PROJECT_NAME, name: ${APP:-app}, W .env COMPOSE_PROJECT_NAME=<derived>: the as-is run answers app, FAIL", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("${APP:-app}") });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, ".env", `COMPOSE_PROJECT_NAME=${n}\n`);
    // The note expects PASS, but the empty shell value hides the .env name and APP is unset: as is, Compose says app.
    expect([answer(w, ["compose.yml"], { COMPOSE_PROJECT_NAME: "" }), answer(w, ["compose.yml"])]).toEqual([{ name: "app" }, { name: n }]);
    check(w, { COMPOSE_PROJECT_NAME: "" }, { level: "FAIL", has: [byMain("app")], name: n });
  });

  it("row 19c (M2): shell COMPOSE_PROJECT_NAME=feat, W .env COMPOSE_PROJECT_NAME=<derived>: the scrubbed runs land on the derived name, PASS", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("${APP:-app}") });
    const w = f.wt(`${NEST}w1`);
    put(w, ".env", `COMPOSE_PROJECT_NAME=${f.derived(w)}\n`);
    check(w, { COMPOSE_PROJECT_NAME: "feat" }, { level: "PASS", has: ["feat (COMPOSE_PROJECT_NAME"], name: "feat" });
  });

  it("row 20 (D13): root compose.yml name: app, configured docker/dev.yml, W docker/.env names <derived>: FAIL root plain run, fix names <W>/.env", () => {
    const f = fixture(["docker/dev.yml"], { "compose.yml": named("app"), "docker/dev.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, "docker/.env", `COMPOSE_PROJECT_NAME=${n}\n`);
    expect([answer(w, ["docker/dev.yml"]), answer(join(w, "docker")), answer(w)]).toEqual([{ name: n }, { name: n }, { name: "app" }]);
    check(w, {}, { level: "FAIL", has: [byMain("app")], fix: [rootEnv(w)], name: n });
  });

  it("row 20b (D13): main docker/.env names prod; a peer named like the main checkout: FAIL held by the main checkout's root run", () => {
    const f = fixture(["docker/dev.yml"], { "compose.yml": SVC, "docker/dev.yml": SVC });
    put(f.main, "docker/.env", "COMPOSE_PROJECT_NAME=prod\n");
    const w = f.wt("wts/app-node");
    const n = f.derived(w);
    put(w, "docker/.env", `COMPOSE_PROJECT_NAME=${n}\n`);
    expect([answer(f.main, ["docker/dev.yml"]), answer(join(f.main, "docker")), answer(f.main), answer(w)]).toEqual([{ name: "prod" }, { name: "prod" }, { name: "app-node" }, { name: "app-node" }]);
    check(w, {}, { level: "FAIL", has: [byMain("app-node")], name: n });
  });

  it("row 21 (D12): configured docker/dev.yml exists only on W's branch: FAIL configured 'docker, not N', name kept", () => {
    const f = fixture(["docker/dev.yml"]);
    const w = f.wt(`${NEST}w1`, { "docker/dev.yml": SVC });
    expect([answer(w, ["docker/dev.yml"]), answer(join(w, "docker")), answer(w)]).toEqual([{ name: "docker" }, { noFile: true }, { noFile: true }]);
    // Check 4's fix for a configured run names <first file dir>/.env.
    check(w, {}, { level: "FAIL", has: [not("docker", f.derived(w))], fix: [`to ${w}/docker/.env`], name: f.derived(w) });
  });

  describe("row 22 (needs a docker daemon)", () => {
    const tag = `loops-policy-empty:${process.pid}`;
    let container = "";
    afterAll(() => {
      if (container) spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      spawnSync("docker", ["rmi", "-f", tag], { stdio: "ignore" });
    });

    it.skipIf(!daemon)("row 22 (D14): a held committed name: and a container of N started outside every checkout: both FAIL, check 5 first, withheld", () => {
      const app = `policy-${process.pid}`;
      const f = fixture(["compose.yml"], { "compose.yml": named(app) });
      const w = f.wt(`${NEST}w1`);
      const n = f.derived(w);
      const elsewhere = join(f.home, "elsewhere");
      mkdirSync(elsewhere);
      // An image from an empty tar (no pull) and a created, never started, container carrying Compose's labels.
      expect(spawnSync("docker", ["import", "-", tag], { input: Buffer.alloc(10240) }).status).toBe(0);
      const c = spawnSync("docker", ["create", "--label", `com.docker.compose.project=${n}`, "--label", `com.docker.compose.project.working_dir=${elsewhere}`, tag, "/none"], { encoding: "utf8" });
      expect(c.status, c.stderr).toBe(0);
      container = c.stdout.trim();
      const text = check(w, {}, { level: "FAIL", has: [`project ${n} was started from project directory`, byMain(app)], name: null }, run);
      expect(text.indexOf(`project ${n} was started`)).toBeLessThan(text.indexOf(byMain(app)));
    });
  });

  it("row 23 (I2): W .env names a live peer's derived name, the peer's answers differ: FAIL held by that worktree", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`);
    const dp = f.derived(p);
    put(w, ".env", `COMPOSE_PROJECT_NAME=${dp}\n`);
    expect(answer(p)).toEqual({ name: "p1" });
    check(w, {}, { level: "FAIL", has: [byPeer(dp, "p1")], name: f.derived(w) });
  });

  it("row 24 (I3): W .env names a deleted peer's derived name: FAIL held by that worktree", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`);
    const dp = f.derived(p);
    rmSync(p, { recursive: true, force: true });
    put(w, ".env", `COMPOSE_PROJECT_NAME=${dp}\n`);
    check(w, {}, { level: "FAIL", has: [byPeer(dp, "p1")], name: f.derived(w) });
  });

  it("row 25 (I4): the main checkout's name: equals a peer's derived name: main FAIL (check 6), withheld", () => {
    const f = fixture(["compose.yml"]);
    const p = f.wt(`${NEST}p1`);
    const dp = f.derived(p);
    commit(f.main, { "compose.yml": named(dp) });
    check(f.main, {}, { level: "FAIL", has: [dp], name: null });
  });

  it("row 25b (I4): a peer's plain answer equals the main checkout's name: main PASS (peers' answers are not held from main), the peer FAILs", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const p = f.wt("other/app-node");
    expect(answer(p)).toEqual({ name: "app-node" });
    check(f.main, {}, { level: "PASS", has: ["app-node (compose)"], name: "app-node" });
    check(p, {}, { level: "FAIL", has: [byMain("app-node")], name: f.derived(p) });
  });

  it("row 26 (I5): a peer's configured run answers x (no plain file there); W's root plain run answers x: FAIL held by the peer", () => {
    const f = fixture(["docker/dev.yml"]);
    const p = f.wt("p1", { "docker/dev.yml": named("x") });
    const w = f.wt(`${NEST}w1`, { "docker/dev.yml": SVC, "compose.yml": named("x") });
    const n = f.derived(w);
    put(w, "docker/.env", `COMPOSE_PROJECT_NAME=${n}\n`);
    expect([answer(p, ["docker/dev.yml"]), answer(join(p, "docker")), answer(p)]).toEqual([{ name: "x" }, { noFile: true }, { noFile: true }]);
    expect([answer(w, ["docker/dev.yml"]), answer(join(w, "docker")), answer(w)]).toEqual([{ name: n }, { name: n }, { name: "x" }]);
    check(w, {}, { level: "FAIL", has: [byPeer("x", "p1")], name: n });
  });

  it("row 27 (I6): W's plain runs find no compose file, its configured run answers N: PASS", () => {
    const f = fixture(["deploy/stack.yml"], { "deploy/stack.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, "deploy/.env", `COMPOSE_PROJECT_NAME=${n}\n`);
    expect([answer(w, ["deploy/stack.yml"]), answer(join(w, "deploy")), answer(w)]).toEqual([{ name: n }, { noFile: true }, { noFile: true }]);
    check(w, {}, { level: "PASS", has: [derivedPass(n)], name: n });
  });

  it("row 28 (I9): a peer's compose file is invalid, run from the main checkout: PASS, the peer is not probed", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("app") });
    const p = f.wt(`${NEST}p1`, { "compose.yml": "services: [\n" });
    expect(answer(p, ["compose.yml"])).toEqual({ kind: "exit" });
    const probes: string[] = [];
    check(f.main, {}, { level: "PASS", has: ["app (compose)"], name: "app" }, quiet(probes));
    expect(probes.filter((c) => c.startsWith(p))).toEqual([]);
  });
  it("row 28b (M3): the same invalid peer, run from another worktree: FAIL check 2 for the peer's runs, withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const p = f.wt(`${NEST}p1`, { "compose.yml": "services: [\n" });
    const w = f.wt(`${NEST}w1`);
    // W's own runs answer w1, its root's directory name, so the peer's failure is the only FAIL.
    expect([answer(p, ["compose.yml"]), answer(w)]).toEqual([{ kind: "exit" }, { name: "w1" }]);
    check(w, {}, {
      level: "FAIL",
      has: [/worktree [^\n]*p1's configured run: docker compose config exited \d+/],
      fix: [`cd ${shQuote(p)} && env ${OFF_ENV} docker compose -f compose.yml config --no-env-resolution -q`],
      // A peer probe feeds a held name, so its failure withholds (check 2).
      name: null,
    });
  });

  it("row 29 (F25): shell COMPOSE_FILE names a file W lacks: FAIL check 2 for W's plain run, name kept", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    expect([answer(w, ["compose.yml"], { COMPOSE_FILE: "missing.yml" }), answer(w, undefined, { COMPOSE_FILE: "missing.yml" })]).toEqual([{ name: "w1" }, { kind: "exit" }]);
    check(w, { COMPOSE_FILE: "missing.yml" }, {
      level: "FAIL",
      has: [EXITED],
      fix: [`cd ${shQuote(w)} && env ${OFF_ENV} docker compose config --no-env-resolution -q`],
      name: f.derived(w),
    });
  });

  it("row 30: configured docker/dev.yml name: ${APP:-dev}, committed docker/compose.yml name: app, no root file: FAIL the project-dir plain run alone", () => {
    const f = fixture(["docker/dev.yml"], { "docker/dev.yml": named("${APP:-dev}"), "docker/compose.yml": named("app") });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, "docker/.env", `APP=${n}\n`);
    expect([answer(f.main, ["docker/dev.yml"]), answer(join(f.main, "docker")), answer(f.main)]).toEqual([{ name: "dev" }, { name: "app" }, { noFile: true }]);
    expect([answer(w, ["docker/dev.yml"]), answer(join(w, "docker")), answer(w)]).toEqual([{ name: n }, { name: "app" }, { noFile: true }]);
    const text = check(w, {}, { level: "FAIL", has: [`project-dir plain run ${byMain("app")}`], fix: [`to ${w}/docker/.env`], name: n });
    expect(text).not.toContain("configured run");
  });

  it("row 31 (D12): W docker/.env names W's own directory for the configured docker/dev.yml: FAIL 'w1, not N' (the basename counts only for a root run)", () => {
    const f = fixture(["docker/dev.yml"], { "docker/dev.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    put(w, "docker/.env", "COMPOSE_PROJECT_NAME=w1\n");
    expect([answer(w, ["docker/dev.yml"]), answer(join(w, "docker")), answer(w)]).toEqual([{ name: "w1" }, { noFile: true }, { noFile: true }]);
    check(w, {}, { level: "FAIL", has: [`configured run ${not("w1", n)}`], fix: [`to ${w}/docker/.env`], name: n });
  });

  // S1: a branch's compose file can pull a git URL whose path carries a shell variable; no probe may fetch it.
  describe("remote includes and extends", () => {
    let srv: Awaited<ReturnType<typeof canary>>;
    beforeEach(async () => {
      srv = await canary();
    });
    afterEach(() => srv.close());
    const SECRET = "loops-canary-9b2c";
    const vars = { LOOPS_CANARY: SECRET };
    const include = () => `include:\n  - http://127.0.0.1:${srv.port}/x-\${LOOPS_CANARY}.git\n${SVC}`;
    const extend = () => `services:\n  web:\n    extends:\n      file: http://127.0.0.1:${srv.port}/ext-\${LOOPS_CANARY}.git\n      service: web\n`;
    const remote = { include, "extends.file": extend };

    for (const [what, body] of Object.entries(remote)) {
      it(`row 32 (S1): a peer's compose file has a remote ${what}: nothing is fetched, FAIL check 2 for the peer's runs, withheld`, () => {
        const f = fixture(["compose.yml"], { "compose.yml": SVC });
        const w = f.wt(`${NEST}w1`);
        const p = f.wt(`${NEST}p1`, { "compose.yml": body() });
        expect(answer(p, ["compose.yml"], vars)).toEqual({ kind: "exit" });
        check(w, vars, { level: "FAIL", has: [/worktree [^\n]*p1's configured run: docker compose config exited \d+/], fix: [`cd ${shQuote(p)} && env ${OFF_ENV} docker compose`], never: [SECRET], name: null });
        expect(srv.hits()).toBe(0);
      });

      it(`row 33 (S1): the main checkout's compose file has a remote ${what}: nothing is fetched, FAIL check 2 for its runs, withheld`, () => {
        const f = fixture(["compose.yml"], { "compose.yml": body() });
        const w = f.wt(`${NEST}w1`, { "compose.yml": SVC });
        check(w, vars, { level: "FAIL", has: [/the main checkout's configured run: docker compose config exited \d+/], never: [SECRET], name: null });
        expect(srv.hits()).toBe(0);
      });
    }

    it("row 34 (S1): a peer's .env turns the remote loaders on and the shell sets COMPOSE_EXPERIMENTAL_GIT_REMOTE=1: nothing is fetched, withheld", () => {
      const f = fixture(["compose.yml"], { "compose.yml": SVC });
      const w = f.wt(`${NEST}w1`);
      const p = f.wt(`${NEST}p1`, { "compose.yml": include() });
      put(p, ".env", "COMPOSE_EXPERIMENTAL_GIT_REMOTE=1\nCOMPOSE_EXPERIMENTAL_OCI_REMOTE=1\nGIT_ALLOW_PROTOCOL=http\n");
      check(w, { ...vars, COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1" }, { level: "FAIL", has: [/worktree [^\n]*p1's configured run: docker compose config exited \d+/], never: [SECRET], name: null });
      expect(srv.hits()).toBe(0);
    });

    it("row 35 (S1): this worktree's own file has a remote include and the shell sets COMPOSE_EXPERIMENTAL_GIT_REMOTE=1: nothing is fetched, FAIL check 2, the derived name kept", () => {
      const f = fixture(["compose.yml"], { "compose.yml": SVC });
      const w = f.wt(`${NEST}w1`, { "compose.yml": include() });
      check(w, { ...vars, COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1" }, { level: "FAIL", has: [/this worktree's configured run: docker compose config exited \d+/], never: [SECRET], name: f.derived(w) });
      expect(srv.hits()).toBe(0);
    });
  });
});
