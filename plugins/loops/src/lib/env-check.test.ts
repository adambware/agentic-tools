import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { run, type Runner, type RunResult } from "./proc.js";
import { deps, put, repo, sh, shim, tmp } from "./testkit.js";
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
    // Compose merges the documents and rejects these top-level keys.
    const k8s = "apiVersion: v1\nkind: Service\n---\napiVersion: v1\nkind: Pod\n";
    const r = check(setup(`${HEAD}[compose]\n`, { "deploy/compose-k8s.yaml": k8s, "compose-ci.yml": "a: 1\n---\nb: 2\n", "compose-lint.yml": "name: lint\nfoo: 1\n" }));
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.none  no compose file tracked")]);
  });

  it.each([
    ["declares only top-level networks", "ops/compose-net.yml", "networks:\n  edge: {}\n"],
    ["declares only an include", "compose-dev.yaml", "include:\n  - compose.base.yml\n"],
    ["is not valid YAML", "compose-ci.yml", "services: [\n"],
    // `docker compose -f <file> config` loads each of these.
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
    expect(check(root, ["--compose-project"]).out).toBe("app-prod");
    expect(check(root).out).toContain("PASS e.project  app-prod (name: in compose file)");
    const bare = setup(test(), { "compose.yml": "services: {}\n" });
    commit(bare);
    const wt = worktree(bare, "Feat_X.1");
    // Compose lowercases and drops (does not replace) invalid characters.
    expect(check(wt, ["--compose-project"]).out).toBe("feat_x1");
    expect(check(wt).out).toContain("PASS e.project  feat_x1 (derived: dirname)");
  });

  it("derives the name from the first compose file's directory, as Compose does", () => {
    const sub = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/compose.yml"]\n`;
    const root = setup(sub, { "deploy/compose.yml": "services: {}\n" });
    commit(root);
    expect(check(root, ["--compose-project"]).out).toBe("deploy");
    // Every worktree's plain `docker compose` is project deploy too: the main checkout's.
    const wt = worktree(root, "feat-d");
    const r = check(wt);
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name deploy")]);
    // The .env Compose reads sits beside the first compose file, not at the repo root.
    put(root, ".env", "COMPOSE_PROJECT_NAME=fromroot\n");
    put(root, "deploy/.env", "COMPOSE_PROJECT_NAME=fromdeploy\n");
    expect(check(root, ["--compose-project"]).out).toBe("fromdeploy");
    // slug-hash names worktrees only; the main checkout keeps Compose's default.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    expect(check(slug, ["--compose-project"]).out).toBe("app-node");
  });

  it("slug-hash appends a path hash, so equal basenames never collide", () => {
    const root = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    commit(root);
    const a = check(worktree(root, "feat-x"), ["--compose-project"]).out;
    const b = check(worktree(root, "feat-x"), ["--compose-project"]).out;
    expect(a).toMatch(/^app-node-feat-x-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
  });

  it("fails when a worktree would reuse the prod name, or two worktrees derive the same name", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const prod = check(worktree(root, "app-prod"));
    expect([prod.code, prod.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    const plain = setup(test(), { "compose.yml": "services: {}\n" });
    commit(plain);
    worktree(plain, "dup");
    const dup = check(worktree(plain, "dup"));
    expect(dup.out).toMatch(/FAIL e\.project {2}project name dup is also used by worktree .*dup/);
    // The prod name is the main checkout's name:, even when the worktree's compose file declares another.
    const renamed = worktree(root, "app-prod");
    put(renamed, "compose.yml", COMPOSE.replace("app-prod", "app-other"));
    expect(check(renamed).out).toContain("FAIL e.project  worktree would use the main checkout's project name app-prod");
    // With no compose file in the main checkout, the worktree's own name: still counts as prod.
    const bare = setup(test(), { "compose.yml": COMPOSE });
    commit(bare);
    const wt = worktree(bare, "app-prod");
    rmSync(join(bare, "compose.yml"));
    expect(check(wt).out).toContain("FAIL e.project  worktree would use the main checkout's project name app-prod");
  });

  it("takes the prod name from the main checkout's directory when its compose file has no name:, whatever the worktree declares", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    const prod = check(root, ["--compose-project"]).out;
    const wt = worktree(root, "feat-a");
    put(wt, "compose.yml", "name: feat-stack\nservices: {}\n");
    const shell = check(wt, [], { COMPOSE_PROJECT_NAME: prod });
    expect([shell.code, shell.out]).toEqual([1, expect.stringContaining(`FAIL e.project  worktree would use the main checkout's project name ${prod}`)]);
    put(wt, ".env", `COMPOSE_PROJECT_NAME=${prod}\n`);
    expect(check(wt).out).toContain(`FAIL e.project  worktree would use the main checkout's project name ${prod}`);
    rmSync(join(wt, ".env"));
    // Its own name: is not the main checkout's, but plain docker compose there still runs as feat-stack, not feat-a.
    const own = check(wt);
    expect([own.code, own.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use its compose name: feat-stack, not feat-a — fix: add COMPOSE_PROJECT_NAME=feat-a to .env")]);
    put(wt, ".env", "COMPOSE_PROJECT_NAME=feat-a\n");
    expect(check(wt).out).toContain("PASS e.project  feat-a (COMPOSE_PROJECT_NAME)");
  });

  it("COMPOSE_PROJECT_NAME wins, unless it is the prod name", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-y");
    expect(check(wt, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" }).out).toBe("mine");
    expect(check(wt, ["--compose-project"], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
  });

  it("fails when a configured compose file is missing, naming it", () => {
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.test.yml"]\n`;
    const r = check(setup(two, { "compose.yml": COMPOSE }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  compose file missing: compose.test.yml")]);
    expect(check(setup(two, { "compose.yml": COMPOSE, "compose.test.yml": "services: {}\n" })).out).toContain("PASS e.project  app-prod");
  });

  it("resolves interpolation in name: against the check's env, failing closed when it cannot", () => {
    const withName = (n: string) => setup(test(), { "compose.yml": `name: ${n}\nservices: {}\n` });
    const name = (n: string, env: Record<string, string> = {}) => check(withName(n), ["--compose-project"], env).out;
    expect(name("${STACK_NAME:-app-prod}")).toBe("app-prod");
    expect(name("${STACK_NAME:-app-prod}", { STACK_NAME: "other" })).toBe("other");
    // A set-but-empty value resolves to an empty name, which Compose treats as absent.
    expect(check(withName("${STACK_NAME-app-prod}"), [], { STACK_NAME: "" }).out).not.toContain("cannot be resolved");
    expect(name("${STACK_NAME-app-prod}")).toBe("app-prod");
    expect(name("$STACK_NAME", { STACK_NAME: "bare" })).toBe("bare");
    expect(name('"${STACK_NAME:-quoted}" # c')).toBe("quoted");
    for (const bad of ["${STACK_NAME}", "${STACK_NAME:?must set}", "$STACK_NAME"]) {
      const r = check(withName(bad));
      expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.project  compose name: ${bad} cannot be resolved`)]);
    }
    // A worktree on the main stack's interpolated default is the prod name.
    const root = withName("${STACK_NAME:-app-prod}");
    commit(root);
    const wt = worktree(root, "feat-z");
    const clash = check(wt, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    // An unresolvable declaration in the main checkout means the prod name is unknown: fail.
    const mainBad = withName("${STACK_NAME}");
    commit(mainBad);
    const fw = worktree(mainBad, "feat-w");
    expect(check(fw, [], { STACK_NAME: "x" }).out).toContain("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name x");
    expect(check(fw, [], { STACK_NAME: "x", COMPOSE_PROJECT_NAME: "feat-w" }).code).toBe(0);
    put(mainBad, "compose.yml", "name: ${OTHER}\nservices: {}\n");
    expect(check(worktree(mainBad, "feat-v"), [], { STACK_NAME: "x" }).out).toContain("FAIL e.project  the main checkout's compose name: ${OTHER} cannot be resolved");
  });

  it("interpolates name: against the checkout's .env too, and a COMPOSE_PROJECT_NAME there beats the file", () => {
    const root = setup(test(), { "compose.yml": "name: ${STACK_NAME:-dev}\nservices: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-e");
    put(root, ".env", "# c\nexport STACK_NAME='live' # trailing\n");
    const clash = check(wt, [], { COMPOSE_PROJECT_NAME: "live" });
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name live")]);
    expect(check(wt, [], { COMPOSE_PROJECT_NAME: "dev" }).code).toBe(0);
    // The shell env beats .env.
    expect(check(root, ["--compose-project"], { STACK_NAME: "shell" }).out).toBe("shell");
    expect(check(root, ["--compose-project"]).out).toBe("live");
    // A name with no default resolves from .env alone.
    const only = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    expect(check(only).code).toBe(1);
    put(only, ".env", "STACK_NAME=fromenv\n");
    expect(check(only, ["--compose-project"]).out).toBe("fromenv");
    // COMPOSE_PROJECT_NAME in main's .env is the real prod name, whatever the file declares.
    const pinned = setup(test(), { "compose.yml": COMPOSE });
    commit(pinned);
    const pwt = worktree(pinned, "feat-p");
    put(pinned, ".env", "COMPOSE_PROJECT_NAME=envprod\n");
    expect(check(pwt, [], { COMPOSE_PROJECT_NAME: "envprod" }).code).toBe(1);
    expect(check(pwt, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(0);
    // The checkout's own .env names its project too; the shell still wins.
    expect(check(pinned, ["--compose-project"]).out).toBe("envprod");
    expect(check(pinned, ["--compose-project"], { COMPOSE_PROJECT_NAME: "shell" }).out).toBe("shell");
  });

  it("passes an unresolvable name: under --static", () => {
    const root = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    expect(check(root, ["--static"]).out).toContain("PASS e.project  compose files present (project name not resolved in --static)");
    expect(check(root, ["--static"], { CI: "true" }).code).toBe(0);
    expect(check(setup(test(), {}), ["--static"]).out).toContain("FAIL e.project  no compose file found");
  });

  it("treats an empty name: as absent and reads a next-line scalar", () => {
    for (const empty of ['name: ""', "name: ${STACK_NAME:-}", "name: ''"]) {
      const r = check(setup(test(), { "compose.yml": `${empty}\nservices: {}\n` }));
      expect([empty, r.code, r.out]).toEqual([empty, 0, expect.stringContaining("PASS e.project")]);
      expect(r.out).not.toContain("cannot be resolved");
    }
    // A bare reference set to "" resolves to empty (absent), from the shell or the .env.
    for (const bare of ["${STACK_NAME}", "$STACK_NAME"]) {
      const viaShell = check(setup(test(), { "compose.yml": `name: ${bare}\nservices: {}\n` }), [], { STACK_NAME: "" });
      expect([bare, viaShell.code, viaShell.out]).toEqual([bare, 0, expect.stringContaining("PASS e.project")]);
      const viaEnv = setup(test(), { "compose.yml": `name: ${bare}\nservices: {}\n` });
      put(viaEnv, ".env", "STACK_NAME=\n");
      const r = check(viaEnv);
      expect([bare, r.code, r.out]).toEqual([bare, 0, expect.stringContaining("PASS e.project")]);
    }
    expect(check(setup(test(), { "compose.yml": "name:\n  nextline\nservices: {}\n" }), ["--compose-project"]).out).toBe("nextline");
  });

  it("normalizes declared names like Compose before comparing", () => {
    const root = setup(test(), { "compose.yml": "name: My_App!\nservices: {}\n" });
    commit(root);
    expect(check(root, ["--compose-project"]).out).toBe("my_app");
    const wt = worktree(root, "feat-n");
    const r = check(wt, [], { COMPOSE_PROJECT_NAME: "my_app" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("worktree would use the main checkout's project name")]);
    expect(check(wt, [], { COMPOSE_PROJECT_NAME: "My_App" }).code).toBe(1);
    expect(check(wt, [], { COMPOSE_PROJECT_NAME: "other" }).code).toBe(0);
  });

  it("trims leading _ and - from a declared name like Compose", () => {
    const root = setup(test(), { "compose.yml": "name: _MyApp\nservices: {}\n" });
    commit(root);
    expect(check(root, ["--compose-project"]).out).toBe("myapp");
    expect(check(worktree(root, "feat-t"), [], { COMPOSE_PROJECT_NAME: "myapp" }).code).toBe(1);
  });

  it("reports the checkout's own unresolvable name: only when it decides the project", () => {
    const root = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-r");
    put(root, ".env", "STACK_NAME=live\n");
    // The worktree has no .env, so plain docker compose there cannot resolve its own name:.
    const own = check(wt);
    expect([own.code, own.out]).toEqual([1, expect.stringContaining("FAIL e.project  compose name: ${STACK_NAME} cannot be resolved")]);
    // With its own COMPOSE_PROJECT_NAME that name: is irrelevant, and the prod name is main's resolved one.
    put(wt, ".env", "COMPOSE_PROJECT_NAME=feat-r\n");
    expect(check(wt).out).toContain("PASS e.project  feat-r (COMPOSE_PROJECT_NAME)");
    const clash = check(wt, [], { COMPOSE_PROJECT_NAME: "live" });
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name live")]);
    // A main checkout whose COMPOSE_PROJECT_NAME overrides the file does not need the file's name to resolve.
    const bare = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    const viaShell = check(bare, ["--compose-project"], { COMPOSE_PROJECT_NAME: "chosen" });
    expect([viaShell.code, viaShell.out]).toEqual([0, "chosen"]);
    put(bare, ".env", "COMPOSE_PROJECT_NAME=fromenv\n");
    expect(check(bare).out).toContain("PASS e.project  fromenv (COMPOSE_PROJECT_NAME)");
  });

  it("uses the last name: across the ordered compose files, in the worktree and the main checkout", () => {
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.override.yml"]\n`;
    const root = setup(two, { "compose.yml": "name: app-base\n", "compose.override.yml": "name: app-prod\nservices: {}\n" });
    commit(root);
    expect(check(root, ["--compose-project"]).out).toBe("app-prod");
    // The worktree's own override declares the prod name: clash, though its first file says app-base.
    const wt = worktree(root, "feat-o");
    const both = check(wt, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([both.code, both.out]).toEqual([1, expect.stringContaining("worktree would use the main checkout's project name app-prod")]);
    // The main checkout's reserved name is its last declaration, not the first (app-base).
    expect(check(wt, [], { COMPOSE_PROJECT_NAME: "app-base" }).code).toBe(0);
  });

  it("reads a quoted name: key and a flow mapping", () => {
    for (const key of ['"name"', "'name'", "name "]) {
      const root = setup(test(), { "compose.yml": `${key}: app-prod\nservices: {}\n` });
      commit(root);
      expect([key, check(root, ["--compose-project"]).out]).toEqual([key, "app-prod"]);
      expect([key, check(worktree(root, "feat-q"), [], { COMPOSE_PROJECT_NAME: "app-prod" }).code]).toEqual([key, 1]);
    }
    const flow = setup(test(), { "compose.yml": '# c\n{"name": "app-prod", "services": {}}\n' });
    commit(flow);
    expect(check(flow, ["--compose-project"]).out).toBe("app-prod");
    const wt = check(worktree(flow, "feat-f"), [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([wt.code, wt.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
  });

  it("reads name: after a byte-order mark, YAML directives and a root tag", () => {
    const bom = setup(test(), { "compose.yml": "﻿name: app-prod\nservices:\n  web:\n    image: x\n" });
    commit(bom);
    expect(check(bom, ["--compose-project"]).out).toBe("app-prod");
    expect(check(worktree(bom, "feat-b"), [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
    // `docker compose config` names each of these app-prod.
    const docs = ['%YAML 1.1\n---\n{"name": "app-prod", "services": {}}\n', "﻿%YAML 1.1\n%TAG ! tag:x,2000:\n--- {name: app-prod}\n", "--- !!map\n{name: app-prod}\n"];
    for (const doc of docs) {
      const flow = setup(test(), { "compose.yml": doc });
      commit(flow);
      expect([doc, check(flow, ["--compose-project"]).out]).toEqual([doc, "app-prod"]);
      expect([doc, check(worktree(flow, "feat-d"), [], { COMPOSE_PROJECT_NAME: "app-prod" }).code]).toEqual([doc, 1]);
    }
  });

  it("reads name: with YAML 1.2 core scalars under a %YAML 1.1 directive, as Compose does", () => {
    // `docker compose config` names these on, yes and y; YAML 1.1 scalars would make them booleans.
    for (const [doc, want] of [["%YAML 1.1\n---\nname: on\nservices: {}\n", "on"], ["%YAML 1.1\n---\nname: yes\nservices: {}\n", "yes"], ["%YAML 1.1\n---\nservices: {}\n---\nname: y\n", "y"]] as const) {
      const root = setup(test(), { "compose.yml": doc });
      commit(root);
      expect([doc, check(root, ["--compose-project"]).out]).toEqual([doc, want]);
    }
  });

  it("resolves name: in a compose file whose services share nested anchors, as Compose does", () => {
    // `docker compose config` accepts this; yaml's default alias budget (100) rejected it.
    const svcs = Array.from({ length: 30 }, (_, i) => `  svc${i}: {image: alpine, <<: *common}\n`).join("");
    const doc = `name: app-prod\nx-env: &env {TZ: UTC}\nx-base: &base {environment: *env}\nx-common: &common {<<: *base, restart: unless-stopped}\nservices:\n${svcs}`;
    const root = setup(test(), { "compose.yml": doc });
    commit(root);
    expect(check(root, ["--compose-project"]).out).toBe("app-prod");
    const r = check(root);
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.project  app-prod (name: in compose file)")]);
    expect(r.out).toContain("PASS e.container_name  no fixed container_name");
  });

  it("resolves name: across the documents of one compose file as Compose merges them", () => {
    // `docker compose config` gives each of these; a later null or "" name: does not replace a set one.
    const docs: [string, string][] = [
      ["name: app-prod\nservices: {a: {image: x}}\n---\nservices: {b: {image: x}}\n", "app-prod"],
      ["services: {a: {image: x}}\n---\nname: app-prod\n", "app-prod"],
      ["name: app-one\nservices: {}\n---\nname: app-prod\n", "app-prod"],
      ["name: app-prod\nservices: {}\n---\nname: \"\"\n", "app-prod"],
      ["name: app-prod\nservices: {}\n---\nname:\n", "app-prod"],
      ["name: \"\"\nservices: {}\n---\nname: app-prod\n", "app-prod"],
      ["name: app-one\nservices: {}\n---\n{}\n---\n!!map {name: app-prod}\n", "app-prod"],
    ];
    for (const [doc, want] of docs) {
      const root = setup(test(), { "compose.yml": doc });
      commit(root);
      expect([doc, check(root, ["--compose-project"]).out]).toEqual([doc, want]);
      expect([doc, check(worktree(root, "feat-m"), [], { COMPOSE_PROJECT_NAME: want }).code]).toEqual([doc, 1]);
    }
  });

  it("interpolates .env values against earlier keys and the shell, failing closed when it cannot", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-i");
    put(root, ".env", "STACK=live\nCOMPOSE_PROJECT_NAME=${STACK}\n");
    expect(check(root, ["--compose-project"]).out).toBe("live");
    expect(check(root, ["--compose-project"], { STACK: "shell" }).out).toBe("shell");
    expect(check(wt, [], { COMPOSE_PROJECT_NAME: "live" }).code).toBe(1);
    expect(check(wt, [], { COMPOSE_PROJECT_NAME: "stack" }).code).toBe(0);
    // A name: reads a .env key that is itself interpolated.
    const nested = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    put(nested, ".env", 'BASE=app\nSTACK_NAME="${BASE}-live"\n');
    expect(check(nested, ["--compose-project"]).out).toBe("app-live");
    // Unresolvable, or single-quoted (literal), is a FAIL, in the checkout and from a worktree.
    put(root, ".env", "COMPOSE_PROJECT_NAME=${NOPE}\n");
    const own = check(root);
    expect([own.code, own.out]).toEqual([1, expect.stringContaining("FAIL e.project  COMPOSE_PROJECT_NAME ${NOPE} cannot be resolved")]);
    const fromWt = check(wt);
    expect([fromWt.code, fromWt.out]).toEqual([1, expect.stringContaining("FAIL e.project  the main checkout's COMPOSE_PROJECT_NAME ${NOPE} cannot be resolved")]);
    put(root, ".env", "STACK=live\nCOMPOSE_PROJECT_NAME='${STACK}'\n");
    expect(check(root, ["--compose-project"]).code).toBe(1);
  });

  it("rejects an invalid COMPOSE_PROJECT_NAME instead of normalizing it, as Compose does", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    for (const bad of ["UPPER.INVALID", "---", "Upper"]) {
      const p = check(root, ["--compose-project"], { COMPOSE_PROJECT_NAME: bad });
      expect([bad, p.code, p.out, p.err]).toEqual([bad, 1, "", expect.stringContaining(`COMPOSE_PROJECT_NAME ${bad} is not a valid Compose project name`)]);
      expect(check(root, [], { COMPOSE_PROJECT_NAME: bad }).out).toContain(`FAIL e.project  COMPOSE_PROJECT_NAME ${bad} is not a valid Compose project name`);
    }
    const wt = worktree(root, "feat-c");
    put(wt, ".env", "COMPOSE_PROJECT_NAME=My.App\n");
    expect(check(wt).code).toBe(1);
    rmSync(join(wt, ".env"));
    put(root, ".env", "COMPOSE_PROJECT_NAME=Prod.App\n");
    expect(check(wt).out).toContain("FAIL e.project  the main checkout's COMPOSE_PROJECT_NAME Prod.App is not a valid Compose project name");
  });

  it("reads name: through anchors, aliases, tags, merge keys, explicit keys, flow mappings and an indented root, as Compose does", () => {
    // `docker compose config` names each of these app-prod.
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
    ];
    for (const doc of docs) {
      const root = setup(test(), { "compose.yml": doc });
      commit(root);
      expect([doc, check(root, ["--compose-project"]).out]).toEqual([doc, "app-prod"]);
      expect([doc, check(worktree(root, "feat-y"), [], { COMPOSE_PROJECT_NAME: "app-prod" }).code]).toEqual([doc, 1]);
    }
  });

  it("fails closed on a compose file that is not valid YAML, not a mapping in every document, or has a non-string name:", () => {
    // `docker compose config` rejects each of these.
    const docs: [string, string][] = [
      ["name: app-prod\nname: other\nservices: {}\n", "is not valid YAML"],
      ["name: app-prod\nservices: [\n", "is not valid YAML"],
      ["%YAML 1.2\n---\nname: app-prod\n", "has a %YAML directive other than 1.1"],
      ["name: app-prod\nservices: {}\n...\n%YAML 1.2\n---\nname: other\n", "has a %YAML directive other than 1.1"],
      ["name: app-prod\nservices: {}\n---\n", "has no top-level mapping"],
      ["name: app-prod\nservices: {}\n---\n- x\n", "has no top-level mapping"],
      ["name: app-prod\nservices: {}\n---\nname: 123\n---\nname: other\n", "has a name: that is not a string"],
      ["name:\nservices: {}\n---\nname: app-prod\n", "has a name: that is not a string"],
      ["services: {}\n---\nname:\n", "has a name: that is not a string"],
      // Compose accepts this one; yaml keeps anchors per document, so it fails closed.
      ["x-n: &n app-prod\nservices: {}\n---\nname: *n\n", "is not valid YAML"],
      ["- name: app-prod\n", "has no top-level mapping"],
      ["# only a comment\n", "has no top-level mapping"],
      ["name: 123\nservices: {}\n", "has a name: that is not a string"],
      ["name: [app]\nservices: {}\n", "has a name: that is not a string"],
      ["name:\nservices: {}\n", "has a name: that is not a string"],
      ["name: ~\nservices: {}\n", "has a name: that is not a string"],
      ["name: !!binary YXBw\nservices: {}\n", "has a name: that is not a string"],
    ];
    for (const [doc, why] of docs) {
      const root = setup(test(), { "compose.yml": doc });
      commit(root);
      const r = check(root);
      expect([doc, r.code, r.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  compose file compose.yml ${why}`)]);
      // The worktree's own copy fails first; once it is fixed, the main checkout's still decides the prod name.
      const w = worktree(root, "feat-y");
      expect([doc, check(w, [], { COMPOSE_PROJECT_NAME: "app-prod" }).out]).toEqual([doc, expect.stringContaining(`FAIL e.project  compose file compose.yml ${why}`)]);
      put(w, "compose.yml", "services: {}\n");
      const wt = check(w, [], { COMPOSE_PROJECT_NAME: "app-prod" });
      expect([doc, wt.code, wt.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  the main checkout's compose file compose.yml ${why}`)]);
    }
    // Compose rejects the whole project, so a later file's name: does not rescue it.
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.override.yml"]\n`;
    const r = check(setup(two, { "compose.yml": "name: 123\n", "compose.override.yml": "name: app-prod\n" }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  compose file compose.yml has a name: that is not a string")]);
  });

  it("fails in a worktree whose committed name: makes plain docker compose use the prod project", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "s3-wt");
    const r = check(wt);
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name app-prod — fix: add COMPOSE_PROJECT_NAME=s3-wt to .env")]);
    // The worktree's own COMPOSE_PROJECT_NAME (its .env, or the shell) makes it safe.
    put(wt, ".env", "COMPOSE_PROJECT_NAME=s3-wt\n");
    expect(check(wt).out).toContain("PASS e.project  s3-wt (COMPOSE_PROJECT_NAME)");
    expect(check(worktree(root, "s4-wt"), [], { COMPOSE_PROJECT_NAME: "s4" }).out).toContain("PASS e.project  s4 (COMPOSE_PROJECT_NAME)");
    // Under slug-hash too: the worktree's plain Compose name is its file's name:, not the derived one.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": COMPOSE });
    commit(slug);
    const s = check(worktree(slug, "feat-s"));
    expect([s.code, s.out]).toEqual([1, expect.stringMatching(/FAIL e\.project {2}plain docker compose in this worktree would use the main checkout's project name app-prod — fix: add COMPOSE_PROJECT_NAME=app-node-feat-s-[0-9a-f]{6} to \.env/)]);
  });

  it("--compose-project still hands over the safe -p name when only plain docker compose would clash", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "s3-wt");
    // -p s3-wt is safe there, so --compose-project still hands it over, warning on stderr.
    const p = check(wt, ["--compose-project"]);
    expect([p.code, p.out]).toEqual([0, "s3-wt"]);
    expect(p.err).toContain("plain docker compose in this worktree would use the main checkout's project name app-prod; fix: add COMPOSE_PROJECT_NAME=s3-wt to .env");
    // A real reuse of the prod name yields no name, and stderr carries the fix.
    const reuse = check(wt, ["--compose-project"], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([reuse.code, reuse.out, reuse.err]).toEqual([1, "", expect.stringContaining("worktree would use the main checkout's project name app-prod — fix: set COMPOSE_PROJECT_NAME")]);
    // The full run still fails, and hands no project to b.containers or local checks.
    put(root, CFG, test('inputs = ["compose.yml"]\n') + local(root, "d.p", 'echo "PASS d.p project=[$ENV_CHECK_PROJECT]"'));
    commit(root);
    const wp = worktree(root, "s5-wt");
    const calls: string[][] = [];
    const full = check(wp, [], {}, (cmd, args, opts) => (cmd === "docker" ? (calls.push(args), { code: 0, stdout: "a1\n", stderr: "", timedOut: false }) : run(cmd, args, opts)));
    expect([full.code, calls]).toEqual([1, []]);
    expect(full.out).toContain("PASS d.p  project=[]");
  });

  it("reads name: from the files plain docker compose loads: the implicit override and COMPOSE_FILE", () => {
    // `docker compose config` names each of these as asserted.
    const root = setup(test(), { "compose.yml": "services: {}\n", ".gitignore": "compose.override.yml\n.env\n" });
    commit(root);
    put(root, "compose.override.yml", "name: app-prod\n");
    expect(check(root, ["--compose-project"]).out).toBe("app-prod");
    const wt = worktree(root, "feat-ovr");
    expect(check(wt, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
    // A copied override makes plain docker compose in the worktree hit prod.
    put(wt, "compose.override.yml", "name: app-prod\n");
    const plain = check(wt);
    expect([plain.code, plain.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name app-prod")]);
    // COMPOSE_FILE replaces discovery, so the override no longer counts.
    put(root, ".env", "COMPOSE_FILE=compose.yml\n");
    expect(check(root, ["--compose-project"]).out).toBe("app-node");

    // COMPOSE_FILE in the main checkout's .env adds a prod overlay declaring name:.
    const shop = setup(test(), { "compose.yml": "services: {}\n", "compose.prod.yml": "name: shop-prod\n", ".gitignore": ".env\n" });
    commit(shop);
    put(shop, ".env", "COMPOSE_FILE=compose.yml:compose.prod.yml\n");
    expect(check(shop, ["--compose-project"]).out).toBe("shop-prod");
    const w2 = worktree(shop, "feat-cf");
    expect(check(w2).out).toContain("PASS e.project  feat-cf (derived: dirname)");
    expect(check(w2, [], { COMPOSE_PROJECT_NAME: "shop-prod" }).code).toBe(1);
    put(w2, ".env", "COMPOSE_FILE=compose.yml:compose.prod.yml\n");
    expect(check(w2).code).toBe(1);
    // COMPOSE_PATH_SEPARATOR splits it; the shell's COMPOSE_FILE beats the .env's.
    put(shop, ".env", "COMPOSE_PATH_SEPARATOR=;\nCOMPOSE_FILE=compose.yml;compose.prod.yml\n");
    expect(check(shop, ["--compose-project"]).out).toBe("shop-prod");
    expect(check(shop, ["--compose-project"], { COMPOSE_FILE: "compose.yml" }).out).toBe("app-node");

    // COMPOSE_FILE's first file sets the project directory: its name, and its .env for keys the first .env leaves unset.
    const sub = setup(test(), { "compose.yml": "services: {}\n", "deploy/compose.yml": "services: {}\n" });
    put(sub, ".env", "COMPOSE_FILE=deploy/compose.yml\n");
    expect(check(sub, ["--compose-project"]).out).toBe("deploy");
    put(sub, "deploy/.env", "COMPOSE_PROJECT_NAME=fromdeploy\n");
    expect(check(sub, ["--compose-project"]).out).toBe("fromdeploy");
    put(sub, ".env", "COMPOSE_FILE=deploy/compose.yml\nCOMPOSE_PROJECT_NAME=fromroot\n");
    expect(check(sub, ["--compose-project"]).out).toBe("fromroot");

    // An empty COMPOSE_FILE, or one naming a missing file, makes Compose fail, whatever names the project.
    const bad: [string, string][] = [["", "COMPOSE_FILE is empty"], ["gone.yml:compose.yml", "COMPOSE_FILE names gone.yml, which is not a file"]];
    for (const [cf, why] of bad) {
      const r = check(sub, [], { COMPOSE_FILE: cf, COMPOSE_PROJECT_NAME: "x" });
      expect([cf, r.code, r.out]).toEqual([cf, 1, expect.stringContaining(`FAIL e.project  ${why}`)]);
    }
  });

  it("treats the name plain docker compose discovers as prod too when it loads other files than the configured ones", () => {
    // `docker compose config` with no -f gives app-prod in each main checkout below.
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.test.yml"]\n`;
    const root = setup(two, { "compose.yml": "services: {web: {image: x}}\n", "compose.test.yml": "services: {web: {environment: {A: 1}}}\n", ".gitignore": "compose.override.yml\n" });
    commit(root);
    put(root, "compose.override.yml", "name: app-prod\n");
    // The configured stack (-f compose.yml -f compose.test.yml) keeps its own name.
    expect(check(root, ["--compose-project"]).out).toBe("app-node");
    const wt = worktree(root, "feat-two");
    expect(check(wt).out).toContain("PASS e.project  feat-two (derived: dirname)");
    const r = check(wt, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    // A copied override makes plain docker compose in the worktree hit prod.
    put(wt, "compose.override.yml", "name: app-prod\n");
    expect(check(wt).out).toContain("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name app-prod");
    put(wt, "compose.override.yml", "services: {}\n");
    // An override Compose cannot read fails closed.
    put(root, "compose.override.yml", "name: [x]\n");
    expect(check(wt, [], { COMPOSE_PROJECT_NAME: "feat-two" }).out).toContain("FAIL e.project  the main checkout's compose file compose.override.yml has a name: that is not a string");

    // Compose discovers compose.yaml before the configured compose.yml.
    const yaml = setup(test(), { "compose.yml": "services: {web: {image: x}}\n" });
    commit(yaml);
    put(yaml, "compose.yaml", "name: app-prod\nservices: {web: {image: x}}\n");
    const w2 = worktree(yaml, "feat-yaml");
    expect(check(w2, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);

    // From a non-default file's directory, Compose walks up to the default file above it.
    const up = setup(`${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/stack.yml"]\nderive = "slug-hash"\n`, { "deploy/stack.yml": "services: {web: {image: x}}\n", "compose.yml": "name: app-prod\nservices: {web: {image: x}}\n" });
    commit(up);
    const w3 = worktree(up, "feat-up");
    expect(check(w3, [], { COMPOSE_PROJECT_NAME: "feat-up" }).out).toContain("PASS e.project  feat-up (COMPOSE_PROJECT_NAME)");
    expect(check(w3, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
    // The .env beside the file it walked up to names that run too.
    put(up, ".env", "COMPOSE_PROJECT_NAME=app-live\n");
    expect(check(w3, [], { COMPOSE_PROJECT_NAME: "app-live" }).code).toBe(1);
  });

  it("fails in worktrees that share a committed name: when the main checkout's .env overrides it", () => {
    for (const [doc, env] of [["name: app-x", "COMPOSE_PROJECT_NAME=prod"], ["name: ${STACK:-app-x}", "STACK=prod"]]) {
      const root = setup(test(), { "compose.yml": `${doc}\nservices:\n  web:\n    image: x\n`, ".gitignore": ".env\n" });
      commit(root);
      put(root, ".env", `${env}\n`);
      const a = worktree(root, "feat-a");
      worktree(root, "feat-b");
      expect([doc, check(root).out]).toEqual([doc, expect.stringContaining("PASS e.project  prod")]);
      const r = check(a);
      expect([doc, r.code, r.out]).toEqual([doc, 1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use its compose name: app-x, not feat-a — fix: add COMPOSE_PROJECT_NAME=feat-a to .env")]);
      put(a, ".env", "COMPOSE_PROJECT_NAME=feat-a\n");
      expect([doc, check(a).out]).toEqual([doc, expect.stringContaining("PASS e.project  feat-a (COMPOSE_PROJECT_NAME)")]);
    }
  });

  it("counts a peer worktree's plain docker compose name as taken", () => {
    const root = setup(test(), { "compose.yml": "name: app-x\nservices: {}\n", ".gitignore": ".env\n" });
    commit(root);
    put(root, ".env", "COMPOSE_PROJECT_NAME=prod\n");
    const a = worktree(root, "feat-a");
    worktree(root, "feat-b");
    // feat-b has no .env, so plain docker compose there runs as app-x.
    const r = check(a, [], { COMPOSE_PROJECT_NAME: "app-x" });
    expect([r.code, r.out]).toEqual([1, expect.stringMatching(/FAIL e\.project {2}project name app-x is also used by worktree .*feat-b/)]);
    // Under slug-hash, two worktrees with one directory name both run plain docker compose as that name.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    commit(slug);
    const s1 = worktree(slug, "feat-s");
    expect(check(s1).code).toBe(0);
    worktree(slug, "feat-s");
    const s = check(s1);
    expect([s.code, s.out]).toEqual([1, expect.stringMatching(/FAIL e\.project {2}plain docker compose in this worktree would use project feat-s, which worktree .*feat-s also uses/)]);
  });

  it("an empty shell COMPOSE_PROJECT_NAME hides the .env one, as Compose does", () => {
    const root = setup(test(), { "compose.yml": "name: production\nservices: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-e");
    put(wt, ".env", "COMPOSE_PROJECT_NAME=test-stack\n");
    expect(check(wt).out).toContain("PASS e.project  test-stack (COMPOSE_PROJECT_NAME)");
    // `docker compose config` here names it production: the empty value blocks .env, and name: applies.
    const r = check(wt, [], { COMPOSE_PROJECT_NAME: "" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  plain docker compose in this worktree would use the main checkout's project name production — fix: unset the empty COMPOSE_PROJECT_NAME in the shell")]);
    put(root, ".env", "COMPOSE_PROJECT_NAME=envprod\n");
    expect(check(root, ["--compose-project"]).out).toBe("envprod");
    expect(check(root, ["--compose-project"], { COMPOSE_PROJECT_NAME: "" }).out).toBe("production");
  });

  it("fails on the checkout's own invalid compose file even when COMPOSE_PROJECT_NAME is set", () => {
    const docs: [string, string][] = [
      ["name: app-prod\nservices: [\n", "is not valid YAML"],
      ["- name: app-prod\n", "has no top-level mapping"],
      ["name: 123\nservices: {}\n", "has a name: that is not a string"],
    ];
    for (const [doc, why] of docs) {
      const root = setup(test(), { "compose.yml": doc });
      commit(root);
      const sh = check(root, [], { COMPOSE_PROJECT_NAME: "foo" });
      expect([doc, sh.code, sh.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  compose file compose.yml ${why}`)]);
      expect(sh.out).not.toContain("or set COMPOSE_PROJECT_NAME");
      put(root, ".env", "COMPOSE_PROJECT_NAME=foo\n");
      expect([doc, check(root).code, check(root, ["--compose-project"]).out]).toEqual([doc, 1, ""]);
    }
    // An unresolvable name: stays waived by a COMPOSE_PROJECT_NAME (known note).
    const ok = setup(test(), { "compose.yml": "name: ${UNSET_VAR}\nservices: {}\n" });
    expect(check(ok, [], { COMPOSE_PROJECT_NAME: "foo" }).out).toContain("PASS e.project  foo (COMPOSE_PROJECT_NAME)");
  });

  it("reads YAML-style KEY: value lines in .env, as Compose does", () => {
    const plain = { "compose.yml": "services: {}\n" };
    const root = setup(test(), plain);
    commit(root);
    put(root, ".env", "COMPOSE_PROJECT_NAME: app-prod\n");
    expect(check(root, ["--compose-project"]).out).toBe("app-prod");
    const r = check(worktree(root, "wt"), [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    const named = setup(test(), { "compose.yml": "name: ${STACK}\nservices: {}\n" });
    put(named, ".env", "STACK: app-live\nURL=http://x:1\n");
    expect(check(named, ["--compose-project"]).out).toBe("app-live");
  });

  it("does not count the main checkout's derived name as a clash when it runs under another name", () => {
    const sub = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/compose.yml"]\n`;
    const root = setup(sub, { "deploy/compose.yml": "services: {}\n" });
    commit(root);
    put(root, "deploy/.env", "COMPOSE_PROJECT_NAME=foo\n");
    expect(check(root, ["--compose-project"]).out).toBe("foo");
    const r = check(worktree(root, "feat-d"));
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.project  deploy (derived: dirname)")]);
    // A second worktree really does collide on deploy.
    expect(check(worktree(root, "feat-e")).out).toMatch(/FAIL e\.project {2}project name deploy is also used by worktree .*feat-d/);
    // A COMPOSE_PROJECT_NAME equal to the main checkout's directory name, while it runs under its name:, is no clash.
    const app = setup(test(), { "compose.yml": COMPOSE });
    commit(app);
    const a = check(worktree(app, "app-wt"), [], { COMPOSE_PROJECT_NAME: "app-node" });
    expect([a.code, a.out]).toEqual([0, expect.stringContaining("PASS e.project  app-node (COMPOSE_PROJECT_NAME)")]);
  });

  it("compares with each peer worktree's own COMPOSE_PROJECT_NAME before its derived name", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    put(a, ".env", "COMPOSE_PROJECT_NAME=shared-test\n");
    put(b, ".env", "COMPOSE_PROJECT_NAME=shared-test\n");
    for (const [wt, peer] of [[a, "feat-b"], [b, "feat-a"]] as const) {
      const r = check(wt);
      expect([r.code, r.out]).toEqual([1, expect.stringMatching(new RegExp(`FAIL e\\.project {2}project name shared-test is also used by worktree .*${peer}`))]);
    }
    // feat-b runs as shared-test, so its derived name is free.
    const c = check(worktree(root, "feat-c"), [], { COMPOSE_PROJECT_NAME: "feat-b" });
    expect([c.code, c.out]).toEqual([0, expect.stringContaining("PASS e.project  feat-b (COMPOSE_PROJECT_NAME)")]);
  });

  it("slug-hash never derives a name Compose rejects when the main checkout's directory normalizes to empty", () => {
    const root = repo({ "compose.yml": "services: {}\n" }, "プロ");
    put(root, CFG, test('derive = "slug-hash"\n'));
    commit(root);
    const r = check(worktree(root, "feat.x"), ["--compose-project"]);
    expect([r.code, r.out]).toEqual([0, expect.stringMatching(/^wt-feat-x-[0-9a-f]{6}$/)]);
  });

  it("fails when the directory leaves no project name after Compose normalizes it", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    for (const dir of ["___", "项目"]) {
      const r = check(worktree(root, dir));
      expect([dir, r.code, r.out]).toEqual([dir, 1, expect.stringContaining(`FAIL e.project  no project name derives from directory ${dir}`)]);
    }
  });

  it("warns on a fixed container_name unless allowlisted, and reads files only under --static", () => {
    const files = { "compose.yml": `${COMPOSE}    container_name: web-1\n` };
    const warn = check(setup(test(), files));
    expect([warn.code, warn.out]).toEqual([0, expect.stringContaining("WARN e.container_name  fixed container_name web-1 collides across worktrees")]);
    expect(check(setup(test('allow_container_name = ["web-1"]\n'), files)).out).toContain("PASS e.container_name");
    expect(check(setup(test(), files), ["--static"]).out).toContain("PASS e.project  compose files present, name: app-prod (project name not resolved in --static)");
    expect(check(setup(test(), {})).out).toContain("FAIL e.project  no compose file found (compose.yml)");
  });

  it.each([
    ["flow mapping", "name: app\nservices: {db: {image: postgres, container_name: prod-db}}\n"],
    ["flow service", "name: app\nservices:\n  db: {image: postgres, container_name: prod-db}\n"],
    ["double-quoted key", 'name: app\nservices:\n  db:\n    image: postgres\n    "container_name": prod-db\n'],
    ["single-quoted key", "name: app\nservices:\n  db:\n    image: postgres\n    'container_name': prod-db\n"],
    ["merge key", "name: app\nx-b: &b\n  container_name: prod-db\nservices:\n  db:\n    <<: *b\n    image: postgres\n"],
    ["later document", "name: app\nservices: {db: {image: postgres}}\n---\nservices: {db: {container_name: prod-db}}\n"],
  ])("warns on a fixed container_name written as a %s, as Compose reads it", (_n, body) => {
    const r = check(setup(test(), { "compose.yml": body }), ["--static"]);
    expect(r.out).toContain("WARN e.container_name  fixed container_name prod-db collides across worktrees");
  });

  it("reads container_name only as a service key, and warns when a compose file cannot be parsed", () => {
    const scalar = "name: app\nservices:\n  db:\n    image: x\n    command: |\n      container_name: notreal\nx-note: {container_name: notreal}\n";
    expect(check(setup(test(), { "compose.yml": scalar }), ["--static"]).out).toContain("PASS e.container_name  no fixed container_name");
    const bad = check(setup(test(), { "compose.yml": "name: app\nservices: {db: {container_name: x}\n" }), ["--static"]);
    expect(bad.out).toContain("WARN e.container_name  cannot read container_name: compose.yml does not parse as a compose file — fix: fix the file until docker compose config accepts it");
  });
});

describe("b.containers", () => {
  const COMPOSE = "name: app-prod\nservices:\n  web:\n    image: x\n";
  const cfg = (extra = "") => `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml"]\ninputs = ["compose.yml", "docker/**"]\n${extra}`;
  const files = { "compose.yml": COMPOSE, "docker/Dockerfile": "FROM x\n" };
  const res = (code: number | null, stdout = ""): RunResult => ({ code, stdout, stderr: "", timedOut: false });
  /** A fake docker: `ps` lists `ids`, `inspect` prints `created` for each; every other command runs for real. */
  const fake = (ps: RunResult, created: string[] = [], calls: string[][] = []): Runner => (cmd, args, opts) => {
    if (cmd !== "docker") return run(cmd, args, opts);
    calls.push(args);
    return args[0] === "ps" ? ps : res(0, created.join("\n"));
  };
  const b = (root: string, args: string[], runner: Runner) => check(root, args, {}, runner).lines.filter((l) => l.includes("b.containers")).join("\n");

  it("fails (default) or warns on containers created before the newest input commit", () => {
    const root = setup(cfg(), files);
    commit(root);
    const old = ["/web-1 2000-01-01T00:00:00Z", "/db-1 2000-01-02T00:00:00Z"];
    const calls: string[][] = [];
    const r = check(root, [], {}, fake(res(0, "a1\nb2\n"), old, calls));
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL b.containers  web-1, db-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate");
    expect(calls[0]).toEqual(["ps", "-q", "--filter", "label=com.docker.compose.project=app-prod"]);
    const w = check(setup(cfg('containers = "warn"\n'), files), [], {}, fake(res(0, "a1\n"), old));
    expect([w.code, w.out]).toEqual([0, expect.stringContaining("WARN b.containers  web-1, db-1 created")]);
  });

  it("names every configured compose file in the fix, quoting odd paths", () => {
    const two = cfg().replace('files = ["compose.yml"]', 'files = ["compose.yml", "ops/compose test.yml"]');
    const root = setup(two, { ...files, "ops/compose test.yml": "services: {}\n" });
    commit(root);
    expect(b(root, [], fake(res(0, "a1\n"), ["/web-1 2000-01-01T00:00:00Z"]))).toContain("— fix: docker compose -p app-prod -f compose.yml -f 'ops/compose test.yml' up -d --build --force-recreate");
  });

  it("passes when every container is newer than the inputs", () => {
    const root = setup(cfg(), files);
    commit(root);
    expect(b(root, [], fake(res(0, "a1\n"), ["/web-1 2999-01-01T00:00:00Z"]))).toBe("PASS b.containers  1 running container(s) are newer than the compose inputs");
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
    expect(b(root, [], fake(res(0, "a1\n"), ["/web-1 2010-01-01T00:00:00Z"]))).toBe(
      "FAIL b.containers  web-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate",
    );
  });

  it("compares with the inputs' modification times too, so an edit on disk after the build fails", () => {
    const root = repo({ ...files, [CFG]: cfg() });
    at(root, "2001-01-01T00:00:00Z", "commit", "-q", "--amend", "--no-edit", "--reset-author");
    const old = new Date("2005-01-01T00:00:00Z");
    for (const f of Object.keys(files)) utimesSync(join(root, f), old, old);
    const built = fake(res(0, "a1\n"), ["/web-1 2010-01-01T00:00:00Z"]);
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
    expect(b(root, [], fake(res(0, "a1\n"), ["/web-1 2010-01-01T00:00:00Z"]))).toBe(
      "FAIL b.containers  web-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate",
    );
  });

  it("keeps the compose.override file Compose loads beside a lone default-named file", () => {
    const stale = () => fake(res(0, "a1\n"), ["/web-1 2000-01-01T00:00:00Z"]);
    const root = setup(cfg(), { ...files, ".gitignore": "compose.override.yml\ndocker-compose.override.yaml\n" });
    commit(root);
    put(root, "compose.override.yml", "services:\n  web:\n    ports: [\"8080:80\"]\n");
    put(root, "docker-compose.override.yaml", "services: {}\n");
    expect(b(root, [], stale())).toContain("— fix: docker compose -p app-prod -f compose.yml -f compose.override.yml up -d --build --force-recreate");
    rmSync(join(root, "compose.override.yml"));
    expect(b(root, [], stale())).toContain("— fix: docker compose -p app-prod -f compose.yml -f docker-compose.override.yaml up -d --build --force-recreate");
    // COMPOSE_FILE turns off Compose's discovery, so no override is loaded.
    expect(check(root, [], { COMPOSE_FILE: "compose.yml" }, stale()).out).toContain("— fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate");
    put(root, ".env", "COMPOSE_FILE=compose.yml\n");
    expect(b(root, [], stale())).toContain("— fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate");
    rmSync(join(root, ".env"));
    rmSync(join(root, "docker-compose.override.yaml"));
    expect(b(root, [], stale())).toContain("— fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate");
  });

  it("finds the override beside a default-named file in a subdirectory, and adds none to a non-default or multi-file set", () => {
    const stale = () => fake(res(0, "a1\n"), ["/web-1 2000-01-01T00:00:00Z"]);
    const sub = setup(cfg().replace(/"compose\.yml"/g, '"deploy/docker-compose.yml"'), { "deploy/docker-compose.yml": COMPOSE });
    commit(sub);
    put(sub, "deploy/compose.override.yaml", "services: {}\n");
    put(sub, "compose.override.yml", "services: {}\n");
    expect(b(sub, [], stale())).toContain("— fix: docker compose -p app-prod -f deploy/docker-compose.yml -f deploy/compose.override.yaml up -d --build --force-recreate");
    const named = setup(cfg().replace(/"compose\.yml"/g, '"stack.yml"'), { "stack.yml": COMPOSE });
    commit(named);
    put(named, "compose.override.yml", "services: {}\n");
    expect(b(named, [], stale())).toContain("— fix: docker compose -p app-prod -f stack.yml up -d --build --force-recreate");
    const two = setup(cfg().replace('files = ["compose.yml"]', 'files = ["compose.yml", "ops/extra.yml"]'), { ...files, "ops/extra.yml": "services: {}\n" });
    commit(two);
    put(two, "compose.override.yml", "services: {}\n");
    expect(b(two, [], stale())).toContain("— fix: docker compose -p app-prod -f compose.yml -f ops/extra.yml up -d --build --force-recreate");
  });

  it("skips (never warns) when docker is absent, the daemon is down, or the stack is not running", () => {
    const root = setup(cfg(), files);
    commit(root);
    expect(b(root, [], fake(res(null)))).toContain("SKIP b.containers  docker is not available");
    expect(b(root, [], fake(res(1)))).toContain("SKIP b.containers  docker is not available");
    expect(b(root, [], fake(res(0, "\n")))).toBe("SKIP b.containers  stack down (no running container for project app-prod)");
    expect(check(root, [], {}, fake(res(0, ""))).code).toBe(0);
  });

  it("skips when no commit touches the inputs or docker inspect fails", () => {
    const none = setup(cfg().replace('inputs = ["compose.yml", "docker/**"]', 'inputs = ["nothing/**"]'), files);
    commit(none);
    expect(b(none, [], fake(res(0, "a1\n"), ["/web-1 2000-01-01T00:00:00Z"]))).toBe("SKIP b.containers  no commit touches the [compose] inputs");
    const root = setup(cfg(), files);
    commit(root);
    const failInspect: Runner = (cmd, args, opts) => (cmd !== "docker" ? run(cmd, args, opts) : args[0] === "ps" ? res(0, "a1\n") : res(1));
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
    const r = check(wt, [], {}, fake(res(0, "a1\n"), ["/web-1 2000-01-01T00:00:00Z"], calls));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  worktree would use the main checkout's project name app-prod")]);
    expect(calls).toEqual([]);
    expect(r.out).not.toContain("b.containers");
    expect(r.out).toContain("PASS d.p  project=\n");
  });

  it("is not run under --static, without inputs, or in compose mode none", () => {
    const calls: string[][] = [];
    const root = setup(cfg(), files);
    commit(root);
    expect(b(root, ["--static"], fake(res(0, "a1"), [], calls))).toBe("");
    expect(b(setup(`${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml"]\n`, files), [], fake(res(0, "a1"), [], calls))).toBe("");
    expect(b(setup(`${HEAD}[compose]\nmode = "none"\n`), [], fake(res(0, "a1"), [], calls))).toBe("");
    expect(calls).toEqual([]);
  });

  it("uses the worktree's derived project name", () => {
    const root = setup(cfg(), { ...files, "compose.yml": "services:\n  web:\n    image: x\n" });
    commit(root);
    const calls: string[][] = [];
    b(worktree(root, "feat-z"), [], fake(res(0, ""), [], calls));
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
      return check(root, args).out;
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
