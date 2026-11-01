import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { run, type Runner, type RunResult } from "./proc.js";
import { composeStub, deps, put, repo, sh, shim, tmp, type ComposeAnswer, type ComposeAnswers, type ComposeCall } from "./testkit.js";
import { VERSION } from "./version.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const V = VERSION.replace(/\./g, "\\.");
const HEAD = "schema_version = 1\n";
const CFG = ".loops/env-check.toml";
const GO_PIN = `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod", "tool-versions"]\ncompare = "minor"\n`;
const GO_FILES = { "go.mod": "module x\n\ngo 1.26\n", ".tool-versions": "go 1.26.1\n" };

/** A repo with the files and config written (not committed), and the PATH that finds `shims`. */
function setup(config: string, files: Record<string, string> = {}): string {
  const root = repo({ "README.md": "x\n", ...files });
  put(root, CFG, config);
  return root;
}
const commit = (root: string): void => (sh(root, "add", "-A"), void sh(root, "commit", "-q", "-m", "more"));
let n = 0;
function worktree(root: string, name: string, parent = tmp()): string {
  const wt = join(parent, name);
  sh(root, "worktree", "add", "-q", "-b", `b${n++}`, wt);
  return wt;
}
/** Runs everything for real, except that git ls-files `flag` fails. */
const lsFails = (flag: string): Runner => (cmd, args, opts) => (cmd === "git" && args[0] === "ls-files" && args[1] === flag ? { code: 128, stdout: "", stderr: "fatal: index file corrupt", timedOut: false } : run(cmd, args, opts));
const withPath = (...dirs: string[]) => ({ PATH: [...dirs, process.env.PATH].join(":") });
const goShim = (v = "1.26.1") => shim("go", `[ "$GOTOOLCHAIN" = local ] && [ "$GOPROXY" = off ] || exit 9\necho "go version go${v} darwin/arm64"`);

function check(cwd: string, args: string[] = [], env: Record<string, string> = {}, runner?: Runner) {
  const t = deps(cwd, env);
  if (runner) t.d.run = runner;
  const code = main(["env-check", ...args], t.d);
  return { code, out: t.out.join("\n"), err: t.err.join("\n"), lines: t.out.join("\n").split("\n") };
}
const rp = (p: string): string => realpathSync(p);
/**
 * `check` with `docker compose config` stubbed from `answers` (see composeStub). Every probe's env is asserted: this
 * checkout's probes (cwd the checkout or a directory under it) get the shell's COMPOSE_* as passed, the main checkout's
 * and peers' get none, and all keep the rest.
 */
function checkC(cwd: string, answers: ComposeAnswers, args: string[] = [], env: Record<string, string> = {}) {
  const calls: ComposeCall[] = [];
  const r = check(cwd, args, env, composeStub(answers, calls));
  const own = rp(cwd);
  const composeOf = (e: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(e).filter(([k]) => k.startsWith("COMPOSE_")));
  for (const c of calls) {
    expect([typeof c.env.PATH, c.env.HOME]).toEqual(["string", env.HOME ?? "/nonexistent-home"]);
    for (const [k, v] of Object.entries(env)) if (!k.startsWith("COMPOSE_")) expect(c.env[k]).toBe(v);
    expect(composeOf(c.env)).toEqual(`${rp(c.cwd)}/`.startsWith(`${own}/`) ? composeOf(env) : {});
  }
  return { ...r, calls };
}
const local = (root: string, id: string, script: string, extra = "", exec = true): string => {
  const rel = `.loops/checks/${id.replace(/\W/g, "_")}.sh`;
  put(root, rel, `#!/bin/sh\n${script}\n`, exec);
  return `\n[[local]]\nid = "${id}"\nrun = "${rel}"\n${extra}`;
};

describe("pins and local toolchains", () => {
  it("passes when sources agree and the local toolchain matches, probing offline", () => {
    const r = check(setup(GO_PIN, GO_FILES), [], withPath(goShim()));
    expect(r.code).toBe(0);
    expect(r.lines).toEqual([
      "PASS a.pins.go  go 1.26.1 (go-mod:go.mod, tool-versions:.tool-versions)",
      "PASS a.local.go  local go 1.26.1 matches pin 1.26.1",
      "env-check: 0 FAIL, 0 WARN, 2 PASS, 0 SKIP",
    ]);
  });

  it("fails on disagreeing sources and on an unparseable source, without probing", () => {
    const drift = check(setup(GO_PIN.replace("minor", "exact"), { ...GO_FILES, ".tool-versions": "go 1.25.0\n" }), [], withPath(goShim()));
    expect(drift.code).toBe(1);
    expect(drift.out).toContain("FAIL a.pins.go  go-mod:go.mod=1.26, tool-versions:.tool-versions=1.25.0 disagree (exact) — fix:");
    expect(drift.out).not.toContain("a.local");
    const miss = check(setup(GO_PIN, { "go.mod": "module x\n" }));
    expect([miss.code, miss.out]).toEqual([1, expect.stringContaining("FAIL a.pins.go  go-mod: no go version found in go.mod")]);
  });

  it.each([
    ["nvmrc 22.1.0 above the engines floor", "22.1.0", ">=20.11.0", 0, "PASS a.pins.node"],
    ["nvmrc 18.2.0 below the engines floor", "18.2.0", ">=20.0.0", 1, "FAIL a.pins.node  nvmrc:.nvmrc=18.2.0 below the floor 20.0.0"],
  ])("exact compare treats an engines range as a floor: %s", (_n, nvmrc, range, code, line) => {
    const cfg = `${HEAD}[[pins]]\ntool = "node"\nsources = ["nvmrc", "engines"]\ncompare = "exact"\n`;
    const r = check(setup(cfg, { ".nvmrc": `${nvmrc}\n`, "package.json": JSON.stringify({ engines: { node: range } }) }));
    expect(r.code).toBe(code);
    expect(r.out).toContain(line);
    expect(r.out).not.toContain("disagree");
  });

  it.each([
    ["warn", "1.25.0", 0, "WARN a.local.go  local go 1.25.0 does not match pin 1.26.1"],
    ["fail", "1.25.0", 1, "FAIL a.local.go  local go 1.25.0 does not match pin 1.26.1"],
    ["warn", "1.26.7", 0, "PASS a.local.go"], // minor compare ignores the patch
  ])("local = %s with go %s exits %i", (level, have, code, line) => {
    const root = setup(`${GO_PIN}local = "${level}"\n`, GO_FILES);
    const r = check(root, [], withPath(goShim(have)));
    expect(r.code).toBe(code);
    expect(r.out).toContain(line);
  });

  it("treats a missing tool as the configured level and local = off as no check", () => {
    expect(check(setup(`${GO_PIN}local = "fail"\n`, GO_FILES), [], { PATH: tmp() }).out).toContain("FAIL a.local.go  go not found or gave no version");
    expect(check(setup(`${GO_PIN}local = "off"\n`, GO_FILES)).out).not.toContain("a.local");
  });

  it("probes with a timeout and reports a hung probe as timed out at the local level", () => {
    const seen: (number | undefined)[] = [];
    const hung: Runner = (cmd, args, opts) => (cmd === "go" ? (seen.push(opts?.timeoutMs), { code: null, stdout: "", stderr: "", timedOut: true }) : run(cmd, args, opts));
    const r = check(setup(`${GO_PIN}local = "fail"\n`, GO_FILES), [], {}, hung);
    expect(seen).toEqual([10_000]);
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL a.local.go  go version timed out after 10s — fix: install go 1.26.1")]);
  });
});

describe("--static", () => {
  const cfg = `${GO_PIN}local = "fail"\n[shared_checkout]\nhint = "use a worktree"\n[harness]\ntools = ["nope-tool"]\n`;
  it.each([[["--static"], {}], [[], { CI: "true" }]])("%j %j reads files only: no toolchain, tool or worktree probes", (args, env) => {
    const never = shim("go", "exit 9");
    const r = check(setup(cfg, GO_FILES), args, { ...withPath(never), ...env });
    expect(r.code).toBe(0);
    expect(r.out).toContain("SKIP c.shared  not checked in --static mode");
    expect(r.out).not.toContain("a.local");
    expect(r.out).not.toContain("d.tools");
  });
});

describe("c.shared", () => {
  const cfg = `${HEAD}[shared_checkout]\nhint = "git worktree add .claude/worktrees/<name>"\n`;
  it("fails in the shared checkout with the hint, passes in a linked worktree, honours ENV_CHECK_ALLOW_MAIN", () => {
    const root = setup(cfg);
    commit(root);
    const r = check(root);
    expect([r.code, r.lines[0]]).toEqual([1, "FAIL c.shared  this is the shared checkout; agents and branches belong in a worktree — fix: git worktree add .claude/worktrees/<name>"]);
    expect(check(root, [], { ENV_CHECK_ALLOW_MAIN: "0" }).code).toBe(1); // only "1" allows it
    expect(check(root, [], { ENV_CHECK_ALLOW_MAIN: "1" })).toMatchObject({ code: 0, out: expect.stringContaining("INFO c.shared  shared checkout allowed by ENV_CHECK_ALLOW_MAIN") });
    expect(check(worktree(root, "feat-x")).lines[0]).toBe("PASS c.shared  in a linked worktree");
  });
});

describe("harness", () => {
  const run = (h: string, files: Record<string, string> = {}, tweak: (root: string) => void = () => {}) => {
    const root = setup(`${HEAD}[harness]\n${h}\n`, files);
    commit(root);
    tweak(root);
    return check(root);
  };

  it("d.tools lists what is missing from PATH", () => {
    expect(run('tools = ["git", "nope-tool", "nope-two"]').out).toContain("FAIL d.tools  missing on PATH: nope-tool, nope-two");
    expect(run('tools = ["git"]').out).toContain("PASS d.tools  present: git");
  });

  it("d.files needs present, non-empty files", () => {
    const r = run('files = ["VERSION", "go.sum", "README.md"]', { VERSION: "" });
    expect(r.out).toContain("FAIL d.files  missing or empty: VERSION, go.sum");
  });

  it("d.entrypoints auto reads ./commands from CI workflows and needs +x", () => {
    const wf = "jobs:\n  a:\n    steps:\n      - run: ./bin/ci.sh --fast\n      - run: |\n          ./scripts/x.sh\n          echo hi\n      - uses: ./.github/actions/local\n";
    const files = { ".github/workflows/ci.yml": wf, "bin/ci.sh*": "#!/bin/sh\n", "scripts/x.sh": "#!/bin/sh\n" };
    const r = run('entrypoints = "auto"', files);
    expect(r.out).toContain("FAIL d.entrypoints  missing or not executable: scripts/x.sh — fix: chmod +x scripts/x.sh");
    expect(run('entrypoints = ["bin/ci.sh"]', files).out).toContain("PASS d.entrypoints  1 executable");
    // A tracked workflow deleted from the worktree is d.tracked's finding, not a crash.
    const gone = run('entrypoints = "auto"\ntracked = true', files, (root) => rmSync(join(root, ".github/workflows/ci.yml")));
    expect([gone.code, gone.out]).toEqual([1, expect.stringContaining("FAIL d.tracked  deleted: .github/workflows/ci.yml")]);
  });

  it("d.tracked catches a deleted tracked file and a lost exec bit", () => {
    const files = { "a.txt": "a\n", "run.sh*": "#!/bin/sh\n" };
    expect(run("tracked = true", files).out).toContain("PASS d.tracked  no tracked file deleted, exec bits intact");
    const r = run("tracked = true", files, (root) => {
      rmSync(join(root, "a.txt"));
      chmodSync(join(root, "run.sh"), 0o644);
    });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL d.tracked  deleted: a.txt; exec bit lost: run.sh")]);
    // git quotes non-ASCII names unless -z; the report names the file as it is on disk.
    const u = run("tracked = true", { "ü.txt": "u\n" }, (root) => rmSync(join(root, "ü.txt")));
    expect(u.out).toContain("FAIL d.tracked  deleted: ü.txt");
    // A failing ls-files -d is a FAIL, not "no tracked file deleted".
    const root = setup(`${HEAD}[harness]\ntracked = true\n`, files);
    expect(check(root, [], {}, lsFails("-d"))).toMatchObject({ code: 1, out: expect.stringContaining("FAIL d.tracked  git ls-files failed") });
  });

  it("d.sparse warns when sparse checkout is on", () => {
    const r = run('sparse = "warn"', {}, (root) => sh(root, "config", "core.sparseCheckout", "true"));
    expect(r.out).toContain("WARN d.sparse  sparse checkout is enabled");
    expect(r.code).toBe(0);
  });
});

