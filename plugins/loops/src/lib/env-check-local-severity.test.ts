// 0.8.0 B3 and B5: `local` as a { major, minor, patch } severity table, and a.local rows when the pins disagree.
import { execFileSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./env-config.js";
import { main } from "./loops-cli.js";
import { run, UsageError, type Runner } from "./proc.js";
import { deps, put, repo, shim, tmp } from "./testkit.js";

const HEAD = "schema_version = 1\n";
const CFG = ".loops/env-check.toml";
// go.mod's 1.26 and .tool-versions' 1.26.1 agree under every compare; the pin is 1.26.1.
const GO_FILES = { "go.mod": "module x\n\ngo 1.26\n", ".tool-versions": "go 1.26.1\n" };
const GO = (compare: string, local: string) => `${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod", "tool-versions"]\ncompare = "${compare}"\nlocal = ${local}\n`;
const SPLIT = '{ major = "fail", minor = "warn", patch = "info" }';
const goShim = (v: string) => shim("go", `echo "go version go${v} darwin/arm64"`);
const nodeShim = (v: string) => shim("node", `echo v${v}`);
const gitOnly = (): string => {
  const d = tmp();
  symlinkSync(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), join(d, "git"));
  return d;
};

function check(config: string, files: Record<string, string>, PATH: string, runner?: Runner) {
  const root = repo({ "README.md": "x\n", ...files });
  put(root, CFG, config);
  const t = deps(root, { PATH });
  if (runner) t.d.run = runner;
  const code = main(["env-check"], t.d);
  const lines = t.out.join("\n").split("\n");
  return { code, err: t.err.join("\n"), lines, local: lines.filter((l) => / a\.local\./.test(l)) };
}
const withShim = (dir: string) => `${dir}:${process.env.PATH}`;

// Value: protects=B3 local severity split (pilot ask: a patch drift should not shout like a major one); fails_when=the
// mismatch row's level stops following the first differing component, or a probe failure stops using major;
// why_new=local was one level for every difference; seam=none; no_claim=B1 range rows
describe("local severity table (B3)", () => {
  it.each([
    ["2.0.0", 1, "FAIL a.local.go  local go 2.0.0 does not match pin 1.26.1"],
    ["1.25.0", 0, "WARN a.local.go  local go 1.25.0 does not match pin 1.26.1"],
    ["1.26.0", 0, "INFO a.local.go  local go 1.26.0 does not match pin 1.26.1"],
    ["1.26.1", 0, "PASS a.local.go  local go 1.26.1 matches pin 1.26.1"],
  ])("under compare = exact, go %s is reported at its first differing component's level", (have, code, row) => {
    const r = check(GO("exact", SPLIT), GO_FILES, withShim(goShim(have)));
    expect(r.code).toBe(code);
    expect(r.local.map((l) => l.split(" — fix: ")[0])).toEqual([row]);
  });

  // The level comes from the numeric cores alone, so a prerelease of the same release is patch for every tool.
  it("a prerelease-only difference is reported at the patch level", () => {
    const one = (mod: string, have: string) => check(`${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\nlocal = ${SPLIT}\n`, { "go.mod": `module x\n\ngo ${mod}\n` }, withShim(goShim(have)));
    const rc = one("1.26", "1.26rc1");
    expect([rc.code, rc.local.map((l) => l.split(" — fix: ")[0])]).toEqual([0, ["INFO a.local.go  local go 1.26rc1 does not match pin 1.26"]]);
    const pin = one("1.26rc1", "1.26.0");
    expect([pin.code, pin.local.map((l) => l.split(" — fix: ")[0])]).toEqual([0, ["INFO a.local.go  local go 1.26.0 does not match pin 1.26rc1"]]);
  });

  it("a missing component is warn, and off drops the row for that difference", () => {
    expect(check(GO("exact", '{ patch = "off" }'), GO_FILES, withShim(goShim("1.26.0"))).local).toEqual([]);
    expect(check(GO("exact", '{ patch = "off" }'), GO_FILES, withShim(goShim("1.25.0"))).local).toEqual([expect.stringMatching(/^WARN a\.local\.go  local go 1\.25\.0 does not match/)]);
  });

  it("compare decides first: a patch difference accepted under compare = minor stays PASS", () => {
    expect(check(GO("minor", '{ patch = "fail" }'), GO_FILES, withShim(goShim("1.26.7"))).local).toEqual(["PASS a.local.go  local go 1.26.7 matches pin 1.26.1"]);
    const minor = check(GO("minor", '{ major = "fail", minor = "info" }'), GO_FILES, withShim(goShim("1.25.0")));
    expect([minor.code, minor.local[0]?.split(" — fix: ")[0]]).toEqual([0, "INFO a.local.go  local go 1.25.0 does not match pin 1.26.1"]);
  });

  it("a probe failure uses the major level; major = off reports none", () => {
    const missing = check(GO("exact", '{ major = "info", minor = "fail", patch = "fail" }'), GO_FILES, gitOnly());
    expect([missing.code, missing.local.map((l) => l.split(" — fix: ")[0])]).toEqual([0, ["INFO a.local.go  go not found on PATH"]]);
    const hung: Runner = (cmd, args, opts) => (cmd === "go" ? { code: null, stdout: "", stderr: "", timedOut: true } : run(cmd, args, opts));
    expect(check(GO("exact", '{ major = "fail", minor = "info" }'), GO_FILES, process.env.PATH!, hung).local).toEqual([expect.stringMatching(/^FAIL a\.local\.go  go version timed out after 10s/)]);
    expect(check(GO("exact", '{ major = "off" }'), GO_FILES, gitOnly()).local).toEqual([]);
  });

  it("the string forms keep their meaning: fail and warn for every difference, off (or an all-off table) never probes", () => {
    expect(check(GO("exact", '"fail"'), GO_FILES, withShim(goShim("1.26.0"))).local).toEqual([expect.stringMatching(/^FAIL a\.local\.go  local go 1\.26\.0 does not match/)]);
    expect(check(GO("exact", '"warn"'), GO_FILES, withShim(goShim("2.0.0"))).local).toEqual([expect.stringMatching(/^WARN a\.local\.go  local go 2\.0\.0 does not match/)]);
    for (const off of ['"off"', '{ major = "off", minor = "off", patch = "off" }']) {
      const probed: string[] = [];
      const spy: Runner = (cmd, args, opts) => (probed.push(cmd), run(cmd, args, opts));
      expect(check(GO("exact", off), GO_FILES, withShim(goShim("2.0.0")), spy).local).toEqual([]);
      expect(probed).not.toContain("go");
    }
  });

  it("normalizes local at parse, and a bad value is a config error (exit 2)", () => {
    const local = (v: string) => parseConfig(GO("exact", v), CFG).pins[0]!.local;
    expect(local('"fail"')).toEqual({ major: "fail", minor: "fail", patch: "fail" });
    expect(local('{ minor = "info" }')).toEqual({ major: "warn", minor: "info", patch: "warn" });
    expect(parseConfig(`${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\n`, CFG).pins[0]!.local).toEqual({ major: "warn", minor: "warn", patch: "warn" });
    for (const bad of ['"info"', '{ major = "error" }', '{ build = "warn" }', "3"]) expect(() => local(bad)).toThrow(UsageError);
    for (const bad of ["1979-05-27", "1979-05-27T07:32:00Z", "3"]) expect(() => local(bad)).toThrow(/\[\[pins\]\] #1: local must be fail\|warn\|off or a \{ major, minor, patch \} table/);
    const r = check(GO("exact", '{ major = "loud" }'), GO_FILES, withShim(goShim("1.26.1")));
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("[[pins]] #1: local.major must be fail|warn|info|off")]);
  });
});

