// e.project's peer policy (0.8.0, U1) with Compose stubbed: a peer's failed probe is one WARN per peer, never a FAIL
// here, and the uninterpolated fallback that recovers its names runs only where it can help, once per run and file set.
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isComposeConfigCall } from "./compose-config.js";
import { envCheckMain } from "./env-check.js";
import type { Runner, RunResult } from "./proc.js";
import { composeStub, deps, put, repo, sh, tmp, type ComposeAnswers } from "./testkit.js";

const CONFIG = 'schema_version = 1\n[compose]\nmode = "test"\nfiles = ["compose.yml"]\n';
const INTERP = { error: "error while interpolating services.web.image: required variable IMG is missing a value: s3cr3t-value" };
const res = (code: number | null, stdout = "", stderr = "", timedOut = false): RunResult => ({ code, stdout, stderr, timedOut });

let n = 0;
/** A main checkout (app-node) with compose.yml committed and `names.length` worktrees named after them. */
function checkouts(...names: string[]) {
  const root = repo({ "README.md": "x\n", "compose.yml": "services: {}\n", ".loops/env-check.toml": CONFIG });
  const parent = tmp();
  const wts = names.map((w) => {
    const dir = join(parent, w);
    sh(root, "worktree", "add", "-q", "-b", `p${n++}`, dir);
    return realpathSync(dir);
  });
  return { root: realpathSync(root), wts };
}

type Raw = { cwd: string; files: string[]; normalize: boolean };
/** `answers` for the name probes; `raw` answers each fallback probe (`--no-interpolate`), recorded in `calls`. */
function runner(answers: ComposeAnswers, raw: (r: Raw) => RunResult, calls: Raw[]): Runner {
  const inner = composeStub(answers);
  return (cmd, args, opts) => {
    if (isComposeConfigCall(cmd, args) && args.includes("--no-interpolate")) {
      const r = { cwd: realpathSync(opts?.cwd ?? ""), files: args.flatMap((a, i) => (a === "-f" ? [args[i + 1]!] : [])), normalize: !args.includes("--no-normalize") };
      calls.push(r);
      return raw(r);
    }
    return inner(cmd, args, opts);
  };
}

function check(cwd: string, run: Runner, args: string[] = []) {
  const t = deps(cwd);
  t.d.run = run;
  const code = envCheckMain(args, t.d);
  return { code, out: t.out.join("\n"), err: t.err.join("\n") };
}

