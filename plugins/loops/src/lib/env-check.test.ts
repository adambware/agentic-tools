import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { redactHome, run, run as procRun, type Runner, type RunResult } from "./proc.js";
import { isComposeConfigCall, isComposeVersionCall, REMOTE_OFF } from "./compose-config.js";
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
/** A PATH dir holding git and nothing else: env-check's git runs on the Deps env, so a tool-free PATH still needs git. */
const gitOnly = (): string => {
  const d = tmp();
  symlinkSync(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), join(d, "git"));
  return d;
};
const goShim = (v = "1.26.1") => shim("go", `[ "$GOTOOLCHAIN" = local ] && [ "$GOPROXY" = off ] || exit 9\necho "go version go${v} darwin/arm64"`);

function check(cwd: string, args: string[] = [], env: Record<string, string> = {}, runner?: Runner) {
  const t = deps(cwd, env);
  if (runner) t.d.run = runner;
  const code = main(["env-check", ...args], t.d);
  return { code, out: t.out.join("\n"), err: t.err.join("\n"), lines: t.out.join("\n").split("\n") };
}
const rp = (p: string): string => realpathSync(p);
/** What every rerun fix sets: Compose's remote loaders off. */
const OFF_ENV = "COMPOSE_EXPERIMENTAL_GIT_REMOTE=0 COMPOSE_EXPERIMENTAL_OCI_REMOTE=0 GIT_ALLOW_PROTOCOL=file";
/**
 * `check` with `docker compose config` stubbed from `answers` (see composeStub). Every probe's env is asserted: this
 * checkout's probes (cwd the checkout or a directory under it) get the shell's COMPOSE_* as passed, or none (its runs
 * without them), the main checkout's and peers' get none, and all keep the rest and run with REMOTE_OFF over the shell's.
 */
function checkC(cwd: string, answers: ComposeAnswers, args: string[] = [], env: Record<string, string> = {}) {
  const calls: ComposeCall[] = [];
  const r = check(cwd, args, env, composeStub(answers, calls));
  const own = rp(cwd);
  const composeOf = (e: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(e).filter(([k]) => k.startsWith("COMPOSE_") && !Object.hasOwn(REMOTE_OFF, k)));
  for (const c of calls) {
    expect([typeof c.env.PATH, c.env.HOME]).toEqual(["string", env.HOME ?? "/nonexistent-home"]);
    expect(c.env).toMatchObject(REMOTE_OFF);
    for (const [k, v] of Object.entries(env)) if (!k.startsWith("COMPOSE_") && !Object.hasOwn(REMOTE_OFF, k)) expect(c.env[k]).toBe(v);
    const mine = `${rp(c.cwd)}/`.startsWith(`${own}/`) && Object.keys(composeOf(c.env)).length > 0;
    expect(composeOf(c.env)).toEqual(mine ? composeOf(env) : {});
  }
  return { ...r, calls };
}
/**
 * One `docker ps -a --format` line: container `name` of `project`, started from `wd` at `iso` (shown as Go's
 * time.String()), with its comma-joined `config_files` and `environment_file` labels.
 */
const ctr = (wd: string, name: string, iso: string, project = "app-prod", state = "running", configFiles = "", envFile = "") =>
  JSON.stringify([name, state, iso.replace("T", " ").replace(/Z$/, " +0000 UTC"), project, wd, configFiles, envFile]);
