// 0.8.0 C1: the composite action (action.yml) and its logic, scripts/action-env-check.sh.
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseConfig } from "./env-config.js";
import { put, sh, shim, tmp } from "./testkit.js";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(PLUGIN, "scripts", "action-env-check.sh");
const BASH = "/bin/bash";
const SETUP_NODE = /::error::loops env-check: .*add actions\/setup-node/;

/** The system tools the script uses, linked into one dir, so PATH can hold them without any ambient node. */
const TOOLS = (() => {
  const dir = tmp();
  for (const t of ["awk", "cat", "dirname", "head", "mktemp", "od", "rm", "sed", "tr"]) {
    const p = execFileSync("/bin/sh", ["-c", `command -v ${t}`], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } }).trim();
    symlinkSync(p, join(dir, t));
  }
  return dir;
})();

/**
 * A fake node: `--version` prints $FAKE_VERSION (default v20.11.1); any other call records its argv (one per line) and
 * cwd, prints $FAKE_OUT's contents and exits $FAKE_EXIT (default 0).
 */
const fakeNode = (): string =>
  shim(
    "node",
    [
      'if [ "$1" = "--version" ]; then printf "%s\\n" "${FAKE_VERSION-v20.11.1}"; exit 0; fi',
      'printf "%s\\n" "$@" > "$FAKE_LOG/argv"',
      'pwd > "$FAKE_LOG/cwd"',
      '[ -n "${FAKE_OUT:-}" ] && cat "$FAKE_OUT"',
      'exit "${FAKE_EXIT:-0}"',
    ].join("\n"),
  );
/** An action dir (with a space in its path) holding a placeholder bin/loops.mjs; the fake node never reads it. */
const actionDir = (): string => {
  const dir = join(tmp(), "action path");
  put(dir, "bin/loops.mjs", "// placeholder\n");
  return dir;
};

interface Run {
  code: number | null;
  out: string;
  log: string;
  summary: string | null;
  argv: string[] | null;
  cwd: string | null;
}
function runScript(env: Record<string, string>, opts: { path?: string; summary?: boolean } = {}): Run {
  const ws = tmp();
  const log = tmp();
  const summaryFile = join(tmp(), "summary.md");
  const full: Record<string, string> = {
    PATH: opts.path ?? `${fakeNode()}:${TOOLS}`,
    HOME: tmp(),
    GITHUB_WORKSPACE: ws,
    GITHUB_ACTION_PATH: actionDir(),
    RUNNER_TEMP: tmp(),
    FAKE_LOG: log,
    ...(opts.summary === false ? {} : { GITHUB_STEP_SUMMARY: summaryFile }),
    ...env,
  };
  const r = spawnSync(BASH, [SCRIPT], { cwd: ws, env: full, encoding: "utf8" });
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : null);
  const argv = read(join(log, "argv"));
  return {
    code: r.status,
    out: r.stdout + r.stderr,
    log,
    summary: read(summaryFile),
    argv: argv === null ? null : argv.replace(/\n$/, "").split("\n"),
    cwd: read(join(log, "cwd"))?.trim() ?? null,
  };
}
const output = (text: string): string => {
  const dir = tmp();
  put(dir, "out.txt", text);
  return join(dir, "out.txt");
};