describe("e.project peer WARNs and the fallback (stubbed Compose)", () => {
  it("gives one WARN per failed peer naming its first failed run and how many more, after the PASS; --compose-project exits 0 with the warnings on stderr", () => {
    const { root, wts } = checkouts("feat-a", "feat-b", "feat-c");
    const [a, b, c] = wts as [string, string, string];
    const answers = { [root]: "app-node", [a]: "feat-a", [b]: INTERP, [c]: { cfg: "feat-c", plain: { error: "boom" } } };
    const calls: Raw[] = [];
    const r = check(a, runner(answers, () => res(1, "", "nope\n"), calls), ["--json"]);
    const rows = (JSON.parse(r.out).results as { level: string; id: string; message: string }[]).filter((x) => x.id === "e.project");
    expect(r.code).toBe(0);
    expect(rows.map((x) => x.level)).toEqual(["PASS", "WARN", "WARN"]);
    expect(rows[1]!.message).toMatch(new RegExp(`^peer worktree ${b}: configured run: docker compose config exited 1: required variable IMG is missing a value, and 1 more run;`));
    expect(rows[2]!.message).toMatch(new RegExp(`^peer worktree ${c}: root plain run: docker compose config exited 1; this checkout keeps project feat-a`));
    expect(r.out).not.toContain("s3cr3t");
    const p = check(a, runner(answers, () => res(1), []), ["--compose-project"]);
    expect([p.code, p.out]).toEqual([0, "feat-a"]);
    expect(p.err.split("\n")).toEqual([expect.stringMatching(/^env-check: warning: peer worktree .*feat-b: .* — fix: run bin\/env-check in /), expect.stringMatching(/^env-check: warning: peer worktree .*feat-c: /)]);
  });

  it("runs the fallback only for kind interp or exit, once per (cwd, files), and a literal name: once more normalized", () => {
    const { root, wts } = checkouts("feat-a", "feat-b", "feat-c");
    const [a, b, c] = wts as [string, string, string];
    // feat-b fails interp (both runs), feat-c's probe times out (no fallback: it would hang as long).
    const slow: Runner = (cmd, args, opts) => (isComposeConfigCall(cmd, args) && !args.includes("--no-interpolate") && realpathSync(opts?.cwd ?? "") === c ? res(null, "", "", true) : inner(cmd, args, opts));
    const calls: Raw[] = [];
    const inner = runner({ [root]: "app-node", [a]: "feat-a", [b]: INTERP, [c]: "unused" }, (x) => res(0, JSON.stringify({ name: x.normalize ? "lit" : "Lit" })), calls);
    const r = check(a, slow);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`WARN e.project  peer worktree ${c}: configured run: docker compose config timed out after 10s`);
    expect(calls.every((x) => x.cwd === b)).toBe(true);
    expect(calls.map((x) => [x.files.join(","), x.normalize])).toEqual([["compose.yml", false], ["compose.yml", true], ["", false], ["", true]]);
    const keys = calls.map((x) => `${x.cwd}|${x.files}|${x.normalize}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("skips the fallback for every later peer once one fallback times out", () => {
    const { root, wts } = checkouts("feat-a", "feat-b", "feat-c");
    const [a, b, c] = wts as [string, string, string];
    const calls: Raw[] = [];
    const r = check(a, runner({ [root]: "app-node", [a]: "feat-a", [b]: INTERP, [c]: INTERP }, () => res(null, "", "", true), calls));
    expect(r.code, r.out).toBe(0);
    expect(calls).toEqual([{ cwd: b, files: ["compose.yml"], normalize: false }]);
    expect(r.out.match(/WARN e\.project {2}peer worktree/g)).toHaveLength(2);
  });

  it("holds a recovered name: a literal name: equal to this worktree's withholds it, and the WARN says the name was checked, not kept", () => {
    const { root, wts } = checkouts("feat-a", "feat-b");
    const [a, b] = wts as [string, string];
    const r = check(a, runner({ [root]: "app-node", [a]: "feat-a", [b]: INTERP }, () => res(0, JSON.stringify({ name: "feat-a" })), []), ["--compose-project"]);
    expect([r.code, r.out]).toEqual([1, ""]);
    expect(r.err).toContain(`env-check: this worktree would use project feat-a, which worktree ${b} uses`);
    expect(r.err).toContain(`env-check: warning: peer worktree ${b}: configured run: docker compose config exited 1: required variable IMG is missing a value, and 1 more run; this checkout's project feat-a was checked against every name loops can know`);
    // The FAIL lines come before the warnings.
    expect(r.err.indexOf("which worktree")).toBeLessThan(r.err.indexOf("warning: peer"));
  });

  it("holds the main checkout's derived name when its probe fails, and nothing for a templated name: the .env does not override", () => {
    const { root, wts } = checkouts("feat-a");
    const [a] = wts as [string];
    // A worktree directory named like the main checkout (app-node) would share its project.
    const parent = tmp();
    const twin = join(parent, "app-node");
    sh(root, "worktree", "add", "-q", "-b", `p${n++}`, twin);
    put(twin, ".loops/env-check.toml", `${CONFIG}derive = "dirname"\n`);
    const calls: Raw[] = [];
    // ${PN} with no .env: nothing resolves it locally (a ${PN:-x} would resolve to x).
    const tpl = (x: Raw) => res(0, JSON.stringify({ name: x.normalize ? "pn" : "${PN}" }));
    const r = check(twin, runner({ [root]: INTERP, [a]: "feat-a", [realpathSync(twin)]: "app-node" }, tpl, calls));
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL e.project  this worktree would use project app-node, which the main checkout uses");
    expect(r.out).toContain("its name: reads a variable loops could not resolve from that checkout's .env");
    expect(r.out).not.toContain("project pn");
    expect(calls.length).toBeGreaterThan(0);
  });
});