describe("compose", () => {
  const test = (extra = "") => `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml"]\n${extra}`;
  const COMPOSE = "name: app-prod\nservices:\n  web:\n    image: x\n";
  // Compose decides; the stub returns what v5.1.2 returned for each fixture. These two lines recur.
  const EMPTY = { error: "project name must not be empty" };
  const NO_FILE = { error: "no configuration file provided: not found" };
  const invalid = (n: string) => ({ error: `invalid project name "${n}": must consist only of lowercase alphanumeric characters, hyphens, and underscores as well as start with a letter or number` });
  const notString = (root: string) => `validating ${root}/compose.yml: name must be a string`;
  const PROBE_FIX = "fix the file until docker compose config accepts it, or set COMPOSE_PROJECT_NAME";
  const PROBE_FIX_SET = "fix the file, or the shell's COMPOSE_PROJECT_NAME, until docker compose config accepts them";

  it("mode none passes with no tracked compose file and fails when one is tracked", () => {
    expect(check(setup(`${HEAD}[compose]\nmode = "none"\n`)).out).toContain("PASS e.none  no compose file tracked");
    const r = check(setup(`${HEAD}[compose]\n`, { "deploy/docker-compose.dev.yml": COMPOSE }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining('FAIL e.none  config says compose mode none but deploy/docker-compose.dev.yml is tracked — fix: set [compose] mode = "test"')]);
  });

  it.each(["docker-compose-dev.yml", "ops/compose-prod.yaml", "Docker-Compose.yml", "COMPOSE.YAML"])("mode none fails when %s is tracked", (f) => {
    const r = check(setup(`${HEAD}[compose]\n`, { [f]: COMPOSE }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.none  config says compose mode none but ${f} is tracked`)]);
  });

  it("mode none ignores names that only contain compose", () => {
    expect(check(setup(`${HEAD}[compose]\n`, { "composer.yml": "x: 1\n", "my-compose.yml": "x: 1\n" })).out).toContain("PASS e.none  no compose file tracked");
  });

  it.each([".github/workflows/compose-lint.yml", "compose-ci.yml", "docs/compose-spec.yaml"])("mode none ignores %s when it is not a Compose file", (f) => {
    const r = check(setup(`${HEAD}[compose]\n`, { [f]: "name: lint\non: push\njobs:\n  t:\n    services:\n      db:\n        image: x\n" }));
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.none  no compose file tracked")]);
  });

  it("mode none ignores a dash-suffixed file whose merged documents hold keys Compose does not allow", () => {
    const k8s = "apiVersion: v1\nkind: Service\n---\napiVersion: v1\nkind: Pod\n";
    const r = check(setup(`${HEAD}[compose]\n`, { "deploy/compose-k8s.yaml": k8s, "compose-ci.yml": "a: 1\n---\nb: 2\n", "compose-lint.yml": "name: lint\nfoo: 1\n" }));
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.none  no compose file tracked")]);
  });

  it.each([
    ["declares only top-level networks", "ops/compose-net.yml", "networks:\n  edge: {}\n"],
    ["declares only an include", "compose-dev.yaml", "include:\n  - compose.base.yml\n"],
    ["is not valid YAML", "compose-ci.yml", "services: [\n"],
    ["has services in a later document", "compose-ci.yml", "x-a: 1\n---\nservices: {}\n"],
    ["declares only top-level models", "compose-dev.yml", "models:\n  m:\n    model: ai/smollm2\n"],
    ["gets services through a top-level merge key", "compose-dev.yml", "x-base: &b\n  services:\n    web:\n      image: nginx\n<<: *b\n"],
    ["is a name-only overlay", "compose-dev.yml", "name: app-dev\n"],
    ["holds only a name and extension keys", "compose-dev.yml", "name: app-dev\nx-env: &e {A: 1}\nx-more: *e\n"],
  ])("mode none still fails a dash-suffixed file that %s", (_n, f, body) => {
    const r = check(setup(`${HEAD}[compose]\n`, { [f]: body }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.none  config says compose mode none but ${f} is tracked`)]);
  });

  it("mode none counts a dot-suffixed or bare name whatever it holds, and a tracked dash file it cannot read", () => {
    const r = check(setup(`${HEAD}[compose]\n`, { "ci/docker-compose.ci.yml": "name: lint\non: push\n" }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.none  config says compose mode none but ci/docker-compose.ci.yml is tracked")]);
    const gone = setup(`${HEAD}[compose]\n`, { "compose-dev.yml": "services: {}\n" });
    rmSync(join(gone, "compose-dev.yml"));
    expect(check(gone).out).toContain("FAIL e.none  config says compose mode none but compose-dev.yml is tracked");
  });

  it("uses the file's name in the main checkout and a derived name in a worktree with none", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    expect(checkC(root, { [root]: "app-prod" }, ["--compose-project"]).out).toBe("app-prod");
    expect(checkC(root, { [root]: "app-prod" }).out).toContain("PASS e.project  app-prod (name: in compose file)");
    const bare = setup(test(), { "compose.yml": "services: {}\n" });
    commit(bare);
    const wt = worktree(bare, "Feat_X.1");
    // Compose lowercases and drops (does not replace) invalid characters in a directory name.
    const A = { [bare]: "app-node", [wt]: "feat_x1" };
    expect(checkC(wt, A, ["--compose-project"]).out).toBe("feat_x1");
    expect(checkC(wt, A).out).toContain("PASS e.project  feat_x1 (derived: dirname)");
  });

  it("resolves the compose project once per run", () => {
    // One configured probe of this checkout per run, whether the run prints the name or the full report.
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const own = (args: string[]): number => checkC(root, { [root]: "app-prod" }, args).calls.filter((c) => c.files.length && rp(c.cwd) === root).length;
    expect(own(["--compose-project"])).toBe(1);
    expect(own([])).toBe(1);
  });

  it("passes DOCKER_CONFIG and the shell's COMPOSE_* to this checkout's probes, and only DOCKER_CONFIG to the main checkout's and peers'", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const peer = worktree(root, "feat-a");
    const wt = worktree(root, "feat-b");
    const env = { DOCKER_CONFIG: "/opt/docker-cfg", COMPOSE_PROJECT_NAME: "mine", COMPOSE_FILE: "compose.yml" };
    const r = checkC(wt, { [wt]: "mine", [root]: "app-prod", [peer]: "app-prod" }, [], env);
    expect(r.out).toContain("PASS e.project  mine (COMPOSE_PROJECT_NAME)");
    // Own configured, main configured, main plain, peer configured, peer plain; no own plain under a shell COMPOSE_PROJECT_NAME.
    expect(r.calls.map((c) => [rp(c.cwd), c.files])).toEqual([[wt, ["compose.yml"]], [root, ["compose.yml"]], [root, []], [peer, ["compose.yml"]], [peer, []]]);
    for (const c of r.calls) expect([c.env.DOCKER_CONFIG, c.env.HOME, typeof c.env.PATH]).toEqual(["/opt/docker-cfg", "/nonexistent-home", "string"]);
    expect(r.calls[0]!.env).toMatchObject(env);
    for (const c of r.calls.slice(1)) expect(Object.keys(c.env).filter((k) => k.startsWith("COMPOSE_"))).toEqual([]);
  });

  it("skips e.project when Compose is unavailable, handing down only a name loops can vouch for", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-u");
    const docker = { unavailable: "docker" as const };
    const plugin = { unavailable: "plugin" as const };
    // The main checkout has no vouchable name: SKIP, never PASS, and nothing else is probed.
    const m = checkC(root, { [root]: docker });
    expect([m.code, m.calls.length]).toEqual([0, 1]);
    expect(m.out).toContain("SKIP e.project  compose unavailable (docker is not installed); nothing to collide with");
    expect(m.out).not.toContain("PASS e.project");
    const mp = checkC(root, { [root]: docker }, ["--compose-project"]);
    expect([mp.code, mp.out, mp.err]).toEqual([1, "", "env-check: compose unavailable (docker is not installed); nothing to collide with"]);
    // A worktree vouches for its derived name, or the shell's COMPOSE_PROJECT_NAME.
    const w = checkC(wt, { [wt]: plugin });
    expect([w.code, w.calls.length]).toEqual([0, 1]);
    expect(w.out).toContain("SKIP e.project  compose unavailable (compose plugin is not installed); nothing to collide with");
    expect(checkC(wt, { [wt]: plugin }, ["--compose-project"])).toMatchObject({ code: 0, out: "feat-u" });
    expect(checkC(wt, { [wt]: plugin }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" })).toMatchObject({ code: 0, out: "mine" });
    // Compose answering here but not for another checkout (a PATH shim) is still a SKIP with the vouchable name, never a FAIL.
    const peer = worktree(root, "feat-v");
    const s = checkC(wt, { [wt]: "feat-u", [root]: docker });
    expect([s.code, s.calls.length]).toEqual([0, 2]);
    expect(s.out).toContain("SKIP e.project  compose unavailable (docker is not installed); nothing to collide with");
    expect(checkC(wt, { [wt]: "feat-u", [root]: docker }, ["--compose-project"])).toMatchObject({ code: 0, out: "feat-u" });
    expect(checkC(wt, { [wt]: "feat-u", [root]: "app-prod", [peer]: plugin }).out).toContain("SKIP e.project  compose unavailable (compose plugin is not installed); nothing to collide with");
  });

  it("fails e.project on a Compose too old for --no-env-resolution, asking for an upgrade, and --compose-project exits 1", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-o");
    // It still runs stacks, so it is no "nothing to collide with" SKIP; a shell COMPOSE_PROJECT_NAME does not change the fix.
    const old = { error: "unknown flag: --no-env-resolution" };
    const why = "compose config: docker compose is too old (needs config --no-env-resolution) — fix: upgrade Docker Compose to one whose config takes --no-env-resolution";
    for (const cwd of [root, wt]) {
      const r = checkC(cwd, { [cwd]: old }, [], { COMPOSE_PROJECT_NAME: "mine" });
      expect([cwd, r.code, r.out]).toEqual([cwd, 1, expect.stringContaining(`FAIL e.project  ${why}`)]);
      const p = checkC(cwd, { [cwd]: old }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" });
      expect([cwd, p.code, p.out, p.err]).toEqual([cwd, 1, "", `env-check: ${why}`]);
    }
  });

  it("names a peer worktree by its configured files' answer, and its plain name never frees that one", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    const env = (n: string) => ({ COMPOSE_PROJECT_NAME: n });
    // Only b's .env explains its configured answer shared: b runs as shared under -p too, whatever its plain run picks.
    const fromEnv = checkC(a, { [root]: "app-node", [a]: "shared", [b]: { cfg: "shared", plain: "other" } }, [], env("shared"));
    expect([fromEnv.code, fromEnv.out]).toEqual([1, expect.stringContaining(`FAIL e.project  project name shared is also used by worktree ${b}`)]);
    // An override's name: moves only b's plain run; b's -p name is still its derived feat-b.
    const ovr = checkC(a, { [root]: "app-node", [a]: "feat-b", [b]: { cfg: "feat-b", plain: "ovr" } }, [], env("feat-b"));
    expect([ovr.code, ovr.out]).toEqual([1, expect.stringContaining(`FAIL e.project  project name feat-b is also used by worktree ${b}`)]);
    expect(checkC(a, { [root]: "app-node", [a]: "ovr", [b]: { cfg: "feat-b", plain: "ovr" } }, [], env("ovr")).code).toBe(1);
    // A peer without every configured file has no configured run to ask: it holds its derived name (and plain, from a worktree).
    rmSync(join(b, "compose.yml"));
    const gone = checkC(a, { [root]: "app-node", [a]: "feat-b" }, [], env("feat-b"));
    expect([gone.code, gone.calls.some((c) => rp(c.cwd) === rp(b))]).toEqual([1, false]);
    // A peer on a branch missing one of several configured files is not failed for it: only its plain run is asked.
    const two = setup(`${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.dev.yml"]\n`, { "compose.yml": "services: {}\n", "compose.dev.yml": "services: {}\n" });
    commit(two);
    const c2 = worktree(two, "feat-c");
    const d2 = worktree(two, "feat-d");
    rmSync(join(d2, "compose.dev.yml"));
    const part = checkC(c2, { [two]: "app-node", [c2]: "mine", [d2]: { cfg: { error: "open compose.dev.yml: no such file or directory" }, plain: "feat-d" } }, [], env("mine"));
    expect([part.code, part.out]).toEqual([0, expect.stringContaining("PASS e.project  mine (COMPOSE_PROJECT_NAME)")]);
  });

  it("probes the main checkout's plain run even when it lacks this branch's configured files", () => {
    const sub = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/compose.yml"]\n`;
    const root = setup(sub, { "deploy/compose.yml": "services: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-m");
    // The main checkout's branch keeps its stack in compose.yml at the root: plain Compose starts as near deploy/ as it can.
    rmSync(join(root, "deploy"), { recursive: true });
    put(root, "compose.yml", COMPOSE);
    const r = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    expect(r.calls.map((c) => [rp(c.cwd), c.files])).toEqual([[wt, ["deploy/compose.yml"]], [root, []]]);
    // Finding no file there at all, the main checkout runs nothing: no prod name to take.
    rmSync(join(root, "compose.yml"));
    expect(checkC(wt, { [root]: NO_FILE, [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(0);
  });

  it("derives the name from the first compose file's directory, as Compose does", () => {
    const sub = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/compose.yml"]\n`;
    const root = setup(sub, { "deploy/compose.yml": "services: {}\n" });
    commit(root);
    expect(checkC(root, { [root]: "deploy" }, ["--compose-project"]).out).toBe("deploy");
    // The .env Compose reads sits beside the first compose file, not at the repo root.
    put(root, ".env", "COMPOSE_PROJECT_NAME=fromroot\n");
    put(root, "deploy/.env", "COMPOSE_PROJECT_NAME=fromdeploy\n");
    expect(checkC(root, { [root]: "fromdeploy" }, ["--compose-project"]).out).toBe("fromdeploy");
    rmSync(join(root, ".env"));
    rmSync(join(root, "deploy/.env"));
    // Every worktree's configured run is project deploy too: the main checkout's. Plain runs are probed from the first
    // configured file's directory, so the main checkout's plain name is deploy as well.
    const wt = worktree(root, "feat-d");
    const r = checkC(wt, { [wt]: "deploy", [root]: "deploy", [join(root, "deploy")]: "deploy" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name deploy")]);
    expect(r.calls.map((c) => [rp(c.cwd), c.files])).toEqual([[wt, ["deploy/compose.yml"]], [root, ["deploy/compose.yml"]], [join(root, "deploy"), []]]);
    // slug-hash names worktrees only; the main checkout keeps Compose's default.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    expect(checkC(slug, { [slug]: "app-node" }, ["--compose-project"]).out).toBe("app-node");
  });

  it("treats a plain run that finds no compose file as no plain project, in any checkout", () => {
    // Only deploy/stack.yml: plain docker compose in deploy/ (and at the root) finds nothing, so it runs nothing.
    const only = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/stack.yml"]\nderive = "slug-hash"\n`;
    const root = setup(only, { "deploy/stack.yml": "services: {}\n" });
    commit(root);
    const peer = worktree(root, "feat-p");
    const wt = worktree(root, "feat-s");
    const A = { [root]: "deploy", [join(root, "deploy")]: NO_FILE, [peer]: "deploy", [join(peer, "deploy")]: NO_FILE, [wt]: "deploy", [join(wt, "deploy")]: NO_FILE };
    const r = checkC(wt, A);
    expect([r.code, r.out]).toEqual([0, expect.stringMatching(/PASS e\.project {2}app-node-feat-s-[0-9a-f]{6} \(derived: slug-hash\)/)]);
    expect(r.calls.map((c) => [rp(c.cwd), c.files])).toEqual([[wt, ["deploy/stack.yml"]], [root, ["deploy/stack.yml"]], [join(root, "deploy"), []], [peer, ["deploy/stack.yml"]], [join(peer, "deploy"), []], [join(wt, "deploy"), []]]);
    expect(checkC(wt, A, ["--compose-project"]).out).toMatch(/^app-node-feat-s-[0-9a-f]{6}$/);
    // A default-named file in deploy/ gives plain docker compose there the main checkout's name: the plain-run FAIL names the .env that run reads.
    const sub = setup(only.replace("stack.yml", "compose.yml"), { "deploy/compose.yml": "services: {}\n" });
    commit(sub);
    const ws = worktree(sub, "feat-s");
    const p = checkC(ws, { [sub]: "deploy", [join(sub, "deploy")]: "deploy", [ws]: "deploy", [join(ws, "deploy")]: "deploy" });
    const slug = "app-node-feat-s-[0-9a-f]{6}";
    expect([p.code, p.out]).toEqual([1, expect.stringMatching(new RegExp(`FAIL e\\.project {2}plain docker compose in this worktree would use the main checkout's project name deploy — fix: add COMPOSE_PROJECT_NAME=${slug} to deploy/\\.env, or always pass -p ${slug}`))]);
    // The not-found line is only ever a plain answer; from a configured probe it is Compose's error like any other.
    const f = checkC(wt, { ...A, [wt]: NO_FILE });
    expect([f.code, f.out]).toEqual([1, expect.stringContaining(`FAIL e.project  compose config: no configuration file provided: not found — fix: ${PROBE_FIX}`)]);
  });

  it("slug-hash appends a path hash, so equal basenames never collide", () => {
    const root = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    commit(root);
    const wa = worktree(root, "feat-x");
    const wb = worktree(root, "feat-x");
    const A = { [root]: "app-node", [wa]: "feat-x", [wb]: "feat-x" };
    const a = checkC(wa, A, ["--compose-project"]).out;
    const b = checkC(wb, A, ["--compose-project"]).out;
    expect(a).toMatch(/^app-node-feat-x-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
  });

  it("fails when a worktree would reuse the prod name, or two worktrees derive the same name", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "app-prod");
    const prod = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" });
    expect([prod.code, prod.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    const plain = setup(test(), { "compose.yml": "services: {}\n" });
    commit(plain);
    const d1 = worktree(plain, "dup");
    const d2 = worktree(plain, "dup");
    const dup = checkC(d2, { [plain]: "app-node", [d1]: "dup", [d2]: "dup" });
    expect(dup.out).toMatch(/FAIL e\.project {2}project name dup is also used by worktree .*dup/);
    // The prod name is the main checkout's name:, even when the worktree's compose file declares another.
    const renamed = worktree(root, "app-prod");
    put(renamed, "compose.yml", COMPOSE.replace("app-prod", "app-other"));
    expect(checkC(renamed, { [root]: "app-prod", [renamed]: "app-other" }).out).toContain("FAIL e.project  worktree would use the main checkout's project name app-prod");
    // With no compose file in the main checkout there is no prod stack, so the worktree's own name: is its own (before 0.5.0 it counted as prod).
    const bare = setup(test(), { "compose.yml": COMPOSE });
    commit(bare);
    const w = worktree(bare, "app-prod");
    rmSync(join(bare, "compose.yml"));
    const own = checkC(w, { [w]: "app-prod", [bare]: NO_FILE });
    expect([own.code, own.out]).toEqual([0, expect.stringContaining("PASS e.project  app-prod (derived: dirname)")]);
  });

  it("takes the prod name from the main checkout's directory when its compose file has no name:, whatever the worktree declares", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    const prod = checkC(root, { [root]: "app-node" }, ["--compose-project"]).out;
    const wt = worktree(root, "feat-a");
    put(wt, "compose.yml", "name: feat-stack\nservices: {}\n");
    const shell = checkC(wt, { [root]: prod, [wt]: prod }, [], { COMPOSE_PROJECT_NAME: prod });
    expect([shell.code, shell.out]).toEqual([1, expect.stringContaining(`FAIL e.project  worktree would use the main checkout's project name ${prod}`)]);
    // A .env name is this worktree's identity too (Compose's answer is neither its name: nor its directory), so it clashes as such.
    put(wt, ".env", `COMPOSE_PROJECT_NAME=${prod}\n`);
    expect(checkC(wt, { [root]: prod, [wt]: prod }).out).toContain(`FAIL e.project  worktree would use the main checkout's project name ${prod}`);
    rmSync(join(wt, ".env"));
    // Its own name: is not the main checkout's, but plain docker compose there still runs as feat-stack, not feat-a.
    const own = checkC(wt, { [root]: prod, [wt]: "feat-stack" });
    expect([own.code, own.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use its compose name: feat-stack, not feat-a — fix: add COMPOSE_PROJECT_NAME=feat-a to .env")]);
    put(wt, ".env", "COMPOSE_PROJECT_NAME=feat-a\n");
    expect(checkC(wt, { [root]: prod, [wt]: "feat-a" }).out).toContain("PASS e.project  feat-a (COMPOSE_PROJECT_NAME)");
  });

  it("COMPOSE_PROJECT_NAME wins, unless it is the prod name", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-y");
    expect(checkC(wt, { [root]: "app-prod", [wt]: "mine" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" }).out).toBe("mine");
    expect(checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
  });

  it("fails when a configured compose file is missing, naming it", () => {
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.test.yml"]\n`;
    const r = checkC(setup(two, { "compose.yml": COMPOSE }), {});
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  compose file missing: compose.test.yml")]);
    const both = setup(two, { "compose.yml": COMPOSE, "compose.test.yml": "services: {}\n" });
    expect(checkC(both, { [both]: "app-prod" }).out).toContain("PASS e.project  app-prod");
  });

  it("resolves interpolation in name: against the check's env, failing closed when it cannot", () => {
    const withName = (n: string) => setup(test(), { "compose.yml": `name: ${n}\nservices: {}\n` });
    const name = (n: string, want: ComposeAnswer, env: Record<string, string> = {}) => {
      const root = withName(n);
      return checkC(root, { [root]: want }, ["--compose-project"], env).out;
    };
    expect(name("${STACK_NAME:-app-prod}", "app-prod")).toBe("app-prod");
    expect(name("${STACK_NAME:-app-prod}", "other", { STACK_NAME: "other" })).toBe("other");
    // Compose: a name: that interpolates to the empty string is rejected; only a literal "" falls back to the directory.
    const dash = withName("${STACK_NAME-app-prod}");
    const r0 = checkC(dash, { [dash]: EMPTY }, [], { STACK_NAME: "" });
    expect([r0.code, r0.out]).toEqual([1, expect.stringContaining(`FAIL e.project  compose config: project name must not be empty — fix: ${PROBE_FIX}`)]);
    expect(name("${STACK_NAME-app-prod}", "app-prod")).toBe("app-prod");
    expect(name("$STACK_NAME", "bare", { STACK_NAME: "bare" })).toBe("bare");
    expect(name('"${STACK_NAME:-quoted}" # c', "quoted")).toBe("quoted");
    const bad: [string, { error: string }][] = [
      ["${STACK_NAME}", EMPTY],
      ["${STACK_NAME:?must set}", { error: "error while interpolating name: required variable STACK_NAME is missing a value: must set" }],
      ["$STACK_NAME", EMPTY],
    ];
    for (const [n, why] of bad) {
      const root = withName(n);
      const r = checkC(root, { [root]: why });
      expect([n, r.code, r.out]).toEqual([n, 1, expect.stringContaining(`FAIL e.project  compose config: ${why.error}`)]);
    }
    // A worktree on the main stack's interpolated default is the prod name.
    const root = withName("${STACK_NAME:-app-prod}");
    commit(root);
    const wt = worktree(root, "feat-z");
    const clash = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    // The shell's STACK_NAME reaches every checkout's probe (it is not a COMPOSE_* variable): main and worktree both run as x.
    const mainBad = withName("${STACK_NAME}");
    commit(mainBad);
    const fw = worktree(mainBad, "feat-w");
    expect(checkC(fw, { [mainBad]: "x", [fw]: "x" }, [], { STACK_NAME: "x" }).out).toContain("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name x");
    expect(checkC(fw, { [mainBad]: "x", [fw]: "feat-w" }, [], { STACK_NAME: "x", COMPOSE_PROJECT_NAME: "feat-w" }).code).toBe(0);
    // The main checkout's name: cannot resolve: Compose's error is the FAIL (before 0.5.0 it said "cannot be resolved").
    put(mainBad, "compose.yml", "name: ${OTHER}\nservices: {}\n");
    const fv = worktree(mainBad, "feat-v");
    expect(checkC(fv, { [mainBad]: EMPTY, [fv]: "x", [fw]: "x" }, [], { STACK_NAME: "x" }).out).toContain("FAIL e.project  the main checkout's compose config: project name must not be empty");
  });

  it("fails e.project in the main checkout and every other worktree when Compose fails on a peer worktree's files", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    const why = "required variable STACK is missing a value: set it";
    const answers = { [root]: "app-prod", [a]: "feat-a", [b]: { error: why } };
    for (const [cwd, env] of [[a, { COMPOSE_PROJECT_NAME: "feat-a" }], [root, {}]] as const) {
      const r = checkC(cwd, answers, [], env);
      // The peer's own shell decides its name, so the fix is the generic one even where this shell sets COMPOSE_PROJECT_NAME.
      expect([cwd, r.code, r.out]).toEqual([cwd, 1, expect.stringContaining(`FAIL e.project  worktree ${b}'s compose config: ${why} — fix: ${PROBE_FIX}`)]);
    }
  });

  it("interpolates name: against the checkout's .env too, and a COMPOSE_PROJECT_NAME there beats the file", () => {
    const root = setup(test(), { "compose.yml": "name: ${STACK_NAME:-dev}\nservices: {}\n" });
    commit(root);
    put(root, ".env", "# c\nexport STACK_NAME='live' # trailing\n");
    // The shell env beats .env.
    expect(checkC(root, { [root]: "shell" }, ["--compose-project"], { STACK_NAME: "shell" }).out).toBe("shell");
    expect(checkC(root, { [root]: "live" }, ["--compose-project"]).out).toBe("live");
    const wt = worktree(root, "feat-e");
    const clash = checkC(wt, { [root]: "live", [wt]: "live" }, [], { COMPOSE_PROJECT_NAME: "live" });
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name live")]);
    expect(checkC(wt, { [root]: "live", [wt]: "dev" }, [], { COMPOSE_PROJECT_NAME: "dev" }).code).toBe(0);
    // A name with no default resolves from .env alone.
    const only = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    expect(checkC(only, { [only]: EMPTY }).code).toBe(1);
    put(only, ".env", "STACK_NAME=fromenv\n");
    expect(checkC(only, { [only]: "fromenv" }, ["--compose-project"]).out).toBe("fromenv");
    // COMPOSE_PROJECT_NAME in main's .env is the real prod name, whatever the file declares.
    const pinned = setup(test(), { "compose.yml": COMPOSE });
    commit(pinned);
    const pwt = worktree(pinned, "feat-p");
    put(pinned, ".env", "COMPOSE_PROJECT_NAME=envprod\n");
    expect(checkC(pwt, { [pinned]: "envprod", [pwt]: "envprod" }, [], { COMPOSE_PROJECT_NAME: "envprod" }).code).toBe(1);
    expect(checkC(pwt, { [pinned]: "envprod", [pwt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(0);
    // The checkout's own .env names its project too; the shell still wins.
    expect(checkC(pinned, { [pinned]: "envprod", [pwt]: "app-prod" }, ["--compose-project"]).out).toBe("envprod");
    expect(checkC(pinned, { [pinned]: "shell", [pwt]: "app-prod" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "shell" }).out).toBe("shell");
  });

  it("passes an unresolvable name: under --static", () => {
    // An empty answer map throws on any probe: --static and CI=true never spawn Compose.
    const root = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    expect(checkC(root, {}, ["--static"]).out).toContain("PASS e.project  compose files present (project name not resolved in --static)");
    expect(checkC(root, {}, [], { CI: "true" }).code).toBe(0);
    expect(checkC(root, {}, ["--static"], { CI: "true" }).code).toBe(0);
    expect(checkC(setup(test(), {}), {}, ["--static"]).out).toContain("FAIL e.project  no compose file found");
  });

  it("treats an empty name: as absent and reads a next-line scalar", () => {
    // Compose: a literal empty name: falls back to the directory; one that interpolates to empty is rejected.
    for (const empty of ['name: ""', "name: ''"]) {
      const root = setup(test(), { "compose.yml": `${empty}\nservices: {}\n` });
      const r = checkC(root, { [root]: "app-node" });
      expect([empty, r.code, r.out]).toEqual([empty, 0, expect.stringContaining("PASS e.project  app-node (derived: dirname)")]);
    }
    const interp = setup(test(), { "compose.yml": "name: ${STACK_NAME:-}\nservices: {}\n" });
    expect(checkC(interp, { [interp]: EMPTY }).out).toContain("FAIL e.project  compose config: project name must not be empty");
    for (const bare of ["${STACK_NAME}", "$STACK_NAME"]) {
      const viaShell = setup(test(), { "compose.yml": `name: ${bare}\nservices: {}\n` });
      expect([bare, checkC(viaShell, { [viaShell]: EMPTY }, [], { STACK_NAME: "" }).code]).toEqual([bare, 1]);
      const viaEnv = setup(test(), { "compose.yml": `name: ${bare}\nservices: {}\n` });
      put(viaEnv, ".env", "STACK_NAME=\n");
      expect([bare, checkC(viaEnv, { [viaEnv]: EMPTY }).code]).toEqual([bare, 1]);
    }
    const next = setup(test(), { "compose.yml": "name:\n  nextline\nservices: {}\n" });
    expect(checkC(next, { [next]: "nextline" }, ["--compose-project"]).out).toBe("nextline");
  });

  it("normalizes declared names like Compose before comparing", () => {
    const root = setup(test(), { "compose.yml": "name: My_App!\nservices: {}\n" });
    commit(root);
    expect(checkC(root, { [root]: "my_app" }, ["--compose-project"]).out).toBe("my_app");
    const wt = worktree(root, "feat-n");
    const r = checkC(wt, { [root]: "my_app", [wt]: "my_app" }, [], { COMPOSE_PROJECT_NAME: "my_app" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("worktree would use the main checkout's project name")]);
    // Compose validates a COMPOSE_PROJECT_NAME instead of normalizing it.
    const upper = checkC(wt, { [wt]: invalid("My_App") }, [], { COMPOSE_PROJECT_NAME: "My_App" });
    expect([upper.code, upper.out]).toEqual([1, expect.stringContaining(`FAIL e.project  compose config: ${invalid("My_App").error}`)]);
    expect(checkC(wt, { [root]: "my_app", [wt]: "other" }, [], { COMPOSE_PROJECT_NAME: "other" }).code).toBe(0);
  });

  it("trims leading _ and - from a declared name like Compose", () => {
    const root = setup(test(), { "compose.yml": "name: _MyApp\nservices: {}\n" });
    commit(root);
    expect(checkC(root, { [root]: "myapp" }, ["--compose-project"]).out).toBe("myapp");
    const wt = worktree(root, "feat-t");
    expect(checkC(wt, { [root]: "myapp", [wt]: "myapp" }, [], { COMPOSE_PROJECT_NAME: "myapp" }).code).toBe(1);
  });

  it("reports the checkout's own unresolvable name: only when it decides the project", () => {
    const root = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-r");
    put(root, ".env", "STACK_NAME=live\n");
    // The worktree has no .env, so Compose cannot name its run: Compose's error is the FAIL.
    const own = checkC(wt, { [wt]: EMPTY });
    expect([own.code, own.out]).toEqual([1, expect.stringContaining(`FAIL e.project  compose config: project name must not be empty — fix: ${PROBE_FIX}`)]);
    // With its own COMPOSE_PROJECT_NAME that name: is irrelevant, and the prod name is main's resolved one.
    put(wt, ".env", "COMPOSE_PROJECT_NAME=feat-r\n");
    expect(checkC(wt, { [wt]: "feat-r", [root]: "live" }).out).toContain("PASS e.project  feat-r (derived: dirname)");
    const clash = checkC(wt, { [wt]: "live", [root]: "live" }, [], { COMPOSE_PROJECT_NAME: "live" });
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name live")]);
    // A main checkout whose COMPOSE_PROJECT_NAME overrides the file does not need the file's name to resolve.
    const bare = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    const viaShell = checkC(bare, { [bare]: "chosen" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "chosen" });
    expect([viaShell.code, viaShell.out]).toEqual([0, "chosen"]);
    put(bare, ".env", "COMPOSE_PROJECT_NAME=fromenv\n");
    expect(checkC(bare, { [bare]: "fromenv" }).out).toContain("PASS e.project  fromenv (COMPOSE_PROJECT_NAME)");
  });

  it("uses the last name: across the ordered compose files, in the worktree and the main checkout", () => {
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.override.yml"]\n`;
    const root = setup(two, { "compose.yml": "name: app-base\n", "compose.override.yml": "name: app-prod\nservices: {}\n" });
    commit(root);
    expect(checkC(root, { [root]: "app-prod" }, ["--compose-project"]).out).toBe("app-prod");
    // The worktree's own override declares the prod name: clash, though its first file says app-base.
    const wt = worktree(root, "feat-o");
    const both = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([both.code, both.out]).toEqual([1, expect.stringContaining("worktree would use the main checkout's project name app-prod")]);
    // The main checkout's reserved name is its last declaration, not the first (app-base).
    expect(checkC(wt, { [root]: "app-prod", [wt]: "app-base" }, [], { COMPOSE_PROJECT_NAME: "app-base" }).code).toBe(0);
  });

  /** A main checkout named app-prod by Compose, and a worktree whose shell COMPOSE_PROJECT_NAME=app-prod clashes with it. */
  const namedProd = (doc: string, wtName: string): void => {
    const root = setup(test(), { "compose.yml": doc });
    commit(root);
    expect([doc, checkC(root, { [root]: "app-prod" }, ["--compose-project"]).out]).toEqual([doc, "app-prod"]);
    const wt = worktree(root, wtName);
    const r = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([doc, r.code, r.out]).toEqual([doc, 1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
  };

  it("reads a quoted name: key and a flow mapping", () => {
    for (const key of ['"name"', "'name'", "name "]) namedProd(`${key}: app-prod\nservices: {}\n`, "feat-q");
    namedProd('# c\n{"name": "app-prod", "services": {}}\n', "feat-f");
  });

  it("reads name: after a byte-order mark, YAML directives and a root tag", () => {
    namedProd("﻿name: app-prod\nservices:\n  web:\n    image: x\n", "feat-b");
    for (const doc of ['%YAML 1.1\n---\n{"name": "app-prod", "services": {}}\n', "﻿%YAML 1.1\n%TAG ! tag:x,2000:\n--- {name: app-prod}\n", "--- !!map\n{name: app-prod}\n"]) namedProd(doc, "feat-d");
  });

  it("reads name: with YAML 1.2 core scalars under a %YAML 1.1 directive, as Compose does", () => {
    for (const [doc, want] of [["%YAML 1.1\n---\nname: on\nservices: {}\n", "on"], ["%YAML 1.1\n---\nname: yes\nservices: {}\n", "yes"], ["%YAML 1.1\n---\nservices: {}\n---\nname: y\n", "y"]] as const) {
      const root = setup(test(), { "compose.yml": doc });
      commit(root);
      expect([doc, checkC(root, { [root]: want }, ["--compose-project"]).out]).toEqual([doc, want]);
    }
  });

  it("resolves name: in a compose file whose services share nested anchors, as Compose does", () => {
    const svcs = Array.from({ length: 30 }, (_, i) => `  svc${i}: {image: alpine, <<: *common}\n`).join("");
    const doc = `name: app-prod\nx-env: &env {TZ: UTC}\nx-base: &base {environment: *env}\nx-common: &common {<<: *base, restart: unless-stopped}\nservices:\n${svcs}`;
    const root = setup(test(), { "compose.yml": doc });
    commit(root);
    expect(checkC(root, { [root]: "app-prod" }, ["--compose-project"]).out).toBe("app-prod");
    const r = checkC(root, { [root]: "app-prod" });
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.project  app-prod (name: in compose file)")]);
    expect(r.out).toContain("PASS e.container_name  no fixed container_name");
  });

  it("resolves name: across the documents of one compose file as Compose merges them", () => {
    const docs = [
      "name: app-prod\nservices: {a: {image: x}}\n---\nservices: {b: {image: x}}\n",
      "services: {a: {image: x}}\n---\nname: app-prod\n",
      "name: app-one\nservices: {}\n---\nname: app-prod\n",
      "name: app-prod\nservices: {}\n---\nname: \"\"\n",
      "name: app-prod\nservices: {}\n---\nname:\n",
      "name: \"\"\nservices: {}\n---\nname: app-prod\n",
      "name: app-one\nservices: {}\n---\n{}\n---\n!!map {name: app-prod}\n",
    ];
    for (const doc of docs) namedProd(doc, "feat-m");
  });

  it("interpolates .env values against earlier keys and the shell, failing closed when it cannot", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-i");
    put(root, ".env", "STACK=live\nCOMPOSE_PROJECT_NAME=${STACK}\n");
    expect(checkC(root, { [root]: "live", [wt]: "app-prod" }, ["--compose-project"]).out).toBe("live");
    expect(checkC(root, { [root]: "shell", [wt]: "app-prod" }, ["--compose-project"], { STACK: "shell" }).out).toBe("shell");
    expect(checkC(wt, { [root]: "live", [wt]: "live" }, [], { COMPOSE_PROJECT_NAME: "live" }).code).toBe(1);
    expect(checkC(wt, { [root]: "live", [wt]: "stack" }, [], { COMPOSE_PROJECT_NAME: "stack" }).code).toBe(0);
    // A name: reads a .env key that is itself interpolated.
    const nested = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    put(nested, ".env", 'BASE=app\nSTACK_NAME="${BASE}-live"\n');
    expect(checkC(nested, { [nested]: "app-live" }, ["--compose-project"]).out).toBe("app-live");
    // Compose: an unset variable in .env interpolates to empty, so this COMPOSE_PROJECT_NAME is as if unset and name: applies
    // (before 0.5.0 it failed closed on it).
    const nope = setup(test(), { "compose.yml": COMPOSE });
    put(nope, ".env", "COMPOSE_PROJECT_NAME=${NOPE}\n");
    const own = checkC(nope, { [nope]: "app-prod" });
    expect([own.code, own.out]).toEqual([0, expect.stringContaining("PASS e.project  app-prod (name: in compose file)")]);
    put(root, ".env", "COMPOSE_PROJECT_NAME=${NOPE}\n");
    const fromWt = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" });
    expect([fromWt.code, fromWt.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name app-prod")]);
    // Single-quoted (literal) is a name Compose rejects.
    put(root, ".env", "STACK=live\nCOMPOSE_PROJECT_NAME='${STACK}'\n");
    const lit = checkC(root, { [root]: invalid("${STACK}"), [wt]: "app-prod" }, ["--compose-project"]);
    expect([lit.code, lit.out, lit.err]).toEqual([1, "", expect.stringContaining(`compose config: ${invalid("${STACK}").error}`)]);
  });

  it("rejects an invalid COMPOSE_PROJECT_NAME instead of normalizing it, as Compose does", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    for (const bad of ["UPPER.INVALID", "---", "Upper"]) {
      const p = checkC(root, { [root]: invalid(bad) }, ["--compose-project"], { COMPOSE_PROJECT_NAME: bad });
      expect([bad, p.code, p.out, p.err]).toEqual([bad, 1, "", `env-check: compose config: ${invalid(bad).error} — fix: ${PROBE_FIX_SET}`]);
      expect(checkC(root, { [root]: invalid(bad) }, [], { COMPOSE_PROJECT_NAME: bad }).out).toContain(`FAIL e.project  compose config: ${invalid(bad).error}`);
    }
    const wt = worktree(root, "feat-c");
    put(wt, ".env", "COMPOSE_PROJECT_NAME=My.App\n");
    expect(checkC(wt, { [wt]: invalid("My.App") }).code).toBe(1);
    rmSync(join(wt, ".env"));
    put(root, ".env", "COMPOSE_PROJECT_NAME=Prod.App\n");
    expect(checkC(wt, { [wt]: "app-prod", [root]: invalid("Prod.App") }).out).toContain(`FAIL e.project  the main checkout's compose config: ${invalid("Prod.App").error}`);
  });

  it("reads name: through anchors, aliases, tags, merge keys, explicit keys, flow mappings and an indented root, as Compose does", () => {
    const docs = [
      "--- # doc\n{name: app-prod, services: {}}\n",
      "name: &n app-prod\nservices: {}\n",
      "name: !!str app-prod\nservices: {}\n",
      "x-n: &n app-prod\nname: *n\nservices: {}\n",
      "  name: app-prod\n  services: {}\n",
      "? name\n: app-prod\nservices: {}\n",
      "x-b: &b {name: app-prod}\n<<: *b\nservices: {}\n",
      "x-a: &a\n  name: app-other\nname: app-prod\n<<: *a\nservices: {}\n",
      "name: !reset app-prod\nservices: {}\n",
      // An anchor shared across documents resolves too (before 0.5.0 it failed closed on it).
      "x-n: &n app-prod\nservices: {}\n---\nname: *n\n",
    ];
    for (const doc of docs) namedProd(doc, "feat-y");
  });

  it("fails closed on a compose file that is not valid YAML, not a mapping in every document, or has a non-string name:", () => {
    // Each error line is Compose's own; <root> is the checkout path.
    const docs: [string, string][] = [
      ["name: app-prod\nname: other\nservices: {}\n", 'line 2: mapping key "name" already defined at line 1'],
      ["name: app-prod\nservices: [\n", "yaml: while parsing a flow node at line 2: did not find expected node content"],
      ["%YAML 1.2\n---\nname: app-prod\n", "yaml: <unknown position>: found incompatible YAML document"],
      ["name: app-prod\nservices: {}\n...\n%YAML 1.2\n---\nname: other\n", "failed to parse <root>/compose.yml: yaml: line 3: found incompatible YAML document"],
      ["name: app-prod\nservices: {}\n---\n", "top-level object must be a mapping"],
      ["name: app-prod\nservices: {}\n---\n- x\n", "top-level object must be a mapping"],
      ["name: app-prod\nservices: {}\n---\nname: 123\n---\nname: other\n", "validating <root>/compose.yml: name must be a string"],
      ["name:\nservices: {}\n---\nname: app-prod\n", "validating <root>/compose.yml: name must be a string"],
      ["services: {}\n---\nname:\n", "validating <root>/compose.yml: name must be a string"],
      ["- name: app-prod\n", "line 1: cannot construct !!seq into cli.named"],
      ["# only a comment\n", "empty compose file"],
      ["name: 123\nservices: {}\n", "validating <root>/compose.yml: name must be a string"],
      ["name: [app]\nservices: {}\n", "line 1: cannot construct !!seq into string"],
      ["name:\nservices: {}\n", "validating <root>/compose.yml: name must be a string"],
      ["name: ~\nservices: {}\n", "validating <root>/compose.yml: name must be a string"],
    ];
    for (const [doc, why] of docs) {
      const root = setup(test(), { "compose.yml": doc });
      commit(root);
      const at = (dir: string) => why.split("<root>").join(dir);
      const r = checkC(root, { [root]: { error: why } });
      expect([doc, r.code, r.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  compose config: ${at(root)} — fix: ${PROBE_FIX}`)]);
      // The worktree's own copy fails first; once it is fixed, the main checkout's still decides the prod name.
      const w = worktree(root, "feat-y");
      expect([doc, checkC(w, { [w]: { error: why } }, [], { COMPOSE_PROJECT_NAME: "app-prod" }).out]).toEqual([doc, expect.stringContaining(`FAIL e.project  compose config: ${at(w)}`)]);
      put(w, "compose.yml", "services: {}\n");
      const wt = checkC(w, { [w]: "app-prod", [root]: { error: why } }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
      expect([doc, wt.code, wt.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  the main checkout's compose config: ${at(root)}`)]);
    }
    // Compose: a binary-tagged scalar decodes to the string app, which is a valid name.
    const bin = setup(test(), { "compose.yml": "name: !!binary YXBw\nservices: {}\n" });
    expect(checkC(bin, { [bin]: "app" }, ["--compose-project"]).out).toBe("app");
    // Compose rejects the whole project, so a later file's name: does not rescue it.
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.override.yml"]\n`;
    const t = setup(two, { "compose.yml": "name: 123\n", "compose.override.yml": "name: app-prod\n" });
    const r = checkC(t, { [t]: { error: notString("<root>") } });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.project  compose config: ${notString(t)}`)]);
  });

  it("fails in a worktree whose committed name: makes plain docker compose use the prod project", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "s3-wt");
    const r = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name app-prod — fix: add COMPOSE_PROJECT_NAME=s3-wt to .env")]);
    // The worktree's own COMPOSE_PROJECT_NAME (its .env, or the shell) makes it safe.
    put(wt, ".env", "COMPOSE_PROJECT_NAME=s3-wt\n");
    expect(checkC(wt, { [root]: "app-prod", [wt]: "s3-wt" }).out).toContain("PASS e.project  s3-wt (COMPOSE_PROJECT_NAME)");
    const s4 = worktree(root, "s4-wt");
    expect(checkC(s4, { [root]: "app-prod", [wt]: "s3-wt", [s4]: "s4" }, [], { COMPOSE_PROJECT_NAME: "s4" }).out).toContain("PASS e.project  s4 (COMPOSE_PROJECT_NAME)");
    // Under slug-hash too: the worktree's plain Compose name is its file's name:, not the derived one.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": COMPOSE });
    commit(slug);
    const ws = worktree(slug, "feat-s");
    const s = checkC(ws, { [slug]: "app-prod", [ws]: "app-prod" });
    expect([s.code, s.out]).toEqual([1, expect.stringMatching(/FAIL e\.project {2}plain docker compose in this worktree would use the main checkout's project name app-prod — fix: add COMPOSE_PROJECT_NAME=app-node-feat-s-[0-9a-f]{6} to \.env/)]);
  });

  it("--compose-project still hands over the safe -p name when only plain docker compose would clash", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "s3-wt");
    // -p s3-wt is safe there, so --compose-project still hands it over, warning on stderr.
    const p = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, ["--compose-project"]);
    expect([p.code, p.out]).toEqual([0, "s3-wt"]);
    expect(p.err).toContain("plain docker compose in this worktree would use the main checkout's project name app-prod; fix: add COMPOSE_PROJECT_NAME=s3-wt to .env");
    // A real reuse of the prod name yields no name, and stderr carries the fix.
    const reuse = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([reuse.code, reuse.out, reuse.err]).toEqual([1, "", expect.stringContaining("worktree would use the main checkout's project name app-prod — fix: set COMPOSE_PROJECT_NAME")]);
    // The full run still fails, and hands no project to b.containers or local checks.
    put(root, CFG, test('inputs = ["compose.yml"]\n') + local(root, "d.p", 'echo "PASS d.p project=[$ENV_CHECK_PROJECT]"'));
    commit(root);
    const wp = worktree(root, "s5-wt");
    const calls: string[][] = [];
    const docker: Runner = (cmd, args, opts) => (cmd === "docker" ? (calls.push(args), { code: 0, stdout: "a1\n", stderr: "", timedOut: false }) : run(cmd, args, opts));
    const full = check(wp, [], {}, composeStub({ [root]: "app-prod", [wt]: "app-prod", [wp]: "app-prod" }, [], docker));
    expect([full.code, calls]).toEqual([1, []]);
    expect(full.out).toContain("PASS d.p  project=[]");
  });

  it("reads name: from the files plain docker compose loads: the implicit override and COMPOSE_FILE", () => {
    // The main checkout's -p is what its configured run (-f compose.yml) is named; the override only names plain runs.
    const root = setup(test(), { "compose.yml": "services: {}\n", ".gitignore": "compose.override.yml\n.env\n" });
    commit(root);
    put(root, "compose.override.yml", "name: app-prod\n");
    expect(checkC(root, { [root]: "app-node" }, ["--compose-project"]).out).toBe("app-node");
    const wt = worktree(root, "feat-ovr");
    const M = { cfg: "app-node", plain: "app-prod" };
    expect(checkC(wt, { [root]: M, [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
    // A copied override makes plain docker compose in the worktree hit prod.
    put(wt, "compose.override.yml", "name: app-prod\n");
    const plain = checkC(wt, { [root]: M, [wt]: { cfg: "feat-ovr", plain: "app-prod" } });
    expect([plain.code, plain.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name app-prod")]);
    // COMPOSE_FILE replaces discovery, so the override no longer counts for plain runs either.
    put(root, ".env", "COMPOSE_FILE=compose.yml\n");
    rmSync(join(wt, "compose.override.yml"));
    expect(checkC(wt, { [root]: "app-node", [wt]: "feat-ovr" }).out).toContain("PASS e.project  feat-ovr (derived: dirname)");

    // COMPOSE_FILE in the main checkout's .env adds a prod overlay declaring name: to its plain run.
    const shop = setup(test(), { "compose.yml": "services: {}\n", "compose.prod.yml": "name: shop-prod\n", ".gitignore": ".env\n" });
    commit(shop);
    put(shop, ".env", "COMPOSE_FILE=compose.yml:compose.prod.yml\n");
    expect(checkC(shop, { [shop]: "app-node" }, ["--compose-project"]).out).toBe("app-node");
    const w2 = worktree(shop, "feat-cf");
    const S = { cfg: "app-node", plain: "shop-prod" };
    expect(checkC(w2, { [shop]: S, [w2]: "feat-cf" }).out).toContain("PASS e.project  feat-cf (derived: dirname)");
    expect(checkC(w2, { [shop]: S, [w2]: "shop-prod" }, [], { COMPOSE_PROJECT_NAME: "shop-prod" }).code).toBe(1);
    put(w2, ".env", "COMPOSE_FILE=compose.yml:compose.prod.yml\n");
    expect(checkC(w2, { [shop]: S, [w2]: { cfg: "feat-cf", plain: "shop-prod" } }).code).toBe(1);
    // COMPOSE_PATH_SEPARATOR splits it; the shell's COMPOSE_FILE beats the .env's.
    put(shop, ".env", "COMPOSE_PATH_SEPARATOR=;\nCOMPOSE_FILE=compose.yml;compose.prod.yml\n");
    expect(checkC(shop, { [shop]: "app-node", [w2]: "shop-prod" }, ["--compose-project"]).out).toBe("app-node");
    expect(checkC(w2, { [shop]: S, [w2]: "shop-prod" }, [], { COMPOSE_PROJECT_NAME: "shop-prod" }).code).toBe(1);
    // The shell's COMPOSE_FILE beats this checkout's .env for its plain run (the main checkout's probes do not see it).
    expect(checkC(w2, { [shop]: S, [w2]: "feat-cf" }, [], { COMPOSE_FILE: "compose.yml" }).code).toBe(0);

    // COMPOSE_FILE's first file sets the project directory of a plain run: its name, and its .env for keys the first .env leaves unset.
    const sub = setup(test(), { "compose.yml": "services: {}\n", "deploy/compose.yml": "services: {}\n" });
    commit(sub);
    const w3 = worktree(sub, "feat-sub");
    put(sub, ".env", "COMPOSE_FILE=deploy/compose.yml\n");
    expect(checkC(sub, { [sub]: "app-node", [w3]: "feat-sub" }, ["--compose-project"]).out).toBe("app-node");
    expect(checkC(w3, { [sub]: { cfg: "app-node", plain: "deploy" }, [w3]: "deploy" }, [], { COMPOSE_PROJECT_NAME: "deploy" }).code).toBe(1);
    put(sub, "deploy/.env", "COMPOSE_PROJECT_NAME=fromdeploy\n");
    expect(checkC(w3, { [sub]: { cfg: "app-node", plain: "fromdeploy" }, [w3]: "fromdeploy" }, [], { COMPOSE_PROJECT_NAME: "fromdeploy" }).code).toBe(1);
    put(sub, ".env", "COMPOSE_FILE=deploy/compose.yml\nCOMPOSE_PROJECT_NAME=fromroot\n");
    expect(checkC(sub, { [sub]: "fromroot", [w3]: "feat-sub" }, ["--compose-project"]).out).toBe("fromroot");

    // An empty COMPOSE_FILE, or one naming a missing file, makes a plain run fail, whatever names the project; -f is unaffected.
    const bad: [string, string][] = [["", "read <root>: is a directory"], ["gone.yml:compose.yml", "stat <root>/gone.yml: no such file or directory"]];
    for (const [cf, why] of bad) {
      const r = checkC(w3, { [sub]: "fromroot", [w3]: { cfg: "feat-sub", plain: { error: why } } }, [], { COMPOSE_FILE: cf });
      expect([cf, r.code, r.out]).toEqual([cf, 1, expect.stringContaining(`FAIL e.project  compose config: ${why.split("<root>").join(w3)}`)]);
    }
  });

  it("treats the name plain docker compose discovers as prod too when it loads other files than the configured ones", () => {
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.test.yml"]\n`;
    const root = setup(two, { "compose.yml": "services: {web: {image: x}}\n", "compose.test.yml": "services: {web: {environment: {A: 1}}}\n", ".gitignore": "compose.override.yml\n" });
    commit(root);
    put(root, "compose.override.yml", "name: app-prod\n");
    // The configured stack (-f compose.yml -f compose.test.yml) keeps its own name.
    expect(checkC(root, { [root]: "app-node" }, ["--compose-project"]).out).toBe("app-node");
    const wt = worktree(root, "feat-two");
    const M = { cfg: "app-node", plain: "app-prod" };
    expect(checkC(wt, { [root]: M, [wt]: "feat-two" }).out).toContain("PASS e.project  feat-two (derived: dirname)");
    const r = checkC(wt, { [root]: M, [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    // A copied override makes plain docker compose in the worktree hit prod.
    put(wt, "compose.override.yml", "name: app-prod\n");
    expect(checkC(wt, { [root]: M, [wt]: { cfg: "feat-two", plain: "app-prod" } }).out).toContain("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name app-prod");
    put(wt, "compose.override.yml", "services: {}\n");
    // An override Compose cannot read fails closed, with Compose's line.
    put(root, "compose.override.yml", "name: [x]\n");
    const badOvr = { cfg: "app-node", plain: { error: "line 1: cannot construct !!seq into string" } };
    expect(checkC(wt, { [root]: badOvr, [wt]: "feat-two" }, [], { COMPOSE_PROJECT_NAME: "feat-two" }).out).toContain("FAIL e.project  the main checkout's compose config: line 1: cannot construct !!seq into string");

    // Compose discovers compose.yaml before the configured compose.yml.
    const yaml = setup(test(), { "compose.yml": "services: {web: {image: x}}\n" });
    commit(yaml);
    put(yaml, "compose.yaml", "name: app-prod\nservices: {web: {image: x}}\n");
    const w2 = worktree(yaml, "feat-yaml");
    expect(checkC(w2, { [yaml]: { cfg: "app-node", plain: "app-prod" }, [w2]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);

    // From a non-default file's directory, a plain run walks up to the default file at the root.
    const up = setup(`${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/stack.yml"]\nderive = "slug-hash"\n`, { "deploy/stack.yml": "services: {web: {image: x}}\n", "compose.yml": "name: app-prod\nservices: {web: {image: x}}\n" });
    commit(up);
    const w3 = worktree(up, "feat-up");
    const U = { [up]: "deploy", [join(up, "deploy")]: "app-prod" };
    expect(checkC(w3, { ...U, [w3]: "feat-up" }, [], { COMPOSE_PROJECT_NAME: "feat-up" }).out).toContain("PASS e.project  feat-up (COMPOSE_PROJECT_NAME)");
    expect(checkC(w3, { ...U, [w3]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
    // The .env beside the file it found names that run too (deploy/ has none, so Compose reads the root's).
    put(up, ".env", "COMPOSE_PROJECT_NAME=app-live\n");
    expect(checkC(w3, { ...U, [join(up, "deploy")]: "app-live", [w3]: "app-live" }, [], { COMPOSE_PROJECT_NAME: "app-live" }).code).toBe(1);
  });

  it("fails in worktrees that share a committed name: when the main checkout's .env overrides it", () => {
    for (const [doc, env] of [["name: app-x", "COMPOSE_PROJECT_NAME=prod"], ["name: ${STACK:-app-x}", "STACK=prod"]] as const) {
      const root = setup(test(), { "compose.yml": `${doc}\nservices:\n  web:\n    image: x\n`, ".gitignore": ".env\n" });
      commit(root);
      put(root, ".env", `${env}\n`);
      const a = worktree(root, "feat-a");
      const b = worktree(root, "feat-b");
      expect([doc, checkC(root, { [root]: "prod", [a]: "app-x", [b]: "app-x" }).out]).toEqual([doc, expect.stringContaining("PASS e.project  prod")]);
      const r = checkC(a, { [root]: "prod", [a]: "app-x", [b]: "app-x" });
      // A literal or interpolated name: alike is "its compose name:" (as before 0.5.0), ahead of the peer that shares it.
      const why = "plain docker compose in this worktree would use its compose name: app-x, not feat-a";
      expect([doc, r.code, r.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  ${why} — fix: add COMPOSE_PROJECT_NAME=feat-a to .env`)]);
      put(a, ".env", "COMPOSE_PROJECT_NAME=feat-a\n");
      expect([doc, checkC(a, { [root]: "prod", [a]: "feat-a", [b]: "app-x" }).out]).toEqual([doc, expect.stringContaining("PASS e.project  feat-a (COMPOSE_PROJECT_NAME)")]);
    }
  });

  it("counts a peer worktree's plain docker compose name as taken", () => {
    const root = setup(test(), { "compose.yml": "name: app-x\nservices: {}\n", ".gitignore": ".env\n" });
    commit(root);
    put(root, ".env", "COMPOSE_PROJECT_NAME=prod\n");
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    // feat-b has no .env, so plain docker compose there runs as app-x.
    const r = checkC(a, { [root]: "prod", [a]: "app-x", [b]: "app-x" }, [], { COMPOSE_PROJECT_NAME: "app-x" });
    expect([r.code, r.out]).toEqual([1, expect.stringMatching(/FAIL e\.project {2}project name app-x is also used by worktree .*feat-b/)]);
    // Under slug-hash, two worktrees with one directory name both run plain docker compose as that name.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    commit(slug);
    const s1 = worktree(slug, "feat-s");
    expect(checkC(s1, { [slug]: "app-node", [s1]: "feat-s" }).code).toBe(0);
    const s2 = worktree(slug, "feat-s");
    const s = checkC(s1, { [slug]: "app-node", [s1]: "feat-s", [s2]: "feat-s" });
    expect([s.code, s.out]).toEqual([1, expect.stringMatching(/FAIL e\.project {2}plain docker compose in this worktree would use project feat-s, which worktree .*feat-s also uses/)]);
  });

  it("an empty shell COMPOSE_PROJECT_NAME hides the .env one, as Compose does", () => {
    const root = setup(test(), { "compose.yml": "name: production\nservices: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-e");
    put(wt, ".env", "COMPOSE_PROJECT_NAME=test-stack\n");
    // Compose answers test-stack, which neither the literal name: nor the directory explains: the .env names this worktree.
    expect(checkC(wt, { [root]: "production", [wt]: "test-stack" }).out).toContain("PASS e.project  test-stack (COMPOSE_PROJECT_NAME)");
    // The empty value blocks .env, and name: applies: Compose names a plain run there production.
    const r = checkC(wt, { [root]: "production", [wt]: "production" }, [], { COMPOSE_PROJECT_NAME: "" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name production — fix: unset the empty COMPOSE_PROJECT_NAME in the shell, which hides the .env one, and add COMPOSE_PROJECT_NAME=feat-e to .env, or always pass -p feat-e")]);
    put(root, ".env", "COMPOSE_PROJECT_NAME=envprod\n");
    expect(checkC(root, { [root]: "envprod", [wt]: "test-stack" }, ["--compose-project"]).out).toBe("envprod");
    expect(checkC(root, { [root]: "production", [wt]: "test-stack" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "" }).out).toBe("production");
  });

  it("fails on the checkout's own invalid compose file even when COMPOSE_PROJECT_NAME is set", () => {
    const docs: [string, string][] = [
      ["name: app-prod\nservices: [\n", "yaml: while parsing a flow node at line 2: did not find expected node content"],
      ["- name: app-prod\n", "line 1: cannot construct !!seq into cli.named"],
      ["name: 123\nservices: {}\n", notString("<root>")],
    ];
    for (const [doc, why] of docs) {
      const root = setup(test(), { "compose.yml": doc });
      commit(root);
      const sh = checkC(root, { [root]: { error: why } }, [], { COMPOSE_PROJECT_NAME: "foo" });
      // Compose fails the developer's run the same way, COMPOSE_PROJECT_NAME or not: the fix does not ask to set the one already set.
      expect([doc, sh.code, sh.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  compose config: ${why.split("<root>").join(root)} — fix: ${PROBE_FIX_SET}`)]);
      expect(sh.out).not.toContain("or set COMPOSE_PROJECT_NAME");
      put(root, ".env", "COMPOSE_PROJECT_NAME=foo\n");
      expect([doc, checkC(root, { [root]: { error: why } }).code, checkC(root, { [root]: { error: why } }, ["--compose-project"]).out]).toEqual([doc, 1, ""]);
    }
    // An unresolvable name: stays waived by a COMPOSE_PROJECT_NAME.
    const ok = setup(test(), { "compose.yml": "name: ${UNSET_VAR}\nservices: {}\n" });
    expect(checkC(ok, { [ok]: "foo" }, [], { COMPOSE_PROJECT_NAME: "foo" }).out).toContain("PASS e.project  foo (COMPOSE_PROJECT_NAME)");
  });

  it("reads YAML-style KEY: value lines in .env, as Compose does", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    put(root, ".env", "COMPOSE_PROJECT_NAME: app-prod\n");
    expect(checkC(root, { [root]: "app-prod" }, ["--compose-project"]).out).toBe("app-prod");
    const wt = worktree(root, "wt");
    const r = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    const named = setup(test(), { "compose.yml": "name: ${STACK}\nservices: {}\n" });
    put(named, ".env", "STACK: app-live\nURL=http://x:1\n");
    expect(checkC(named, { [named]: "app-live" }, ["--compose-project"]).out).toBe("app-live");
  });

  it("does not count the main checkout's derived name as a clash when it runs under another name", () => {
    const sub = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/compose.yml"]\n`;
    const root = setup(sub, { "deploy/compose.yml": "services: {}\n" });
    commit(root);
    put(root, "deploy/.env", "COMPOSE_PROJECT_NAME=foo\n");
    expect(checkC(root, { [root]: "foo" }, ["--compose-project"]).out).toBe("foo");
    // The main checkout runs as foo, configured or plain (its plain run starts in deploy/, beside that .env), so a
    // worktree deriving deploy does not clash with it.
    const wd = worktree(root, "feat-d");
    const M = { [root]: "foo", [join(root, "deploy")]: "foo" };
    const r = checkC(wd, { ...M, [wd]: "deploy", [join(wd, "deploy")]: "deploy" });
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.project  deploy (derived: dirname)")]);
    // A second worktree really does collide on deploy: the peer's plain run is probed from its deploy/ too.
    const we = worktree(root, "feat-e");
    expect(checkC(we, { ...M, [wd]: "deploy", [join(wd, "deploy")]: "deploy", [we]: "deploy" }).out).toMatch(/FAIL e\.project {2}project name deploy is also used by worktree .*feat-d/);
    // A COMPOSE_PROJECT_NAME equal to the main checkout's directory name, while it runs under its name:, is no clash.
    const app = setup(test(), { "compose.yml": COMPOSE });
    commit(app);
    const wa = worktree(app, "app-wt");
    const a = checkC(wa, { [app]: "app-prod", [wa]: "app-node" }, [], { COMPOSE_PROJECT_NAME: "app-node" });
    expect([a.code, a.out]).toEqual([0, expect.stringContaining("PASS e.project  app-node (COMPOSE_PROJECT_NAME)")]);
  });

  it("compares with each peer worktree's own COMPOSE_PROJECT_NAME before its derived name", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    put(a, ".env", "COMPOSE_PROJECT_NAME=shared-test\n");
    put(b, ".env", "COMPOSE_PROJECT_NAME=shared-test\n");
    // Compose's answer for each worktree is explained by neither a name: nor its directory, so it is the .env's: both are shared-test.
    for (const [wt, peer] of [[a, "feat-b"], [b, "feat-a"]] as const) {
      const r = checkC(wt, { [root]: "app-node", [a]: "shared-test", [b]: "shared-test" });
      expect([r.code, r.out]).toEqual([1, expect.stringMatching(new RegExp(`FAIL e\\.project {2}project name shared-test is also used by worktree .*${peer}`))]);
    }
    // feat-b runs as shared-test under -p and plain alike, so its derived name is free.
    const wc = worktree(root, "feat-c");
    const c = checkC(wc, { [root]: "app-node", [a]: "shared-test", [b]: "shared-test", [wc]: "feat-b" }, [], { COMPOSE_PROJECT_NAME: "feat-b" });
    expect([c.code, c.out]).toEqual([0, expect.stringContaining("PASS e.project  feat-b (COMPOSE_PROJECT_NAME)")]);
  });

  it("slug-hash never derives a name Compose rejects when the main checkout's directory normalizes to empty", () => {
    // Compose names a directory that normalizes to empty "project name must not be empty", so the main checkout declares a name:.
    const root = repo({ "compose.yml": COMPOSE }, "プロ");
    put(root, CFG, test('derive = "slug-hash"\n'));
    commit(root);
    const wt = worktree(root, "feat.x");
    const r = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, ["--compose-project"]);
    expect([r.code, r.out]).toEqual([0, expect.stringMatching(/^wt-feat-x-[0-9a-f]{6}$/)]);
  });

  it("fails when the directory leaves no project name after Compose normalizes it", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    for (const dir of ["___", "项目"]) {
      const wt = worktree(root, dir);
      const r = checkC(wt, { [wt]: EMPTY });
      expect([dir, r.code, r.out]).toEqual([dir, 1, expect.stringContaining("FAIL e.project  compose config: project name must not be empty")]);
    }
  });

  it("warns on a fixed container_name unless allowlisted, and reads files only under --static", () => {
    const files = { "compose.yml": `${COMPOSE}    container_name: web-1\n` };
    const root = setup(test(), files);
    const warn = checkC(root, { [root]: "app-prod" });
    expect([warn.code, warn.out]).toEqual([0, expect.stringContaining("WARN e.container_name  fixed container_name web-1 collides across worktrees")]);
    const allow = setup(test('allow_container_name = ["web-1"]\n'), files);
    expect(checkC(allow, { [allow]: "app-prod" }).out).toContain("PASS e.container_name");
    expect(checkC(setup(test(), files), {}, ["--static"]).out).toContain("PASS e.project  compose files present, name: app-prod (project name not resolved in --static)");
    expect(checkC(setup(test(), {}), {}).out).toContain("FAIL e.project  no compose file found (compose.yml)");
  });

  it.each([
    ["flow mapping", "name: app\nservices: {db: {image: postgres, container_name: prod-db}}\n"],
    ["flow service", "name: app\nservices:\n  db: {image: postgres, container_name: prod-db}\n"],
    ["double-quoted key", 'name: app\nservices:\n  db:\n    image: postgres\n    "container_name": prod-db\n'],
    ["single-quoted key", "name: app\nservices:\n  db:\n    image: postgres\n    'container_name': prod-db\n"],
    ["merge key", "name: app\nx-b: &b\n  container_name: prod-db\nservices:\n  db:\n    <<: *b\n    image: postgres\n"],
    ["later document", "name: app\nservices: {db: {image: postgres}}\n---\nservices: {db: {container_name: prod-db}}\n"],
  ])("warns on a fixed container_name written as a %s, as Compose reads it", (_n, body) => {
    const r = checkC(setup(test(), { "compose.yml": body }), {}, ["--static"]);
    expect(r.out).toContain("WARN e.container_name  fixed container_name prod-db collides across worktrees");
  });

  it("reads container_name only as a service key, and warns when a compose file cannot be parsed", () => {
    const scalar = "name: app\nservices:\n  db:\n    image: x\n    command: |\n      container_name: notreal\nx-note: {container_name: notreal}\n";
    expect(checkC(setup(test(), { "compose.yml": scalar }), {}, ["--static"]).out).toContain("PASS e.container_name  no fixed container_name");
    const bad = checkC(setup(test(), { "compose.yml": "name: app\nservices: {db: {container_name: x}\n" }), {}, ["--static"]);
    expect(bad.out).toContain("WARN e.container_name  cannot read container_name: compose.yml does not parse as a compose file — fix: fix the file until docker compose config accepts it");
  });
});

describe("b.containers", () => {
  const COMPOSE = "name: app-prod\nservices:\n  web:\n    image: x\n";
  const cfg = (extra = "") => `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml"]\ninputs = ["compose.yml", "docker/**"]\n${extra}`;
  const files = { "compose.yml": COMPOSE, "docker/Dockerfile": "FROM x\n" };
  const res = (code: number | null, stdout = ""): RunResult => ({ code, stdout, stderr: "", timedOut: false });
  /** A fake docker: `ps` lists `ids`, `inspect` prints `created` for each, `compose config` answers from `answers`; every other command runs for real. */
  const fake = (ps: RunResult, created: string[] = [], calls: string[][] = [], answers: ComposeAnswers = {}): Runner =>
    composeStub(answers, [], (cmd, args, opts) => {
      if (cmd !== "docker") return run(cmd, args, opts);
      calls.push(args);
      return args[0] === "ps" ? ps : res(0, created.join("\n"));
    });
  const prod = (root: string): ComposeAnswers => ({ [root]: "app-prod" });
  const b = (root: string, args: string[], runner: Runner) => check(root, args, {}, runner).lines.filter((l) => l.includes("b.containers")).join("\n");
  const stale = (root: string) => fake(res(0, "a1\n"), ["/web-1 2000-01-01T00:00:00Z"], [], prod(root));

  it("fails (default) or warns on containers created before the newest input commit", () => {
    const root = setup(cfg(), files);
    commit(root);
    const old = ["/web-1 2000-01-01T00:00:00Z", "/db-1 2000-01-02T00:00:00Z"];
    const calls: string[][] = [];
    const r = check(root, [], {}, fake(res(0, "a1\nb2\n"), old, calls, prod(root)));
    expect(r.code).toBe(1);
    // A lone default-named file needs no -f: the fix is the developer's own invocation plus -p.
    expect(r.out).toContain("FAIL b.containers  web-1, db-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod up -d --build --force-recreate");
    expect(calls[0]).toEqual(["ps", "-q", "--filter", "label=com.docker.compose.project=app-prod"]);
    const warn = setup(cfg('containers = "warn"\n'), files);
    const w = check(warn, [], {}, fake(res(0, "a1\n"), old, [], prod(warn)));
    expect([w.code, w.out]).toEqual([0, expect.stringContaining("WARN b.containers  web-1, db-1 created")]);
  });

  it("names every configured compose file in the fix, quoting odd paths", () => {
    const two = cfg().replace('files = ["compose.yml"]', 'files = ["compose.yml", "ops/compose test.yml"]');
    const root = setup(two, { ...files, "ops/compose test.yml": "services: {}\n" });
    commit(root);
    expect(b(root, [], stale(root))).toContain("— fix: docker compose -p app-prod -f compose.yml -f 'ops/compose test.yml' up -d --build --force-recreate");
  });

  it("passes when every container is newer than the inputs", () => {
    const root = setup(cfg(), files);
    commit(root);
    expect(b(root, [], fake(res(0, "a1\n"), ["/web-1 2999-01-01T00:00:00Z"], [], prod(root)))).toBe("PASS b.containers  1 running container(s) are newer than the compose inputs");
  });

  /** git, with the commit dated `date`. */
  const at = (cwd: string, date: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });

  it("fails on a container built before a pull brought in an older-dated input commit", () => {
    const up = repo({ ...files, [CFG]: cfg() });
    at(up, "2001-01-01T00:00:00Z", "commit", "-q", "--amend", "--no-edit", "--reset-author");
    const root = join(tmp(), "app");
    sh(dirname(root), "clone", "-q", up, root);
    put(up, "compose.yml", COMPOSE.replace("image: x", "image: x:2"));
    sh(up, "add", "-A");
    // Committed upstream before the container was built; pulled after.
    at(up, "2002-01-01T00:00:00Z", "commit", "-q", "-m", "x:2");
    sh(root, "pull", "-q", "--ff-only");
    expect(b(root, [], fake(res(0, "a1\n"), ["/web-1 2010-01-01T00:00:00Z"], [], prod(root)))).toBe(
      "FAIL b.containers  web-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod up -d --build --force-recreate",
    );
  });

  it("compares with the inputs' modification times too, so an edit on disk after the build fails", () => {
    const root = repo({ ...files, [CFG]: cfg() });
    at(root, "2001-01-01T00:00:00Z", "commit", "-q", "--amend", "--no-edit", "--reset-author");
    const old = new Date("2005-01-01T00:00:00Z");
    for (const f of Object.keys(files)) utimesSync(join(root, f), old, old);
    const built = fake(res(0, "a1\n"), ["/web-1 2010-01-01T00:00:00Z"], [], prod(root));
    expect(b(root, [], built)).toBe("PASS b.containers  1 running container(s) are newer than the compose inputs");
    put(root, "docker/Dockerfile", "FROM x:2\n");
    expect(b(root, [], built)).toContain("FAIL b.containers  web-1 created before the newest change to the compose inputs");
  });

  it("prints a fix that recreates the containers, since a cache-hit rebuild keeps a container whose input was only rewritten", () => {
    const root = repo({ ...files, [CFG]: cfg() });
    at(root, "2001-01-01T00:00:00Z", "commit", "-q", "--amend", "--no-edit", "--reset-author");
    const old = new Date("2005-01-01T00:00:00Z");
    for (const f of Object.keys(files)) utimesSync(join(root, f), old, old);
    // Same content, newer mtime: `up -d --build` alone leaves the container Running and this FAIL in place.
    const touched = new Date("2020-01-01T00:00:00Z");
    utimesSync(join(root, "compose.yml"), touched, touched);
    expect(b(root, [], fake(res(0, "a1\n"), ["/web-1 2010-01-01T00:00:00Z"], [], prod(root)))).toBe(
      "FAIL b.containers  web-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod up -d --build --force-recreate",
    );
  });

  // Since 0.5.0 the command names no override: it omits -f for a lone default-named file, so plain Compose loads the
  // override itself, whatever override files say. A shell COMPOSE_FILE, or a default file Compose prefers beside the
  // configured one, would make plain Compose load another stack, so then the configured -f is passed.
  it("omits -f for a lone default-named file, so plain Compose loads its override itself", () => {
    const root = setup(cfg(), { ...files, ".gitignore": "compose.override.yml\ndocker-compose.override.yaml\ncompose.yaml\n" });
    commit(root);
    put(root, "compose.override.yml", "services:\n  web:\n    ports: [\"8080:80\"]\n");
    put(root, "docker-compose.override.yaml", "services: {}\n");
    put(root, "docker-compose.yml", "services: {}\n");
    const fix = "— fix: docker compose -p app-prod up -d --build --force-recreate";
    const withF = "— fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate";
    expect(b(root, [], stale(root))).toContain(fix);
    expect(check(root, [], { COMPOSE_FILE: "other.yml" }, stale(root)).out).toContain(withF);
    // Compose reads COMPOSE_FILE from the .env too; loops reads no .env, so that one is the developer's own run.
    put(root, ".env", "COMPOSE_FILE=compose.yml\n");
    expect(b(root, [], stale(root))).toContain(fix);
    put(root, "compose.yaml", "services: {}\n");
    expect(b(root, [], stale(root))).toContain(withF);
  });

  // Since 0.5.0 a default-named file in a subdirectory, a non-default name or a multi-file set gets the configured -f
  // list, under which Compose loads no override, so none is named.
  it("passes the configured -f list for a file in a subdirectory, a non-default name or a multi-file set, naming no override", () => {
    const sub = setup(cfg().replace(/"compose\.yml"/g, '"deploy/docker-compose.yml"'), { "deploy/docker-compose.yml": COMPOSE });
    commit(sub);
    put(sub, "deploy/compose.override.yaml", "services: {}\n");
    expect(b(sub, [], stale(sub))).toContain("— fix: docker compose -p app-prod -f deploy/docker-compose.yml up -d --build --force-recreate");
    const named = setup(cfg().replace(/"compose\.yml"/g, '"stack.yml"'), { "stack.yml": COMPOSE });
    commit(named);
    put(named, "compose.override.yml", "services: {}\n");
    expect(b(named, [], stale(named))).toContain("— fix: docker compose -p app-prod -f stack.yml up -d --build --force-recreate");
    const two = setup(cfg().replace('files = ["compose.yml"]', 'files = ["compose.yml", "ops/extra.yml"]'), { ...files, "ops/extra.yml": "services: {}\n" });
    commit(two);
    put(two, "compose.override.yml", "services: {}\n");
    expect(b(two, [], stale(two))).toContain("— fix: docker compose -p app-prod -f compose.yml -f ops/extra.yml up -d --build --force-recreate");
  });

  it("skips (never warns) when docker is absent, the daemon is down, or the stack is not running", () => {
    const root = setup(cfg(), files);
    commit(root);
    expect(b(root, [], fake(res(null), [], [], prod(root)))).toContain("SKIP b.containers  docker is not available");
    expect(b(root, [], fake(res(1), [], [], prod(root)))).toContain("SKIP b.containers  docker is not available");
    expect(b(root, [], fake(res(0, "\n"), [], [], prod(root)))).toBe("SKIP b.containers  stack down (no running container for project app-prod)");
    expect(check(root, [], {}, fake(res(0, ""), [], [], prod(root))).code).toBe(0);
  });

  it("skips with the project unknown when Compose is unavailable in the main checkout, and uses the vouchable name in a worktree", () => {
    const root = setup(cfg(), files);
    put(root, CFG, cfg() + local(root, "d.p", 'echo "PASS d.p project=[$ENV_CHECK_PROJECT]"'));
    commit(root);
    const fresh = ["/web-1 2999-01-01T00:00:00Z"];
    const calls: string[][] = [];
    const m = check(root, [], {}, fake(res(0, "a1\n"), fresh, calls, { [root]: { unavailable: "docker" } }));
    expect([m.code, calls]).toEqual([0, []]);
    expect(m.out).toContain("SKIP b.containers  project unknown (compose unavailable)");
    expect(m.out).toContain("PASS d.p  project=[]");
    const wt = worktree(root, "feat-u");
    const w = check(wt, [], {}, fake(res(0, "a1\n"), fresh, calls, { [wt]: { unavailable: "plugin" } }));
    expect(calls[0]).toEqual(["ps", "-q", "--filter", "label=com.docker.compose.project=feat-u"]);
    expect(w.out).toContain("PASS b.containers  1 running container(s) are newer than the compose inputs");
    expect(w.out).toContain("PASS d.p  project=[feat-u]");
    const shell = check(wt, [], { COMPOSE_PROJECT_NAME: "mine" }, fake(res(0, "a1\n"), fresh, calls, { [wt]: { unavailable: "plugin" } }));
    expect(calls[2]![3]).toBe("label=com.docker.compose.project=mine");
    expect(shell.out).toContain("PASS d.p  project=[mine]");
  });

  it("skips when no commit touches the inputs or docker inspect fails", () => {
    const none = setup(cfg().replace('inputs = ["compose.yml", "docker/**"]', 'inputs = ["nothing/**"]'), files);
    commit(none);
    expect(b(none, [], stale(none))).toBe("SKIP b.containers  no commit touches the [compose] inputs");
    const root = setup(cfg(), files);
    commit(root);
    const failInspect = composeStub(prod(root), [], (cmd, args, opts) => (cmd !== "docker" ? run(cmd, args, opts) : args[0] === "ps" ? res(0, "a1\n") : res(1)));
    const r = check(root, [], {}, failInspect);
    expect([r.code, r.lines.filter((l) => l.includes("b.containers"))]).toEqual([0, ["SKIP b.containers  docker inspect failed"]]);
  });

  it("hands a failing project to neither docker nor local checks", () => {
    const root = setup(cfg(), files);
    put(root, CFG, cfg() + local(root, "d.p", 'echo "PASS d.p project=$ENV_CHECK_PROJECT"'));
    commit(root);
    put(root, ".env", "COMPOSE_PROJECT_NAME=app-prod\n");
    const wt = worktree(root, "feat-copy");
    put(wt, ".env", "COMPOSE_PROJECT_NAME=app-prod\n");
    const calls: string[][] = [];
    // The copied .env is not the worktree's identity (-p feat-copy is), but plain docker compose there hits prod: a FAIL either way.
    const r = check(wt, [], {}, fake(res(0, "a1\n"), ["/web-1 2000-01-01T00:00:00Z"], calls, { [root]: "app-prod", [wt]: "app-prod" }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name app-prod")]);
    expect(calls).toEqual([]);
    expect(r.out).not.toContain("b.containers");
    expect(r.out).toContain("PASS d.p  project=\n");
  });

  it("is not run under --static, without inputs, or in compose mode none", () => {
    const calls: string[][] = [];
    const root = setup(cfg(), files);
    commit(root);
    // No answers: a compose probe under --static would throw.
    expect(b(root, ["--static"], fake(res(0, "a1"), [], calls))).toBe("");
    const noInputs = setup(`${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml"]\n`, files);
    expect(b(noInputs, [], fake(res(0, "a1"), [], calls, prod(noInputs)))).toBe("");
    expect(b(setup(`${HEAD}[compose]\nmode = "none"\n`), [], fake(res(0, "a1"), [], calls))).toBe("");
    expect(calls).toEqual([]);
  });

  it("uses the worktree's derived project name", () => {
    const root = setup(cfg(), { ...files, "compose.yml": "services:\n  web:\n    image: x\n" });
    commit(root);
    const calls: string[][] = [];
    const wt = worktree(root, "feat-z");
    b(wt, [], fake(res(0, ""), [], calls, { [root]: "app-node", [wt]: "feat-z" }));
    expect(calls[0]![3]).toBe("label=com.docker.compose.project=feat-z");
  });
});

describe("local checks", () => {
  const run = (script: string, extra = "", env: Record<string, string> = {}, args: string[] = []) => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + local(root, "d.x", script, extra));
    return check(root, args, env);
  };

  it("relays protocol lines, with fixes, and exports the ENV_CHECK_* environment", () => {
    const r = run('echo "PASS d.x mode=$ENV_CHECK_MODE wt=$ENV_CHECK_WORKTREE id=$ENV_CHECK_ID no_color=$NO_COLOR proxy=$GOPROXY tc=$GOTOOLCHAIN"\necho "WARN d.x.two careful — fix: do it"\necho "INFO d.x.three fyi"\necho "SKIP d.x.four n/a"');
    expect(r.code).toBe(0);
    expect(r.lines).toEqual([
      "PASS d.x  mode=full wt=0 id=d.x no_color=1 proxy=off tc=local",
      "WARN d.x.two  careful — fix: do it",
      "INFO d.x.three  fyi",
      "SKIP d.x.four  n/a",
      "env-check: 0 FAIL, 1 WARN, 1 PASS, 1 SKIP",
    ]);
  });

  it.each([
    ["an unparseable line", 'echo "all good"', /FAIL d\.x\.protocol {2}unparseable line: all good/],
    ["an id outside the configured one", 'echo "PASS other.id ok"', /FAIL d\.x\.protocol {2}unparseable line: PASS other\.id ok/],
    ["an id that only shares a prefix", 'echo "PASS d.xy ok"', /FAIL d\.x\.protocol {2}unparseable line: PASS d\.xy ok/],
    ["no output", "true", /FAIL d\.x {2}printed no results/],
    ["a nonzero exit without a FAIL line", 'echo "PASS d.x fine"\necho boom >&2\nexit 4', /FAIL d\.x {2}exited 4 without a FAIL line \(boom\)/],
  ])("fails closed on %s", (_n, script, re) => {
    const r = run(script);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(re);
    expect(r.out).toContain("— fix:");
  });

  it("does not add a FAIL when the check already printed one, and warns on a timeout", () => {
    const f = run('echo "FAIL d.x broken — fix: repair"\nexit 1');
    expect(f.lines).toEqual(["FAIL d.x  broken — fix: repair", "env-check: 1 FAIL, 0 WARN, 0 PASS, 0 SKIP"]);
    const t = run("exec sleep 5", "timeout_s = 0.2\n");
    expect([t.code, t.out]).toEqual([0, expect.stringContaining("WARN d.x  timed out after 0.2s (not a pass)")]);
    expect(t.out).not.toContain("printed no results");
    // Value: protects=a timeout_s whose *1000 has float error (16.1) is accepted and spawned with a whole-millisecond timeout; fails_when=the validator checks Number.isSafeInteger(v * 1000) again; why_new=the whole-millisecond guard rejected valid values; seam=none; no_claim=none beyond protects
    expect(run('echo "PASS d.x ok"', "timeout_s = 16.1\n")).toMatchObject({ code: 0, out: expect.stringContaining("PASS d.x  ok") });
  });

  it("keeps a FAIL printed before the timeout", () => {
    // The deadline leaves room for the first exec of a newly written script, which can take over 0.5s on a loaded machine.
    const ft = run('echo "FAIL d.x.early broken"\nexec sleep 30', "timeout_s = 3\n");
    expect([ft.code, ft.lines.slice(0, 2)]).toEqual([1, ["FAIL d.x.early  broken — fix: address the message above and re-run", "WARN d.x  timed out after 3s (not a pass) — fix: raise timeout_s or run .loops/checks/d_x.sh by hand"]]);
  }, 15_000);

  it("kills a check that ignores SIGTERM at its timeout", () => {
    const t0 = Date.now();
    // A shell loop, not `exec sleep`: some sh builds reset an ignored TERM across exec.
    const t = run('trap "" TERM\nend=$(($(date +%s) + 4))\nwhile [ "$(date +%s)" -lt "$end" ]; do :; done', "timeout_s = 0.2\n");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(t.out).toContain("WARN d.x  timed out after 0.2s (not a pass)");
  });

  it("exports ENV_CHECK_PROJECT: the resolved project, else empty", () => {
    const project = (compose: string, args: string[] = []) => {
      const root = setup(HEAD, { "compose.yml": "name: app-prod\nservices: {}\n" });
      put(root, CFG, `${HEAD}${compose}${local(root, "d.p", 'echo "PASS d.p project=[$ENV_CHECK_PROJECT]"', "static = true\n")}`);
      // --static never asks Compose (an empty answer map would throw).
      return checkC(root, args.includes("--static") ? {} : { [root]: "app-prod" }, args).out;
    };
    const test = '[compose]\nmode = "test"\nfiles = ["compose.yml"]\n';
    expect(project(test)).toContain("PASS d.p  project=[app-prod]");
    expect(project(test, ["--static"])).toContain("PASS d.p  project=[]");
    expect(project('[compose]\nmode = "none"\n')).toContain("PASS d.p  project=[]");
    expect(project("")).toContain("PASS d.p  project=[]");
  });

  it("runs only static = true checks under --static, skipping the rest", () => {
    expect(run('echo "PASS d.x ran $ENV_CHECK_MODE"', "static = true\n", {}, ["--static"]).out).toContain("PASS d.x  ran static");
    expect(run('echo "PASS d.x ran"', "", {}, ["--static"]).out).toContain("SKIP d.x  not run in --static mode");
  });

  it("collapses identical results into one line that names the repeated ids", () => {
    const root = setup(HEAD);
    const a = local(root, "d.a", 'echo "FAIL d.a stack down — fix: start it"');
    const b = local(root, "d.b", 'echo "FAIL d.b stack down — fix: start it"');
    const c = local(root, "x.c", 'echo "FAIL x.c stack down — fix: start it"');
    put(root, CFG, HEAD + a + b + c);
    const r = check(root);
    expect(r.lines).toEqual(["FAIL d.a  stack down — fix: start it (also: d.b, x.c)", "env-check: 1 FAIL, 0 WARN, 0 PASS, 0 SKIP"]);
  });

  it("orders groups a, c, d, e, then x, keeping config order inside a group", () => {
    const root = setup(HEAD);
    const parts = ["x.z", "d.b", "a.c", "d.a"].map((id) => local(root, id, `echo "PASS ${id} ok from ${id}"`));
    put(root, CFG, HEAD + parts.join(""));
    expect(check(root).lines.slice(0, 4).map((l) => l.split(" ")[1])).toEqual(["a.c", "d.b", "d.a", "x.z"]);
  });
});

describe("output and exit codes", () => {
  it("--quiet prints only WARN and FAIL plus the summary", () => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + local(root, "d.a", 'echo "PASS d.a fine"\necho "WARN d.a.w hmm — fix: x"\necho "INFO d.a.i note"'));
    expect(check(root, ["--quiet"]).lines).toEqual(["WARN d.a.w  hmm — fix: x", "env-check: 0 FAIL, 1 WARN, 1 PASS, 0 SKIP"]);
  });

  it("--json carries results, summary and exit; INFO is not counted", () => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + local(root, "d.a", 'echo "PASS d.a fine"\necho "FAIL d.a.f bad"\necho "INFO d.a.i note"'));
    const j = JSON.parse(check(root, ["--json"]).out);
    expect(j).toMatchObject({ schema: 1, engine: VERSION, mode: "full", exit: 1, summary: { fail: 1, warn: 0, pass: 1, skip: 0 } });
    expect(j.results[1]).toEqual({ level: "FAIL", id: "d.a.f", message: "bad", fix: "address the message above and re-run", also: [], source: "local" });
  });

  it("replaces $HOME with ~ in text and json, and never leaks it", () => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + local(root, "d.a", 'echo "PASS d.a root=$ENV_CHECK_ROOT"'));
    const env = { HOME: dirname(root) };
    expect(check(root, [], env).lines[0]).toBe("PASS d.a  root=~/app-node");
    const raw = check(root, ["--json"], env).out;
    expect(raw).not.toContain(dirname(root));
    expect(JSON.parse(raw).root).toBe("~/app-node");
  });

  const bad: [string, string, RegExp][] = [
    ["invalid TOML", "schema_version = \n", /env-check\.toml: /],
    ["no schema_version", "", /schema_version is missing/],
    ["schema_version 2", "schema_version = 2\n", new RegExp(`schema_version 2 is unsupported by loops ${V}`)],
    ["unknown top-level key", `${HEAD}colour = 1\n`, /unknown key "colour"/],
    ["unknown pins key", `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\nfoo = 1\n`, /\[\[pins\]\] #1: unknown key "foo"/],
    ["unknown source kind", `${HEAD}[[pins]]\ntool = "go"\nsources = ["gomod"]\n`, /unknown source kind in "gomod"/],
    ["inherited source kind", `${HEAD}[[pins]]\ntool = "go"\nsources = ["constructor"]\n`, /unknown source kind in "constructor"/],
    ["bad compare", `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\ncompare = "close"\n`, /compare must be exact\|minor\|major\|floor/],
    ["engine too new", `engine = ">=9.0.0"\n${HEAD}`, new RegExp(`needs loops >=9\\.0\\.0, this is ${V}; update agentic-tools`)],
    ["engine odd form", `engine = "^0.4"\n${HEAD}`, /engine must look like ">=0\.4\.0"/],
    ["compose test without files", `${HEAD}[compose]\nmode = "test"\n`, /mode test needs files/],
    ["compose dev", `${HEAD}[compose]\nmode = "dev"\n`, /mode must be none\|test/],
    ["bad local id", `${HEAD}[[local]]\nid = "zz"\nrun = "a"\n`, /id "zz" must look like/],
    // Value: protects=parseConfig rejects empty sources, duplicate local ids and a non-positive timeout_s; fails_when=one of those guards is removed; why_new=the bad-config table had no rows for them; seam=none; no_claim=none beyond protects
    ["empty sources", `${HEAD}[[pins]]\ntool = "go"\nsources = []\n`, /\[\[pins\]\] #1: sources is empty/],
    ["duplicate local id", `${HEAD}[[local]]\nid = "d.a"\nrun = "a"\n[[local]]\nid = "d.a"\nrun = "b"\n`, /\[\[local\]\] #2: duplicate id d\.a/],
    ["zero timeout", `${HEAD}[[local]]\nid = "d.a"\nrun = "a"\ntimeout_s = 0\n`, /timeout_s must be a positive number/],
    ["infinite timeout", `${HEAD}[[local]]\nid = "d.a"\nrun = "a"\ntimeout_s = inf\n`, /timeout_s must be a positive number/],
    ["sub-millisecond timeout", `${HEAD}[[local]]\nid = "d.a"\nrun = "a"\ntimeout_s = 0.0005\n`, /timeout_s must be a positive number/],
    ["absolute local run", `${HEAD}[[local]]\nid = "d.a"\nrun = "/bin/true"\n`, /\[\[local\]\] #1: run "\/bin\/true" must be a repo-relative path/],
    ["local run outside the repo", `${HEAD}[[local]]\nid = "d.a"\nrun = "x/../../x.sh"\n`, /run "x\/\.\.\/\.\.\/x\.sh" must be a repo-relative path/],
    ["missing local check", `${HEAD}[[local]]\nid = "d.a"\nrun = ".loops/checks/nope.sh"\n`, /local check d\.a: \.loops\/checks\/nope\.sh is missing or not executable/],
  ];
  it.each(bad)("exits 2 on %s", (_n, config, re) => {
    const r = check(setup(config));
    expect([r.code, r.err]).toEqual([2, expect.stringMatching(re)]);
    expect(r.out).toBe("");
  });

  it("exits 2 for a non-executable local check, a missing config, a non-repo and bad flags", () => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + local(root, "d.a", "true", "", false));
    expect(check(root).code).toBe(2);
    expect(check(repo()).err).toContain("nothing to check");
    expect(check(tmp()).err).toContain("not a git repository");
    expect(check(setup(HEAD), ["--bogus"]).code).toBe(2);
    expect(check(setup(`engine = ">=0.4.0"\n${HEAD}`)).code).toBe(0);
    // Value: protects=an engine floor below VERSION with a higher later component (>=0.3.9) is accepted; fails_when=checkEngine compares components independently instead of stopping at the first difference; why_new=only the equal floor was tested; seam=none; no_claim=none beyond protects
    expect(check(setup(`engine = ">=0.3.9"\n${HEAD}`)).code).toBe(0);
  });

  it("exits 2 naming the file when the config path is unreadable", () => {
    const root = repo({ "README.md": "x\n" });
    mkdirSync(join(root, CFG), { recursive: true });
    const r = check(root);
    expect([r.code, r.err]).toEqual([2, expect.stringContaining(`cannot read ${join(root, CFG)}`)]);
  });

  it("exits 2 when git ls-files fails on a corrupt index", () => {
    const root = setup(HEAD);
    put(root, ".git/index", "garbage, not an index");
    const r = check(root);
    expect([r.code, r.err]).toEqual([2, expect.stringMatching(/git ls-files failed: \S/)]);
  });

  it("--compose-project exits 2 when compose mode is not test", () => {
    expect(check(setup(HEAD), ["--compose-project"]).code).toBe(2);
  });
});

describe("wrapper templates/env-check", () => {
  const wrapper = join(HERE, "..", "..", "templates", "env-check");
  const sandbox = (env: Record<string, string>, ...args: string[]) => {
    const r = spawnSync("/bin/sh", [wrapper, ...args], { env, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const nodeDir = (): string => {
    const dir = tmp();
    symlinkSync(process.execPath, join(dir, "node"));
    return dir;
  };

  it("execs $LOOPS_BIN with env-check and the caller's args, then falls back to $HOME/bin/loops and PATH", () => {
    const fake = shim("loops", 'echo "ran $*"');
    expect(sandbox({ PATH: nodeDir(), HOME: tmp(), LOOPS_BIN: join(fake, "loops") }, "--static")).toMatchObject({ code: 0, out: "ran env-check --static\n" });
    const home = tmp();
    shim("loops", 'echo "home $*"', join(home, "bin"));
    expect(sandbox({ PATH: nodeDir(), HOME: home }).out).toBe("home env-check\n");
    expect(sandbox({ PATH: `${nodeDir()}:${fake}`, HOME: tmp() }).out).toBe("ran env-check\n");
  });

  it("runs a non-executable bundle through node", () => {
    const dir = tmp();
    put(dir, "loops.mjs", "process.stdout.write(process.argv.slice(2).join(' '));");
    expect(sandbox({ PATH: nodeDir(), HOME: tmp(), LOOPS_BIN: join(dir, "loops.mjs") }, "--json").out).toBe("env-check --json");
  });

  it("prints a hint and exits 3 when there is no engine or no node", () => {
    const none = sandbox({ PATH: nodeDir(), HOME: tmp() });
    expect(none).toMatchObject({ code: 3, out: "env-check: not run\n" });
    expect(none.err).toContain("engine not installed");
    const fake = shim("loops", "echo hi");
    expect(sandbox({ PATH: tmp(), HOME: tmp(), LOOPS_BIN: join(fake, "loops") }).code).toBe(3);
  });

  it("stays within 30 lines", () => {
    expect(readFileSync(wrapper, "utf8").split("\n").length).toBeLessThanOrEqual(31);
  });
});

describe("versions", () => {
  it("package.json and plugin.json match the CLI version", () => {
    const at = (f: string): string => (JSON.parse(readFileSync(join(HERE, "..", "..", f), "utf8")) as { version: string }).version;
    expect([at("package.json"), at(".claude-plugin/plugin.json")]).toEqual([VERSION, VERSION]);
    expect(main(["--version"], deps(tmp()).d)).toBe(0);
    // Value: protects=an unknown or missing loops subcommand exits 2 with usage on stderr; fails_when=the dispatcher falls through to exit 0 or throws; why_new=only --version was exercised; seam=none; no_claim=none beyond protects
    const t = deps(tmp());
    expect([main(["frobnicate"], t.d), main([], t.d)]).toEqual([2, 2]);
    expect(t.err.join("\n")).toMatch(/^frobnicate: unknown command frobnicate\nloops [0-9.]+\nusage: loops/);
  });
});
