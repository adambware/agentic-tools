// 0.8.0 D2 coverage: d.node_modules on a lockfile or hidden lockfile it cannot read, nothing to install, bundled
// packages and the object form of workspaces.
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { braces, isMember, type Platform } from "./node-modules.js";
import { deps, put, repo } from "./testkit.js";

const CFG = ".loops/env-check.toml";
const LINUX: Platform = { os: "linux", cpu: "x64", libc: "glibc" };
type Pkgs = Record<string, Record<string, unknown>>;
const I = (c: string) => `sha512-${c.repeat(8)}==`;
const LEFT = { "node_modules/left-pad": { version: "1.3.0", integrity: I("a") } };
const lock = (pkgs: Pkgs, root: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "app", version: "1.0.0", ...root }, ...pkgs } }, null, 2);
const hidden = (pkgs: Pkgs, lockfileVersion = 3) => JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion, requires: true, packages: pkgs }, null, 2);
const CONFIG = 'schema_version = 1\n[harness]\nnode_modules = "fail"\nfiles = ["package.json"]\n';

function run(root: string) {
  const t = deps(root);
  const code = main(["env-check"], { ...t.d, platform: LINUX });
  return { code, rows: t.out.join("\n").split("\n").filter((l) => l.includes(" d.node_modules ")) };
}

