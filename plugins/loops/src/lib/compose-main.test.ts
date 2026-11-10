// e.project's main-checkout keys (0.8.0, A4 and A5) with Compose stubbed: `[compose] main_project` is the main
// checkout's -p name, and `[compose] main_files` its file set, read by every consumer through one accessor. Also the
// config errors' upgrade hints.
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envCheckMain } from "./env-check.js";
import { parseConfig } from "./env-config.js";
import { main } from "./loops-cli.js";
import type { Runner } from "./proc.js";
import { composeStub, deps, noStacks, put, repo, sh, tmp, type ComposeAnswers, type ComposeCall } from "./testkit.js";

const CFG = ".loops/env-check.toml";
const head = (extra = "") => `schema_version = 1\n[compose]\nmode = "test"\nfiles = ["compose.yml"]\n${extra}`;

let n = 0;
/** A main checkout (app-node) with `files` committed, and one worktree per name in `wts`, each with `wtFiles` committed. */
function checkouts(files: Record<string, string>, wts: string[] = [], wtFiles: Record<string, string> = {}) {
  const root = realpathSync(repo({ "README.md": "x\n", ...files }));
  const parent = tmp();
  const ws = wts.map((w) => {
    const dir = join(parent, w);
    sh(root, "worktree", "add", "-q", "-b", `m${n++}`, dir);
    if (Object.keys(wtFiles).length) {
      for (const [f, c] of Object.entries(wtFiles)) put(dir, f, c);
      sh(dir, "add", "-A");
      sh(dir, "commit", "-q", "-m", "wt");
    }
    return realpathSync(dir);
  });
  return { root, wts: ws };
}

function check(cwd: string, run: Runner, args: string[] = [], env: Record<string, string> = {}) {
  const t = deps(cwd, env);
  t.d.run = run;
  const code = envCheckMain(args, t.d);
  return { code, out: t.out.join("\n"), err: t.err.join("\n") };
}
type Row = { level: string; id: string; message: string; fix: string | null };
const rows = (out: string, id: string): Row[] => (JSON.parse(out).results as Row[]).filter((r) => r.id === id);

/** `docker ps -a` lists `lines` (Container JSON arrays); everything else is the real runner. */
const ps = (lines: unknown[][]): Runner => (cmd, args, opts) => (cmd === "docker" && args[0] === "ps" ? { code: 0, stdout: lines.map((l) => `${JSON.stringify(l)}\n`).join(""), stderr: "", timedOut: false } : noStacks(cmd, args, opts));

describe("config: main_project, main_files and the upgrade hints", () => {
  it("validates main_project against Compose's project-name rules and main_files as a non-empty list", () => {
    expect(parseConfig(head('main_project = "app_main-2"\nmain_files = ["deploy/main.yml"]\n'), CFG).compose).toMatchObject({ mainProject: "app_main-2", mainFiles: ["deploy/main.yml"] });
    expect(parseConfig(head(), CFG).compose).toMatchObject({ mainProject: null, mainFiles: null });
    for (const bad of ['"App"', '"-app"', '"a b"', '""', "3"]) expect(() => parseConfig(head(`main_project = ${bad}\n`), CFG)).toThrow(/main_project must be a Compose project name/);
    expect(() => parseConfig(head("main_files = []\n"), CFG)).toThrow("[compose]: main_files must be a non-empty list of strings");
  });

  it("exits 2 on an invalid main_project", () => {
    const root = repo({ "compose.yml": "services: {}\n", [CFG]: head('main_project = "Bad"\n') });
    const t = deps(root);
    t.d.run = composeStub({ [root]: "app-node" });
    const r = { code: main(["env-check"], t.d), err: t.err.join("\n") };
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("main_project must be a Compose project name")]);
  });

  it("an unknown key says a newer key needs a newer engine and an engine floor; the engine floor names the update for a stable checkout and CI", () => {
    expect(() => parseConfig(head("future_key = 1\n"), CFG)).toThrow(`[compose]: unknown key "future_key" (a key from a newer loops needs a newer engine: update agentic-tools, and set engine = ">=0.8.0" or the version that added it, so an older engine says so)`);
    expect(() => parseConfig(`schema_version = 1\nengine = ">=99.0.0"\n`, CFG)).toThrow(/^config needs loops >=99\.0\.0, this is .*; update agentic-tools \(stable checkout: git pull; CI: bump the action's pinned SHA\)$/);
  });
});