// Value: protects=the action's file contract (a composite step that runs the script with inputs only as env vars);
// fails_when=the script stops parsing, loses its exec bit, or action.yml interpolates an input into run: (script
// injection); why_new=action.yml and the script are new; seam=none; no_claim=GitHub's own runner behavior
describe("action.yml and the script (C1)", () => {
  it("the script parses with bash -n and is executable", () => {
    expect(spawnSync(BASH, ["-n", SCRIPT]).status).toBe(0);
    expect(() => accessSync(SCRIPT, constants.X_OK)).not.toThrow();
  });
  it("action.yml is a composite action whose one step runs the script, inputs only through env", () => {
    const a = parse(readFileSync(join(PLUGIN, "action.yml"), "utf8"));
    expect(Object.keys(a.inputs)).toEqual(["working-directory", "require-checks"]);
    expect(a.inputs["working-directory"].default).toBe(".");
    expect(a.inputs["require-checks"].default).toBe("");
    expect(a.outputs).toBeUndefined();
    expect(a.runs.using).toBe("composite");
    expect(a.runs.steps).toHaveLength(1);
    const [step] = a.runs.steps;
    expect(step.shell).toBe("bash");
    expect(step.run).toBe('bash "$GITHUB_ACTION_PATH/scripts/action-env-check.sh"');
    expect(step.env).toEqual({
      INPUT_WORKING_DIRECTORY: "${{ inputs.working-directory }}",
      INPUT_REQUIRE_CHECKS: "${{ inputs.require-checks }}",
    });
  });
});

// Value: protects=the setup-node gate (bin/loops.mjs needs node 18+; an older node fails with a syntax error that
// names nothing to fix); fails_when=an old, missing or unreadable node runs the engine anyway, or exits other than 2;
// why_new=the gate is new; seam=PATH; no_claim=which node versions the engine itself supports
describe("the action's node gate (C1)", () => {
  it.each(["v16.20.0", "v17.9.1", "", "garbage"])("node --version %j is exit 2 with the setup-node hint", (v) => {
    const r = runScript({ FAKE_VERSION: v });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(SETUP_NODE);
    expect(r.argv).toBeNull();
    expect(r.summary).toBeNull();
  });
  it("node missing from PATH is exit 2 with the setup-node hint", () => {
    const r = runScript({}, { path: TOOLS });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/::error::loops env-check: node is not on PATH; add actions\/setup-node/);
    expect(r.summary).toBeNull();
  });
  it.each(["v18.0.0", "v100.0.0", "v20.11.1\r"])("node --version %j runs the engine", (v) => {
    const r = runScript({ FAKE_VERSION: v });
    expect(r.code).toBe(0);
    expect(r.argv).not.toBeNull();
  });
});