// Value: protects=D2's error and edge rows (an unreadable lockfile FAILs with a working fix, an unreadable or too-old
// hidden lockfile WARNs cannot-verify, an empty lockfile PASSes, a bundled package and a {packages:[...]} workspace member
// never differ); fails_when=a JSON error throws or PASSes, a broken hidden lockfile is read as empty (every package
// "not installed"), nothing-to-install FAILs, or inBundle/object workspaces are dropped; why_new=the D2 tests cover only
// a missing hidden lockfile and array workspaces; seam=Deps.platform; no_claim=real npm installs (hand-written lockfiles)
describe("d.node_modules edges", () => {
  it("a lockfile that is not valid JSON FAILs with restore-or-regenerate as the fix", () => {
    const root = repo({ "package.json": "{}\n", "package-lock.json": "{ not json\n", [CFG]: CONFIG });
    const r = run(root);
    expect(r.code).toBe(1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatch(/^FAIL d\.node_modules {2}package-lock\.json: not valid JSON \(.+\) — fix: restore it \(git checkout -- package-lock\.json\) or regenerate it with npm install$/);
  });

  it("a hidden lockfile that is not valid JSON or has an old lockfileVersion is a cannot-verify WARN; nothing to install PASSes", () => {
    const root = repo({ "package.json": "{}\n", "package-lock.json": lock(LEFT), [CFG]: CONFIG });
    put(root, "node_modules/.package-lock.json", "{ truncated");
    const bad = run(root);
    expect(bad.code).toBe(0);
    expect(bad.rows).toHaveLength(1);
    expect(bad.rows[0]).toMatch(/^WARN d\.node_modules {2}package-lock\.json: cannot verify node_modules \(node_modules\/\.package-lock\.json is not valid JSON \(.+\); it is written by npm 7 or later\) — fix: npm ci$/);
    put(root, "node_modules/.package-lock.json", hidden(LEFT, 1));
    expect(run(root).rows).toEqual(["WARN d.node_modules  package-lock.json: cannot verify node_modules (node_modules/.package-lock.json has lockfileVersion 1; it is written by npm 7 or later) — fix: npm ci"]);

    const empty = repo({ "package.json": "{}\n", "package-lock.json": lock({}), [CFG]: CONFIG });
    expect(run(empty)).toEqual({ code: 0, rows: ["PASS d.node_modules  package-lock.json: no packages to install"] });
    put(empty, "node_modules/.keep", "");
    expect(run(empty)).toEqual({ code: 0, rows: ["PASS d.node_modules  package-lock.json: no packages to install"] });
  });

  it("a bundled package is never 'not installed', and {packages: [...]} workspaces with ** skip a nested member's lockfile", () => {
    const locked = {
      ...LEFT,
      "node_modules/host": { version: "2.0.0", integrity: I("h"), bundleDependencies: ["inner"] },
      "node_modules/host/node_modules/inner": { version: "0.3.0", inBundle: true },
      "node_modules/b": { resolved: "packages/sub/b", link: true },
      "packages/sub/b": { name: "b", version: "0.1.0" },
    };
    const root = repo({
      "package.json": "{}\n",
      "package-lock.json": lock(locked, { workspaces: { packages: ["packages/**"] } }),
      "packages/sub/b/package.json": '{"name":"b"}\n',
      // A member's own lockfile, with nothing installed beside it: compared, it would FAIL node_modules/ missing.
      "packages/sub/b/package-lock.json": lock({ "node_modules/nope": { version: "1.0.0" } }),
      [CFG]: CONFIG,
    });
    put(root, "node_modules/.package-lock.json", hidden({ ...LEFT, "node_modules/host": locked["node_modules/host"], "node_modules/b": locked["node_modules/b"] }));
    put(root, "node_modules/b/package.json", '{"name":"b"}\n');
    expect(run(root)).toEqual({ code: 0, rows: ["PASS d.node_modules  package-lock.json: node_modules matches (4 packages)"] });
  });
});

// Value: protects=a workspace member named by a brace, `?` or `[...]` glob being compared as its own install (a false
// "node_modules/ missing" FAIL for a member npm installed through the root); fails_when=those constructs are matched
// literally (red on e55dc2f: the {a,b} member's lockfile FAILed); why_new=PR #33 review (codex P2), the matcher knew only
// * and **; seam=a hand-written lockfile; no_claim=minimatch's extglobs (@(a|b)) and dot rules
describe("d.node_modules workspaces globs (review fix)", () => {
  it("expands braces like npm: alternatives, nested ones, numeric ranges; a lone {x} and an escaped brace stay", () => {
    expect(braces("packages/{a,b}")).toEqual(["packages/a", "packages/b"]);
    expect(braces("{apps,libs/{x,y}}/*")).toEqual(["apps/*", "libs/x/*", "libs/y/*"]);
    expect(braces("p/v{1..3}")).toEqual(["p/v1", "p/v2", "p/v3"]);
    expect(braces("p/{x}/{a,b}")).toEqual(["p/{x}/a", "p/{x}/b"]);
    expect(braces("p/\\{a,b}")).toEqual(["p/\\{a,b}"]);
    expect(braces("p/{a,b")).toEqual(["p/{a,b"]);
  });

  it("matches ?, [...] and [!...] within a segment, and honours ! negations", () => {
    expect(isMember(["packages/?"], "packages/a")).toBe(true);
    expect(isMember(["packages/?"], "packages/ab")).toBe(false);
    expect(isMember(["packages/[ab]"], "packages/b")).toBe(true);
    expect(isMember(["packages/[!ab]"], "packages/b")).toBe(false);
    expect(isMember(["packages/[a-c]x"], "packages/bx")).toBe(true);
    expect(isMember(["packages/a.b"], "packages/aXb")).toBe(false);
    expect(isMember(["packages/*", "!packages/legacy"], "packages/legacy")).toBe(false);
    expect(isMember(["packages/*", "!packages/legacy"], "packages/new")).toBe(true);
  });

  it("skips the lockfile of a member a {a,b} glob names", () => {
    const locked = { ...LEFT, "node_modules/a": { resolved: "packages/a", link: true }, "packages/a": { name: "a", version: "0.1.0" } };
    const root = repo({
      "package.json": "{}\n",
      "package-lock.json": lock(locked, { workspaces: ["packages/{a,b}"] }),
      "packages/a/package.json": '{"name":"a"}\n',
      "packages/a/package-lock.json": lock({ "node_modules/nope": { version: "1.0.0" } }),
      [CFG]: CONFIG,
    });
    put(root, "node_modules/.package-lock.json", hidden({ ...LEFT, "node_modules/a": locked["node_modules/a"] }));
    put(root, "node_modules/a/package.json", '{"name":"a"}\n');
    expect(run(root)).toEqual({ code: 0, rows: ["PASS d.node_modules  package-lock.json: node_modules matches (2 packages)"] });
  });
});