describe("main_project (A4)", () => {
  const COMPOSE = { "compose.yml": "services:\n  web:\n    image: x\n" };

  it("is the main checkout's name whatever Compose answers there, and ENV_CHECK_PROJECT gets it", () => {
    const { root } = checkouts({ ...COMPOSE, [CFG]: head('main_project = "stack"\n') });
    put(root, CFG, head('main_project = "stack"\n') + `\n[[local]]\nid = "d.p"\nrun = ".loops/p.sh"\n`);
    put(root, ".loops/p.sh", '#!/bin/sh\necho "PASS d.p project=[$ENV_CHECK_PROJECT]"\n', true);
    const run = composeStub({ [root]: "app-node" });
    const r = check(root, run);
    expect([r.code, r.out]).toEqual([0, expect.stringContaining("PASS e.project  stack (main_project)")]);
    expect(r.out).toContain("project=[stack]");
    expect(check(root, run, ["--compose-project"]).out).toBe("stack");
    // The shell naming the same project is no mismatch.
    expect(check(root, run, ["--compose-project"], { COMPOSE_PROJECT_NAME: "stack" })).toMatchObject({ code: 0, out: "stack" });
  });

  it("keeps the name when the main checkout's own configured run fails (the wrappers pass -p)", () => {
    const { root } = checkouts({ ...COMPOSE, [CFG]: head('main_project = "stack"\n') });
    const r = check(root, composeStub({ [root]: { cfg: { error: "boom" }, plain: "app-node" } }), ["--json"]);
    const e = rows(r.out, "e.project");
    expect(e.map((x) => x.level)).toEqual(["FAIL"]);
    expect(check(root, composeStub({ [root]: { cfg: { error: "boom" }, plain: "app-node" } }), ["--compose-project"]).out).toBe("stack");
  });

  it("FAILs and withholds in the main checkout when the shell's COMPOSE_PROJECT_NAME differs", () => {
    const { root } = checkouts({ ...COMPOSE, [CFG]: head('main_project = "stack"\n') });
    const run = composeStub({ [root]: "app-node" });
    const r = check(root, run, [], { COMPOSE_PROJECT_NAME: "other" });
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.project  your shell's COMPOSE_PROJECT_NAME other is not [compose] main_project stack: a run here without -p would use another stack than the config names — fix: unset COMPOSE_PROJECT_NAME, or set main_project = "other" in ${CFG}`)]);
    const p = check(root, run, ["--compose-project"], { COMPOSE_PROJECT_NAME: "other" });
    expect([p.code, p.out]).toEqual([1, ""]);
  });

  it("is held from every worktree: a worktree shell or dirname-derived name equal to it FAILs, withheld", () => {
    const { root, wts } = checkouts({ ...COMPOSE, [CFG]: head('main_project = "stack"\n') }, ["feat", "stack"]);
    const [feat, stack] = wts as [string, string];
    const answers: ComposeAnswers = { [root]: "app-node", [feat]: "feat", [stack]: "stack" };
    expect(check(feat, composeStub(answers))).toMatchObject({ code: 0, out: expect.stringContaining("PASS e.project  feat (derived: dirname)") });
    const shell = check(feat, composeStub(answers), ["--compose-project"], { COMPOSE_PROJECT_NAME: "stack" });
    expect([shell.code, shell.out, shell.err]).toEqual([1, "", expect.stringContaining("would use project stack, which the main checkout uses")]);
    const named = check(stack, composeStub(answers));
    // main's name comes from main_project, not its directory (app-node): the message names that source, not dirname.
    expect([named.code, named.out]).toEqual([1, expect.stringContaining(`this worktree would use project stack, which the main checkout uses: it is [compose] main_project in ${CFG} — fix: rename this worktree's directory: git worktree move ${stack} <new-path>; or set derive = "slug-hash" in ${CFG}`)]);
    expect(named.out).toContain(`, or set another main_project in ${CFG}`);
    expect(named.out).not.toContain("derive one name");
  });

  it("a main checkout name that is not its dirname-derived one (a literal name:) gets the generic holder message", () => {
    const { root, wts } = checkouts({ ...COMPOSE, [CFG]: head() }, ["foo"]);
    const [foo] = wts as [string];
    const r = check(foo, composeStub({ [root]: "foo", [foo]: "foo" }));
    expect([r.code, r.out]).toEqual([1, expect.stringContaining(`FAIL e.project  this worktree would use project foo, which the main checkout uses — fix: rename this worktree's directory: git worktree move ${foo} <new-path>; or set derive = "slug-hash" in ${CFG}`)]);
    expect(r.out).not.toContain("derive one name");
  });

  it("is the project b.containers checks", () => {
    const { root } = checkouts({ ...COMPOSE, [CFG]: head('main_project = "stack"\ninputs = ["compose.yml"]\n') });
    const old = "2001-01-01 00:00:00 +0000 UTC";
    const run = composeStub({ [root]: "app-node" }, [], ps([["stack-web-1", "running", old, "stack", root, "", ""], ["app-node-web-1", "running", old, "app-node", root, "", ""]]));
    const r = check(root, run, ["--json"]);
    const b = rows(r.out, "b.containers");
    expect(b).toEqual([expect.objectContaining({ level: "FAIL", message: expect.stringContaining("stack-web-1 created before"), fix: expect.stringContaining("docker compose -p stack -f compose.yml up -d") })]);
    expect(b[0]!.message).not.toContain("app-node-web-1");
  });
});

