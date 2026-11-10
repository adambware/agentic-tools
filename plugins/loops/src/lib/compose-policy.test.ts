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

/** `quiet`, recording the cwd of each fallback probe (`config --no-interpolate`); `noNormalize` false: a Compose without --no-normalize. */
function fallbacks(raw: string[], noNormalize = true): Runner {
  const inner = quiet();
  return (cmd, args, opts) => {
    if (isComposeConfigCall(cmd, args) && args.includes("--no-interpolate")) {
      raw.push(opts?.cwd ?? "");
      if (!noNormalize && args.includes("--no-normalize")) return { code: 1, stdout: "", stderr: "unknown flag: --no-normalize\n", timedOut: false };
    }
    return inner(cmd, args, opts);
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
  /** Fragments of the peer WARNs (e.project WARN rows, also on --compose-project's stderr); none when absent. */
  warn?: (string | RegExp)[];
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
  const all = (JSON.parse(j.out).results as JsonResult[]).filter((r) => r.id.startsWith("e.project"));
  const rs = all.filter((r) => r.level !== "WARN");
  const warns = all.filter((r) => r.level === "WARN");
  const warnText = warns.map((r) => `${r.message} — fix: ${r.fix}`).join("\n");
  expect(warns.length > 0, warnText).toBe(!!want.warn?.length);
  for (const h of want.warn ?? []) typeof h === "string" ? expect(warnText).toContain(h) : expect(warnText).toMatch(h);
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
  // A peer WARN goes to stderr after any FAIL line and never changes the exit (checked above).
  for (const w of warns) expect(p.err).toContain(`env-check: warning: ${w.message} — fix: ${w.fix}`);
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
  it("row 28b (M3, U1): the same invalid peer, run from another worktree: PASS, one peer WARN, the derived name kept", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const p = f.wt(`${NEST}p1`, { "compose.yml": "services: [\n" });
    const w = f.wt(`${NEST}w1`);
    // W's own runs answer w1, its root's directory name, so the peer's failure is the only gap.
    expect([answer(p, ["compose.yml"]), answer(w)]).toEqual([{ kind: "exit" }, { name: "w1" }]);
    check(w, {}, {
      level: "PASS",
      has: [derivedPass(f.derived(w))],
      // 0.8.0 (U1): a peer's failed probe no longer withholds; its derived name is held, the gap is a WARN.
      warn: [new RegExp(`^peer worktree ${re(p)}: configured run: docker compose config exited \\d+, and 1 more run; this checkout keeps project ${re(f.derived(w))}`), `fix: run bin/env-check in ${p} (its e.project row names the fix there); if that worktree is abandoned, git worktree remove ${shQuote(p)}`],
      name: f.derived(w),
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

    it("rows 32-35 control (M16): Compose run directly with the remote loaders on fetches each form, so their 0 hits mean the switches held", () => {
      const ON = { ...vars, COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1", COMPOSE_EXPERIMENTAL_OCI_REMOTE: "1" };
      let seen = 0;
      for (const [what, body] of Object.entries(remote)) {
        const f = fixture(["compose.yml"], { "compose.yml": body() });
        // Not through loops or composeName: no REMOTE_OFF, and baseEnv sets no GIT_ALLOW_PROTOCOL, so git may use http.
        run("docker", ["compose", "-f", "compose.yml", "config", "--no-env-resolution", "-q"], { cwd: f.main, env: { ...baseEnv(), ...ON } });
        expect(srv.hits(), what).toBeGreaterThan(seen);
        seen = srv.hits();
      }
    });

    for (const [what, body] of Object.entries(remote)) {
      it(`row 32 (S1, U1): a peer's compose file has a remote ${what}: nothing is fetched (the fallback neither), PASS with a peer WARN, kept`, () => {
        const f = fixture(["compose.yml"], { "compose.yml": SVC });
        const w = f.wt(`${NEST}w1`);
        const p = f.wt(`${NEST}p1`, { "compose.yml": body() });
        expect(answer(p, ["compose.yml"], vars)).toEqual({ kind: "exit" });
        check(w, vars, { level: "PASS", has: [derivedPass(f.derived(w))], warn: [new RegExp(`^peer worktree ${re(p)}: configured run: docker compose config exited \\d+`)], never: [SECRET], name: f.derived(w) });
        expect(srv.hits()).toBe(0);
      });

      it(`row 33 (S1, U1): the main checkout's compose file has a remote ${what}: nothing is fetched, PASS with a main-checkout WARN, kept`, () => {
        const f = fixture(["compose.yml"], { "compose.yml": body() });
        const w = f.wt(`${NEST}w1`, { "compose.yml": SVC });
        // The main checkout's derived name (app-node) is held for its failed runs (A1b); W's slug-hash name is not it.
        check(w, vars, { level: "PASS", has: [derivedPass(f.derived(w))], warn: [new RegExp(`^main checkout ${re(f.main)}: configured run: docker compose config exited \\d+`)], never: [SECRET], name: f.derived(w) });
        expect(srv.hits()).toBe(0);
      });
    }

    it("row 34 (S1, U1): a peer's .env turns the remote loaders on and the shell sets COMPOSE_EXPERIMENTAL_GIT_REMOTE=1: nothing is fetched, even by the fallback; PASS with a peer WARN", () => {
      const f = fixture(["compose.yml"], { "compose.yml": SVC });
      const w = f.wt(`${NEST}w1`);
      const p = f.wt(`${NEST}p1`, { "compose.yml": include() });
      put(p, ".env", "COMPOSE_EXPERIMENTAL_GIT_REMOTE=1\nCOMPOSE_EXPERIMENTAL_OCI_REMOTE=1\nGIT_ALLOW_PROTOCOL=http\n");
      const raw: string[] = [];
      check(w, { ...vars, COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1" }, { level: "PASS", has: [derivedPass(f.derived(w))], warn: [new RegExp(`^peer worktree ${re(p)}: configured run: docker compose config exited \\d+`)], never: [SECRET], name: f.derived(w) }, fallbacks(raw));
      // The fallback did run there (uninterpolated, so the URL's variable stays unexpanded) and fetched nothing either.
      expect(raw.filter((c) => c.startsWith(p)).length).toBeGreaterThan(0);
      expect(srv.hits()).toBe(0);
    });

    it("row 35 (S1): this worktree's own file has a remote include and the shell sets COMPOSE_EXPERIMENTAL_GIT_REMOTE=1: nothing is fetched, FAIL check 2, the derived name kept", () => {
      const f = fixture(["compose.yml"], { "compose.yml": SVC });
      const w = f.wt(`${NEST}w1`, { "compose.yml": include() });
      check(w, { ...vars, COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1" }, { level: "FAIL", has: [/this worktree's configured run: docker compose config exited \d+/], never: [SECRET], name: f.derived(w) });
      expect(srv.hits()).toBe(0);
    });
  });

  it("row 36 (M13): the main checkout, committed name: app, shell COMPOSE_PROJECT_NAME=feat: PASS feat (check 4 is a worktree's)", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("app") });
    // The scrubbed run answers app, neither feat nor an own name; only a worktree's runs are held to its own names (row 7b).
    expect([answer(f.main, ["compose.yml"], { COMPOSE_PROJECT_NAME: "feat" }), answer(f.main, ["compose.yml"])]).toEqual([{ name: "feat" }, { name: "app" }]);
    check(f.main, { COMPOSE_PROJECT_NAME: "feat" }, { level: "PASS", has: ["feat (COMPOSE_PROJECT_NAME"], name: "feat" });
  });

  // U1 (0.8.0): a broken peer keeps this checkout's name unless a name knowable for it collides. "Broken" below is a
  // ${LOOPS_IMG:?} image with no value anywhere (kind interp), which the fallback reads past without interpolating.
  const BROKEN = "services:\n  web:\n    image: ${LOOPS_IMG:?set it}\n";
  const brokenNamed = (n: string) => `name: ${n}\n${BROKEN}`;
  const TEMPLATED = "its name: reads a variable loops could not resolve from that worktree's .env";
  const peerWarn = (p: string) => new RegExp(`^peer worktree ${re(p)}: configured run: docker compose config exited 1: required variable LOOPS_IMG is missing a value`);

  it("row 37 (U1): a peer needs ${LOOPS_IMG:?} and has no .env: PASS here with a peer WARN; the peer's own run FAILs naming the variable, its name kept", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`, { "compose.yml": BROKEN });
    expect(answer(p, ["compose.yml"])).toEqual({ kind: "interp" });
    check(w, {}, { level: "PASS", has: [derivedPass(f.derived(w))], warn: [peerWarn(p)], name: f.derived(w) });
    check(p, {}, { level: "FAIL", has: ["this worktree's configured run: docker compose config exited 1: required variable LOOPS_IMG is missing a value"], fix: [`set LOOPS_IMG in ${p}/.env or export it`], name: f.derived(p) });
  });

  it("row 38 (U1, A1c): a broken peer's literal name: is this worktree's derived name: FAIL held by that peer (the fallback reads it), withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed(n) });
    expect(answer(p, ["compose.yml"])).toEqual({ kind: "interp" });
    check(w, {}, { level: "FAIL", has: [`this worktree would use project ${n}, which worktree ${p} uses`], warn: [peerWarn(p), "this checkout's project"], name: null });
  });

  it("row 38b (U1, A1c): a broken peer without name: whose .env COMPOSE_PROJECT_NAME is this worktree's name: FAIL held by that peer, withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    const p = f.wt(`${NEST}p1`, { "compose.yml": BROKEN });
    put(p, ".env", `COMPOSE_PROJECT_NAME=${n}\n`);
    expect(answer(p, ["compose.yml"])).toEqual({ kind: "interp" });
    check(w, {}, { level: "FAIL", has: [`this worktree would use project ${n}, which worktree ${p} uses`], warn: [peerWarn(p)], name: null });
  });

  it("row 38c (U1, A1c): the same literal name: on a Compose without --no-normalize: the fallback fails, holds nothing, PASS with the peer WARN", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed(n) });
    const raw: string[] = [];
    check(w, {}, { level: "PASS", has: [derivedPass(n)], warn: [peerWarn(p)], name: n }, fallbacks(raw, false));
    expect(raw.length).toBeGreaterThan(0);
  });

  it("row 39 (U1, A1c): a broken peer's name: ${PN:-x}, the shell naming this worktree pn-x: no false FAIL (the template's normalized form is not held), the peer WARN", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed("${PN:-x}") });
    // Plain --no-interpolate would report pn-x, a name nobody runs under.
    const raw = run("docker", ["compose", "-f", "compose.yml", "config", "--no-env-resolution", "--no-interpolate", "--format", "json"], { cwd: p, env: baseEnv() });
    expect(JSON.parse(raw.stdout).name).toBe("pn-x");
    // The default resolves the template (x is held), so the WARN does not call it unresolved.
    check(w, { COMPOSE_PROJECT_NAME: "pn-x" }, { level: "PASS", has: ["pn-x (COMPOSE_PROJECT_NAME)"], warn: [peerWarn(p)], never: [TEMPLATED], name: "pn-x" });
  });

  it("row 39c (U1, A1c): a broken peer's name: ${STACK}, its .env STACK=<this worktree's derived name>: FAIL held by that peer, withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed("${STACK}") });
    put(p, ".env", `STACK=${n}\n`);
    expect(answer(p, ["compose.yml"])).toEqual({ kind: "interp" });
    check(w, {}, { level: "FAIL", has: [`this worktree would use project ${n}, which worktree ${p} uses`], warn: [peerWarn(p)], never: [TEMPLATED], name: null });
  });

  it("row 39d (U1, A1c): a broken peer's name: ${PN:-x} with no PN, the shell naming this worktree x: FAIL held by that peer (the default is its name), withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed("${PN:-x}") });
    // Once fixed, the peer runs as x.
    expect(answer(p, ["compose.yml"], { LOOPS_IMG: "nginx" })).toEqual({ name: "x" });
    check(w, { COMPOSE_PROJECT_NAME: "x" }, { level: "FAIL", has: [byPeer("x", p)], warn: [peerWarn(p)], name: null });
  });

  it("row 39f (U1, A1c): a broken peer's name: ${STACK}, no STACK, its .env COMPOSE_PROJECT_NAME=stack: FAIL held by that peer, withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed("${STACK}") });
    // The .env name equals the template's normalized form, so only reading the .env shows it is set.
    put(p, ".env", "COMPOSE_PROJECT_NAME=stack\n");
    expect(answer(p, ["compose.yml"])).toEqual({ kind: "interp" });
    check(w, { COMPOSE_PROJECT_NAME: "stack" }, { level: "FAIL", has: [byPeer("stack", p)], warn: [peerWarn(p)], never: [TEMPLATED], name: null });
  });

  it("row 39g (U1, A1c): a broken peer's name: ${STACK}, its .env STACK='<name>\\'s' (escaped quote): FAIL held by that peer, withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed("${STACK}") });
    put(p, ".env", "STACK='feat\\'s'\n");
    expect(answer(p, ["compose.yml"], { LOOPS_IMG: "nginx" })).toEqual({ name: "feats" });
    check(w, { COMPOSE_PROJECT_NAME: "feats" }, { level: "FAIL", has: [byPeer("feats", p)], warn: [peerWarn(p)], name: null });
  });

  it("row 39e (U1, A1c): a broken peer's name: ${STACK} and no .env: nothing held for it, PASS with the templated WARN", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed("${STACK}") });
    expect(answer(p, ["compose.yml"])).toEqual({ kind: "interp" });
    check(w, { COMPOSE_PROJECT_NAME: "stack" }, { level: "PASS", has: ["stack (COMPOSE_PROJECT_NAME)"], warn: [peerWarn(p), TEMPLATED], name: "stack" });
  });

  it("row 39b (U1, A1c): a broken peer's name: ${LOOPS_X} and its .env COMPOSE_PROJECT_NAME is this worktree's name: FAIL held by that peer, withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    const p = f.wt(`${NEST}p1`, { "compose.yml": brokenNamed("${LOOPS_X}") });
    put(p, ".env", `COMPOSE_PROJECT_NAME=${n}\n`);
    expect(answer(p, ["compose.yml"])).toEqual({ kind: "interp" });
    check(w, {}, { level: "FAIL", has: [`this worktree would use project ${n}, which worktree ${p} uses`], warn: [peerWarn(p)], name: null });
  });

  it("row 40 (U1, A1b): the main checkout's probe fails and this worktree's dirname name is the main checkout's: FAIL held by it, withheld", () => {
    const f = fixture(["docker/compose.yml"], { "docker/compose.yml": BROKEN }, "dirname");
    const w = f.wt(`${NEST}w1`, { "docker/compose.yml": SVC });
    expect([answer(f.main, ["docker/compose.yml"]), f.derived(w)]).toEqual([{ kind: "interp" }, "docker"]);
    // A3: both paths are named; the project directory is docker/ in every checkout, so only slug-hash helps.
    const text = check(w, {}, { level: "FAIL", has: [byMain("docker"), `the main checkout ${f.main} and this worktree ${w} derive one name under derive = "dirname"`], fix: ['set derive = "slug-hash"', "renames every worktree's project, so first stop each worktree's stack (docker compose down, without -v)"], warn: [new RegExp(`^main checkout ${re(f.main)}: configured run: docker compose config exited 1: required variable LOOPS_IMG`)], name: null });
    expect(text).not.toContain("git worktree move");
  });

  it("row 40b (A3): the main checkout's probe fails and a root-level worktree directory is named like it: FAIL withheld, the fix names git worktree move and slug-hash", () => {
    const f = fixture(["compose.yml"], { "compose.yml": BROKEN }, "dirname");
    const w = f.wt("other/app-node", { "compose.yml": SVC });
    expect([answer(f.main, ["compose.yml"]), f.derived(w)]).toEqual([{ kind: "interp" }, "app-node"]);
    check(w, {}, { level: "FAIL", has: [byMain("app-node"), `the main checkout ${f.main} and this worktree ${w}`], fix: [`git worktree move ${shQuote(w)} <new-path>`, 'set derive = "slug-hash"', "without -v"], warn: [new RegExp(`^main checkout ${re(f.main)}: `)], name: null });
  });

  it("row 40c (A3): the main checkout probes fine with name: x and a worktree directory is named like it: PASS (only x is held)", () => {
    const f = fixture(["compose.yml"], { "compose.yml": named("x") }, "dirname");
    const w = f.wt("other/app-node", { "compose.yml": SVC });
    expect([answer(f.main, ["compose.yml"]), answer(w, ["compose.yml"]), f.derived(w)]).toEqual([{ name: "x" }, { name: "app-node" }, "app-node"]);
    check(w, {}, { level: "PASS", has: ["app-node (derived: dirname)"], name: "app-node" });
  });

  it("row 41 (U1): a broken peer and a running container labeled with this worktree's name from that peer: FAIL check 5, withheld", () => {
    const f = fixture(["compose.yml"], { "compose.yml": SVC });
    const w = f.wt(`${NEST}w1`);
    const n = f.derived(w);
    const p = f.wt(`${NEST}p1`, { "compose.yml": BROKEN });
    const line = JSON.stringify([`${n}-web-1`, "running", "2026-11-01 17:00:00 -0400 EDT", n, p, join(p, "compose.yml"), ""]);
    const inner = quiet();
    const ps: Runner = (cmd, args, opts) => (cmd === "docker" && args[0] === "ps" ? { code: 0, stdout: `${line}\n`, stderr: "", timedOut: false } : inner(cmd, args, opts));
    check(w, {}, { level: "FAIL", has: [`project ${n} was started from project directory ${p} (worktree ${p})`], warn: [peerWarn(p)], name: null }, ps);
  });
});