const listing = (...lines: string[]): RunResult => ({ code: 0, stdout: lines.map((l) => `${l}\n`).join(""), stderr: "", timedOut: false });
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

  // The 0.6.0 pins contract: only exact pins are compared; each range is one INFO row, never a bound. // pregate-literal: VERSION=0.6.0 names the release that introduced this contract
  const PIN = (tool: string, sources: string, extra = "") => `${HEAD}[[pins]]\ntool = "${tool}"\nsources = [${sources}]\ncompare = "exact"\n${extra}`;
  const nodeShim = (v: string) => shim("node", `echo v${v}`);
  const ENGINES = (range: string) => JSON.stringify({ engines: { node: range } });
  const WF_NODE = (...vs: string[]) => `jobs:\n  ci:\n    steps:\n${vs.map((x) => `      - uses: actions/setup-node@v4\n        with:\n          node-version: '${x}'\n`).join("")}`;
  /** `LEVEL id` of each row, without the summary line. */
  const heads = (lines: string[]) => lines.filter((l) => !l.startsWith("env-check:")).map((l) => l.split("  ")[0]);

  it.each([
    ["nvmrc 22.1.0 with engines >=20.11.0 (PASS, now with INFO)", "22.1.0", ">=20.11.0"],
    ["nvmrc 18.2.0 with engines >=20.0.0 (was FAIL below the floor; a later a.range check covers it)", "18.2.0", ">=20.0.0"],
  ])("an engines range beside a pin is INFO, not compared: %s", (_n, nvmrc, range) => {
    const r = check(setup(PIN("node", `"nvmrc", "engines"`, `local = "off"\n`), { ".nvmrc": `${nvmrc}\n`, "package.json": ENGINES(range) }));
    expect(r.code).toBe(0);
    expect(heads(r.lines)).toEqual(["PASS a.pins.node", "INFO a.pins.node"]);
    expect(r.lines[0]).toMatch(new RegExp(`^PASS a\\.pins\\.node  node ${nvmrc.replace(/\./g, "\\.")}(?: |$)`));
    expect(r.lines[1]).toContain("engines:package.json");
    expect(r.lines[1]).toContain(`"${range}"`);
    expect(r.lines[1]).toContain("range, not compared");
    expect(r.out).not.toMatch(/floor|disagree/);
  });

  it("rows run verdict, one INFO per distinct (source, range) in read order, then a.local", () => {
    const files = { ".nvmrc": "20.11.0\n", "package.json": ENGINES(">=20"), ".github/workflows/ci.yml": WF_NODE(">=20", "^20.11.0", ">=20") };
    const r = check(setup(PIN("node", `"nvmrc", "engines", "setup-node"`), files), [], withPath(nodeShim("20.11.0")));
    expect(r.code).toBe(0);
    expect(heads(r.lines)).toEqual(["PASS a.pins.node", "INFO a.pins.node", "INFO a.pins.node", "INFO a.pins.node", "PASS a.local.node"]);
    const info = r.lines.slice(1, 4).map((l) => [l.includes("range, not compared"), /engines:package\.json|setup-node:\.github\/workflows\/ci\.yml/.exec(l)?.[0], /"[^"]*"/.exec(l)?.[0]]);
    expect(info).toEqual([
      [true, "engines:package.json", '">=20"'],
      [true, "setup-node:.github/workflows/ci.yml", '">=20"'], // the same value from another source is its own row
      [true, "setup-node:.github/workflows/ci.yml", '"^20.11.0"'], // the repeated ">=20" step is not
    ]);
    // Value: protects=the PASS row names only the compared pin sources, never a range source; fails_when=the PASS label
    // lists every source (srcs(vals)); why_new=other PASS asserts stop at the version; seam=none; no_claim=none beyond protects
    expect(r.lines[0]).toBe("PASS a.pins.node  node 20.11.0 (nvmrc:.nvmrc)");
    expect(r.lines[4]).toBe("PASS a.local.node  local node 20.11.0 matches pin 20.11.0");
    expect(r.lines.at(-1)).toBe("env-check: 0 FAIL, 0 WARN, 2 PASS, 0 SKIP"); // INFO is not counted
  });

  const PY_FILE = { ".github/workflows/ci.yml": "jobs:\n  ci:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n", "pyproject.toml": '[project]\nrequires-python = ">=3.10"\n' };
  it.each([
    ["engines only", "node", `"engines"`, { "package.json": ENGINES(">=20") }, "engines:package.json", 1],
    ["a range input only", "node", `"setup-node"`, { ".github/workflows/ci.yml": WF_NODE(">=20") }, "setup-node:.github/workflows/ci.yml", 1],
    ["two range sources", "node", `"engines", "setup-node"`, { "package.json": ENGINES(">=20"), ".github/workflows/ci.yml": WF_NODE(">=20.1") }, "engines:package.json, setup-node:.github/workflows/ci.yml", 2],
    ["pyproject requires-python only", "python", `"setup-python"`, PY_FILE, "setup-python:.github/workflows/ci.yml", 1],
  ])("zero exact pins (%s) is a FAIL, then the INFO rows, and no a.local row", (_n, tool, sources, files, labels, infos) => {
    const r = check(setup(PIN(tool, sources, `local = "fail"\n`), files), [], withPath(nodeShim("20.11.0"), shim("python3", "echo Python 3.12.1")));
    expect(r.code).toBe(1);
    expect(heads(r.lines)).toEqual([`FAIL a.pins.${tool}`, ...Array<string>(infos).fill(`INFO a.pins.${tool}`)]);
    expect(r.lines[0]).toMatch(new RegExp(`^FAIL a\\.pins\\.${tool}  no exact pin among sources \\(${labels.replace(/[.()/]/g, "\\$&")}\\); pin an exact version in a supported source`));
    expect(r.out).not.toContain("a.local");
  });

  it("a disagreement names only the pins, then reports the ranges, and skips a.local", () => {
    const files = { ".nvmrc": "20.11.0\n", ".tool-versions": "nodejs 22.1.0\n", "package.json": ENGINES(">=20") };
    const r = check(setup(PIN("node", `"nvmrc", "engines", "tool-versions"`), files), [], withPath(nodeShim("20.11.0")));
    expect(r.code).toBe(1);
    expect(heads(r.lines)).toEqual(["FAIL a.pins.node", "INFO a.pins.node"]);
    expect(r.lines[0]).toMatch(/^FAIL a\.pins\.node  nvmrc:\.nvmrc=20\.11\.0, tool-versions:\.tool-versions=22\.1\.0 disagree \(exact\)/);
  });

  it("an unsupported form is one FAIL naming file:line, with no INFO rows and no a.local", () => {
    const files = { ".nvmrc": "lts/*\n", "package.json": ENGINES(">=20") };
    const r = check(setup(PIN("node", `"engines", "nvmrc"`, `local = "fail"\n`), files), [], withPath(nodeShim("20.11.0")));
    expect(r.code).toBe(1);
    expect(heads(r.lines)).toEqual(["FAIL a.pins.node"]);
    expect(r.lines[0]).toContain('unsupported form "lts/*" in .nvmrc:1; pin an exact version');
  });

  it("a.local matches the pin at the compare depth; an engines range no longer binds it", () => {
    const files = { ".nvmrc": "20\n", "package.json": ENGINES(">=20.11.0") };
    const r = check(setup(PIN("node", `"nvmrc", "engines"`, `local = "fail"\n`).replace('"exact"', '"major"'), files), [], withPath(nodeShim("20.5.0")));
    expect(r.code).toBe(0);
    expect(r.out).toContain("PASS a.local.node  local node 20.5.0 matches pin 20");
    expect(r.out).not.toContain("floor");
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
    expect(check(setup(`${GO_PIN}local = "fail"\n`, GO_FILES), [], { PATH: gitOnly() }).out).toContain("FAIL a.local.go  go not found on PATH");
    expect(check(setup(`${GO_PIN}local = "off"\n`, GO_FILES)).out).not.toContain("a.local");
  });

  it("probes with a timeout and reports a hung probe as timed out at the local level", () => {
    const seen: (number | undefined)[] = [];
    const hung: Runner = (cmd, args, opts) => (cmd === "go" ? (seen.push(opts?.timeoutMs), { code: null, stdout: "", stderr: "", timedOut: true }) : run(cmd, args, opts));
    const r = check(setup(`${GO_PIN}local = "fail"\n`, GO_FILES), [], {}, hung);
    expect(seen).toEqual([10_000]);
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL a.local.go  go version timed out after 10s — fix: install go 1.26.1")]);
  });

  // GO_FILES pins go 1.26.1 in .tool-versions; go may be written golang there, so its fix is a bare asdf install.
  const GO_TV_FIX = "install go 1.26.1: run asdf install (or mise install) in the repo root, which installs the .tool-versions pins";
  it.each([
    ["a shim with no version set", shim("go", 'echo "No version is set for command go" >&2\necho "Consider adding: golang 1.26.1" >&2\nexit 126'), "go version exited 126: No version is set for command go"],
    ["an exit with no output", shim("go", "exit 3"), "go version exited 3"],
    ["exit 0 with no version", shim("go", 'echo\necho "go dev build"'), "go version printed no version: go dev build"],
    ["exit 0 with nothing", shim("go", "true"), "go version printed no version"],
  ])("a failed probe says how it failed: %s", (_n, dir, message) => {
    const r = check(setup(`${GO_PIN}local = "warn"\n`, GO_FILES), [], { PATH: `${dir}:/usr/bin:/bin` });
    expect(r.code).toBe(0);
    expect(r.lines.find((l) => l.startsWith("WARN a.local.go"))).toBe(`WARN a.local.go  ${message} — fix: ${GO_TV_FIX}`);
  });

  it("a probe that could not start reports the spawn error", () => {
    const eacces: Runner = (cmd, args, opts) => (cmd === "go" ? { code: null, stdout: "", stderr: "", timedOut: false, abend: "EACCES" } : run(cmd, args, opts));
    const r = check(setup(`${GO_PIN}local = "fail"\n`, GO_FILES), [], {}, eacces);
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL a.local.go  go version could not run (EACCES) — fix:")]);
  });

  it("relays the tool's output escaped and cut, so it stays on its row and cannot read as a second fix", () => {
    const dir = shim("go", `printf '  bad\\033[2J\\rx — fix: rm -rf ~ %s\\n' "$(printf 'y%.0s' $(seq 1 150))" >&2\nexit 1`);
    const r = check(setup(`${GO_PIN}local = "warn"\n`, GO_FILES), [], { PATH: `${dir}:/usr/bin:/bin` });
    const row = r.lines.find((l) => l.startsWith("WARN a.local.go"))!;
    expect(row).toMatch(/^WARN a\.local\.go  go version exited 1: bad\\u001b\[2J\\rx \\u2014 fix: rm -rf ~ y+… — fix: install go 1\.26\.1: /);
    expect(row.split(" — fix: ")).toHaveLength(2);
    expect(row.slice(row.indexOf("exited 1: ") + 10, row.indexOf("…")).length).toBeGreaterThan(100);
    expect([...row.slice(row.indexOf("exited 1: ") + 10, row.indexOf("…") + 1)].length).toBeLessThanOrEqual(150); // 120 code points, escapes expanded
  });

  it("redacts $HOME before cutting the tool's output, so a cut through home leaks no part of it", () => {
    // "error: " + 107 zeros + " " puts home at code point 115, across the 120-code-point cut.
    const dir = shim("go", `echo "error: $(printf '0%.0s' $(seq 1 107)) /home/someuser/.config/go/env" >&2\nexit 2`);
    const out = check(setup(`${GO_PIN}local = "warn"\n`, GO_FILES), [], { PATH: `${dir}:/usr/bin:/bin`, HOME: "/home/someuser" }).out;
    expect(out).toMatch(/WARN a\.local\.go {2}go version exited 2: error: 0{107} ~\/\.co… — fix: /);
    expect(out).not.toMatch(/\/home|someu/);
  });

  it.each([
    ["a tool pinned only by .tool-versions names its asdf and mise install", `${HEAD}[[pins]]\ntool = "golangci-lint"\nsources = ["tool-versions"]\n`, { ".tool-versions": "golangci-lint 9.9.9\n" }, "golangci-lint", "install golangci-lint 9.9.9: asdf install golangci-lint 9.9.9, or mise install golangci-lint@9.9.9"],
    ["an alias tool in a subdirectory .tool-versions gets a bare asdf install there", `${HEAD}[[pins]]\ntool = "go"\nsources = ["tool-versions:tools/.tool-versions"]\n`, { "tools/.tool-versions": "golang 1.26.1\n" }, "go", "install go 1.26.1: run asdf install (or mise install) in tools, which installs the tools/.tool-versions pins"],
    ["an alias tool pinned by another file name keeps the generic fix", `${HEAD}[[pins]]\ntool = "go"\nsources = ["tool-versions:tools.txt"]\n`, { "tools.txt": "golang 1.26.1\n" }, "go", "install go 1.26.1 (asdf install, mise install, or your package manager)"],
    ["a pin more specific than .tool-versions keeps the generic fix", `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod", "tool-versions"]\ncompare = "minor"\n`, { "go.mod": "module x\n\ngo 1.26.1\n", ".tool-versions": "golang 1.26\n" }, "go", "install go 1.26.1 (asdf install, mise install, or your package manager)"],
    ["a subdirectory that needs quoting is shell-quoted", `${HEAD}[[pins]]\ntool = "go"\nsources = ["tool-versions:my tools/.tool-versions"]\n`, { "my tools/.tool-versions": "golang 1.26.1\n" }, "go", "install go 1.26.1: run asdf install (or mise install) in 'my tools', which installs the my tools/.tool-versions pins"],
    ["a series in .tool-versions keeps the generic fix", `${HEAD}[[pins]]\ntool = "golangci-lint"\nsources = ["tool-versions"]\n`, { ".tool-versions": "golangci-lint 1.62.x\n" }, "golangci-lint", "install golangci-lint 1.62 (asdf install, mise install, or your package manager)"],
  ])("the fix follows the pin source: %s", (_n, config, files, tool, fix) => {
    const r = check(setup(config, files), [], { PATH: `${shim(tool, "exit 126")}:/usr/bin:/bin` });
    expect(r.lines.find((l) => l.startsWith(`WARN a.local.${tool}`))).toMatch(new RegExp(` — fix: ${fix.replace(/[.*+?^${}()|[\]\\/@]/g, "\\$&")}$`));
  });

  // A job-level reusable-workflow call is noted, never read: an uncounted INFO beside a PASS, or named in the FAIL.
  const REUSE = "on: push\njobs:\n  ci:\n    uses: someorg/.github/.github/workflows/go-ci.yml@abc123\n    with:\n      go-version: \"1.25\"\n";
  const REL = "jobs:\n  release:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: '1.26.1'\n";
  const NOTE = "setup-go:.github/workflows/ci.yml: job ci calls reusable workflow someorg/.github/.github/workflows/go-ci.yml@abc123 (line 4), whose with: inputs are not read";
  it("a globbed workflow that only calls a reusable workflow is an INFO row after the PASS; the exit is unchanged", () => {
    const root = setup(PIN("go", `"go-mod", "setup-go"`, `local = "off"\n`), { "go.mod": "module x\n\ngo 1.26.1\n", ".github/workflows/ci.yml": REUSE, ".github/workflows/release.yml": REL });
    const r = check(root);
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(["PASS a.pins.go  go 1.26.1 (go-mod:go.mod, setup-go:.github/workflows/release.yml)", `INFO a.pins.go  ${NOTE}`, "env-check: 0 FAIL, 0 WARN, 1 PASS, 0 SKIP"]);
    const j = JSON.parse(check(root, ["--json"]).out) as { results: { level: string; id: string; message: string }[] };
    expect(j.results.filter((x) => x.id === "a.pins.go").map((x) => [x.level, x.message])).toEqual([["PASS", expect.any(String)], ["INFO", NOTE]]);
  });

  it("escapes a tracked file name in pin rows, so a control character in it cannot reach the terminal", () => {
    const wf = ".github/workflows/ci\u001b[2J.yml";
    const root = setup(PIN("go", `"go-mod", "setup-go"`, `local = "off"\n`), { "go.mod": "module x\n\ngo 1.26.1\n", [wf]: REUSE, ".github/workflows/release.yml": REL });
    const r = check(root);
    expect(r.lines[1]).toBe(`INFO a.pins.go  ${NOTE.replace("ci.yml", "ci\\u001b[2J.yml")}`);
    const only = check(setup(PIN("go", `"setup-go"`, `local = "off"\n`), { [wf]: REUSE }));
    expect(only.lines[0]).toMatch(/^FAIL a\.pins\.go {2}setup-go: no go version found in \.github\/workflows\/ci\\u001b\[2J\.yml; /);
    for (const x of [r, only]) expect(x.out).not.toContain("\u001b");
  });

  it("relays a reusable-workflow note escaped in text and raw in --json", () => {
    const wf = REUSE.replace("  ci:\n    uses: someorg/.github/.github/workflows/go-ci.yml@abc123", '  "c\\u202ei":\n    uses: "someorg/.github/.github/workflows/go\\e-ci.yml@abc123"');
    const root = setup(PIN("go", `"go-mod", "setup-go"`, `local = "off"\n`), { "go.mod": "module x\n\ngo 1.26.1\n", ".github/workflows/ci.yml": wf, ".github/workflows/release.yml": REL });
    const note = NOTE.replace("job ci", "job c\u202ei").replace("go-ci.yml", "go\u001b-ci.yml");
    expect(check(root).lines[1]).toBe(`INFO a.pins.go  ${note.replace("\u202e", "\\u202e").replace("\u001b", "\\u001b")}`);
    const raw = check(root, ["--json"]).out;
    expect(raw).not.toMatch(/[\u001b\u202e]/);
    expect((JSON.parse(raw) as { results: { message: string }[] }).results[1]!.message).toBe(note);
  });

  it("a reusable-only workflow as the only match stays a FAIL, with a fix that says reusable inputs are not read", () => {
    const r = check(setup(PIN("go", `"setup-go"`, `local = "off"\n`), { ".github/workflows/ci.yml": REUSE }));
    expect(r.code).toBe(1);
    expect(r.lines[0]).toBe(
      "FAIL a.pins.go  setup-go: no go version found in .github/workflows/ci.yml; job ci calls reusable workflow someorg/.github/.github/workflows/go-ci.yml@abc123 (line 4), whose with: inputs are not read — fix: pin the version in a step that uses actions/setup-go in a workflow of this repo, or remove the setup-go source from .loops/env-check.toml (reusable-workflow inputs are not read)",
    );
  });
});

describe("--static", () => {
  const cfg = `${GO_PIN}local = "fail"\n[shared_checkout]\nhint = "use a worktree"\n[harness]\ntools = ["nope-tool"]\n`;
  it.each([[["--static"], {}], [[], { CI: "true" }]])("%j %j reads files only: no toolchain, tool or worktree-list probes", (args, env) => {
    const never = shim("go", "exit 9");
    const calls: string[][] = [];
    const rec: Runner = (cmd, a, opts) => (calls.push([cmd, ...a]), run(cmd, a, opts));
    const r = check(setup(cfg, GO_FILES), args, { ...withPath(never), ...env }, rec);
    expect(r.code).toBe(0);
    expect(r.out).toContain("SKIP c.shared  not checked in --static mode");
    expect(r.out).not.toContain("a.local");
    expect(r.out).not.toContain("d.tools");
    // One rev-parse pair, no `git worktree list`.
    expect(calls.filter((c) => c[0] === "git").map((c) => c.slice(1, 3))).toEqual([["rev-parse", "--show-toplevel"], ["ls-files", "-z"], ["rev-parse", "--git-dir"], ["rev-parse", "--git-common-dir"]]);
  });

  // A static [[local]] that prints what env-check tells it about the worktree.
  const echoWt = (extra = "") => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + extra + local(root, "d.x", 'echo "PASS d.x wt=$ENV_CHECK_WORKTREE"', "static = true\n"));
    commit(root);
    return root;
  };
  it.each([[["--static"], {}], [[], { CI: "true" }]])("%j %j tells a [[local]] the same ENV_CHECK_WORKTREE full mode does", (args, env) => {
    const root = echoWt();
    const wt = worktree(root, "feat-s");
    expect(check(wt, args, env).lines[0]).toBe("PASS d.x  wt=1");
    expect(check(wt).lines[0]).toBe("PASS d.x  wt=1");
    expect(check(root, args, env).lines[0]).toBe("PASS d.x  wt=0");
  });

  it.each([
    ["--static", "--git-dir", ["--static"], {}],
    ["CI=true", "--git-common-dir", [], { CI: "true" }],
  ] as [string, string, string[], Record<string, string>][])("%s: a failed rev-parse %s FAILs c.shared and tells a [[local]] nothing", (_n, flag, args, env) => {
    const root = echoWt(`[shared_checkout]\nhint = "use a worktree"\n`);
    const wt = worktree(root, "feat-u");
    const nul: Runner = (cmd, a, opts) => (cmd === "git" && a[0] === "rev-parse" && a[1] === flag ? { code: 128, stdout: "", stderr: "fatal: boom", timedOut: false } : run(cmd, a, opts));
    // Empty, set explicitly: an inherited ENV_CHECK_WORKTREE never wins.
    expect(check(wt, args, { ...env, ENV_CHECK_WORKTREE: "1" }, nul)).toMatchObject({
      code: 1,
      lines: ["FAIL c.shared  could not read git metadata — fix: rerun git rev-parse --git-dir --git-common-dir to see why", "PASS d.x  wt=", "env-check: 1 FAIL, 0 WARN, 1 PASS, 0 SKIP"],
    });
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

  const PASS = "PASS c.shared  in a linked worktree";
  const COPIED = "FAIL c.shared  this folder shares another worktree's git metadata (copied?) — fix: recreate it with git worktree add; do not run git worktree repair here";
  const committed = (): string => {
    const root = setup(cfg);
    commit(root);
    return root;
  };
  const cpR = (from: string, to: string): void => void execFileSync("cp", ["-R", from, to]);

  it("fails a cp -R copy of a worktree as copied, even with ENV_CHECK_ALLOW_MAIN=1", () => {
    const wt = worktree(committed(), "feat-a");
    const copy = join(tmp(), "feat-a-copy");
    cpR(wt, copy);
    expect(check(copy)).toMatchObject({ code: 1, lines: expect.arrayContaining([COPIED]) });
    expect(check(copy, [], { ENV_CHECK_ALLOW_MAIN: "1" })).toMatchObject({ code: 1, lines: expect.arrayContaining([COPIED]) });
    expect(check(join(copy, ".loops")).lines).toContain(COPIED); // from a subdirectory too
    expect(check(wt).lines).toContain(PASS); // the original is still fine
  });

  it("still tells a copy's [[local]] ENV_CHECK_WORKTREE=1 (not the main checkout); c.shared fails the run", () => {
    const root = setup(cfg);
    put(root, CFG, cfg + local(root, "d.x", 'echo "PASS d.x wt=$ENV_CHECK_WORKTREE"', "static = true\n"));
    commit(root);
    const copy = join(tmp(), "feat-w-copy");
    cpR(worktree(root, "feat-w"), copy);
    for (const args of [[], ["--static"]]) expect(check(copy, args)).toMatchObject({ code: args.length ? 0 : 1, lines: expect.arrayContaining(["PASS d.x  wt=1"]) });
    expect(check(copy).lines).toContain(COPIED);
  });

  it("fails worktree A copied over registered worktree B: B is listed, but its .git points at A's metadata", () => {
    const root = committed();
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    rmSync(b, { recursive: true });
    cpR(a, b);
    expect(sh(root, "worktree", "list", "--porcelain")).toContain(`worktree ${b}\n`);
    expect(check(b)).toMatchObject({ code: 1, lines: expect.arrayContaining([COPIED]) });
  });

  it("passes a worktree with relative paths, one reached through a symlink, and one run from a subdirectory", () => {
    const root = committed();
    const rel = join(tmp(), "feat-rel");
    sh(root, "worktree", "add", "-q", "--relative-paths", "-b", `b${n++}`, rel);
    expect(readFileSync(join(rel, ".git"), "utf8")).toMatch(/^gitdir: \.\./); // git did store it relative
    expect(check(rel).lines).toContain(PASS);
    const link = join(tmp(), "link");
    symlinkSync(tmp(), link);
    const viaLink = worktree(root, "feat-link", link);
    expect(check(viaLink).lines).toContain(PASS);
    expect(check(join(viaLink, ".loops")).lines).toContain(PASS);
    // git stores real paths, so the symlink that matters is in a hook-style GIT_DIR: equal once both are real paths.
    const rootLink = join(tmp(), "root-link");
    symlinkSync(root, rootLink);
    expect(check(viaLink, [], { GIT_DIR: join(rootLink, ".git", "worktrees", "feat-link") }).lines).toContain(PASS);
  });

  it("tells a moved worktree to run git worktree repair", () => {
    const wt = worktree(committed(), "feat-m");
    const moved = join(tmp(), "feat-m-moved");
    execFileSync("mv", [wt, moved]);
    expect(check(moved)).toMatchObject({ code: 1, lines: expect.arrayContaining([`FAIL c.shared  worktree moved: git has it registered at ${wt}, which is missing — fix: run git worktree repair here`]) });
  });

  it("fails an inherited GIT_DIR or GIT_WORK_TREE that points at another checkout, even with ENV_CHECK_ALLOW_MAIN=1", () => {
    const root = committed();
    const wt = worktree(root, "feat-g");
    const gd = join(root, ".git", "worktrees", "feat-g");
    const msg = `FAIL c.shared  GIT_DIR points at another checkout's git metadata; git commands here act on ${gd} — fix: unset GIT_DIR GIT_WORK_TREE`;
    expect(check(root, [], { GIT_DIR: gd })).toMatchObject({ code: 1, lines: expect.arrayContaining([msg]) });
    expect(check(root, [], { GIT_DIR: gd, ENV_CHECK_ALLOW_MAIN: "1" })).toMatchObject({ code: 1, lines: expect.arrayContaining([msg]) });
    expect(check(wt, [], { GIT_WORK_TREE: root }).lines).toContain(`FAIL c.shared  GIT_WORK_TREE points at another checkout's files; git commands here act on ${root} — fix: unset GIT_DIR GIT_WORK_TREE`);
  });

  it("says nothing about the GIT_DIR git sets inside a hook: it names this checkout's own metadata", () => {
    const root = committed();
    const wt = worktree(root, "feat-h");
    const dump = join(tmp(), "hook-env");
    put(root, ".git/hooks/pre-commit", `#!/bin/sh\n{ pwd; env | grep '^GIT_'; } > '${dump}'\n`, true);
    sh(wt, "commit", "-q", "--allow-empty", "-m", "hooked");
    const [cwd, ...vars] = readFileSync(dump, "utf8").trim().split("\n");
    const env = Object.fromEntries(vars.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    expect(env.GIT_DIR).toBeTruthy(); // git did set one
    expect(check(cwd!, [], env).lines).toContain(PASS);
    expect(check(root, [], { GIT_DIR: ".git" }).lines[0]).toMatch(/^FAIL c\.shared {2}this is the shared checkout/); // the main checkout's own, relative
  });

  it.each(["--git-dir", "--git-common-dir"])("fails when git rev-parse %s fails, instead of guessing a worktree", (flag) => {
    const wt = worktree(committed(), "feat-n");
    const nul: Runner = (cmd, args, opts) => (cmd === "git" && args[0] === "rev-parse" && args[1] === flag ? { code: 128, stdout: "", stderr: "fatal: boom", timedOut: false } : run(cmd, args, opts));
    expect(check(wt, [], {}, nul)).toMatchObject({ code: 1, lines: expect.arrayContaining(["FAIL c.shared  could not read git metadata — fix: rerun git rev-parse --git-dir --git-common-dir to see why"]) });
  });

  it("fails a worktree when git worktree list fails: its registration cannot be checked", () => {
    const wt = worktree(committed(), "feat-l");
    const nul: Runner = (cmd, args, opts) => (cmd === "git" && args[0] === "worktree" ? { code: 128, stdout: "", stderr: "fatal: boom", timedOut: false } : run(cmd, args, opts));
    expect(check(wt, [], {}, nul).lines).toContain("FAIL c.shared  could not read git metadata — fix: rerun git worktree list --porcelain to see why");
  });
});

describe("git env", () => {
  // `git rev-parse --local-env-vars` (git 2.56): what points git at a repo other than the one cwd is in.
  const LOCAL = "GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_OBJECT_DIRECTORY GIT_DIR GIT_WORK_TREE GIT_IMPLICIT_WORK_TREE GIT_GRAFT_FILE GIT_INDEX_FILE GIT_NO_REPLACE_OBJECTS GIT_REPLACE_REF_BASE GIT_PREFIX GIT_SHALLOW_FILE GIT_COMMON_DIR".split(" ");

  it("every env-check git spawn gets the caller's env without git's repo-local variables", () => {
    const root = setup(`${HEAD}[harness]\ntracked = true\nsparse = "warn"\n[shared_checkout]\nhint = "h"\n`);
    const elsewhere = setup(HEAD);
    const env = { ...Object.fromEntries(LOCAL.map((k) => [k, join(elsewhere, ".git")])), GIT_CONFIG_COUNT: "1", LOOPS_MARK: "1" };
    const seen: (NodeJS.ProcessEnv | undefined)[] = [];
    const r = check(root, [], env, (cmd, args, opts) => (cmd === "git" && seen.push(opts?.env), run(cmd, args, opts)));
    expect(r.out).toContain("PASS d.tracked");
    expect(seen.length).toBeGreaterThanOrEqual(7);
    for (const e of seen) {
      expect(e).toMatchObject({ LOOPS_MARK: "1", HOME: "/nonexistent-home" });
      expect(Object.keys(e ?? {}).filter((k) => LOCAL.includes(k))).toEqual([]);
    }
  });

  // One way to spawn git: through gitEnv, in every module but zone, which reviews whatever index the caller's git env
  // selects (a tool's temporary GIT_INDEX_FILE), so it keeps that env. proc.ts holds the helpers; testkit.ts sets up repos.
  it("every git spawn passes gitEnv, except zone's, which never does", () => {
    const src = join(HERE, "..");
    const spawns = (text: string): string[] =>
      [...text.matchAll(/(?<!function )\b(?:git|repoRoot)\(|\b\w+\(\s*"git",/g)].map((m) => {
        let i = m.index + m[0].indexOf("(");
        for (let depth = 0; i < text.length; i++) if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) break;
        return text.slice(m.index, i + 1);
      });
    const found = Object.fromEntries(
      ["lib", "bin"].flatMap((d) =>
        readdirSync(join(src, d))
          .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !["proc.ts", "testkit.ts"].includes(f))
          .map((f) => [`${d}/${f}`, spawns(readFileSync(join(src, d, f), "utf8"))] as const)
          .filter(([, s]) => s.length),
      ),
    );
    expect(Object.keys(found).sort()).toEqual(expect.arrayContaining(["lib/env-check.ts", "lib/env-checks.ts", "lib/zone-cli.ts"]));
    for (const [file, calls] of Object.entries(found)) {
      for (const c of calls) expect(`${file}: ${c}`).toMatch(file === "lib/zone-cli.ts" ? /^[^:]+: (?![^]*gitEnv\()/ : /gitEnv\(/);
    }
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

  describe("d.tools version-manager shims", () => {
    const FIX =
      "fix: set a version for this checkout (a .tool-versions line for asdf, mise use <tool>@<version> for mise), put the version manager on PATH, or install the tool outside it";
    /** An asdf shim for `tool` that execs `asdf` (by name, or by the given path); running it leaves a marker. */
    const asdfShim = (dir: string, tool: string, asdf = "asdf") =>
      put(dir, tool, `#!/usr/bin/env bash\n# asdf-plugin: ${tool} 1.0.0\ntouch "${dir}/ran-${tool}"\nexec ${asdf} exec "${tool}" "$@"\n`, true);
    /** A fake version manager `name` in `dir` that logs "<cwd> <args>" and answers `which` with `body`. */
    const manager = (dir: string, name: string, body: string) => put(dir, name, `#!/bin/sh\necho "$PWD $*" >> "${dir}/${name}.log"\n${body}\n`, true);
    const NO_VERSION = 'echo "No version is set for command $2" >&2; exit 126';
    const RESOLVES = 'echo "/opt/asdf/installs/$2/1.0.0/bin/$2"';
    const go = (tools: string, env: Record<string, string>, runner?: Runner) => {
      const root = setup(`${HEAD}[harness]\ntools = ${tools}\n`);
      commit(root);
      return { root, ...check(root, [], env, runner) };
    };
    // A PATH with no real asdf or mise on it: git runs from the process env, so it is not needed here.
    const bare = (...dirs: string[]) => ({ PATH: [...dirs, "/usr/bin", "/bin"].join(":") });

    it("FAILs an asdf shim that resolves no version, asking asdf which from the repo root and never running the tool", () => {
      const shims = tmp();
      const bin = tmp();
      asdfShim(shims, "fakelint");
      manager(bin, "asdf", NO_VERSION);
      const r = go('["fakelint"]', bare(shims, bin));
      expect(r.code).toBe(1);
      expect(r.out).toContain(`FAIL d.tools  version-manager shim resolves no version here: fakelint (asdf which fakelint exited 126: No version is set for command fakelint) — ${FIX}`);
      expect(r.out).not.toContain("PASS d.tools");
      expect(readFileSync(join(bin, "asdf.log"), "utf8")).toBe(`${r.root} which fakelint\n`);
      expect(existsSync(join(shims, "ran-fakelint"))).toBe(false);
    });

    it("PASSes an asdf shim that resolves, and never runs a plain tool or the shim", () => {
      const shims = tmp();
      const bin = tmp();
      asdfShim(shims, "fakelint");
      put(shims, "plain", `#!/bin/sh\ntouch "${shims}/ran-plain"\n`, true);
      manager(bin, "asdf", RESOLVES);
      const r = go('["fakelint", "plain"]', bare(shims, bin));
      expect(r.code).toBe(0);
      expect(r.out).toContain("PASS d.tools  present: fakelint, plain");
      expect(readFileSync(join(bin, "asdf.log"), "utf8")).toBe(`${r.root} which fakelint\n`); // only the shim is asked about
      expect(existsSync(join(shims, "ran-fakelint")) || existsSync(join(shims, "ran-plain"))).toBe(false);
    });

    it("FAILs when asdf is not on PATH, unless the shim execs asdf by an absolute path", () => {
      const shims = tmp();
      asdfShim(shims, "fakelint");
      expect(go('["fakelint"]', bare(shims)).out).toContain("FAIL d.tools  version-manager shim resolves no version here: fakelint (asdf not on PATH)");
      // An older asdf shim names asdf by its path: that asdf is asked, though no asdf is on PATH.
      const abs = tmp();
      const home = tmp();
      asdfShim(abs, "fakelint", `${home}/bin/asdf`);
      manager(join(home, "bin"), "asdf", RESOLVES);
      const r = go('["fakelint"]', bare(abs));
      expect(r.out).toContain("PASS d.tools  present: fakelint");
      expect(readFileSync(join(home, "bin", "asdf.log"), "utf8")).toBe(`${r.root} which fakelint\n`);
      // ...and a PATH asdf is not asked instead of it.
      const other = tmp();
      manager(other, "asdf", RESOLVES);
      manager(join(home, "bin"), "asdf", NO_VERSION);
      expect(go('["fakelint"]', bare(abs, other)).out).toContain("(asdf which fakelint exited 126: No version is set for command fakelint)");
      expect(existsSync(join(other, "asdf.log"))).toBe(false);
      // A named asdf that is gone cannot run the shim either.
      const gone = tmp();
      asdfShim(gone, "fakelint", "/nonexistent-dir/bin/asdf");
      expect(go('["fakelint"]', bare(gone)).out).toContain("fakelint (asdf not found at /nonexistent-dir/bin/asdf)");
    });

    it("relays a shim diagnostic and a shim's manager path escaped in text and raw in --json", () => {
      const shims = tmp();
      const bin = tmp();
      asdfShim(shims, "fakelint");
      manager(bin, "asdf", "printf 'No version\\033[2K\\302\\233 set\\n' >&2; exit 126");
      const root = setup(`${HEAD}[harness]\ntools = ["fakelint"]\n`);
      commit(root);
      expect(check(root, [], bare(shims, bin)).out).toContain("(asdf which fakelint exited 126: No version\\u001b[2K\\u009b set)");
      const raw = check(root, ["--json"], bare(shims, bin)).out;
      expect(raw).not.toMatch(/[\u001b\u009b]/);
      const tools = (JSON.parse(raw) as { results: { id: string; message: string }[] }).results.find((x) => x.id === "d.tools");
      expect(tools?.message).toContain("(asdf which fakelint exited 126: No version\u001b[2K\u009b set)");
      const gone = tmp();
      asdfShim(gone, "fakelint", "/nonexistent-dir/\u001b[2Kbin/asdf");
      const g = check(root, [], bare(gone));
      expect(g.out).toContain("fakelint (asdf not found at /nonexistent-dir/\\u001b[2Kbin/asdf)");
      expect(g.out).not.toContain("\u001b");
    });

    it("asks mise about a symlink to the mise binary, and does not treat mise itself as a shim", () => {
      const bin = tmp();
      const shims = tmp();
      manager(bin, "mise", 'echo "mise ERROR $2 is not a mise bin" >&2; exit 1');
      symlinkSync(join(bin, "mise"), join(shims, "fakelint"));
      const r = go('["fakelint"]', bare(shims));
      expect(r.code).toBe(1);
      expect(r.out).toContain("FAIL d.tools  version-manager shim resolves no version here: fakelint (mise which fakelint exited 1: mise ERROR fakelint is not a mise bin)");
      expect(readFileSync(join(bin, "mise.log"), "utf8")).toBe(`${r.root} which fakelint\n`);
      manager(bin, "mise", RESOLVES);
      expect(go('["fakelint"]', bare(shims)).out).toContain("PASS d.tools  present: fakelint");
      rmSync(join(bin, "mise.log"));
      expect(go('["mise"]', bare(bin)).out).toContain("PASS d.tools  present: mise");
      expect(existsSync(join(bin, "mise.log"))).toBe(false);
    });

    it("FAILs a manager that times out, prints no path, or cannot run", () => {
      const shims = tmp();
      const bin = tmp();
      asdfShim(shims, "fakelint");
      manager(bin, "asdf", "exit 0");
      expect(go('["fakelint"]', bare(shims, bin)).out).toContain("fakelint (asdf which fakelint printed no path)");
      const stub = (r: Partial<RunResult>): Runner => (cmd, args, opts) => (cmd.endsWith("asdf") ? { code: null, stdout: "", stderr: "", timedOut: false, ...r } : procRun(cmd, args, opts));
      expect(go('["fakelint"]', bare(shims, bin), stub({ timedOut: true })).out).toContain("fakelint (asdf which fakelint timed out after 10s)");
      expect(go('["fakelint"]', bare(shims, bin), stub({ abend: "EACCES" })).out).toContain("fakelint (asdf which fakelint could not run (EACCES))");
    });

    it("lists missing tools first, then unresolved shims, in two FAIL rows", () => {
      const shims = tmp();
      const bin = tmp();
      asdfShim(shims, "fakelint");
      asdfShim(shims, "other");
      manager(bin, "asdf", NO_VERSION);
      const r = go('["nope-tool", "fakelint", "other"]', bare(shims, bin));
      expect(r.code).toBe(1);
      const rows = r.lines.filter((l) => l.includes("d.tools"));
      expect(rows.map((l) => l.split(" — ")[0])).toEqual([
        "FAIL d.tools  missing on PATH: nope-tool",
        "FAIL d.tools  version-manager shim resolves no version here: fakelint (asdf which fakelint exited 126: No version is set for command fakelint); other (asdf which other exited 126: No version is set for command other)",
      ]);
    });

    it("escapes the manager's output line", () => {
      const shims = tmp();
      const bin = tmp();
      asdfShim(shims, "fakelint");
      manager(bin, "asdf", "printf 'bad\\033[2J — fix: rm -rf x\\n' >&2; exit 3");
      expect(go('["fakelint"]', bare(shims, bin)).out).toContain("(asdf which fakelint exited 3: bad\\u001b[2J \\u2014 fix: rm -rf x)");
    });

    it("redacts $HOME before cutting the manager's output line", () => {
      const shims = tmp();
      const bin = tmp();
      asdfShim(shims, "fakelint");
      manager(bin, "asdf", `echo "error: $(printf '0%.0s' $(seq 1 107)) /home/someuser/.asdf/x" >&2; exit 3`);
      const out = go('["fakelint"]', { ...bare(shims, bin), HOME: "/home/someuser" }).out;
      expect(out).toMatch(/\(asdf which fakelint exited 3: error: 0{107} ~\/\.as…\)/);
      expect(out).not.toMatch(/\/home|someu/);
    });

    it.each([[["--static"], {}], [[], { CI: "true" }]] as [string[], Record<string, string>][])("%j %j never asks the manager", (args, env) => {
      const shims = tmp();
      const bin = tmp();
      asdfShim(shims, "fakelint");
      manager(bin, "asdf", RESOLVES);
      const root = setup(`${HEAD}[harness]\ntools = ["fakelint"]\n`);
      commit(root);
      const r = check(root, args, { ...bare(shims, bin), ...env });
      expect(r.out).not.toContain("d.tools");
      expect(existsSync(join(bin, "asdf.log")) || existsSync(join(shims, "ran-fakelint"))).toBe(false);
    });
  });

  it("d.files needs present, non-empty files", () => {
    const r = run('files = ["VERSION", "go.sum", "README.md"]', { VERSION: "" });
    expect(r.out).toContain("FAIL d.files  missing or empty: VERSION, go.sum — fix: restore the files (git checkout) or fix [harness] files");
  });

  it("d.files FAILs a directory, a symlink to one, or a FIFO in a separate clause, whatever the directory holds", () => {
    const r = run('files = ["full", "VERSION", "emptydir", "linkdir", "fifo", "go.sum"]', { "full/a.txt": "x\n", VERSION: "" }, (root) => {
      mkdirSync(join(root, "emptydir"));
      symlinkSync("full", join(root, "linkdir"));
      execFileSync("mkfifo", [join(root, "fifo")]);
    });
    expect(r.code).toBe(1);
    expect(r.lines.filter((l) => l.includes("d.files"))).toEqual([
      "FAIL d.files  missing or empty: VERSION, go.sum; not a regular file: full, emptydir, linkdir, fifo — fix: restore the files (git checkout) or fix [harness] files (list a file inside a directory, not the directory)",
    ]);
    expect(run('files = ["full"]', { "full/a.txt": "x\n" }).out).toContain("FAIL d.files  not a regular file: full — fix:");
  });

  it("d.files follows symlinks to regular files, FAILs a dangling one, and checks the working tree only (untracked counts)", () => {
    const r = run('files = ["link", "untracked.txt"]', { "real.txt": "x\n" }, (root) => {
      symlinkSync("real.txt", join(root, "link"));
      put(root, "untracked.txt", "y\n");
    });
    expect(r.out).toContain("PASS d.files  present: link, untracked.txt");
    expect(run('files = ["dangling"]', {}, (root) => symlinkSync("nowhere", join(root, "dangling"))).out).toContain("FAIL d.files  missing or empty: dangling — fix:");
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

  it("d.tracked escapes a tracked name in text and keeps it raw in --json, JSON-escaped", () => {
    const name = "a\u001b[2Kb\u009bc\u202e.txt";
    const root = setup(`${HEAD}[harness]\ntracked = true\n`, { [name]: "x\n" });
    commit(root);
    rmSync(join(root, name));
    const r = check(root);
    expect(r.out).toContain("FAIL d.tracked  deleted: a\\u001b[2Kb\\u009bc\\u202e.txt — fix: ");
    expect(r.out).not.toMatch(/[\u001b\u009b\u202e]/);
    const raw = check(root, ["--json"]).out;
    expect(raw).not.toMatch(/[\u001b\u009b\u202e]/);
    const rows = (JSON.parse(raw) as { results: { id: string; message: string }[] }).results;
    expect(rows.find((x) => x.id === "d.tracked")?.message).toBe(`deleted: ${name}`);
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

  it("d.sparse reads every git bool spelling, PASSes when off, and is not run under --static", () => {
    for (const v of ["yes", "on", "1"]) {
      expect(run('sparse = "warn"', {}, (root) => sh(root, "config", "core.sparseCheckout", v)).out).toContain("WARN d.sparse  sparse checkout is enabled");
    }
    expect(run('sparse = "warn"').lines.filter((l) => l.includes("d.sparse"))).toEqual(["PASS d.sparse  sparse checkout is off"]);
    expect(run('sparse = "warn"', {}, (root) => sh(root, "config", "core.sparseCheckout", "false")).out).toContain("PASS d.sparse  sparse checkout is off");
    const root = setup(`${HEAD}[harness]\nsparse = "warn"\n`);
    commit(root);
    expect(check(root, ["--static"]).out).not.toContain("d.sparse");
  });

  it("d.sparse WARNs, never PASSes, when core.sparseCheckout cannot be read", () => {
    const root = setup(`${HEAD}[harness]\nsparse = "warn"\n`);
    commit(root);
    // An invalid value makes git exit 128 (it also breaks ls-files, so stub only the config read).
    const bad: Runner = (cmd, args, opts) => (cmd === "git" && args[0] === "config" && args.includes("core.sparseCheckout") ? { code: 128, stdout: "", stderr: "fatal: bad boolean config value", timedOut: false } : procRun(cmd, args, opts));
    const odd: Runner = (cmd, args, opts) => (cmd === "git" && args[0] === "config" && args.includes("core.sparseCheckout") ? { code: 0, stdout: "maybe\n", stderr: "", timedOut: false } : procRun(cmd, args, opts));
    for (const runner of [bad, odd]) {
      const r = check(root, [], {}, runner);
      expect(r.lines.filter((l) => l.includes("d.sparse"))).toEqual(["WARN d.sparse  could not read core.sparseCheckout — fix: run git config --type=bool --get core.sparseCheckout to see what is wrong"]);
      expect(r.code).toBe(0);
    }
  });

  it("d.entrypoints auto with no ./ command in tracked workflows is an uncounted INFO; an explicit [] stays silent", () => {
    const files = { ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - run: make test\n" };
    const r = run('entrypoints = "auto"\ntools = ["git"]', files);
    expect(r.lines).toEqual([
      "PASS d.tools  present: git",
      "INFO d.entrypoints  auto: no ./ command in tracked .github/workflows; nothing to check",
      "env-check: 0 FAIL, 0 WARN, 1 PASS, 0 SKIP",
    ]);
    expect(r.code).toBe(0);
    expect(run('entrypoints = []\ntools = ["git"]', files).out).not.toContain("d.entrypoints");
    // An untracked workflow is not read, so its ./ command does not count.
    const u = run('entrypoints = "auto"\ntools = ["git"]', {}, (root) => put(root, ".github/workflows/ci.yml", "jobs:\n  a:\n    steps:\n      - run: ./ci.sh\n"));
    expect(u.out).toContain("INFO d.entrypoints  auto: no ./ command in tracked .github/workflows");
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
  // A failed probe's fix: the command that shows Compose's own error (which loops never copies).
  const RERUN = (dir: string, files = ["compose.yml"]) => `rerun to see Compose's error: cd ${dir} && env ${OFF_ENV} docker compose ${files.map((f) => `-f ${f} `).join("")}config --no-env-resolution -q`;

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
    // loops does not say where Compose's answer came from (name:, .env or the directory): its source is compose.
    expect(checkC(root, { [root]: "app-prod" }).out).toContain("PASS e.project  app-prod (compose)");
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

  it("passes DOCKER_CONFIG and the shell's COMPOSE_* to this checkout's probes, asks them again without its COMPOSE_*, and passes only DOCKER_CONFIG to the main checkout's and peers'", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const peer = worktree(root, "feat-a");
    const wt = worktree(root, "feat-b");
    const env = { DOCKER_CONFIG: "/opt/docker-cfg", COMPOSE_PROJECT_NAME: "mine", COMPOSE_FILE: "compose.yml" };
    const r = checkC(wt, { [wt]: { cfg: "mine", plain: "mine", scrubbed: "feat-b" }, [root]: "app-prod", [peer]: "app-prod" }, [], env);
    expect(r.out).toContain("PASS e.project  mine (COMPOSE_PROJECT_NAME)");
    // Own configured and root plain, each as is then without COMPOSE_*; then the main checkout's and the peer's, without.
    const has = (c: ComposeCall): boolean => Object.keys(c.env).some((k) => k.startsWith("COMPOSE_") && !Object.hasOwn(REMOTE_OFF, k));
    expect(r.calls.map((c) => [rp(c.cwd), c.files, has(c)])).toEqual([
      [wt, ["compose.yml"], true], [wt, ["compose.yml"], false], [wt, [], true], [wt, [], false],
      [root, ["compose.yml"], false], [root, [], false], [peer, ["compose.yml"], false], [peer, [], false],
    ]);
    for (const c of r.calls) expect([c.env.DOCKER_CONFIG, c.env.HOME, typeof c.env.PATH]).toEqual(["/opt/docker-cfg", "/nonexistent-home", "string"]);
    expect(r.calls[0]!.env).toMatchObject(env);
  });

  it("turns Compose's remote loaders off for this checkout's probes, as is and scrubbed, and the main checkout's and peers', over a shell that turns them on", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const peer = worktree(root, "feat-a");
    const wt = worktree(root, "feat-b");
    const env = { COMPOSE_PROJECT_NAME: "mine", COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1", COMPOSE_EXPERIMENTAL_OCI_REMOTE: "1", GIT_ALLOW_PROTOCOL: "https" };
    const r = checkC(wt, { [wt]: { cfg: "mine", plain: "mine", scrubbed: "feat-b" }, [root]: "app-prod", [peer]: "app-prod" }, [], env);
    expect(r.out).toContain("PASS e.project  mine (COMPOSE_PROJECT_NAME)");
    expect(r.calls.map((c) => [rp(c.cwd), c.env.COMPOSE_PROJECT_NAME, c.env.COMPOSE_EXPERIMENTAL_GIT_REMOTE, c.env.COMPOSE_EXPERIMENTAL_OCI_REMOTE, c.env.GIT_ALLOW_PROTOCOL])).toEqual([
      ...[wt, wt, wt, wt, root, root, peer, peer].map((d, i) => [d, i === 0 || i === 2 ? "mine" : undefined, "0", "0", "file"]),
    ]);
  });

  it("skips e.project when Compose is unavailable, handing down only a name loops can vouch for", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-u");
    const docker = { unavailable: "docker" as const };
    const plugin = { unavailable: "plugin" as const };
    // `docker compose version` decides, once, from this checkout: the main checkout has no vouchable name, so SKIP, never PASS.
    const m = checkC(root, { [root]: docker });
    expect([m.code, m.calls.length]).toEqual([0, 0]);
    expect(m.out).toContain("SKIP e.project  compose unavailable (docker is not installed); nothing to collide with");
    expect(m.out).not.toContain("PASS e.project");
    const mp = checkC(root, { [root]: docker }, ["--compose-project"]);
    expect([mp.code, mp.out, mp.err]).toEqual([1, "", "env-check: compose unavailable (docker is not installed); nothing to collide with"]);
    // A worktree vouches for its derived name, or the shell's COMPOSE_PROJECT_NAME.
    const w = checkC(wt, { [wt]: plugin });
    expect([w.code, w.calls.length]).toEqual([0, 0]);
    expect(w.out).toContain("SKIP e.project  compose unavailable (docker compose version exited 125); nothing to collide with");
    expect(checkC(wt, { [wt]: plugin }, ["--compose-project"])).toMatchObject({ code: 0, out: "feat-u" });
    expect(checkC(wt, { [wt]: plugin }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" })).toMatchObject({ code: 0, out: "mine" });
    // Once Compose answers here, a probe of another checkout that cannot start is a FAIL that withholds the name, never a SKIP.
    const stub = composeStub({ [wt]: "feat-u" });
    const lost: Runner = (cmd, args, opts) => (isComposeConfigCall(cmd, args) && rp(opts?.cwd ?? "") === root ? { code: null, stdout: "", stderr: "", timedOut: false, notFound: true } : stub(cmd, args, opts));
    const s = check(wt, [], {}, lost);
    expect([s.code, s.out]).toEqual([1, expect.stringContaining("FAIL e.project  the main checkout's configured run: docker compose config could not start (its directory is gone) — fix: rerun to see Compose's error: cd ")]);
    expect(check(wt, ["--compose-project"], {}, lost)).toMatchObject({ code: 1, out: "" });
  });

  it("fails, withholding the name, when `docker compose version` exits non-zero for a reason other than a missing plugin", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-d");
    const stub = composeStub({ [wt]: "feat-d" });
    const daemon: Runner = (cmd, args, opts) => (isComposeVersionCall(cmd, args) ? { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon\n", timedOut: false } : stub(cmd, args, opts));
    const r = check(wt, [], {}, daemon);
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL e.project  compose: docker compose version exited 1");
    expect(r.out).not.toContain("SKIP e.project");
    expect(check(wt, ["--compose-project"], {}, daemon)).toMatchObject({ code: 1, out: "" });
  });

  it("does not count the remote-loader switches as the shell's COMPOSE_*: no scrubbed own probe, no label", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-k");
    const r = checkC(wt, { [root]: "app-prod", [wt]: { cfg: { error: "boom" }, plain: "feat-k" } }, [], { COMPOSE_EXPERIMENTAL_GIT_REMOTE: "1" });
    expect(r.out).not.toContain("without your shell's");
    expect(r.out.split("\n").filter((l) => l.startsWith("FAIL e.project")).map((l) => l.split(" — ")[0])).toEqual(["FAIL e.project  this worktree's configured run: docker compose config exited 1"]);
    expect(r.calls.filter((c) => rp(c.cwd) === wt).length).toBe(2);
  });

  it("does not claim Compose prints an error when its probe exited 0 with invalid JSON or no project name", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const stub = composeStub({ [root]: "app-prod" });
    const exit0 = (stdout: string): Runner => (cmd, args, opts) => (isComposeConfigCall(cmd, args) ? { code: 0, stdout, stderr: "", timedOut: false } : stub(cmd, args, opts));
    const fix = "Compose exited 0 without a usable project name; check `docker compose version` and upgrade Docker Compose";
    for (const [stdout, why] of [["not json", "printed invalid JSON"], ["{}", "printed no project name"]]) {
      const r = check(root, [], {}, exit0(stdout!));
      expect([why, r.code, r.out]).toEqual([why, 1, expect.stringContaining(`FAIL e.project  this checkout's configured run: docker compose config ${why} — fix: ${fix}`)]);
      expect(r.out).not.toContain("rerun to see Compose's error");
    }
  });

  it("fails e.project on a Compose too old for --no-env-resolution, asking for an upgrade; --compose-project withholds the name when that run names the checkout", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-o");
    // It still runs stacks, so it is no "nothing to collide with" SKIP; a shell COMPOSE_PROJECT_NAME does not change the fix.
    const old = { error: "unknown flag: --no-env-resolution" };
    const why = (whose: string) => `${whose} configured run: docker compose config is too old (needs --no-env-resolution)`;
    const fix = "upgrade Docker Compose to one whose config takes --no-env-resolution";
    // The main checkout's configured run feeds the name: withheld.
    const r = checkC(root, { [root]: old }, [], { COMPOSE_PROJECT_NAME: "mine" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.project  ${why("this checkout's")} — fix: ${fix}`)]);
    const p = checkC(root, { [root]: old }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" });
    expect([p.code, p.out, p.err]).toEqual([1, "", expect.stringContaining(`env-check: ${why("this checkout's")} — fix: ${fix}`)]);
    // A worktree's own run says nothing about -p mine: the name is kept, with a warning.
    const w = checkC(wt, { [wt]: old, [root]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "mine" });
    expect([w.code, w.out]).toEqual([1, expect.stringContaining(`FAIL e.project  ${why("this worktree's")} — fix: ${fix}`)]);
    const wp = checkC(wt, { [wt]: old, [root]: "app-prod" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" });
    expect([wp.code, wp.out, wp.err]).toEqual([0, "mine", expect.stringContaining(`env-check: warning: ${why("this worktree's")} — fix: ${fix}`)]);
  });

  it("holds a peer worktree's derived name and every answer, probing a peer without the configured files plainly, and a gone peer's derived name", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    const env = (n: string) => ({ COMPOSE_PROJECT_NAME: n });
    const held = (n: string, by = `worktree ${b}`) => `FAIL e.project  this worktree would use project ${n}, which ${by} uses`;
    const B = { [root]: "app-node", [b]: { cfg: "cfg-b", plain: "plain-b" } };
    for (const n of ["feat-b", "cfg-b", "plain-b"]) {
      expect([n, checkC(a, { ...B, [a]: n }, [], env(n)).out]).toEqual([n, expect.stringContaining(held(n))]);
      expect([n, checkC(a, { ...B, [a]: n }, ["--compose-project"], env(n)).code]).toEqual([n, 1]);
    }
    expect(checkC(a, { ...B, [a]: "mine" }, [], env("mine")).out).toContain("PASS e.project  mine (COMPOSE_PROJECT_NAME)");
    // A peer on a branch without the configured file has no configured run to ask; its plain run still holds its answer.
    rmSync(join(b, "compose.yml"));
    const plain = checkC(a, { [root]: "app-node", [a]: "plain-b", [b]: "plain-b" }, [], env("plain-b"));
    expect([plain.code, plain.out, plain.calls.filter((c) => rp(c.cwd) === b).map((c) => c.files)]).toEqual([1, expect.stringContaining(held("plain-b")), [[]]]);
    // A peer whose directory is gone is not probed, and holds only its derived name.
    rmSync(b, { recursive: true });
    const gone = checkC(a, { [root]: "app-node", [a]: "feat-b" }, [], env("feat-b"));
    expect([gone.code, gone.out, gone.calls.some((c) => rp(c.cwd) === b)]).toEqual([1, expect.stringContaining(held("feat-b", `worktree ${b} (gone, until git worktree prune)`)), false]);
  });

  it("runs every check and reports every FAIL, the ones that withhold the name first", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-w");
    // Own configured run fails (keeps), the shell's name is held (withholds), the plain run lands elsewhere (keeps).
    const r = checkC(wt, { [root]: "app-prod", [wt]: { cfg: { error: "boom" }, plain: "other" } }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    const fails = r.lines.filter((l) => l.startsWith("FAIL e.project"));
    expect([r.code, fails.length, fails[0]]).toEqual([1, 5, expect.stringContaining("this worktree would use project app-prod, which the main checkout uses")]);
    expect(fails.slice(1).map((l) => l.split(" — ")[0])).toEqual([
      "FAIL e.project  this worktree's configured run: docker compose config exited 1",
      "FAIL e.project  without your shell's COMPOSE_* (COMPOSE_PROJECT_NAME), this worktree's configured run: docker compose config exited 1",
      "FAIL e.project  root plain run would use project other, not app-prod",
      "FAIL e.project  without your shell's COMPOSE_* (COMPOSE_PROJECT_NAME), root plain run would use project other, not app-prod",
    ]);
    // `docker compose version` timing out is a FAIL that withholds the name, and nothing is probed.
    const calls: ComposeCall[] = [];
    const stub = composeStub({ [wt]: "feat-w" }, calls);
    const slow: Runner = (cmd, args, opts) => (cmd === "docker" && args[1] === "version" ? { code: null, stdout: "", stderr: "", timedOut: true } : stub(cmd, args, opts));
    const t = check(wt, ["--compose-project"], {}, slow);
    expect([t.code, t.out, t.err, calls.length]).toEqual([1, "", `env-check: compose: docker compose version timed out after 10s — fix: rerun to see why: cd ${wt} && docker compose version`, 0]);
  });

  it("--compose-project exits 0 with the name it keeps, warning on any FAIL, and 1 when a FAIL withholds it or it is unknown; local checks get that name", () => {
    const root = setup(test('derive = "slug-hash"\n'), { "compose.yml": COMPOSE });
    put(root, CFG, test('derive = "slug-hash"\n') + local(root, "d.p", 'echo "PASS d.p project=[$ENV_CHECK_PROJECT]"'));
    commit(root);
    const wt = worktree(root, "feat-t");
    const lost = worktree(root, "feat-0");
    rmSync(join(lost, "compose.yml"));
    // feat-t is the worktree's own directory name (what Compose derives there), so it is no clash.
    const ok = { [root]: "app-prod", [wt]: "feat-t", [lost]: "feat-0" };
    const n = checkC(wt, ok, ["--compose-project"]).out;
    expect(n).toMatch(/^[\w-]+-feat-t-[0-9a-f]{6}$/);
    const away = tmp();
    const ps = (project: string): Runner => composeStub(ok, [], (cmd, args, opts) => (cmd === "docker" && args[0] === "ps" ? listing(ctr(away, `${project}-web-1`, "2026-01-01T00:00:00Z", project)) : run(cmd, args, opts)));
    const stub = composeStub(ok);
    const slow: Runner = (cmd, args, opts) => (isComposeVersionCall(cmd, args) ? { code: null, stdout: "", stderr: "", timedOut: true } : stub(cmd, args, opts));
    const unlisted: Runner = (cmd, args, opts) => (cmd === "git" && args[0] === "worktree" && args[1] === "list" ? { code: 128, stdout: "", stderr: "fatal: worktree list broke", timedOut: false } : stub(cmd, args, opts));
    const entry = (dir: string): string => `worktree ${dir}\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/x\n\n`;
    const listed = (stdout: string): Runner => (cmd, args, opts) => (cmd === "git" && args[0] === "worktree" && args[1] === "list" ? { code: 0, stdout, stderr: "", timedOut: false } : stub(cmd, args, opts));
    // [source, cwd, answers or a runner, shell env, e.project FAILs, the name kept (null: withheld or unknown)]
    const rows: [string, string, ComposeAnswers | Runner, Record<string, string>, boolean, string | null][] = [
      ["PASS", wt, ok, {}, false, n],
      ["check 0: a configured file missing", lost, ok, {}, true, null],
      ["check 1: docker compose version timed out", wt, slow, {}, true, null],
      ["check 1 SKIP in the main checkout: unknown", root, { [root]: { unavailable: "docker" } }, {}, false, null],
      ["check 1 SKIP in a worktree: the derived name", wt, { [wt]: { unavailable: "plugin" } }, {}, false, n],
      ["check 2: this worktree's own run failed", wt, { ...ok, [wt]: { cfg: { error: "boom" }, plain: "feat-t" } }, {}, true, n],
      ["check 2: the run that names the main checkout failed", root, { ...ok, [root]: { error: "boom" } }, {}, true, null],
      ["check 2: the main checkout's run failed, seen from a worktree", wt, { ...ok, [root]: { error: "boom" } }, {}, true, null],
      ["check 3: the name is held", wt, ok, { COMPOSE_PROJECT_NAME: "app-prod" }, true, null],
      ["check 4: a run without -p lands on a held name", wt, { ...ok, [wt]: "app-prod" }, {}, true, n],
      ["check 5: a stack of the name runs elsewhere", wt, ps(n), {}, true, null],
      ["check 5: a stack of another answer runs elsewhere", wt, ps("feat-t"), {}, true, n],
      ["check 6: the main checkout's name is a worktree's derived name", root, { ...ok, [root]: n }, {}, true, null],
      ["check 0b: the shell's COMPOSE_PROJECT_NAME is no Compose name, in a worktree", wt, ok, { COMPOSE_PROJECT_NAME: "Bad Name" }, true, null],
      ["check 0b: the shell's COMPOSE_PROJECT_NAME is no Compose name, in the main checkout", root, ok, { COMPOSE_PROJECT_NAME: "_x" }, true, null],
      ["check 0b: an invalid shell name, Compose unavailable", wt, { [wt]: { unavailable: "plugin" } }, { COMPOSE_PROJECT_NAME: "UPPER" }, true, null],
      ["check 0c: git worktree list failed, in a worktree", wt, unlisted, {}, true, null],
      ["check 0c: git worktree list failed, Compose unavailable", wt, (cmd, args, opts) => (isComposeVersionCall(cmd, args) ? { code: null, stdout: "", stderr: "", timedOut: false, notFound: true } : unlisted(cmd, args, opts)), {}, true, null],
      ["check 0c: git worktree list failed, in the main checkout", root, unlisted, {}, true, null],
      ["check 0c: git worktree list lacks the main checkout", wt, (cmd, args, opts) => (cmd === "git" && args[0] === "worktree" && args[1] === "list" ? { code: 0, stdout: `worktree ${wt}\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/feat-t\n\n`, stderr: "", timedOut: false } : stub(cmd, args, opts)), {}, true, null],
      ["check 0c: git worktree list leads with this worktree", wt, listed(`${entry(wt)}${entry(root)}`), {}, true, null],
      ["check 0c: git worktree list holds only the main checkout, in a worktree", wt, listed(entry(root)), {}, true, null],
    ];
    for (const [source, cwd, how, env, fails, name] of rows) {
      const go = (args: string[]) => (typeof how === "function" ? check(cwd, args, env, how) : checkC(cwd, how, args, env));
      const p = go(["--compose-project"]);
      const full = go([]);
      const got = { exit: p.code, out: p.out, warned: p.err.includes("env-check: warning: "), full: full.code, local: full.lines.find((l) => l.startsWith("PASS d.p")) };
      expect([source, got]).toEqual([source, { exit: name ? 0 : 1, out: name ?? "", warned: fails && name !== null, full: fails ? 1 : 0, local: `PASS d.p  project=[${name ?? ""}]` }]);
    }
  });

  it("--static and CI=true never run docker; --compose-project asks Compose under either", () => {
    const root = setup(test('inputs = ["compose.yml"]\n'), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "feat-s");
    const noDocker: Runner = (cmd, args, opts) => {
      if (cmd === "docker") throw new Error(`docker ${args.join(" ")} ran`);
      return run(cmd, args, opts);
    };
    for (const [args, env] of [[["--static"], {}], [[], { CI: "true" }], [["--static"], { CI: "true" }]] as [string[], Record<string, string>][]) {
      for (const cwd of [root, wt]) expect([args, env, check(cwd, args, env, noDocker).code]).toEqual([args, env, 0]);
      const m = checkC(root, { [root]: "app-prod" }, ["--compose-project", ...args], env);
      const w = checkC(wt, { [root]: "app-prod", [wt]: "feat-s" }, ["--compose-project", ...args], env);
      expect([args, env, m.code, m.out, w.code, w.out, m.calls.length > 0, w.calls.length > 0]).toEqual([args, env, 0, "app-prod", 0, "feat-s", true, true]);
    }
  });

  it("checks a worktree's runs without the shell's COMPOSE_* against its derived name too, and its configured run's directory name only from the root", () => {
    const root = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-d");
    const slug = checkC(wt, { [root]: "app-node", [wt]: "feat-d" }, ["--compose-project"]).out;
    expect(slug).toMatch(/^app-node-feat-d-[0-9a-f]{6}$/);
    // The shell exports another name; without it the .env names the derived one: an own name, so PASS.
    const W = { [wt]: { cfg: "feat", plain: "feat", scrubbed: slug } };
    expect(checkC(wt, { [root]: "app-node", ...W }, [], { COMPOSE_PROJECT_NAME: "feat" }).out).toContain("PASS e.project  feat (COMPOSE_PROJECT_NAME)");
    // A configured file in a subdirectory: its directory name (shared by every checkout) is no own name, held or not.
    const sub = setup(`${HEAD}[compose]\nmode = "test"\nfiles = ["docker/dev.yml"]\nderive = "slug-hash"\n`, { "docker/dev.yml": "services: {}\n" });
    commit(sub);
    const ws = worktree(sub, "feat-s");
    const at = (dir: string, cfg: ComposeAnswer): ComposeAnswers => ({ [dir]: { cfg, plain: NO_FILE }, [join(dir, "docker")]: NO_FILE });
    const r = checkC(ws, { ...at(sub, "app-node"), ...at(ws, "docker") }, ["--compose-project"]);
    const n = "app-node-feat-s-[0-9a-f]{6}";
    expect([r.code, r.out, r.err]).toEqual([0, expect.stringMatching(new RegExp(`^${n}$`)), expect.stringMatching(new RegExp(`env-check: warning: configured run would use project docker, not ${n} — fix: add COMPOSE_PROJECT_NAME=${n} to ${ws}/docker/\\.env, or export it, or always pass -p ${n}`))]);
    // From the root, the worktree's own directory name (Compose's default) is an own name.
    const root2 = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    commit(root2);
    const w2 = worktree(root2, "feat-r");
    expect(checkC(w2, { [root2]: "app-node", [w2]: "feat-r" }).out).toMatch(/PASS e\.project {2}app-node-feat-r-[0-9a-f]{6} \(derived: slug-hash\)/);
  });

  it("fails in the main checkout whose name is a worktree's derived name, withholding it", () => {
    const root = setup(test(), { "compose.yml": "services: {}\n" });
    commit(root);
    // A worktree in another parent directory named like the main checkout derives its name.
    const wt = worktree(root, "app-node");
    const calls: ComposeCall[] = [];
    const r = check(root, ["--compose-project"], {}, composeStub({ [root]: "app-node" }, calls));
    expect([r.code, r.out, r.err]).toEqual([1, "", expect.stringContaining(`env-check: this checkout would use project app-node, which worktree ${wt} uses — fix: export another COMPOSE_PROJECT_NAME, set derive = "slug-hash" in ${CFG}, or rename worktree ${wt}`)]);
    expect(calls.every((c) => rp(c.cwd) === root)).toBe(true);
  });

  it("probes the main checkout's plain run even when it lacks this branch's configured files", () => {
    const sub = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/compose.yml"]\n`;
    const root = setup(sub, { "deploy/compose.yml": "services: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-m");
    // The main checkout's branch keeps its stack in compose.yml at the root: plain Compose starts as near deploy/ as it can.
    rmSync(join(root, "deploy"), { recursive: true });
    put(root, "compose.yml", COMPOSE);
    const W = { [wt]: "app-prod", [join(wt, "deploy")]: "app-prod" };
    const r = checkC(wt, { [root]: "app-prod", ...W }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  this worktree would use project app-prod, which the main checkout uses")]);
    const D = join(wt, "deploy");
    expect(r.calls.map((c) => [rp(c.cwd), c.files])).toEqual([[wt, ["deploy/compose.yml"]], [wt, ["deploy/compose.yml"]], [D, []], [D, []], [wt, []], [wt, []], [root, []]]);
    // Finding no file there at all, the main checkout runs nothing: no prod name to take.
    rmSync(join(root, "compose.yml"));
    expect(checkC(wt, { [root]: NO_FILE, ...W }, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(0);
  });

  it("derives the name from the first compose file's directory, as Compose does", () => {
    const sub = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/compose.yml"]\n`;
    const root = setup(sub, { "deploy/compose.yml": "services: {}\n" });
    commit(root);
    const at = (dir: string, cfg: string, plain = cfg): ComposeAnswers => ({ [dir]: { cfg, plain: NO_FILE }, [join(dir, "deploy")]: plain });
    expect(checkC(root, at(root, "deploy"), ["--compose-project"]).out).toBe("deploy");
    // The .env Compose reads sits beside the first compose file, not at the repo root.
    put(root, ".env", "COMPOSE_PROJECT_NAME=fromroot\n");
    put(root, "deploy/.env", "COMPOSE_PROJECT_NAME=fromdeploy\n");
    expect(checkC(root, at(root, "fromdeploy"), ["--compose-project"]).out).toBe("fromdeploy");
    rmSync(join(root, ".env"));
    rmSync(join(root, "deploy/.env"));
    // Every worktree's configured run is project deploy too: the main checkout's. Plain runs are probed from the first
    // configured file's directory and from the root, so the main checkout's plain name is deploy as well.
    const wt = worktree(root, "feat-d");
    const r = checkC(wt, { ...at(wt, "deploy"), ...at(root, "deploy") });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  this worktree would use project deploy, which the main checkout uses")]);
    const D = (x: string) => join(x, "deploy");
    expect(r.calls.map((c) => [rp(c.cwd), c.files])).toEqual([[wt, ["deploy/compose.yml"]], [D(wt), []], [wt, []], [root, ["deploy/compose.yml"]], [D(root), []], [root, []]]);
    // slug-hash names worktrees only; the main checkout keeps Compose's default.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    expect(checkC(slug, { [slug]: "app-node" }, ["--compose-project"]).out).toBe("app-node");
  });

  it("treats a run that finds no compose file as no answer, in any checkout, and checks a worktree's configured run too", () => {
    // Only deploy/stack.yml: plain docker compose in deploy/ (and at the root) finds nothing, so it runs nothing.
    const only = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/stack.yml"]\nderive = "slug-hash"\n`;
    const root = setup(only, { "deploy/stack.yml": "services: {}\n" });
    commit(root);
    const peer = worktree(root, "feat-p");
    const wt = worktree(root, "feat-s");
    const at = (dir: string, cfg: ComposeAnswer, plain: ComposeAnswer = NO_FILE): ComposeAnswers => ({ [dir]: { cfg, plain: NO_FILE }, [join(dir, "deploy")]: plain });
    const A = { ...at(root, "deploy"), ...at(peer, "deploy"), ...at(wt, "deploy") };
    const slug = "app-node-feat-s-[0-9a-f]{6}";
    // The worktree's own configured run (no -p) lands on the main checkout's project deploy: a FAIL that keeps the name.
    const r = checkC(wt, A);
    expect([r.code, r.out]).toEqual([1, expect.stringMatching(new RegExp(`FAIL e\\.project {2}configured run would use project deploy, which the main checkout uses — fix: add COMPOSE_PROJECT_NAME=${slug} to ${wt}/deploy/\\.env, or export it, or always pass -p ${slug}`))]);
    const D = (x: string) => join(x, "deploy");
    expect(r.calls.map((c) => [rp(c.cwd), c.files])).toEqual([[wt, ["deploy/stack.yml"]], [D(wt), []], [wt, []], [root, ["deploy/stack.yml"]], [D(root), []], [root, []], [peer, ["deploy/stack.yml"]], [D(peer), []], [peer, []]]);
    expect(checkC(wt, A, ["--compose-project"]).out).toMatch(new RegExp(`^${slug}$`));
    // A default-named file in deploy/ gives plain docker compose there the main checkout's name: the FAIL names the .env that run reads.
    const sub = setup(only.replace("stack.yml", "compose.yml"), { "deploy/compose.yml": "services: {}\n" });
    commit(sub);
    const ws = worktree(sub, "feat-s");
    const p = checkC(ws, { ...at(sub, "deploy", "deploy"), ...at(ws, "deploy", "deploy") });
    expect([p.code, p.out]).toEqual([1, expect.stringMatching(new RegExp(`FAIL e\\.project {2}project-dir plain run would use project deploy, which the main checkout uses — fix: add COMPOSE_PROJECT_NAME=${slug} to ${ws}/deploy/\\.env`))]);
    // The not-found line is no answer from a configured probe too: that run starts nothing.
    const f = checkC(wt, { ...A, ...at(wt, NO_FILE) });
    expect([f.code, f.out]).toEqual([0, expect.stringMatching(new RegExp(`PASS e\\.project {2}${slug} \\(derived: slug-hash\\)`))]);
    // Generated by /ship test-coverage audit (Step 7).
    // Value: protects=the main checkout's configured run finding no compose file FAILs naming that run and withholds the name;
    //   fails_when=the noFile guard goes and it falls through to "no project name derives from directory"; why_new=no test
    //   asserted this message; seam=none; no_claim=real Compose printing not-found for a -f probe (stubbed answer; unit only)
    const m = checkC(root, { ...A, ...at(root, NO_FILE) });
    expect([m.code, m.out]).toEqual([1, expect.stringContaining(`FAIL e.project  this checkout's configured run: docker compose config found no compose file — fix: fix [compose] files in ${CFG}`)]);
    expect(checkC(root, { ...A, ...at(root, NO_FILE) }, ["--compose-project"])).toMatchObject({ code: 1, out: "" });
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
    expect([prod.code, prod.out]).toEqual([1, expect.stringContaining(`FAIL e.project  this worktree would use project app-prod, which the main checkout uses — fix: export another COMPOSE_PROJECT_NAME, set derive = "slug-hash" in ${CFG}, or rename the main checkout`)]);
    const plain = setup(test(), { "compose.yml": "services: {}\n" });
    commit(plain);
    const d1 = worktree(plain, "dup");
    const d2 = worktree(plain, "dup");
    const dup = checkC(d2, { [plain]: "app-node", [d1]: "dup", [d2]: "dup" });
    expect(dup.out).toMatch(/FAIL e\.project {2}this worktree would use project dup, which worktree .*dup uses/);
    // The prod name is the main checkout's answer, even when the worktree's compose file declares another.
    const renamed = worktree(root, "app-prod");
    put(renamed, "compose.yml", COMPOSE.replace("app-prod", "app-other"));
    expect(checkC(renamed, { [root]: "app-prod", [renamed]: "app-other", [wt]: "app-prod" }).out).toContain("FAIL e.project  this worktree would use project app-prod, which the main checkout uses");
    // With no compose file in the main checkout there is no prod stack, so the worktree's own name: is its own (earlier releases counted it as prod).
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
    expect([shell.code, shell.out]).toEqual([1, expect.stringContaining(`FAIL e.project  this worktree would use project ${prod}, which the main checkout uses`)]);
    // A .env naming the main checkout's project: -p feat-a stays safe, but a run without -p lands on prod.
    put(wt, ".env", `COMPOSE_PROJECT_NAME=${prod}\n`);
    const env = checkC(wt, { [root]: prod, [wt]: prod }, ["--compose-project"]);
    expect([env.code, env.out, env.err]).toEqual([0, "feat-a", expect.stringContaining(`env-check: warning: configured run would use project ${prod}, which the main checkout uses — fix: add COMPOSE_PROJECT_NAME=feat-a to ${wt}/.env`)]);
    rmSync(join(wt, ".env"));
    // Its own name: is not the main checkout's, but docker compose there without -p still runs as feat-stack, not feat-a.
    const own = checkC(wt, { [root]: prod, [wt]: "feat-stack" });
    expect([own.code, own.out]).toEqual([1, expect.stringContaining(`FAIL e.project  configured run would use project feat-stack, not feat-a — fix: add COMPOSE_PROJECT_NAME=feat-a to ${wt}/.env, or export it, or always pass -p feat-a`)]);
    put(wt, ".env", "COMPOSE_PROJECT_NAME=feat-a\n");
    expect(checkC(wt, { [root]: prod, [wt]: "feat-a" }).out).toContain("PASS e.project  feat-a (derived: dirname)");
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
    // Its line is not copied (it can echo an interpolated secret): the fix is the command that shows it.
    const dash = withName("${STACK_NAME-app-prod}");
    const r0 = checkC(dash, { [dash]: EMPTY }, [], { STACK_NAME: "" });
    expect([r0.code, r0.out]).toEqual([1, expect.stringContaining(`FAIL e.project  this checkout's configured run: docker compose config exited 1 — fix: ${RERUN(dash)}`)]);
    expect(r0.out).not.toContain(EMPTY.error);
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
      expect([n, r.code, r.out]).toEqual([n, 1, expect.stringContaining("FAIL e.project  this checkout's configured run: docker compose config exited 1")]);
    }
    // A worktree on the main stack's interpolated default is the prod name.
    const root = withName("${STACK_NAME:-app-prod}");
    commit(root);
    const wt = worktree(root, "feat-z");
    const clash = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  this worktree would use project app-prod, which the main checkout uses")]);
    // The shell's STACK_NAME reaches every checkout's probe (it is not a COMPOSE_* variable): main and worktree both run as x.
    const mainBad = withName("${STACK_NAME}");
    commit(mainBad);
    const fw = worktree(mainBad, "feat-w");
    expect(checkC(fw, { [mainBad]: "x", [fw]: "x" }, [], { STACK_NAME: "x" }).out).toContain("FAIL e.project  configured run would use project x, which the main checkout uses");
    expect(checkC(fw, { [mainBad]: "x", [fw]: "feat-w" }, [], { STACK_NAME: "x", COMPOSE_PROJECT_NAME: "feat-w" }).code).toBe(0);
    // The main checkout's name: cannot resolve: that probe's failure is the FAIL (earlier releases said "cannot be resolved").
    put(mainBad, "compose.yml", "name: ${OTHER}\nservices: {}\n");
    const fv = worktree(mainBad, "feat-v");
    expect(checkC(fv, { [mainBad]: EMPTY, [fv]: "x", [fw]: "x" }, [], { STACK_NAME: "x" }).out).toContain("FAIL e.project  the main checkout's configured run: docker compose config exited 1");
  });

  it("fails e.project in every other worktree, not in the main checkout, when Compose fails on a peer worktree's files", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    const answers = { [root]: "app-prod", [a]: "feat-a", [b]: { error: "required variable STACK is missing a value: set it" } };
    // The peer's own shell decides its name, so the rerun command drops this shell's COMPOSE_*; the name is withheld.
    const r = checkC(a, answers, ["--compose-project"], { COMPOSE_PROJECT_NAME: "feat-a" });
    expect([r.code, r.out, r.err]).toEqual([1, "", expect.stringContaining(`env-check: worktree ${b}'s configured run: docker compose config exited 1 — fix: rerun to see Compose's error: cd ${b} && env -u COMPOSE_PROJECT_NAME ${OFF_ENV} docker compose -f compose.yml config --no-env-resolution -q`)]);
    // The main checkout does not probe peers: their derived names are all it holds against (each peer reports the rest).
    const m = checkC(root, answers);
    expect([m.code, m.out, m.calls.every((c) => rp(c.cwd) === root)]).toEqual([0, expect.stringContaining("PASS e.project  app-prod (compose)"), true]);
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
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  this worktree would use project live, which the main checkout uses")]);
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
      expect([empty, r.code, r.out]).toEqual([empty, 0, expect.stringContaining("PASS e.project  app-node (compose)")]);
    }
    const interp = setup(test(), { "compose.yml": "name: ${STACK_NAME:-}\nservices: {}\n" });
    expect(checkC(interp, { [interp]: EMPTY }).out).toContain("FAIL e.project  this checkout's configured run: docker compose config exited 1");
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
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  this worktree would use project my_app, which the main checkout uses")]);
    // Compose validates a COMPOSE_PROJECT_NAME instead of normalizing it.
    const upper = checkC(wt, { [root]: "my_app", [wt]: invalid("My_App") }, [], { COMPOSE_PROJECT_NAME: "My_App" });
    expect([upper.code, upper.out]).toEqual([1, expect.stringContaining('FAIL e.project  your shell\'s COMPOSE_PROJECT_NAME "My_App" is not a Compose project name')]);
    expect(upper.calls).toEqual([]);
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
    // The worktree has no .env, so Compose cannot name its run: a FAIL, but -p feat-r is still safe, so the name is kept.
    const own = checkC(wt, { [wt]: EMPTY, [root]: "live" }, ["--compose-project"]);
    expect([own.code, own.out, own.err]).toEqual([0, "feat-r", expect.stringContaining(`env-check: warning: this worktree's configured run: docker compose config exited 1 — fix: ${RERUN(wt)}`)]);
    // With its own COMPOSE_PROJECT_NAME that name: is irrelevant, and the prod name is main's resolved one.
    put(wt, ".env", "COMPOSE_PROJECT_NAME=feat-r\n");
    expect(checkC(wt, { [wt]: "feat-r", [root]: "live" }).out).toContain("PASS e.project  feat-r (derived: dirname)");
    const clash = checkC(wt, { [wt]: "live", [root]: "live" }, [], { COMPOSE_PROJECT_NAME: "live" });
    expect([clash.code, clash.out]).toEqual([1, expect.stringContaining("FAIL e.project  this worktree would use project live, which the main checkout uses")]);
    // A main checkout whose COMPOSE_PROJECT_NAME overrides the file does not need the file's name to resolve.
    const bare = setup(test(), { "compose.yml": "name: ${STACK_NAME}\nservices: {}\n" });
    const viaShell = checkC(bare, { [bare]: "chosen" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "chosen" });
    expect([viaShell.code, viaShell.out]).toEqual([0, "chosen"]);
    put(bare, ".env", "COMPOSE_PROJECT_NAME=fromenv\n");
    expect(checkC(bare, { [bare]: "fromenv" }).out).toContain("PASS e.project  fromenv (compose)");
  });

  it("uses the last name: across the ordered compose files, in the worktree and the main checkout", () => {
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.override.yml"]\n`;
    const root = setup(two, { "compose.yml": "name: app-base\n", "compose.override.yml": "name: app-prod\nservices: {}\n" });
    commit(root);
    expect(checkC(root, { [root]: "app-prod" }, ["--compose-project"]).out).toBe("app-prod");
    // The worktree's own override declares the prod name: clash, though its first file says app-base.
    const wt = worktree(root, "feat-o");
    const both = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([both.code, both.out]).toEqual([1, expect.stringContaining("this worktree would use project app-prod, which the main checkout uses")]);
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
    expect([doc, r.code, r.out]).toEqual([doc, 1, expect.stringContaining("FAIL e.project  this worktree would use project app-prod, which the main checkout uses")]);
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
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.project  app-prod (compose)")]);
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
    // (earlier releases failed closed on it).
    const nope = setup(test(), { "compose.yml": COMPOSE });
    put(nope, ".env", "COMPOSE_PROJECT_NAME=${NOPE}\n");
    const own = checkC(nope, { [nope]: "app-prod" });
    expect([own.code, own.out]).toEqual([0, expect.stringContaining("PASS e.project  app-prod (compose)")]);
    put(root, ".env", "COMPOSE_PROJECT_NAME=${NOPE}\n");
    const fromWt = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" });
    expect([fromWt.code, fromWt.out]).toEqual([1, expect.stringContaining("FAIL e.project  configured run would use project app-prod, which the main checkout uses")]);
    // Single-quoted (literal) is a name Compose rejects.
    put(root, ".env", "STACK=live\nCOMPOSE_PROJECT_NAME='${STACK}'\n");
    const lit = checkC(root, { [root]: invalid("${STACK}"), [wt]: "app-prod" }, ["--compose-project"]);
    expect([lit.code, lit.out, lit.err]).toEqual([1, "", expect.stringContaining("this checkout's configured run: docker compose config exited 1")]);
  });

  it("rejects an invalid COMPOSE_PROJECT_NAME instead of normalizing it, as Compose does", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    for (const bad of ["UPPER.INVALID", "---", "Upper"]) {
      // loops withholds the name before any probe, naming Compose's rule; Compose's own line is not shown.
      const p = checkC(root, { [root]: invalid(bad) }, ["--compose-project"], { COMPOSE_PROJECT_NAME: bad });
      const why = `your shell's COMPOSE_PROJECT_NAME ${JSON.stringify(bad)} is not a Compose project name (lowercase letters, digits, - and _, starting with a letter or digit)`;
      expect([bad, p.code, p.out, p.err, p.calls]).toEqual([bad, 1, "", `env-check: ${why} — fix: export a COMPOSE_PROJECT_NAME of that form, or unset it`, []]);
      expect(p.err).not.toContain("invalid project name");
      expect(checkC(root, { [root]: invalid(bad) }, [], { COMPOSE_PROJECT_NAME: bad }).out).toContain(`FAIL e.project  ${why}`);
    }
    const wt = worktree(root, "feat-c");
    put(wt, ".env", "COMPOSE_PROJECT_NAME=My.App\n");
    expect(checkC(wt, { [wt]: invalid("My.App"), [root]: "app-prod" }).code).toBe(1);
    rmSync(join(wt, ".env"));
    put(root, ".env", "COMPOSE_PROJECT_NAME=Prod.App\n");
    expect(checkC(wt, { [wt]: "feat-c", [root]: invalid("Prod.App") }).out).toContain("FAIL e.project  the main checkout's configured run: docker compose config exited 1");
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
      // An anchor shared across documents resolves too (earlier releases failed closed on it).
      "x-n: &n app-prod\nservices: {}\n---\nname: *n\n",
    ];
    for (const doc of docs) namedProd(doc, "feat-y");
  });

  it("fails closed on a compose file that is not valid YAML, not a mapping in every document, or has a non-string name:", () => {
    // Each error line is Compose's own; <root> is the checkout path. None of it reaches a Result.
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
      const r = checkC(root, { [root]: { error: why } });
      expect([doc, r.code, r.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  this checkout's configured run: docker compose config exited 1 — fix: ${RERUN(root)}`)]);
      expect([doc, r.out.includes(why.split("<root>").pop()!)]).toEqual([doc, false]);
      // The worktree's own copy fails (keeping -p app-prod); once it is fixed, the main checkout's still decides the prod name.
      const w = worktree(root, "feat-y");
      const own = checkC(w, { [w]: { error: why }, [root]: "app-prod" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "mine" });
      expect([doc, own.code, own.out, own.err]).toEqual([doc, 0, "mine", expect.stringContaining("env-check: warning: this worktree's configured run: docker compose config exited 1")]);
      put(w, "compose.yml", "services: {}\n");
      const wt = checkC(w, { [w]: "app-prod", [root]: { error: why } }, [], { COMPOSE_PROJECT_NAME: "app-prod" });
      expect([doc, wt.code, wt.out]).toEqual([doc, 1, expect.stringContaining("FAIL e.project  the main checkout's configured run: docker compose config exited 1")]);
    }
    // Compose: a binary-tagged scalar decodes to the string app, which is a valid name.
    const bin = setup(test(), { "compose.yml": "name: !!binary YXBw\nservices: {}\n" });
    expect(checkC(bin, { [bin]: "app" }, ["--compose-project"]).out).toBe("app");
    // Compose rejects the whole project, so a later file's name: does not rescue it.
    const two = `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml", "compose.override.yml"]\n`;
    const t = setup(two, { "compose.yml": "name: 123\n", "compose.override.yml": "name: app-prod\n" });
    const r = checkC(t, { [t]: { error: notString("<root>") } });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.project  this checkout's configured run: docker compose config exited 1 — fix: ${RERUN(t, ["compose.yml", "compose.override.yml"])}`)]);
  });

  it("fails in a worktree whose committed name: makes docker compose without -p use the prod project", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "s3-wt");
    const r = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.project  configured run would use project app-prod, which the main checkout uses — fix: add COMPOSE_PROJECT_NAME=s3-wt to ${wt}/.env, or export it, or always pass -p s3-wt`)]);
    expect(r.out).toContain("FAIL e.project  root plain run would use project app-prod, which the main checkout uses");
    // The worktree's own COMPOSE_PROJECT_NAME (its .env, or the shell) makes it safe.
    put(wt, ".env", "COMPOSE_PROJECT_NAME=s3-wt\n");
    expect(checkC(wt, { [root]: "app-prod", [wt]: "s3-wt" }).out).toContain("PASS e.project  s3-wt (derived: dirname)");
    const s4 = worktree(root, "s4-wt");
    expect(checkC(s4, { [root]: "app-prod", [wt]: "s3-wt", [s4]: "s4" }, [], { COMPOSE_PROJECT_NAME: "s4" }).out).toContain("PASS e.project  s4 (COMPOSE_PROJECT_NAME)");
    // Under slug-hash too: the worktree's Compose name is its file's name:, not the derived one.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": COMPOSE });
    commit(slug);
    const ws = worktree(slug, "feat-s");
    const s = checkC(ws, { [slug]: "app-prod", [ws]: "app-prod" });
    expect([s.code, s.out]).toEqual([1, expect.stringMatching(new RegExp(`FAIL e\\.project {2}configured run would use project app-prod, which the main checkout uses — fix: add COMPOSE_PROJECT_NAME=app-node-feat-s-[0-9a-f]{6} to ${ws}/\\.env`))]);
  });

  it("--compose-project still hands over the safe -p name when only docker compose without -p would clash", () => {
    const root = setup(test(), { "compose.yml": COMPOSE });
    commit(root);
    const wt = worktree(root, "s3-wt");
    // -p s3-wt is safe there, so --compose-project still hands it over, warning on stderr.
    const p = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, ["--compose-project"]);
    expect([p.code, p.out]).toEqual([0, "s3-wt"]);
    expect(p.err).toContain(`env-check: warning: configured run would use project app-prod, which the main checkout uses — fix: add COMPOSE_PROJECT_NAME=s3-wt to ${wt}/.env`);
    // A real reuse of the prod name yields no name, and stderr carries the fix.
    const reuse = checkC(wt, { [root]: "app-prod", [wt]: "app-prod" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "app-prod" });
    expect([reuse.code, reuse.out, reuse.err]).toEqual([1, "", expect.stringContaining("env-check: this worktree would use project app-prod, which the main checkout uses — fix: export another COMPOSE_PROJECT_NAME")]);
    // The full run still fails; local checks get the kept name, b.containers does not run.
    put(root, CFG, test('inputs = ["compose.yml"]\n') + local(root, "d.p", 'echo "PASS d.p project=[$ENV_CHECK_PROJECT]"'));
    commit(root);
    const wp = worktree(root, "s5-wt");
    const calls: string[][] = [];
    const docker: Runner = (cmd, args, opts) => (cmd === "docker" ? (calls.push(args), { code: 0, stdout: "", stderr: "", timedOut: false }) : run(cmd, args, opts));
    const full = check(wp, [], {}, composeStub({ [root]: "app-prod", [wt]: "app-prod", [wp]: "app-prod" }, [], docker));
    // Only e.project's one `docker ps -a` (running stacks); b.containers gets no project.
    expect([full.code, calls.map((a) => a.slice(0, 2))]).toEqual([1, [["ps", "-a"]]]);
    expect(full.out).toContain("PASS d.p  project=[s5-wt]");
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
    expect([plain.code, plain.out]).toEqual([1, expect.stringContaining("FAIL e.project  root plain run would use project app-prod, which the main checkout uses")]);
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

    // An empty COMPOSE_FILE, or one naming a missing file, makes a plain run fail, whatever names the project; -f is
    // unaffected, so -p feat-sub stays safe and the name is kept.
    const bad: [string, string][] = [["", "read <root>: is a directory"], ["gone.yml:compose.yml", "stat <root>/gone.yml: no such file or directory"]];
    for (const [cf, why] of bad) {
      const A = { [sub]: "fromroot", [w3]: { cfg: "feat-sub", plain: { error: why } } };
      const r = checkC(w3, A, [], { COMPOSE_FILE: cf });
      expect([cf, r.code, r.out]).toEqual([cf, 1, expect.stringContaining("FAIL e.project  this worktree's root plain run: docker compose config exited 1")]);
      expect([cf, checkC(w3, A, ["--compose-project"], { COMPOSE_FILE: cf })]).toMatchObject([cf, { code: 0, out: "feat-sub" }]);
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
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  this worktree would use project app-prod, which the main checkout uses")]);
    // A copied override makes plain docker compose in the worktree hit prod.
    put(wt, "compose.override.yml", "name: app-prod\n");
    expect(checkC(wt, { [root]: M, [wt]: { cfg: "feat-two", plain: "app-prod" } }).out).toContain("FAIL e.project  root plain run would use project app-prod, which the main checkout uses");
    put(wt, "compose.override.yml", "services: {}\n");
    // An override Compose cannot read fails closed, without Compose's line.
    put(root, "compose.override.yml", "name: [x]\n");
    const badOvr = { cfg: "app-node", plain: { error: "line 1: cannot construct !!seq into string" } };
    expect(checkC(wt, { [root]: badOvr, [wt]: "feat-two" }, [], { COMPOSE_PROJECT_NAME: "feat-two" }).out).toContain("FAIL e.project  the main checkout's root plain run: docker compose config exited 1");

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
    const W = (n: string) => ({ [w3]: n, [join(w3, "deploy")]: n });
    expect(checkC(w3, { ...U, ...W("feat-up") }, [], { COMPOSE_PROJECT_NAME: "feat-up" }).out).toContain("PASS e.project  feat-up (COMPOSE_PROJECT_NAME)");
    expect(checkC(w3, { ...U, ...W("app-prod") }, [], { COMPOSE_PROJECT_NAME: "app-prod" }).code).toBe(1);
    // The .env beside the file it found names that run too (deploy/ has none, so Compose reads the root's).
    put(up, ".env", "COMPOSE_PROJECT_NAME=app-live\n");
    expect(checkC(w3, { ...U, [join(up, "deploy")]: "app-live", ...W("app-live") }, [], { COMPOSE_PROJECT_NAME: "app-live" }).code).toBe(1);
  });

  it("fails in worktrees that share a committed name: when the main checkout's .env overrides it", () => {
    for (const [doc, env] of [["name: app-x", "COMPOSE_PROJECT_NAME=prod"], ["name: ${STACK:-app-x}", "STACK=prod"]] as const) {
      const root = setup(test(), { "compose.yml": `${doc}\nservices:\n  web:\n    image: x\n`, ".gitignore": ".env\n" });
      commit(root);
      put(root, ".env", `${env}\n`);
      const a = worktree(root, "feat-a");
      const b = worktree(root, "feat-b");
      expect([doc, checkC(root, { [root]: "prod", [a]: "app-x", [b]: "app-x" }).out]).toEqual([doc, expect.stringContaining("PASS e.project  prod (compose)")]);
      const r = checkC(a, { [root]: "prod", [a]: "app-x", [b]: "app-x" });
      // feat-b runs as app-x without -p too, so app-x is held by that worktree.
      const why = `configured run would use project app-x, which worktree ${b} uses`;
      expect([doc, r.code, r.out]).toEqual([doc, 1, expect.stringContaining(`FAIL e.project  ${why} — fix: add COMPOSE_PROJECT_NAME=feat-a to ${a}/.env`)]);
      put(a, ".env", "COMPOSE_PROJECT_NAME=feat-a\n");
      expect([doc, checkC(a, { [root]: "prod", [a]: "feat-a", [b]: "app-x" }).out]).toEqual([doc, expect.stringContaining("PASS e.project  feat-a (derived: dirname)")]);
    }
  });

  it("counts a peer worktree's answer as taken", () => {
    const root = setup(test(), { "compose.yml": "name: app-x\nservices: {}\n", ".gitignore": ".env\n" });
    commit(root);
    put(root, ".env", "COMPOSE_PROJECT_NAME=prod\n");
    const a = worktree(root, "feat-a");
    const b = worktree(root, "feat-b");
    // feat-b has no .env, so docker compose there runs as app-x.
    const r = checkC(a, { [root]: "prod", [a]: "app-x", [b]: "app-x" }, [], { COMPOSE_PROJECT_NAME: "app-x" });
    expect([r.code, r.out]).toEqual([1, expect.stringMatching(/FAIL e\.project {2}this worktree would use project app-x, which worktree .*feat-b uses/)]);
    // Under slug-hash, two worktrees with one directory name both run docker compose as that name.
    const slug = setup(test('derive = "slug-hash"\n'), { "compose.yml": "services: {}\n" });
    commit(slug);
    const s1 = worktree(slug, "feat-s");
    expect(checkC(s1, { [slug]: "app-node", [s1]: "feat-s" }).code).toBe(0);
    const s2 = worktree(slug, "feat-s");
    const s = checkC(s1, { [slug]: "app-node", [s1]: "feat-s", [s2]: "feat-s" });
    expect([s.code, s.out]).toEqual([1, expect.stringMatching(/FAIL e\.project {2}root plain run would use project feat-s, which worktree .*feat-s uses/)]);
  });

  it("an empty shell COMPOSE_PROJECT_NAME hides the .env one, as Compose does, so the worktree is asked without it too", () => {
    const root = setup(test(), { "compose.yml": "name: production\nservices: {}\n" });
    commit(root);
    const wt = worktree(root, "feat-e");
    // A worktree .env naming another project than the derived one: -p feat-e is safe, a run without -p is not.
    put(wt, ".env", "COMPOSE_PROJECT_NAME=test-stack\n");
    const other = checkC(wt, { [root]: "production", [wt]: "test-stack" });
    expect([other.code, other.out]).toEqual([1, expect.stringContaining(`FAIL e.project  configured run would use project test-stack, not feat-e — fix: add COMPOSE_PROJECT_NAME=feat-e to ${wt}/.env, or export it, or always pass -p feat-e`)]);
    // The empty value blocks .env, and name: applies: Compose names a run there production. Without the empty value the
    // .env's test-stack applies, which is not feat-e either.
    const W = { [wt]: { cfg: "production", plain: "production", scrubbed: "test-stack" } };
    const r = checkC(wt, { [root]: "production", ...W }, [], { COMPOSE_PROJECT_NAME: "" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.project  configured run would use project production, which the main checkout uses — fix: unset the empty COMPOSE_PROJECT_NAME, then add COMPOSE_PROJECT_NAME=feat-e to ${wt}/.env, or export it, or always pass -p feat-e`)]);
    expect(r.out).toContain("FAIL e.project  without your shell's COMPOSE_* (COMPOSE_PROJECT_NAME), configured run would use project test-stack, not feat-e — fix: unset the empty COMPOSE_PROJECT_NAME, then add");
    put(root, ".env", "COMPOSE_PROJECT_NAME=envprod\n");
    expect(checkC(root, { [root]: "envprod", [wt]: "test-stack" }, ["--compose-project"]).out).toBe("envprod");
    expect(checkC(root, { [root]: { cfg: "production", plain: "production", scrubbed: "envprod" }, [wt]: "test-stack" }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "" }).out).toBe("production");
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
      // Compose fails the developer's run the same way, COMPOSE_PROJECT_NAME or not; the main checkout's configured run withholds the name.
      const sh = checkC(root, { [root]: { error: why } }, ["--compose-project"], { COMPOSE_PROJECT_NAME: "foo" });
      expect([doc, sh.code, sh.out, sh.err]).toEqual([doc, 1, "", expect.stringContaining(`env-check: this checkout's configured run: docker compose config exited 1 — fix: ${RERUN(root)}`)]);
      // Its run without the shell's COMPOSE_* is rerun without them.
      expect(sh.err).toContain(`without your shell's COMPOSE_* (COMPOSE_PROJECT_NAME), this checkout's configured run: docker compose config exited 1 — fix: rerun to see Compose's error: cd ${root} && env -u COMPOSE_PROJECT_NAME ${OFF_ENV} docker compose -f compose.yml config`);
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
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  this worktree would use project app-prod, which the main checkout uses")]);
    const named = setup(test(), { "compose.yml": "name: ${STACK}\nservices: {}\n" });
    put(named, ".env", "STACK: app-live\nURL=http://x:1\n");
    expect(checkC(named, { [named]: "app-live" }, ["--compose-project"]).out).toBe("app-live");
  });

  it("does not count the main checkout's derived name as a clash when it runs under another name", () => {
    const sub = `${HEAD}[compose]\nmode = "test"\nfiles = ["deploy/compose.yml"]\n`;
    const root = setup(sub, { "deploy/compose.yml": "services: {}\n" });
    commit(root);
    put(root, "deploy/.env", "COMPOSE_PROJECT_NAME=foo\n");
    const at = (dir: string, n: string): ComposeAnswers => ({ [dir]: { cfg: n, plain: NO_FILE }, [join(dir, "deploy")]: n });
    expect(checkC(root, at(root, "foo"), ["--compose-project"]).out).toBe("foo");
    // The main checkout runs as foo, configured or plain (its plain run starts in deploy/, beside that .env), so a
    // worktree deriving deploy does not clash with it.
    const wd = worktree(root, "feat-d");
    const r = checkC(wd, { ...at(root, "foo"), ...at(wd, "deploy") });
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.project  deploy (derived: dirname)")]);
    // A second worktree really does collide on deploy: the peer holds its derived name.
    const we = worktree(root, "feat-e");
    expect(checkC(we, { ...at(root, "foo"), ...at(wd, "deploy"), ...at(we, "deploy") }).out).toMatch(/FAIL e\.project {2}this worktree would use project deploy, which worktree .*feat-d uses/);
    // A COMPOSE_PROJECT_NAME equal to the main checkout's directory name, while it runs under its name:, is no clash.
    const app = setup(test(), { "compose.yml": COMPOSE });
    commit(app);
    const wa = worktree(app, "app-wt");
    const a = checkC(wa, { [app]: "app-prod", [wa]: "app-node" }, [], { COMPOSE_PROJECT_NAME: "app-node" });
    expect([a.code, a.out]).toEqual([0, expect.stringContaining("PASS e.project  app-node (COMPOSE_PROJECT_NAME)")]);
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
      const r = checkC(wt, { [wt]: EMPTY, [root]: "app-node" }, ["--compose-project"]);
      expect([dir, r.code, r.out, r.err]).toEqual([dir, 1, "", expect.stringContaining(`env-check: no project name derives from directory ${dir}`)]);
    }
  });

  it("warns on a fixed container_name unless allowlisted, and reads files only under --static", () => {
    const files = { "compose.yml": `${COMPOSE}    container_name: web-1\n` };
    const root = setup(test(), files);
    const warn = checkC(root, { [root]: "app-prod" });
    expect([warn.code, warn.out]).toEqual([0, expect.stringContaining("WARN e.container_name  fixed container_name web-1 collides across worktrees")]);
    const allow = setup(test('allow_container_name = ["web-1"]\n'), files);
    expect(checkC(allow, { [allow]: "app-prod" }).out).toContain("PASS e.container_name");
    expect(checkC(setup(test(), files), {}, ["--static"]).out).toContain("PASS e.project  compose files present (project name not resolved in --static)");
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

describe("e.project running stacks", () => {
  const cfg = (derive = "dirname") => `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml"]\nderive = "${derive}"\n`;
  const files = { "compose.yml": "services:\n  web:\n    image: x\n" };
  const at = (wd: string, project: string) => ctr(wd, `${project}-web-1`, "2026-01-01T00:00:00Z", project);
  /** `check` with `docker compose config` stubbed and `docker ps` answering `ps`; e.project's lines, and the exit and name of --compose-project. */
  const stacks = (cwd: string, answers: ComposeAnswers, ps: RunResult, env: Record<string, string> = {}) => {
    const calls: string[][] = [];
    const runner = composeStub(answers, [], (cmd, args, opts) => (cmd === "docker" && args[0] === "ps" ? (calls.push(args), ps) : run(cmd, args, opts)));
    const full = check(cwd, [], env, runner);
    const p = check(cwd, ["--compose-project"], env, runner);
    return { text: full.lines.filter((l) => l.includes("e.project")).join("\n"), exit: p.code, name: p.out, err: p.err, calls };
  };

  it("finds the owner by real path and whole path segments: a symlinked root, a sibling clone, nested worktrees", () => {
    const root = setup(cfg(), files);
    commit(root);
    const wt = worktree(root, "w1", join(root, ".claude", "worktrees"));
    const answers = { [root]: "app-node", [wt]: "w1" };
    // The label carries the shell's path; git lists the real one. A directory since deleted resolves through its parent.
    const link = join(tmp(), "link");
    symlinkSync(dirname(root), link);
    expect(stacks(root, answers, listing(at(join(link, "app-node"), "app-node"), at(join(link, "app-node", "gone", "deploy"), "app-node")))).toMatchObject({ text: "PASS e.project  app-node (compose)", exit: 0, name: "app-node" });
    const upper = root.replace(/app-node$/, "APP-NODE");
    if (existsSync(upper)) expect(stacks(root, answers, listing(at(upper, "app-node"))).text).toBe("PASS e.project  app-node (compose)");
    // A sibling clone shares the prefix, not a path segment.
    const old = `${root}-old`;
    mkdirSync(old);
    const sib = stacks(root, answers, listing(at(old, "app-node")));
    expect(sib).toMatchObject({ exit: 1, name: "" });
    expect(sib.text).toBe(`FAIL e.project  project app-node was started from project directory ${old} (outside every checkout) — fix: export another COMPOSE_PROJECT_NAME; leave that stack to whoever runs it from ${old}`);
    // The longest containing root owns a directory: a nested worktree's stack is not the main checkout's.
    expect(stacks(root, answers, listing(at(join(wt, "sub"), "app-node"))).text).toContain(`FAIL e.project  project app-node was started from project directory ${wt}/sub (worktree ${wt})`);
    expect(stacks(wt, answers, listing(at(join(wt, "sub"), "w1"))).text).toBe("PASS e.project  w1 (derived: dirname)");
    expect(stacks(wt, answers, listing(at(root, "w1"))).text).toContain(`FAIL e.project  project w1 was started from project directory ${root} (the main checkout)`);
  });

  it("escapes a working_dir label in text rows and the --compose-project stderr line, which uses the text fix separator", () => {
    const root = setup(cfg(), files);
    commit(root);
    const away = join(tmp(), "x\u001b[2Ky");
    const r = stacks(root, { [root]: "app-node" }, listing(at(away, "app-node")));
    expect(r).toMatchObject({ exit: 1, name: "" });
    for (const t of [r.text, r.err]) {
      expect(t).toMatch(/x\\u001b\[2Ky \(outside every checkout\) — fix: export another COMPOSE_PROJECT_NAME/);
      expect(t).not.toContain("\u001b");
    }
  });

  it("withholds the name for a stack of the name, keeps it for a stack of another answer, and reports check 5 first", () => {
    const root = setup(cfg("slug-hash"), files);
    commit(root);
    const wt = worktree(root, "feat-a");
    const answers = { [root]: "app-node", [wt]: "feat-a" };
    const n = stacks(wt, answers, listing()).name;
    expect(n).toMatch(/^app-node-feat-a-[0-9a-f]{6}$/);
    const away = tmp();
    // feat-a is this worktree's own directory name, so only the stack makes it a FAIL; -p <name> stays safe.
    const ans = stacks(wt, answers, listing(at(away, "feat-a")));
    expect(ans).toMatchObject({ exit: 0, name: n });
    expect(ans.text).toBe(`FAIL e.project  project feat-a was started from project directory ${away} (outside every checkout) — fix: always pass -p ${n}; leave that stack to whoever runs it from ${away}`);
    expect(ans.err).toContain("env-check: warning: project feat-a was started from project directory");
    expect(stacks(wt, answers, listing(at(away, n)))).toMatchObject({ exit: 1, name: "" });
    // A held name (check 3) and a stack of it: both withhold, the running stack first.
    const both = stacks(wt, answers, listing(at(away, "app-node")), { COMPOSE_PROJECT_NAME: "app-node" });
    expect(both.text.split("\n").map((l) => l.replace(/ —.*/, ""))).toEqual([
      `FAIL e.project  project app-node was started from project directory ${away} (outside every checkout)`,
      "FAIL e.project  this worktree would use project app-node, which the main checkout uses",
    ]);
    // One listing per run: the full run, then --compose-project.
    expect(both.calls.map((a) => a.slice(0, 2))).toEqual([["ps", "-a"], ["ps", "-a"]]);
  });

  it("says when the running-stack check did not run, and fails closed when docker ps hangs", () => {
    const root = setup(cfg(), files);
    commit(root);
    const answers = { [root]: "app-node" };
    expect(stacks(root, answers, { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon", timedOut: false })).toMatchObject({ text: "PASS e.project  app-node (compose); running stacks not checked (docker ps exit 1)", exit: 0, name: "app-node" });
    expect(stacks(root, answers, { code: null, stdout: "", stderr: "", timedOut: false, notFound: true }).text).toBe("PASS e.project  app-node (compose); running stacks not checked (docker not found)");
    const hung = stacks(root, answers, { code: null, stdout: "", stderr: "", timedOut: true });
    expect(hung).toMatchObject({ text: "FAIL e.project  running stacks not checked (docker ps timed out after 10s) — fix: rerun to see why: docker ps -a", exit: 1, name: "" });
    // With a FAIL instead of a PASS, the first FAIL says it; a name-keeping FAIL does not hide the unrun check.
    const wt = worktree(root, "w1");
    const kept = stacks(wt, { ...answers, [wt]: "other" }, { code: 1, stdout: "", stderr: "", timedOut: false });
    expect(kept).toMatchObject({ exit: 0, name: "w1" });
    expect(kept.text.split("\n").map((l) => l.replace(/ —.*/, ""))).toEqual([
      "FAIL e.project  configured run would use project other, not w1; running stacks not checked (docker ps exit 1)",
      "FAIL e.project  root plain run would use project other, not w1",
    ]);
  });

  it("stops a stray stack without a cd when its project directory is gone or unlabelled", () => {
    const root = setup(cfg(), files);
    commit(root);
    const answers = { [root]: "app-node" };
    const gone = join(tmp(), "deleted wt");
    expect(stacks(root, answers, listing(at(gone, "app-node"))).text).toBe(`FAIL e.project  project app-node was started from project directory ${gone} (outside every checkout) — fix: export another COMPOSE_PROJECT_NAME, or stop that stack: docker compose -p app-node down`);
    expect(stacks(root, answers, listing(at("", "app-node"))).text).toBe("FAIL e.project  project app-node was started from project directory (no working_dir label) (outside every checkout) — fix: export another COMPOSE_PROJECT_NAME, or stop that stack: docker compose -p app-node down");
  });

  it.skipIf(process.getuid?.() === 0)("offers no down for a project directory it cannot stat: only ENOENT and ENOTDIR mean gone", () => {
    const root = setup(cfg(), files);
    commit(root);
    const locked = join(tmp(), "locked");
    const dir = join(locked, "proj");
    mkdirSync(dir, { recursive: true });
    chmodSync(locked, 0o000);
    try {
      const text = stacks(root, { [root]: "app-node" }, listing(at(dir, "app-node"))).text;
      expect(text).toBe(`FAIL e.project  project app-node was started from project directory ${dir} (outside every checkout) — fix: export another COMPOSE_PROJECT_NAME; leave that stack to whoever runs it from ${dir}`);
    } finally {
      chmodSync(locked, 0o700);
    }
    // A path through a file is ENOTDIR: gone.
    const file = join(tmp(), "afile");
    put(dirname(file), "afile", "x\n");
    expect(stacks(root, { [root]: "app-node" }, listing(at(join(file, "sub"), "app-node"))).text).toContain("docker compose -p app-node down");
  });

  it("offers no down for a stack whose project directory exists: a committed name: run by the main checkout or a live worktree", () => {
    const root = setup(cfg(), files);
    commit(root);
    const wt = worktree(root, "w1");
    const r = stacks(wt, { [root]: "app-node", [wt]: "app-node" }, listing(at(root, "app-node")));
    expect(r.text.split("\n").find((l) => l.includes("was started from"))).toBe(`FAIL e.project  project app-node was started from project directory ${root} (the main checkout) — fix: always pass -p w1; leave that stack to whoever runs it from ${root}`);
    expect(r).toMatchObject({ exit: 0, name: "w1" });
    expect(r.err).toContain("env-check: warning: project app-node was started from project directory");
    const s = stacks(root, { [root]: "app-node", [wt]: "w1" }, listing(at(wt, "app-node")));
    expect(s.text).toBe(`FAIL e.project  project app-node was started from project directory ${wt} (worktree ${wt}) — fix: export another COMPOSE_PROJECT_NAME; leave that stack to whoever runs it from ${wt}`);
    expect(s).toMatchObject({ exit: 1, name: "" });
    expect(r.text + r.err + s.text + s.err).not.toContain(" down");
    // A worktree git still lists whose directory is gone: nothing runs it from there, so the stop fix stays.
    const gone = worktree(root, "w2");
    rmSync(gone, { recursive: true, force: true });
    expect(stacks(root, { [root]: "app-node" }, listing(at(gone, "app-node"))).text).toBe(`FAIL e.project  project app-node was started from project directory ${gone} (worktree ${gone}) — fix: export another COMPOSE_PROJECT_NAME, or stop that stack: docker compose -p app-node down`);
  });

  it("prints a home path that needs quoting as ~/'rest', which the shell expands, in text, --json and --compose-project", () => {
    const root = setup(cfg(), files);
    commit(root);
    const answers = { [root]: "app-node" };
    const home = tmp();
    const away = join(home, "my proj");
    mkdirSync(away);
    const fix = "leave that stack to whoever runs it from ~/'my proj'";
    const r = stacks(root, answers, listing(at(away, "app-node")), { HOME: home });
    expect(r.text).toBe(`FAIL e.project  project app-node was started from project directory ~/my proj (outside every checkout) — fix: export another COMPOSE_PROJECT_NAME; ${fix}`);
    expect(r.err).toContain(fix);
    const runner = composeStub(answers, [], (cmd, args, opts) => (cmd === "docker" && args[0] === "ps" ? listing(at(away, "app-node")) : run(cmd, args, opts)));
    const j = JSON.parse(check(root, ["--json"], { HOME: home }, runner).out) as { results: { id: string; fix: string }[] };
    expect(j.results.find((x) => x.id === "e.project")!.fix).toContain(fix);
    // The shell agrees: the printed directory is the real one.
    expect(execFileSync("sh", ["-c", "cd ~/'my proj' && pwd -P"], { env: { ...process.env, HOME: home }, encoding: "utf8" }).trim()).toBe(rp(away));
    expect(redactHome(`cd '${home}' && cd '${home}/it'\\''s' && cd ${home}/x`, home)).toBe("cd ~ && cd ~/'it'\\''s' && cd ~/x");
  });
});

describe("b.containers", () => {
  const COMPOSE = "name: app-prod\nservices:\n  web:\n    image: x\n";
  const cfg = (extra = "") => `${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml"]\ninputs = ["compose.yml", "docker/**"]\n${extra}`;
  const files = { "compose.yml": COMPOSE, "docker/Dockerfile": "FROM x\n" };
  const res = (code: number | null, stdout = ""): RunResult => ({ code, stdout, stderr: "", timedOut: false });
  /** A fake docker: `ps` answers `ps`, `compose config` answers from `answers`; every other command runs for real. */
  const fake = (ps: RunResult, calls: string[][] = [], answers: ComposeAnswers = {}): Runner =>
    composeStub(answers, [], (cmd, args, opts) => {
      if (cmd !== "docker") return run(cmd, args, opts);
      calls.push(args);
      return args[0] === "ps" ? ps : res(1);
    });
  const prod = (root: string): ComposeAnswers => ({ [root]: "app-prod" });
  const b = (root: string, args: string[], runner: Runner) => check(root, args, {}, runner).lines.filter((l) => l.includes("b.containers")).join("\n");
  const stale = (root: string, more: ComposeAnswers = {}) => fake(listing(ctr(root, "web-1", "2000-01-01T00:00:00Z")), [], { ...prod(root), ...more });

  it("fails (default) or warns on containers created before the newest input commit", () => {
    const root = setup(cfg(), files);
    commit(root);
    // An exited container and another project's are not this stack's running code.
    const old = (wd: string) => listing(ctr(wd, "web-1", "2000-01-01T00:00:00Z"), ctr(wd, "db-1", "2000-01-02T00:00:00Z"), ctr(wd, "job-1", "2000-01-01T00:00:00Z", "app-prod", "exited"), ctr("/elsewhere", "x-1", "2000-01-01T00:00:00Z", "other"));
    const calls: string[][] = [];
    const r = check(root, [], {}, fake(old(root), calls, prod(root)));
    expect(r.code).toBe(1);
    // No config_files label: the fix names the configured -f list.
    expect(r.out).toContain("FAIL b.containers  web-1, db-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate");
    // One listing serves e.project and b.containers.
    expect(calls.map((a) => a.slice(0, 2))).toEqual([["ps", "-a"]]);
    const warn = setup(cfg('containers = "warn"\n'), files);
    const w = check(warn, [], {}, fake(old(warn), [], prod(warn)));
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
    expect(b(root, [], fake(listing(ctr(root, "web-1", "2999-01-01T00:00:00Z")), [], prod(root)))).toBe("PASS b.containers  1 running container(s) are newer than the compose inputs");
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
    expect(b(root, [], fake(listing(ctr(root, "web-1", "2010-01-01T00:00:00Z")), [], prod(root)))).toBe(
      "FAIL b.containers  web-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate",
    );
  });

  it("compares with the inputs' modification times too, so an edit on disk after the build fails", () => {
    const root = repo({ ...files, [CFG]: cfg() });
    at(root, "2001-01-01T00:00:00Z", "commit", "-q", "--amend", "--no-edit", "--reset-author");
    const old = new Date("2005-01-01T00:00:00Z");
    for (const f of Object.keys(files)) utimesSync(join(root, f), old, old);
    const built = fake(listing(ctr(root, "web-1", "2010-01-01T00:00:00Z")), [], prod(root));
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
    expect(b(root, [], fake(listing(ctr(root, "web-1", "2010-01-01T00:00:00Z")), [], prod(root)))).toBe(
      "FAIL b.containers  web-1 created before the newest change to the compose inputs — fix: docker compose -p app-prod -f compose.yml up -d --build --force-recreate",
    );
  });

  // Since the Compose rewrite the fix replays the stale containers' own Compose labels: the files they were started with (an
  // implicit override included), their project directory and env files. Paths inside the root print relative to it.
  const labelled = (root: string, files: string, wd = root, envFile = "", ...more: string[]) =>
    fake(listing(ctr(wd, "web-1", "2000-01-01T00:00:00Z", "app-prod", "running", files, envFile), ...more), [], prod(root));
  const fixOf = (out: string) => out.replace(/^.* — fix: docker compose -p app-prod (.*) up -d --build --force-recreate$/, "$1");

  it("names the files the stale containers were started with, override included, when they agree", () => {
    const root = setup(cfg(), { ...files, "compose.override.yml": "services: {}\n" });
    commit(root);
    expect(fixOf(b(root, [], labelled(root, `${root}/compose.yml,${root}/compose.override.yml`)))).toBe("-f compose.yml -f compose.override.yml");
    // A file outside the checkout prints as Compose recorded it.
    const away = tmp();
    put(away, "extra.yml", "services: {}\n");
    expect(fixOf(b(root, [], labelled(root, `${root}/compose.yml,${away}/extra.yml`)))).toBe(`-f compose.yml -f ${away}/extra.yml`);
    // A fresh container's labels do not count; stale containers that disagree, or an empty label, get the configured list.
    const fresh = ctr(root, "db-1", "2999-01-01T00:00:00Z", "app-prod", "running", `${root}/compose.yml`);
    expect(fixOf(b(root, [], labelled(root, `${root}/compose.yml,${root}/compose.override.yml`, root, "", fresh)))).toBe("-f compose.yml -f compose.override.yml");
    const other = ctr(root, "db-1", "2000-01-01T00:00:00Z", "app-prod", "running", `${root}/compose.yml`);
    expect(fixOf(b(root, [], labelled(root, `${root}/compose.yml,${root}/compose.override.yml`, root, "", other)))).toBe("-f compose.yml");
    expect(fixOf(b(root, [], labelled(root, "")))).toBe("-f compose.yml");
    // A labelled file that is gone, or a relative entry, gets the configured list.
    expect(fixOf(b(root, [], labelled(root, `${root}/compose.yml,${root}/gone.yml`)))).toBe("-f compose.yml");
    expect(fixOf(b(root, [], labelled(root, "compose.yml,compose.override.yml")))).toBe("-f compose.yml");
  });

  it("splits config_files only on a comma that starts an absolute path, else falls back to the configured list", () => {
    const two = cfg().replace('files = ["compose.yml"]', 'files = ["compose.yml", "ops/compose test.yml"]');
    const root = setup(two, { ...files, "ops/compose test.yml": "services: {}\n", "ops/a,b.yml": "services: {}\n", "ops,/compose.yml": "services: {}\n" });
    commit(root);
    // A comma inside a file name stays in it, quoted.
    expect(fixOf(b(root, [], labelled(root, `${root}/compose.yml,${root}/ops/a,b.yml`)))).toBe("-f compose.yml -f 'ops/a,b.yml'");
    // A directory ending in a comma splits into entries that are not the files: the configured list, quoted.
    expect(fixOf(b(root, [], labelled(root, `${root}/ops,/compose.yml`, `${root}/ops,`)))).toBe("-f compose.yml -f 'ops/compose test.yml' --project-directory 'ops,'");
  });

  it("adds --project-directory when the stack's differs from the first file's directory, and each --env-file", () => {
    const root = setup(cfg(), { ...files, "docker/dev.yml": "services: {}\n", "docker/x.env": "A=1\n", "docker/y.env": "B=1\n" });
    commit(root);
    expect(fixOf(b(root, [], labelled(root, `${root}/docker/dev.yml`, `${root}/docker`)))).toBe("-f docker/dev.yml");
    expect(fixOf(b(root, [], labelled(root, `${root}/docker/dev.yml`)))).toBe("-f docker/dev.yml --project-directory .");
    // A project directory outside this checkout never gets here: e.project's running-stack check withholds the name.
    expect(fixOf(b(root, [], labelled(root, `${root}/docker/dev.yml`, `${root}/docker`, `${root}/docker/x.env,${root}/docker/y.env`)))).toBe("-f docker/dev.yml --env-file docker/x.env --env-file docker/y.env");
  });

  it("keeps each label's spelling: a symlinked directory is not its target", () => {
    // Compose resolves a file's relative paths (../data) against the directory as spelled: through alias/ that is
    // <root>/data, through deep/deploy/ it is <root>/deep/data. So the fix replays the spelling Compose recorded.
    const root = setup(cfg(), { ...files, "deep/deploy/compose.yml": "services: {}\n", "deep/deploy/x.env": "A=1\n" });
    symlinkSync("deep/deploy", join(root, "alias"));
    symlinkSync(".", join(root, "up"));
    commit(root);
    expect(fixOf(b(root, [], labelled(root, `${root}/alias/compose.yml`, `${root}/alias`, `${root}/alias/x.env`)))).toBe("-f alias/compose.yml --env-file alias/x.env");
    // The project directory through the alias, the file through its target: Compose would not default to it.
    expect(fixOf(b(root, [], labelled(root, `${root}/deep/deploy/compose.yml`, `${root}/alias`)))).toBe("-f deep/deploy/compose.yml --project-directory alias");
    // A link back to the root keeps its name too: ../data from up/ is <root>/data, from the root its parent's.
    expect(fixOf(b(root, [], labelled(root, `${root}/up/compose.yml`, `${root}/up`)))).toBe("-f up/compose.yml");
    // Through another spelling of the root, ../ above it would climb elsewhere: the label prints as recorded.
    const link = join(tmp(), "rootlink");
    symlinkSync(root, link);
    expect(fixOf(b(root, [], labelled(root, `${link}/alias/compose.yml`, `${link}/alias`)))).toBe(`-f ${link}/alias/compose.yml`);
    expect(fixOf(b(root, [], labelled(root, `${link}/alias/compose.yml`, `${root}/alias`)))).toBe(`-f ${link}/alias/compose.yml --project-directory alias`);
  });

  it("skips (never warns) when docker is absent, the daemon is down, or the stack is not running", () => {
    const root = setup(cfg(), files);
    commit(root);
    expect(b(root, [], fake({ ...res(null), notFound: true }, [], prod(root)))).toBe("SKIP b.containers  docker is not available (docker not found)");
    expect(b(root, [], fake(res(1), [], prod(root)))).toBe("SKIP b.containers  docker is not available (docker ps exit 1)");
    expect(b(root, [], fake(res(0, "\n"), [], prod(root)))).toBe("SKIP b.containers  stack down (no running container for project app-prod)");
    expect(b(root, [], fake(listing(ctr(root, "web-1", "2000-01-01T00:00:00Z", "app-prod", "exited")), [], prod(root)))).toBe("SKIP b.containers  stack down (no running container for project app-prod)");
    expect(check(root, [], {}, fake(res(0, ""), [], prod(root))).code).toBe(0);
  });

  it("skips with the project unknown when Compose is unavailable in the main checkout, and uses the vouchable name in a worktree", () => {
    const root = setup(cfg(), files);
    put(root, CFG, cfg() + local(root, "d.p", 'echo "PASS d.p project=[$ENV_CHECK_PROJECT]"'));
    commit(root);
    const calls: string[][] = [];
    const m = check(root, [], {}, fake(listing(), calls, { [root]: { unavailable: "docker" } }));
    expect([m.code, calls]).toEqual([0, []]);
    expect(m.out).toContain("SKIP b.containers  project unknown (compose unavailable)");
    expect(m.out).toContain("PASS d.p  project=[]");
    const wt = worktree(root, "feat-u");
    // e.project stopped at check 1, so b.containers lists the containers itself, once.
    const fresh = (project: string) => ctr(wt, `${project}-web-1`, "2999-01-01T00:00:00Z", project);
    const w = check(wt, [], {}, fake(listing(fresh("feat-u"), fresh("feat-u"), fresh("mine")), calls, { [wt]: { unavailable: "plugin" } }));
    expect(calls.map((a) => a.slice(0, 2))).toEqual([["ps", "-a"]]);
    expect(w.out).toContain("PASS b.containers  2 running container(s) are newer than the compose inputs");
    expect(w.out).toContain("PASS d.p  project=[feat-u]");
    const shell = check(wt, [], { COMPOSE_PROJECT_NAME: "mine" }, fake(listing(fresh("feat-u"), fresh("feat-u"), fresh("mine")), calls, { [wt]: { unavailable: "plugin" } }));
    expect(shell.out).toContain("PASS b.containers  1 running container(s) are newer than the compose inputs");
    expect(shell.out).toContain("PASS d.p  project=[mine]");
  });

  it("fails closed when a container's creation time or the inputs' newest commit time cannot be read", () => {
    const root = setup(cfg(), files);
    commit(root);
    const raw = (name: string, at: string) => JSON.stringify([name, "running", at, "app-prod", root, "", ""]);
    const level = "FAIL";
    // An unparsable CreatedAt must not read as fresh: that container counts as stale and the message says why.
    const garbled = check(root, [], {}, fake(listing(ctr(root, "db-1", "2999-01-01T00:00:00Z"), raw("web-1", "not a time")), [], prod(root)));
    expect(garbled.code).toBe(1);
    expect(garbled.out).toContain(`${level} b.containers  web-1 created before the newest change to the compose inputs (loops cannot read its creation time)`);
    expect(garbled.out).not.toContain("db-1");
    expect(b(root, [], fake(listing(raw("web-1", "")), [], prod(root)))).toContain("FAIL b.containers  web-1");
    expect(b(root, [], fake(listing(raw("web-1", "not a time")), [], prod(root)))).toContain("loops cannot read its creation time");
    // Value: protects=with several stale containers the message names which creation time is unreadable; fails_when=the
    // plural branch is dropped or says "its"; why_new=the cases above have one stale container; seam=none; no_claim=none beyond protects
    const mixed = b(root, [], fake(listing(ctr(root, "db-1", "2000-01-01T00:00:00Z"), raw("web-1", "not a time")), [], prod(root)));
    expect(mixed).toContain("(loops cannot read the creation time of web-1)");
    expect(mixed).toMatch(/db-1.*web-1|web-1.*db-1/);
    // Recreating the stack cannot clear an unreadable time (it prints the same text), so the fix also names the severity escape.
    const escape = '; if docker ps prints CreatedAt in a form loops cannot read, set [compose] containers = "warn" in .loops/env-check.toml';
    expect(garbled.out).toContain(`--force-recreate${escape}`);
    expect(mixed).toContain(escape);
    // Every stale container readable: recreating clears it, so the fix is the recreate command alone.
    expect(b(root, [], fake(listing(ctr(root, "db-1", "2000-01-01T00:00:00Z")), [], prod(root)))).not.toContain("CreatedAt");
    // At the warn level it is a WARN.
    const warn = setup(cfg('containers = "warn"\n'), files);
    commit(warn);
    const warned = b(warn, [], fake(listing(raw("web-1", "garbage").replace(root, warn)), [], prod(warn)));
    expect(warned).toMatch(/^WARN b\.containers {2}web-1 .*loops cannot read its creation time/);
    // The severity escape is only for a FAIL: at warn it is already the escape.
    expect(warned).not.toContain("CreatedAt");
    // A git log that fails or prints garbage over tracked inputs is not "no commit touches the inputs".
    const gitLog = (out: RunResult): Runner => {
      const inner = fake(listing(ctr(root, "web-1", "2999-01-01T00:00:00Z")), [], prod(root));
      return (cmd, args, opts) => (cmd === "git" && args[0] === "log" && args.includes("--format=%ct") ? out : inner(cmd, args, opts));
    };
    for (const out of [res(128), res(0, "not-a-number\n")]) {
      const line = b(root, [], gitLog(out));
      expect(line).toMatch(/^FAIL b\.containers {2}.*loops cannot read the commit time of the compose inputs/);
      expect(line).not.toContain("SKIP");
    }
    // The genuine "no commit" (empty output) stays a SKIP.
    expect(b(root, [], gitLog(res(0, "")))).toBe("SKIP b.containers  no commit touches the [compose] inputs");
    // Value: protects=a user's log.showSignature=true does not turn a signed commit's time into "cannot read"; fails_when=the
    // git log call drops --no-show-signature, so git prints the signature line before the time; why_new=the stubs above
    // ignore git's flags; seam=none; no_claim=real gpg/ssh signing (the stub prints what git does when the flag is missing)
    const signed: Runner = (cmd, args, opts) =>
      cmd === "git" && args[0] === "log" && args.includes("--format=%ct")
        ? res(0, args.includes("--no-show-signature") ? "1\n" : 'Good "git" signature for dev@example.com\n1\n')
        : fake(listing(ctr(root, "web-1", "2999-01-01T00:00:00Z")), [], prod(root))(cmd, args, opts);
    expect(b(root, [], signed)).toMatch(/^PASS b\.containers/);
  });

  // Value: protects=a tracked input whose modification time cannot be read is not time 0 (fresh); fails_when=a statSync
  // error reads as 0 and the newer container PASSes; why_new=no test removed or locked an input; seam=none; no_claim=none beyond protects
  it("fails closed when a tracked input's modification time cannot be read (deleted or unreadable)", () => {
    const fresh = (root: string) => fake(listing(ctr(root, "web-1", "2999-01-01T00:00:00Z")), [], prod(root));
    const gone = setup(cfg(), files);
    commit(gone);
    rmSync(join(gone, "docker/Dockerfile"));
    expect(b(gone, [], fresh(gone))).toBe("FAIL b.containers  loops cannot read the modification time of docker/Dockerfile, so it cannot tell whether the running containers are older — fix: restore docker/Dockerfile or make it readable, then re-run");
  });

  // As root, stat still succeeds inside a 0o000 directory.
  it.skipIf(process.getuid?.() === 0)("fails closed at the containers level when a tracked input cannot be stat'd", () => {
    const fresh = (root: string) => fake(listing(ctr(root, "web-1", "2999-01-01T00:00:00Z")), [], prod(root));
    const locked = setup(cfg('containers = "warn"\n'), files);
    commit(locked);
    chmodSync(join(locked, "docker"), 0o000);
    try {
      expect(b(locked, [], fresh(locked))).toBe("WARN b.containers  loops cannot read the modification time of docker/Dockerfile, so it cannot tell whether the running containers are older — fix: restore docker/Dockerfile or make it readable, then re-run");
    } finally {
      chmodSync(join(locked, "docker"), 0o755);
    }
  });

  it("skips when no commit touches the inputs or the listing cannot be read", () => {
    const none = setup(cfg().replace('inputs = ["compose.yml", "docker/**"]', 'inputs = ["nothing/**"]'), files);
    commit(none);
    expect(b(none, [], stale(none))).toBe("SKIP b.containers  no commit touches the [compose] inputs");
    const root = setup(cfg(), files);
    commit(root);
    const r = check(root, [], {}, fake(res(0, "a1\n"), [], prod(root)));
    expect([r.code, r.lines.filter((l) => l.includes("b.containers"))]).toEqual([0, ["SKIP b.containers  docker is not available (docker ps printed a listing loops cannot read)"]]);
  });

  it("skips b.containers on any e.project FAIL, and hands local checks only the name it keeps", () => {
    const root = setup(cfg(), files);
    put(root, CFG, cfg() + local(root, "d.p", 'echo "PASS d.p project=$ENV_CHECK_PROJECT"'));
    commit(root);
    put(root, ".env", "COMPOSE_PROJECT_NAME=app-prod\n");
    const wt = worktree(root, "feat-copy");
    put(wt, ".env", "COMPOSE_PROJECT_NAME=app-prod\n");
    const calls: string[][] = [];
    // The copied .env is not the worktree's identity (-p feat-copy is), but docker compose there without -p hits prod.
    const r = check(wt, [], {}, fake(listing(ctr(wt, "web-1", "2000-01-01T00:00:00Z")), calls, { [root]: "app-prod", [wt]: "app-prod" }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("FAIL e.project  configured run would use project app-prod, which the main checkout uses")]);
    expect(calls.map((a) => a.slice(0, 2))).toEqual([["ps", "-a"]]);
    expect(r.out).not.toContain("b.containers");
    expect(r.out).toContain("PASS d.p  project=feat-copy\n");
  });

  it("is not run under --static, without inputs, or in compose mode none", () => {
    const calls: string[][] = [];
    const root = setup(cfg(), files);
    commit(root);
    // No answers: a compose probe under --static would throw.
    expect(b(root, ["--static"], fake(res(0, "a1"), calls))).toBe("");
    const noInputs = setup(`${HEAD}[compose]\nmode = "test"\nfiles = ["compose.yml"]\n`, files);
    expect(b(setup(`${HEAD}[compose]\nmode = "none"\n`), [], fake(res(0, "a1"), calls))).toBe("");
    expect(calls).toEqual([]);
    // Without inputs only e.project lists the containers.
    expect(b(noInputs, [], fake(listing(), calls, prod(noInputs)))).toBe("");
    expect(calls.map((a) => a.slice(0, 2))).toEqual([["ps", "-a"]]);
  });

  it("uses the worktree's derived project name", () => {
    const root = setup(cfg(), { ...files, "compose.yml": "services:\n  web:\n    image: x\n" });
    commit(root);
    const calls: string[][] = [];
    const wt = worktree(root, "feat-z");
    const ps = listing(ctr(wt, "feat-z-web-1", "2999-01-01T00:00:00Z", "feat-z"), ctr(root, "app-node-web-1", "2999-01-01T00:00:00Z", "app-node"));
    expect(b(wt, [], fake(ps, calls, { [root]: "app-node", [wt]: "feat-z" }))).toBe("PASS b.containers  1 running container(s) are newer than the compose inputs");
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
    ["an unparseable line", 'echo "all good"', /FAIL d\.x\.protocol {2}unparseable line "all good"/],
    ["an id outside the configured one", 'echo "PASS other.id ok"', /FAIL d\.x\.protocol {2}unparseable line "PASS other\.id ok"/],
    ["an id that only shares a prefix", 'echo "PASS d.xy ok"', /FAIL d\.x\.protocol {2}unparseable line "PASS d\.xy ok"/],
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

  it("splits a line at its first fix separator, accepts -- as one, defuses later ones, and reads an empty fix as none", () => {
    const r = run([
      'echo "WARN d.x.dbl first — fix: a — fix: b"',
      'echo "WARN d.x.dd msg -- fix: ascii dashes"',
      'echo "WARN d.x.add m -- fix: a -- fix: b; git checkout -- x"',
      'echo "PASS d.x.pe ok — fix: "',
      'echo "WARN d.x.we empty — fix:"',
      'printf "FAIL d.x.fe bad — fix:   \\n"',
    ].join("\n"));
    expect(r.lines).toEqual([
      "WARN d.x.dbl  first — fix: a \\u2014 fix: b",
      "WARN d.x.dd  msg — fix: ascii dashes",
      "WARN d.x.add  m — fix: a \\u002d- fix: b; git checkout -- x",
      "PASS d.x.pe  ok",
      "WARN d.x.we  empty — fix: address the message above and re-run",
      "FAIL d.x.fe  bad — fix: address the message above and re-run",
      "env-check: 1 FAIL, 4 WARN, 1 PASS, 0 SKIP",
    ]);
    for (const l of r.lines) expect(l.split(/ (?:—|--) fix: /).length).toBeLessThanOrEqual(2);
  });

  it("accepts CRLF line endings but rejects a line with any other control character, echoed escaped in quotes", () => {
    const crlf = run('printf "PASS d.x fine\\r\\nWARN d.x.w tab\\there — fix: f\\r\\n"');
    expect(crlf.lines).toEqual(["PASS d.x  fine", "WARN d.x.w  tab\\there — fix: f", "env-check: 0 FAIL, 1 WARN, 1 PASS, 0 SKIP"]);
    const fix = "emit `LEVEL id message`, with an optional fix after an em dash and `fix:`, one line per result, id = the configured id or <id>.<name>";
    const cr = run('printf "WARN d.x.cr mid\\rcr here — fix: f\\n"');
    expect(cr.code).toBe(1);
    expect(cr.lines[0]).toBe(`FAIL d.x.protocol  unparseable line "WARN d.x.cr mid\\rcr here \\u2014 fix: f" — fix: ${fix}`);
    expect(cr.out).not.toContain("\r");
    expect(cr.lines[0]!.split(" — fix: ")).toHaveLength(2);
    // A colour or cursor code turns an otherwise good PASS into a protocol FAIL (NO_COLOR=1 is exported).
    const esc = run('printf "PASS d.x ok\\033[2K\\n"');
    expect([esc.code, esc.lines[0]]).toEqual([1, `FAIL d.x.protocol  unparseable line "PASS d.x ok\\u001b[2K" — fix: ${fix}`]);
    expect(esc.out).not.toContain("\u001b");
    expect(esc.out).not.toContain("PASS d.x  ok");
  });

  it("rejects a line that ends in, or is only, a control character other than CRLF's \\r, and a bidi control", () => {
    const fix = "emit `LEVEL id message`, with an optional fix after an em dash and `fix:`, one line per result, id = the configured id or <id>.<name>";
    const r = run('printf "PASS d.x ok\\v\\nPASS d.x fine\\n\\f\\nPASS d.x.r ok \\342\\200\\250\\nPASS d.x.b ok \\342\\200\\256lmth.exe\\n \\r\\n"');
    expect(r.lines).toEqual([
      `FAIL d.x.protocol  unparseable line "PASS d.x ok\\u000b" — fix: ${fix}`,
      "PASS d.x  fine",
      `FAIL d.x.protocol  unparseable line "\\u000c" — fix: ${fix}`,
      `FAIL d.x.protocol  unparseable line "PASS d.x.r ok \\u2028" — fix: ${fix}`,
      `FAIL d.x.protocol  unparseable line "PASS d.x.b ok \\u202elmth.exe" — fix: ${fix}`,
      "env-check: 4 FAIL, 0 WARN, 1 PASS, 0 SKIP",
    ]);
  });

  it("takes the first non-blank stderr line for the excerpt, without CRLF's \\r", () => {
    const r = run('printf "\\r\\nboom\\r\\nmore\\r\\n" >&2\nexit 3');
    expect(r.lines[0]).toBe("FAIL d.x  printed no results, exit 3 (boom) — fix: run .loops/checks/d_x.sh by hand");
  });

  it("cuts a long rejected line to 80 code points without splitting a character, and escapes the stderr excerpt", () => {
    const long = run(`echo "${"y".repeat(79)}😀${"z".repeat(100)}"`);
    expect(long.lines[0]).toContain(`unparseable line "${"y".repeat(79)}😀…" — fix:`);
    const err = run('echo "PASS d.x fine"\nprintf "bad\\033[31m — fix: nope\\n" >&2\nexit 4');
    expect(err.lines[1]).toBe("FAIL d.x  exited 4 without a FAIL line (bad\\u001b[31m \\u2014 fix: nope) — fix: run .loops/checks/d_x.sh by hand");
    expect(err.out).not.toContain("\u001b");
  });

  it("relays a stderr reason escaped in text and raw in --json", () => {
    const script = "printf 'boom\\033[2K\\342\\200\\256x\\n' >&2\nexit 3";
    expect(run(script).lines[0]).toBe("FAIL d.x  printed no results, exit 3 (boom\\u001b[2K\\u202ex) — fix: run .loops/checks/d_x.sh by hand");
    const raw = run(script, "", {}, ["--json"]).out;
    expect(raw).not.toMatch(/[\u001b\u202e]/);
    expect((JSON.parse(raw) as { results: { message: string }[] }).results[0]!.message).toBe("printed no results, exit 3 (boom\u001b[2K\u202ex)");
  });

  it("redacts $HOME before cutting a rejected line or the stderr excerpt, so a cut through home leaks no part of it", () => {
    const env = { HOME: "/home/someuser" };
    // "WARN d.x.c " + 63 zeros + " " puts home at code point 75, across the 80-code-point cut.
    const line = run(`printf 'WARN d.x.c %s /home/someuser/.config/x\\001\\n' "$(printf '0%.0s' $(seq 1 63))"`, "", env);
    expect(line.lines[0]).toMatch(/^FAIL d\.x\.protocol {2}unparseable line "WARN d\.x\.c 0{63} ~\/\.co…" — fix: /);
    // "error: " + 107 zeros + " " puts home at code point 115, across the 120-code-point cut.
    const err = run(`echo "error: $(printf '0%.0s' $(seq 1 107)) /home/someuser/.config/x" >&2\nexit 4`, "", env);
    expect(err.lines[0]).toMatch(/^FAIL d\.x {2}printed no results, exit 4 \(error: 0{107} ~\/\.co…\) — fix: /);
    for (const r of [line, err]) expect(r.out).not.toMatch(/\/home|someu/);
    expect(JSON.stringify(JSON.parse(run(`echo "error: $(printf '0%.0s' $(seq 1 107)) /home/someuser/x" >&2\nexit 4`, "", env, ["--json"]).out))).not.toMatch(/\/home|someu/);
  });
});

describe("output and exit codes", () => {
  it("--quiet prints only WARN and FAIL plus the summary", () => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + local(root, "d.a", 'echo "PASS d.a fine"\necho "WARN d.a.w hmm — fix: x"\necho "INFO d.a.i note"'));
    expect(check(root, ["--quiet"]).lines).toEqual(["WARN d.a.w  hmm — fix: x", "env-check: 0 FAIL, 1 WARN, 1 PASS, 0 SKIP"]);
  });

  it("escapes folded also ids like the rest of the row", () => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + local(root, "d.a", 'echo "WARN d.a.x same"\necho "WARN d.a.y--fix: same"'));
    expect(check(root).lines[0]).toBe("WARN d.a.x  same — fix: address the message above and re-run (also: d.a.y\\u002d-fix:)");
    expect((JSON.parse(check(root, ["--json"]).out) as { results: { also: string[] }[] }).results[0]!.also).toEqual(["d.a.y--fix:"]);
  });

  // Escape once, at the edges: the text renderer (showRow), the JSON pass and the CLI's exit-2 line. A check that
  // escapes its own text makes --json carry it escaped while other rows are raw.
  it("no module but text.ts, the env-check renderer and the CLI error printer uses escapeCtl", () => {
    const src = join(HERE, "..");
    const users = ["lib", "bin"].flatMap((d) =>
      readdirSync(join(src, d))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && /\bescapeCtl\b/.test(readFileSync(join(src, d, f), "utf8")))
        .map((f) => `${d}/${f}`),
    );
    expect(users.sort()).toEqual(["lib/env-check.ts", "lib/loops-cli.ts", "lib/text.ts"]);
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

  it("redacts $HOME given with a trailing slash, never leaking the bare home", () => {
    const root = setup(HEAD);
    put(root, CFG, HEAD + local(root, "d.a", 'echo "PASS d.a root=$ENV_CHECK_ROOT home=$(dirname "$ENV_CHECK_ROOT")"'));
    const env = { HOME: `${dirname(root)}/` };
    expect(check(root, [], env).lines[0]).toBe("PASS d.a  root=~/app-node home=~");
    const raw = check(root, ["--json"], env).out;
    expect(raw).not.toContain(dirname(root));
    expect(JSON.parse(raw).root).toBe("~/app-node");
    const h = "/home/u";
    for (const home of [h, `${h}/`, `${h}//`]) {
      expect(redactHome(`cd '${h}' && cd '${h}/it'\\''s' && cd ${h}/x`, home)).toBe("cd ~ && cd ~/'it'\\''s' && cd ~/x");
      expect(redactHome(`bare ${h} end`, home)).toBe("bare ~ end");
      expect(redactHome(h, home)).toBe("~");
    }
    expect(redactHome("/x", "/")).toBe("/x");
    expect(redactHome("/x", "//")).toBe("/x");
  });

  const bad: [string, string, RegExp][] = [
    ["invalid TOML", "schema_version = \n", /env-check\.toml: /],
    ["no schema_version", "", /schema_version is missing/],
    ["schema_version 2", "schema_version = 2\n", new RegExp(`schema_version 2 is unsupported by loops ${V}`)],
    ["unknown top-level key", `${HEAD}colour = 1\n`, /unknown key "colour"/],
    ["unknown pins key", `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\nfoo = 1\n`, /\[\[pins\]\] #1: unknown key "foo"/],
    ["unknown source kind", `${HEAD}[[pins]]\ntool = "go"\nsources = ["gomod"]\n`, /unknown source kind in "gomod"/],
    ["inherited source kind", `${HEAD}[[pins]]\ntool = "go"\nsources = ["constructor"]\n`, /unknown source kind in "constructor"/],
    ["bad compare", `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\ncompare = "close"\n`, /compare must be exact\|minor\|major(?!\|)/],
    // 0.6.0: compare = "floor" was accepted; ranges are no longer compared, so it is a config error that says why. // pregate-literal: VERSION=0.6.0 names the release that removed floor
    ["compare floor (removed in 0.6.0)", `${HEAD}[[pins]]\ntool = "node"\nsources = ["nvmrc", "engines"]\ncompare = "floor"\n`, /\[\[pins\]\] #1: .*floor was removed in loops 0\.6\.0.*ranges are no longer compared.*a\.range.*exact, minor or major/],
    ["engine too new", `engine = ">=9.0.0"\n${HEAD}`, new RegExp(`needs loops >=9\\.0\\.0, this is ${V}; update agentic-tools`)],
    ["engine odd form", `engine = "^0.4"\n${HEAD}`, /engine must look like ">=0\.4\.0"/],
    ["compose test without files", `${HEAD}[compose]\nmode = "test"\n`, /mode test needs files/],
    ["compose dev", `${HEAD}[compose]\nmode = "dev"\n`, /mode must be none\|test/],
    ["bad local id", `${HEAD}[[local]]\nid = "zz"\nrun = "a"\n`, /id "zz" must look like/],
    ["reserved local id x.none", `${HEAD}[[local]]\nid = "x.none"\nrun = "a"\n`, /\[\[local\]\] #1: id x\.none is reserved for env-check's own "no check ran" row/],
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

  it("redacts and escapes an exit-2 message relayed from git", () => {
    const root = setup(HEAD);
    const r = check(root, [], { HOME: "/home/bob" }, (cmd, args, opts) =>
      cmd === "git" && args.join(" ") === "ls-files -z" ? { code: 128, stdout: "", stderr: "fatal: \u001b[2Jbad index /home/bob/r/.git/index\nmore", timedOut: false } : run(cmd, args, opts),
    );
    expect([r.code, r.err]).toEqual([2, "env-check: git ls-files failed: fatal: \\u001b[2Jbad index ~/r/.git/index"]);
  });

  it("redacts and escapes the whole exit-2 line, the command prefix too; the usage after it stays as is", () => {
    const t = deps(tmp(), { HOME: "/home/bob" });
    expect([main(["\u001b[2J\nboom"], t.d), main(["/home/bob/x\u202e"], t.d)]).toEqual([2, 2]);
    const lines = t.err.join("\n").split("\n");
    expect(lines.filter((l) => l.includes("unknown command"))).toEqual(["\\u001b[2J\\nboom: unknown command \\u001b[2J\\nboom", "~/x\\u202e: unknown command ~/x\\u202e"]);
    expect(lines[1]).toMatch(/^loops [0-9.]+$/);
    expect(lines[2]).toMatch(/^usage: loops <command>/);
  });

  it("--compose-project exits 2 when compose mode is not test", () => {
    expect(check(setup(HEAD), ["--compose-project"]).code).toBe(2);
    expect(check(setup(`${HEAD}[compose]\nmode = "none"\n`), ["--compose-project"])).toMatchObject({ code: 2, out: "", err: expect.stringContaining("compose mode is not test") });
  });
});

describe("x.none: a run that checks nothing", () => {
  const NONE = "WARN x.none  no check ran — fix: add checks to .loops/env-check.toml (see the loops README)";
  it("adds a counted WARN with a fix, keeps exit 0, and shows under --quiet and in --json", () => {
    const root = setup(HEAD);
    commit(root);
    expect(check(root)).toMatchObject({ code: 0, lines: [NONE, "env-check: 0 FAIL, 1 WARN, 0 PASS, 0 SKIP"] });
    expect(check(root, ["--quiet"]).lines).toEqual([NONE, "env-check: 0 FAIL, 1 WARN, 0 PASS, 0 SKIP"]);
    const j = JSON.parse(check(root, ["--json"]).out);
    expect([j.results, j.summary, j.exit]).toEqual([
      [{ level: "WARN", id: "x.none", message: "no check ran", fix: "add checks to .loops/env-check.toml (see the loops README)", also: [], source: "builtin" }],
      { fail: 0, warn: 1, pass: 0, skip: 0 },
      0,
    ]);
    // An empty [harness] is the same as none.
    expect(check(setup(`${HEAD}[harness]\ntools = []\nfiles = []\n`)).lines).toEqual([NONE, "env-check: 0 FAIL, 1 WARN, 0 PASS, 0 SKIP"]);
  });

  it("names --static when the only configured checks do not run there", () => {
    for (const [args, env] of [[["--static"], {}], [[], { CI: "true" }]] as [string[], Record<string, string>][]) {
      const r = check(setup(`${HEAD}[harness]\ntools = ["git"]\nsparse = "warn"\n`), args, env);
      expect([r.code, r.lines]).toEqual([
        0,
        [
          "WARN x.none  no check ran under --static (CI=true implies it) — fix: add checks that run under --static to .loops/env-check.toml ([[pins]], [harness] files, entrypoints or tracked, or a [[local]] with static = true)",
          "env-check: 0 FAIL, 1 WARN, 0 PASS, 0 SKIP",
        ],
      ]);
    }
  });

  it("counts a run of only INFO rows as nothing checked, and never fires beside a counted row", () => {
    const root = setup(`${HEAD}[shared_checkout]\nhint = "use a worktree"\n`);
    commit(root);
    expect(check(root, [], { ENV_CHECK_ALLOW_MAIN: "1" }).lines).toEqual(["INFO c.shared  shared checkout allowed by ENV_CHECK_ALLOW_MAIN", NONE, "env-check: 0 FAIL, 1 WARN, 0 PASS, 0 SKIP"]);
    expect(check(root).out).not.toContain("x.none");
    expect(check(setup(`${HEAD}[harness]\ntools = ["git"]\n`)).out).not.toContain("x.none");
  });

  it("counts a run of only SKIP rows as nothing checked, exit 0; one PASS beside a SKIP is enough", () => {
    const shared = setup(`${HEAD}[shared_checkout]\nhint = "use a worktree"\n`);
    commit(shared);
    expect(check(shared, ["--static"])).toMatchObject({
      code: 0,
      lines: [
        "SKIP c.shared  not checked in --static mode",
        "WARN x.none  no check ran under --static (CI=true implies it) — fix: add checks that run under --static to .loops/env-check.toml ([[pins]], [harness] files, entrypoints or tracked, or a [[local]] with static = true)",
        "env-check: 0 FAIL, 1 WARN, 0 PASS, 1 SKIP",
      ],
    });
    const only = (script: string) => {
      const root = setup(HEAD);
      put(root, CFG, HEAD + local(root, "d.x", script));
      return check(root);
    };
    expect(only('echo "SKIP d.x n/a"\necho "SKIP d.x.two n/a either"')).toMatchObject({ code: 0, lines: ["SKIP d.x  n/a", "SKIP d.x.two  n/a either", NONE, "env-check: 0 FAIL, 1 WARN, 0 PASS, 2 SKIP"] });
    expect(only('echo "SKIP d.x n/a"\necho "PASS d.x.two ok"').out).not.toContain("x.none");
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