describe("main_files (A5)", () => {
  const MAIN = "services:\n  db:\n    image: x\n    container_name: main-db\n";
  const WT = "services:\n  db:\n    image: x\n    container_name: wt-db\n";
  const CONF = head('main_files = ["deploy/main.yml"]\n');

  it("check 0 reads main_files in the main checkout and files in a worktree, and each fix names its key", () => {
    const { root, wts } = checkouts({ "deploy/main.yml": MAIN, [CFG]: CONF }, ["feat"], { "compose.yml": WT });
    const [w] = wts as [string];
    const calls: ComposeCall[] = [];
    const run = composeStub({ [root]: "app-node", [join(root, "deploy")]: "deploy", [w]: "feat" }, calls);
    expect(check(root, run)).toMatchObject({ code: 0 });
    expect(calls.filter((x) => x.files.length).map((x) => [x.cwd, x.files])).toEqual([[root, ["deploy/main.yml"]]]);
    sh(root, "rm", "-q", "deploy/main.yml");
    const gone = check(root, run);
    expect([gone.code, gone.out]).toEqual([1, expect.stringContaining(`FAIL e.project  no compose file found (deploy/main.yml) — fix: fix [compose] main_files in ${CFG}`)]);
    // A worktree lacking compose.yml is fixed through files.
    sh(w, "rm", "-q", "compose.yml");
    expect(check(w, run).out).toContain(`no compose file found (compose.yml) — fix: fix [compose] files in ${CFG}`);
  });

  it("a worktree probes the main checkout with main_files, and each checkout scans its own files for container_name", () => {
    const { root, wts } = checkouts({ "deploy/main.yml": MAIN, [CFG]: CONF }, ["feat"], { "compose.yml": WT });
    const [w] = wts as [string];
    const calls: ComposeCall[] = [];
    const run = composeStub({ [root]: "app-node", [join(root, "deploy")]: "deploy", [w]: "feat" }, calls);
    const fromW = check(w, run, ["--json"]);
    expect(calls.filter((x) => x.cwd === root && x.files.length).map((x) => x.files)).toEqual([["deploy/main.yml"]]);
    expect(calls.filter((x) => x.cwd === w && x.files.length).map((x) => x.files).flat()).toEqual(expect.arrayContaining(["compose.yml"]));
    const cn = (out: string) => rows(out, "e.container_name")[0]!.message;
    expect(cn(fromW.out)).toContain("wt-db");
    expect(cn(fromW.out)).not.toContain("main-db");
    const fromMain = check(root, run, ["--json"]);
    expect(cn(fromMain.out)).toContain("main-db");
    expect(cn(fromMain.out)).not.toContain("wt-db");
  });

  it("derive(main) and the main checkout's project directory follow main_files", () => {
    // dirname: the main checkout's failed probe holds the name of main_files' directory (deploy), not files' (app-node).
    const { root, wts } = checkouts({ "deploy/main.yml": MAIN, [CFG]: CONF }, ["deploy", "app-node"], { "compose.yml": WT });
    const [dep, app] = wts as [string, string];
    const answers: ComposeAnswers = { [root]: { error: "boom" }, [join(root, "deploy")]: { error: "boom" }, [dep]: "deploy", [app]: "app-node" };
    const held = check(dep, composeStub(answers));
    expect([held.code, held.out]).toEqual([1, expect.stringContaining("this worktree would use project deploy, which the main checkout uses")]);
    expect(check(app, composeStub(answers)).out).toContain("PASS e.project  app-node (derived: dirname)");
  });

  it("the b.containers fix falls back to main_files when the labels name no file", () => {
    const { root } = checkouts({ "deploy/main.yml": MAIN, [CFG]: head('main_files = ["deploy/main.yml"]\ninputs = ["deploy/main.yml"]\nallow_container_name = ["main-db"]\n') });
    const run = composeStub({ [root]: "app-node", [join(root, "deploy")]: "deploy" }, [], ps([["app-node-db-1", "running", "2001-01-01 00:00:00 +0000 UTC", "app-node", join(root, "deploy"), "", ""]]));
    const b = rows(check(root, run, ["--json"]).out, "b.containers");
    expect(b[0]!.fix).toContain("docker compose -p app-node -f deploy/main.yml up -d");
  });
});
