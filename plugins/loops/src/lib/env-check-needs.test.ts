// 0.8.0 D1: [[local]] needs = [...] skips the check when a command is missing or its shim resolves nothing.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { run, type Runner } from "./proc.js";
import { deps, put, repo, shim, tmp } from "./testkit.js";

const CFG = ".loops/env-check.toml";
const toml = (needs: string, extra = "") => `schema_version = 1\n[[local]]\nid = "x.rel"\nrun = ".loops/checks/rel.sh"\n${needs}\n${extra}\n`;

function check(config: string, opts: { path?: string[]; args?: string[]; runner?: Runner } = {}) {
  const root = repo({ "README.md": "x\n" });
  const marker = join(tmp(), "ran");
  put(root, CFG, config);
  put(root, ".loops/checks/rel.sh", `#!/bin/sh\ntouch ${marker}\necho "PASS x.rel ok"\n`, true);
  const t = deps(root, { PATH: [...(opts.path ?? []), process.env.PATH ?? ""].join(":") });
  const code = main(["env-check", ...(opts.args ?? [])], { ...t.d, run: opts.runner ?? run });
  return { code, out: t.out.join("\n"), err: t.err.join("\n"), ran: existsSync(marker) };
}

// Value: protects=D1 (a release check that needs goreleaser FAILed on every machine without it); fails_when=needs is
// ignored, or a missing/unresolved command still runs the check; why_new=needs is an unknown [[local]] key on base
// (exit 2), so every test here is red there; seam=none; no_claim=install hints per package manager
describe("[[local]] needs (D1)", () => {
  it("a missing command SKIPs with an install hint and the check does not run", () => {
    const r = check(toml('needs = ["no-such-tool-zz"]'));
    expect(r.code).toBe(0);
    expect(r.out).toContain("SKIP x.rel  no-such-tool-zz not installed — fix: install it and put it on PATH");
    expect(r.ran).toBe(false);
  });

  it("an unresolved shim SKIPs and the check does not run", () => {
    const dir = shim("gr-tool", '# asdf-plugin: gr-tool 1.0.0\nexec asdf exec gr-tool "$@"');
    const asdf = shim("asdf", 'echo "No version is set for command gr-tool" >&2; exit 126');
    const r = check(toml('needs = ["gr-tool"]'), { path: [dir, asdf] });
    expect(r.out).toMatch(/SKIP x\.rel  gr-tool \(asdf which gr-tool exited 126.*\) not installed/);
    expect(r.ran).toBe(false);
  });

  it("a present command runs the check", () => {
    const dir = shim("gr-tool", "exit 0");
    const r = check(toml('needs = ["gr-tool"]'), { path: [dir] });
    expect(r.out).toContain("PASS x.rel");
    expect(r.out).not.toContain("SKIP x.rel");
    expect(r.ran).toBe(true);
  });

  it("--static looks on PATH only and never asks the shim manager", () => {
    const dir = shim("gr-tool", '# asdf-plugin: gr-tool 1.0.0\nexec asdf exec gr-tool "$@"');
    const asked: string[] = [];
    const runner: Runner = (cmd, args, o) => (args[0] === "which" ? (asked.push(cmd), { code: 1, stdout: "", stderr: "", timedOut: false }) : run(cmd, args, o));
    const r = check(toml('needs = ["gr-tool"]', "static = true"), { path: [dir], args: ["--static"], runner });
    expect(asked).toEqual([]);
    expect(r.ran).toBe(true);
    const gone = check(toml('needs = ["no-such-tool-zz"]', "static = true"), { args: ["--static"] });
    expect(gone.out).toContain("SKIP x.rel  no-such-tool-zz not installed");
    expect(gone.ran).toBe(false);
  });

  it("an invalid needs value is exit 2", () => {
    for (const bad of ['needs = "goreleaser"', 'needs = [1]', 'needs = ["./bin/gr"]', 'needs = ["a/b"]', 'needs = [""]']) {
      const r = check(toml(bad));
      expect(r.code, bad).toBe(2);
      expect(r.err).toContain("needs must be a list of command names");
    }
  });

  it("a needs-SKIP does not satisfy --require-checks=<id>", () => {
    const r = check(toml('needs = ["no-such-tool-zz"]'), { args: ["--require-checks=x.rel"] });
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL x.required  x.rel produced only SKIP/INFO rows (SKIP x.rel: no-such-tool-zz not installed)");
  });
});
