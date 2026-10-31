import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { run, type Runner, type RunResult } from "./proc.js";
import { deps, put, repo, sh, shim, tmp } from "./testkit.js";
import { VERSION } from "./version.js";

const HERE = dirname(fileURLToPath(import.meta.url));
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
      "PASS a.pins.go  go 1.26 (go-mod:go.mod, tool-versions:.tool-versions)",
      "PASS a.local.go  local go 1.26.1 matches pin 1.26",
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
    ["warn", "1.25.0", 0, "WARN a.local.go  local go 1.25.0 does not match pin 1.26"],
    ["fail", "1.25.0", 1, "FAIL a.local.go  local go 1.25.0 does not match pin 1.26"],
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
  });

  it("d.tracked catches a deleted tracked file and a lost exec bit", () => {
    const files = { "a.txt": "a\n", "run.sh*": "#!/bin/sh\n" };
    expect(run("tracked = true", files).out).toContain("PASS d.tracked  no tracked file deleted, exec bits intact");
    const r = run("tracked = true", files, (root) => {
      rmSync(join(root, "a.txt"));
      chmodSync(join(root, "run.sh"), 0o644);
    });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL d.tracked  deleted: a.txt; exec bit lost: run.sh")]);
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

  it("uses the file's name in the main checkout and a derived name in a worktree", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    expect(check(root, ["--compose-project"]).out).toBe("app-prod");
    expect(check(root).out).toContain("PASS e.project  app-prod (name: in compose file)");
    const wt = worktree(root, "Feat_X.1");
    expect(check(wt, ["--compose-project"]).out).toBe("feat_x-1");
    expect(check(wt).out).toContain("PASS e.project  feat_x-1 (derived: dirname)");
  });

  it("slug-hash appends a path hash, so equal basenames never collide", () => {
    const root = setup(test('derive = "slug-hash"\n'), { "compose.yml": COMPOSE });
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
    worktree(root, "dup");
    const dup = check(worktree(root, "dup"));
    expect(dup.out).toMatch(/FAIL e\.project {2}project name dup also derives for worktree .*dup/);
  });

  it("COMPOSE_PROJECT_NAME wins, unless it is the prod name", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-y");
    expect(check(wt, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" }).out).toBe("mine");
    expect(check(wt, ["--compose-project"], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
  });

  it("warns on a fixed container_name unless allowlisted, and reads files only under --static", () => {
    const files = { "compose.yml": `${COMPOSE}    container_name: web-1\n` };
    const warn = check(setup(test(), files));
    expect([warn.code, warn.out]).toEqual([0, expect.stringContaining("WARN e.container_name  fixed container_name web-1 collides across worktrees")]);
    expect(check(setup(test('allow_container_name = ["web-1"]\n'), files)).out).toContain("PASS e.container_name");
    expect(check(setup(test(), files), ["--static"]).out).toContain("PASS e.project  compose files present, name: app-prod (project name not resolved in --static)");
    expect(check(setup(test(), {})).out).toContain("FAIL e.project  no compose file found (compose.yml)");
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
    expect(r.out).toContain("FAIL b.containers  web-1, db-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod up -d --build");
    expect(calls[0]).toEqual(["ps", "-q", "--filter", "label=com.docker.compose.project=app-prod"]);
    const w = check(setup(cfg('containers = "warn"\n'), files), [], {}, fake(res(0, "a1\n"), old));
    expect([w.code, w.out]).toEqual([0, expect.stringContaining("WARN b.containers  web-1, db-1 created")]);
  });

  it("passes when every container is newer than the inputs", () => {
    const root = setup(cfg(), files);
    commit(root);
    expect(b(root, [], fake(res(0, "a1\n"), ["/web-1 2999-01-01T00:00:00Z"]))).toBe("PASS b.containers  1 running container(s) are newer than the compose inputs");
  });

  it("skips (never warns) when docker is absent, the daemon is down, or the stack is not running", () => {
    const root = setup(cfg(), files);
    commit(root);
    expect(b(root, [], fake(res(null)))).toContain("SKIP b.containers  docker is not available");
    expect(b(root, [], fake(res(1)))).toContain("SKIP b.containers  docker is not available");
    expect(b(root, [], fake(res(0, "\n")))).toBe("SKIP b.containers  stack down (no running container for project app-prod)");
    expect(check(root, [], {}, fake(res(0, ""))).code).toBe(0);
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
    const root = setup(cfg(), files);
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
    ["schema_version 2", "schema_version = 2\n", /schema_version 2 is unsupported by loops 0\.4\.0/],
    ["unknown top-level key", `${HEAD}colour = 1\n`, /unknown key "colour"/],
    ["unknown pins key", `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\nfoo = 1\n`, /\[\[pins\]\] #1: unknown key "foo"/],
    ["unknown source kind", `${HEAD}[[pins]]\ntool = "go"\nsources = ["gomod"]\n`, /unknown source kind in "gomod"/],
    ["bad compare", `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\ncompare = "close"\n`, /compare must be exact\|minor\|major\|floor/],
    ["engine too new", `engine = ">=9.0.0"\n${HEAD}`, /needs loops >=9\.0\.0, this is 0\.4\.0; update agentic-tools/],
    ["engine odd form", `engine = "^0.4"\n${HEAD}`, /engine must look like ">=0\.4\.0"/],
    ["compose test without files", `${HEAD}[compose]\nmode = "test"\n`, /mode test needs files/],
    ["compose dev", `${HEAD}[compose]\nmode = "dev"\n`, /mode must be none\|test/],
    ["bad local id", `${HEAD}[[local]]\nid = "zz"\nrun = "a"\n`, /id "zz" must look like/],
    // Value: protects=parseConfig rejects empty sources, duplicate local ids and a non-positive timeout_s; fails_when=one of those guards is removed; why_new=the bad-config table had no rows for them; seam=none; no_claim=none beyond protects
    ["empty sources", `${HEAD}[[pins]]\ntool = "go"\nsources = []\n`, /\[\[pins\]\] #1: sources is empty/],
    ["duplicate local id", `${HEAD}[[local]]\nid = "d.a"\nrun = "a"\n[[local]]\nid = "d.a"\nrun = "b"\n`, /\[\[local\]\] #2: duplicate id d\.a/],
    ["zero timeout", `${HEAD}[[local]]\nid = "d.a"\nrun = "a"\ntimeout_s = 0\n`, /timeout_s must be a positive number/],
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