// Value: protects=B5 (a.local stopped vanishing when the pins disagree); fails_when=the local probe is skipped on a
// disagreement or reports against only one pin; why_new=a.local was silent until the pins agreed; seam=none;
// no_claim=which pin is right (a.pins says they disagree)
describe("a.local when the pins disagree (B5)", () => {
  const NODE = (local = '"warn"') => `${HEAD}[[pins]]\ntool = "node"\nsources = ["nvmrc", "node-version", "tool-versions"]\ncompare = "exact"\nlocal = ${local}\n`;
  const NODE_FILES = { ".nvmrc": "20.11.0\n", ".node-version": "20.11.0\n", ".tool-versions": "nodejs 22.1.0\n" };
  const ALIGN = "align the pins first (a.pins.node); env-check then names the version to install";

  it("reports the installed version against each distinct pin, one row each, and says to align the pins first", () => {
    const r = check(NODE(), NODE_FILES, withShim(nodeShim("20.11.0")));
    expect(r.code).toBe(1);
    expect(r.lines[0]).toMatch(/^FAIL a\.pins\.node  .* disagree \(exact\)/);
    expect(r.local).toEqual([
      "PASS a.local.node  local node 20.11.0 matches pin 20.11.0 (nvmrc:.nvmrc, node-version:.node-version)",
      `WARN a.local.node  local node 20.11.0 does not match pin 22.1.0 (tool-versions:.tool-versions) — fix: ${ALIGN}`,
    ]);
  });

  it("each row takes its own level from the local table", () => {
    const r = check(NODE('{ major = "fail", patch = "info" }'), NODE_FILES, withShim(nodeShim("20.11.1")));
    expect(r.local.map((l) => l.split("  ")[0])).toEqual(["INFO a.local.node", "FAIL a.local.node"]);
  });

  it("a probe failure is one row at the major level", () => {
    const r = check(NODE('{ major = "fail" }'), NODE_FILES, gitOnly());
    expect(r.local).toEqual([`FAIL a.local.node  node not found on PATH — fix: ${ALIGN}`]);
  });
});