// Value: protects=the CI verdict (the step's exit is the engine's, the rows reach the log and the summary even on a
// FAIL); fails_when=a pipe or set -e swallows the exit code, a FAIL skips the summary, or a backtick run in a row
// closes the fence early; why_new=the script is new; seam=PATH (fake node); no_claim=the engine's rows (below)
describe("the action's run and summary (C1)", () => {
  it.each([0, 1, 2, 3])("passes on the engine's exit %i", (code) => {
    const r = runScript({ FAKE_EXIT: String(code), FAKE_OUT: output(`ROW ${code}\n`) });
    expect(r.code).toBe(code);
    expect(r.out).toContain(`ROW ${code}`);
    expect(r.summary).toContain(`### loops env-check (exit ${code})`);
  });
  it("writes the summary on exit 1, in a text fence longer than any backtick run in the output", () => {
    const rows = "FAIL x.ticks  a row with ````` five backticks\nenv-check: 1 FAIL, 0 WARN, 0 PASS, 0 SKIP";
    const r = runScript({ FAKE_EXIT: "1", FAKE_OUT: output(rows) });
    expect(r.code).toBe(1);
    expect(r.summary).toBe(`### loops env-check (exit 1)\n\n\`\`\`\`\`\`text\n${rows}\n\`\`\`\`\`\`\n`);
    expect(r.out).toContain("::error::loops env-check: a FAIL row (above); exit 1");
  });
  it("a plain output gets a three-backtick fence", () => {
    const r = runScript({ FAKE_OUT: output("PASS a.pins.go  go 1.26.1 (go-mod:go.mod)\n") });
    expect(r.summary).toBe("### loops env-check (exit 0)\n\n```text\nPASS a.pins.go  go 1.26.1 (go-mod:go.mod)\n```\n");
  });
  it("runs without GITHUB_STEP_SUMMARY", () => {
    expect(runScript({ FAKE_EXIT: "1", FAKE_OUT: output("FAIL x\n") }, { summary: false }).code).toBe(1);
  });
  it("prints the rows with workflow commands paused, so a row never runs as one", () => {
    const r = runScript({ FAKE_OUT: output("::add-mask::secret\nPASS x.a ok\n") });
    const m = r.out.match(/^::stop-commands::([0-9a-f]{32})\n([\s\S]*?)^::\1::$/m);
    expect(m).not.toBeNull();
    expect(m![2]).toBe("::add-mask::secret\nPASS x.a ok\n");
  });
  it("runs node <action>/bin/loops.mjs env-check --static --require-checks once", () => {
    const r = runScript({});
    expect(r.argv!.slice(1)).toEqual(["env-check", "--static", "--require-checks"]);
    expect(r.argv![0]).toMatch(/\/action path\/bin\/loops\.mjs$/);
  });
  it("an engine bundle missing from GITHUB_ACTION_PATH is exit 2", () => {
    const r = runScript({ GITHUB_ACTION_PATH: tmp() });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/::error::loops env-check: no engine at .*bin\/loops\.mjs/);
  });
  it("a Windows runner is exit 2 before node is asked", () => {
    const r = runScript({ RUNNER_OS: "Windows" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("Windows runners are not supported");
    expect(r.argv).toBeNull();
  });
});

// Value: protects=the inputs (working-directory resolved against the workspace, require-checks reaching the engine as
// one argv element); fails_when=a path with spaces splits, a relative path resolves against the wrong dir, or an input
// is word-split, globbed or evaluated; why_new=the inputs are new; seam=PATH (fake node); no_claim=the id grammar (the
// engine validates it, env-check-require-checks.test.ts)
describe("the action's inputs (C1)", () => {
  it("resolves a relative working-directory, spaces included, against GITHUB_WORKSPACE", () => {
    const ws = tmp();
    mkdirSync(join(ws, "my repo", "sub dir"), { recursive: true });
    const r = runScript({ GITHUB_WORKSPACE: ws, INPUT_WORKING_DIRECTORY: "my repo/sub dir" });
    expect(r.code).toBe(0);
    expect(r.cwd).toBe(join(ws, "my repo", "sub dir"));
  });
  it("keeps an absolute working-directory, and defaults an empty one to the workspace", () => {
    const abs = join(tmp(), "a b");
    mkdirSync(abs);
    expect(runScript({ INPUT_WORKING_DIRECTORY: abs }).cwd).toBe(abs);
    const ws = tmp();
    expect(runScript({ GITHUB_WORKSPACE: ws, INPUT_WORKING_DIRECTORY: "" }).cwd).toBe(ws);
  });
  it("a working-directory that is not a directory is exit 2", () => {
    const r = runScript({ INPUT_WORKING_DIRECTORY: "nope" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/::error::loops env-check: working-directory .*\/nope is not a directory/);
    expect(r.argv).toBeNull();
  });
  it("an empty or blank require-checks is the bare flag", () => {
    for (const v of ["", "   ", "\n\t"]) expect(runScript({ INPUT_REQUIRE_CHECKS: v }).argv!.slice(1)).toEqual(["env-check", "--static", "--require-checks"]);
  });
  it("a require-checks list reaches the engine as one argv element, trimmed, never split, globbed or evaluated", () => {
    const ws = tmp();
    const v = 'a.pins.go, a.pins.*  $(touch pwned) `touch pwned2` ; "q" $HOME';
    const r = runScript({ GITHUB_WORKSPACE: ws, INPUT_REQUIRE_CHECKS: `  ${v}  ` });
    expect(r.argv!.slice(1)).toEqual(["env-check", "--static", `--require-checks=${v}`]);
    expect(existsSync(join(ws, "pwned"))).toBe(false);
    expect(existsSync(join(ws, "pwned2"))).toBe(false);
  });
});

// The real engine against the fixtures loops-ci copies into $RUNNER_TEMP. It needs a bin/loops.mjs built with
// --require-checks: CI's loops-engine job runs vitest before the build, so with a stale bundle these skip (the
// action-fixtures job and the build-freshness check still cover them).
const bundleHasRequireChecks = (() => {
  const r = spawnSync(process.execPath, [join(PLUGIN, "bin", "loops.mjs"), "env-check", "--require-checks="], { encoding: "utf8" });
  return r.status === 2 && /--require-checks= needs a value/.test(r.stderr + r.stdout);
})();
const fixture = (name: string): string => {
  const dir = join(tmp(), `${name} copy`);
  cpSync(join(PLUGIN, "fixtures", "env-check", name), dir, { recursive: true });
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "fixture");
  return dir;
};
const nodeDir = (): string => {
  const dir = tmp();
  symlinkSync(process.execPath, join(dir, "node"));
  return dir;
};
const realRun = (dir: string, require = "a.pins.go") =>
  runScript(
    { GITHUB_ACTION_PATH: PLUGIN, INPUT_WORKING_DIRECTORY: dir, INPUT_REQUIRE_CHECKS: require },
    { path: `${nodeDir()}:${TOOLS}:/usr/bin:/bin` },
  );

// Value: protects=the fixtures' shape without the bundle (the real-engine block below skips on a stale bin/);
// fails_when=a fixture loses a source, or the clean and mismatch fixtures differ in more than the Dockerfile tag;
// why_new=the fixtures are new; seam=none; no_claim=the engine's verdict (below)
describe("the env-check fixtures (C1)", () => {
  const files = (name: string) => {
    const dir = join(PLUGIN, "fixtures", "env-check", name);
    const cfg = parseConfig(readFileSync(join(dir, ".loops", "env-check.toml"), "utf8"), ".loops/env-check.toml");
    return { cfg, docker: readFileSync(join(dir, "Dockerfile"), "utf8"), gomod: readFileSync(join(dir, "go.mod"), "utf8") };
  };
  it("pin go over go.mod, the Dockerfile and setup-go, and differ only in the Dockerfile's tag", () => {
    const clean = files("clean");
    const mismatch = files("mismatch");
    expect(clean.cfg.pins.map((p) => [p.tool, p.sources])).toEqual([["go", ["go-mod:go.mod", "dockerfile:Dockerfile", "setup-go:.github/workflows/*.yml"]]]);
    expect(mismatch.cfg).toEqual(clean.cfg);
    expect(mismatch.gomod).toBe(clean.gomod);
    expect(clean.docker).toBe("FROM golang:1.26.1-alpine\n");
    expect(mismatch.docker).toBe("FROM golang:1.25.4-alpine\n");
  });
});

// Value: protects=the fixtures and the action end to end (the mismatch fixture fails on its go pin, the clean one
// passes, and deleting the go pin turns a.pins.go into x.required); fails_when=a fixture drifts so CI's assertion
// tests nothing, or the action loses the engine's row; why_new=the fixtures are new; seam=none (real engine, git);
// no_claim=GitHub's runner
describe.skipIf(!bundleHasRequireChecks)("the action with the real engine on the fixtures (C1)", () => {
  it("mismatch: FAIL a.pins.go, exit 1, in the summary", () => {
    const r = realRun(fixture("mismatch"));
    expect(r.code).toBe(1);
    expect(r.summary).toMatch(/^FAIL a\.pins\.go  .*dockerfile:Dockerfile=1\.25\.4.*disagree/m);
  });
  it("clean: PASS a.pins.go, exit 0", () => {
    const r = realRun(fixture("clean"));
    expect(r.code).toBe(0);
    expect(r.summary).toMatch(/^PASS a\.pins\.go  go 1\.26\.1 /m);
  });
  it("clean with its go pin deleted: FAIL x.required a.pins.go not configured, exit 1", () => {
    const dir = fixture("clean");
    put(dir, ".loops/env-check.toml", "schema_version = 1\n");
    sh(dir, "commit", "-qam", "drop the go pin");
    const r = realRun(dir);
    expect(r.code).toBe(1);
    expect(r.summary).toMatch(/^FAIL x\.required  a\.pins\.go not configured/m);
  });
});
