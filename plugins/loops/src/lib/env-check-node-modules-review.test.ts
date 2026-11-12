// 0.8.0 PR D review fixes for d.node_modules: npm's optional set, sparse checkout, file: links, an empty run, libc.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { detectLibc, eligible, type Platform } from "./node-modules.js";
import { deps, put, repo, sh } from "./testkit.js";

const CFG = ".loops/env-check.toml";
const LINUX: Platform = { os: "linux", cpu: "x64", libc: "glibc" };
const DARWIN: Platform = { os: "darwin", cpu: "arm64", libc: null };
type Pkgs = Record<string, Record<string, unknown>>;
const I = (c: string) => `sha512-${c.repeat(8)}==`;
const LEFT = { "node_modules/left-pad": { version: "1.3.0", integrity: I("a") } };
const lock = (pkgs: Pkgs, root: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "app", version: "1.0.0", ...root }, ...pkgs } }, null, 2);
const hidden = (pkgs: Pkgs) => JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages: pkgs }, null, 2);
const CONFIG = 'schema_version = 1\n[harness]\nnode_modules = "fail"\nfiles = ["package.json"]\n';

function run(root: string, platform: Platform = LINUX, args: string[] = []) {
  const t = deps(root);
  const code = main(["env-check", ...args], { ...t.d, platform });
  const out = t.out.join("\n");
  return { code, out, rows: out.split("\n").filter((l) => l.includes(" d.node_modules ")) };
}

// Value: protects=review fixes to D2; fails_when=a package only a platform-skipped optional package needs is counted
// (a false optional WARN npm ci never clears), a sparse-checkout lockfile FAILs with a fix that does not work, a file:
// link target's own lockfile is skipped as a workspace member, an enabled check with nothing to compare prints nothing,
// or a libc-tagged package counts off Linux or on an unknown libc; why_new=each case printed the wrong row before
// these fixes (verified red); seam=Deps.platform; no_claim=real npm installs (hand-written lockfiles)
describe("d.node_modules review fixes", () => {
  it("skips npm's optional set: optional packages only a platform-skipped package depends on", () => {
    const locked = {
      ...LEFT,
      "node_modules/aplat": { version: "1.0.0", integrity: I("p"), optional: true, os: ["linux"], dependencies: { bdep: "^1.0.0" } },
      "node_modules/bdep": { version: "1.0.0", integrity: I("b"), optional: true },
    };
    const root = repo({ "package.json": "{}\n", "package-lock.json": lock(locked, { dependencies: { "left-pad": "^1.3.0" }, optionalDependencies: { aplat: "^1.0.0" } }), [CFG]: CONFIG });
    put(root, "node_modules/.package-lock.json", hidden(LEFT));
    const mac = run(root, DARWIN);
    expect(mac.rows).toEqual(["PASS d.node_modules  package-lock.json: node_modules matches (1 package)"]);
    // On linux aplat is eligible, so a missing bdep is the optional WARN.
    put(root, "node_modules/.package-lock.json", hidden({ ...LEFT, "node_modules/aplat": locked["node_modules/aplat"] }));
    expect(run(root, LINUX).rows[0]).toMatch(/^WARN d\.node_modules  package-lock\.json: optional package bdep not installed;/);
  });

  it("still compares a required package reachable only through a skipped one", () => {
    const locked = {
      ...LEFT,
      "node_modules/aplat": { version: "1.0.0", optional: true, os: ["linux"], dependencies: { req: "^1.0.0" } },
      "node_modules/req": { version: "1.0.0", integrity: I("r") },
    };
    const root = repo({ "package.json": "{}\n", "package-lock.json": lock(locked, { optionalDependencies: { aplat: "^1.0.0" } }), [CFG]: CONFIG });
    put(root, "node_modules/.package-lock.json", hidden(LEFT));
    expect(run(root, DARWIN).rows).toEqual(["FAIL d.node_modules  package-lock.json: req not installed — fix: npm ci"]);
  });

  it("a tracked lockfile sparse checkout left out is INFO, a deleted one still FAILs", () => {
    const root = repo({ "package.json": "{}\n", "package-lock.json": lock(LEFT), "app/package-lock.json": lock({}), "tools/gen/package-lock.json": lock(LEFT), [CFG]: CONFIG });
    put(root, "node_modules/.package-lock.json", hidden(LEFT));
    sh(root, "sparse-checkout", "set", ".loops", "app");
    const r = run(root);
    expect(r.code).toBe(0);
    expect(r.rows).toContain("INFO d.node_modules  tools/gen/package-lock.json: not checked out (sparse checkout), not compared");
    expect(r.rows.some((l) => l.startsWith("FAIL"))).toBe(false);
    rmSync(join(root, "app/package-lock.json"));
    expect(run(root).rows).toContain("FAIL d.node_modules  app/package-lock.json: cannot read the lockfile — fix: restore it (git checkout -- app/package-lock.json)");
  });

  it("a file: dependency's link target is not a workspace member: its own tracked lockfile is compared", () => {
    const locked = { ...LEFT, "node_modules/my-lib": { resolved: "lib", link: true }, lib: { name: "my-lib", version: "0.1.0" } };
    const root = repo({ "package.json": "{}\n", "package-lock.json": lock(locked, { dependencies: { "my-lib": "file:./lib" } }), "lib/package.json": '{"name":"my-lib"}\n', "lib/package-lock.json": lock({ "node_modules/zzz": { version: "1.0.0" } }), [CFG]: CONFIG });
    put(root, "node_modules/.package-lock.json", hidden({ ...LEFT, "node_modules/my-lib": locked["node_modules/my-lib"] }));
    put(root, "node_modules/my-lib/package.json", '{"name":"my-lib"}\n');
    expect(run(root).rows).toContain("FAIL d.node_modules  lib/package-lock.json: node_modules/ missing (1 package to install) — fix: (cd lib && npm ci)");
  });

  it("an enabled check with no tracked lockfile says so, and --require-checks reports it as INFO only", () => {
    const root = repo({ "package.json": "{}\n", ".gitignore": "package-lock.json\n", "package-lock.json": lock(LEFT), [CFG]: CONFIG });
    expect(run(root).rows).toEqual(["INFO d.node_modules  no tracked package-lock.json to compare"]);
    const req = run(root, LINUX, ["--require-checks=d.node_modules"]);
    expect(req.out).toContain("d.node_modules produced only SKIP/INFO rows (INFO d.node_modules: no tracked package-lock.json to compare)");
    expect(req.out).not.toContain("d.node_modules not configured");
  });

  it("a libc-tagged package is never eligible off linux or on an unknown libc, as in npm's checkPlatform", () => {
    expect(eligible({ libc: ["glibc"] }, DARWIN)).toBe(false);
    expect(eligible({ libc: ["glibc"] }, { ...DARWIN, libc: "glibc" })).toBe(false);
    expect(eligible({ os: ["linux"], cpu: ["x64"], libc: ["glibc"] }, { ...LINUX, libc: null })).toBe(false);
    expect(eligible({ os: ["linux"], cpu: ["x64"], libc: ["musl"] }, { ...LINUX, libc: null })).toBe(false);
    expect(eligible({ os: ["linux"], cpu: ["x64"], libc: ["glibc"] }, LINUX)).toBe(true);
  });

  it("detects libc like npm: ldd text first, the process report only when ldd is unreadable, none off linux", () => {
    const never = () => {
      throw new Error("not read");
    };
    expect(detectLibc("darwin", never, never)).toBeNull();
    expect(detectLibc("linux", () => "musl libc (x86_64)\n", never)).toBe("musl");
    expect(detectLibc("linux", () => "ldd (GNU libc) 2.36\nGNU C Library\n", never)).toBe("glibc");
    expect(detectLibc("linux", () => "something else", never)).toBeNull();
    expect(detectLibc("linux", () => null, () => ({ header: { glibcVersionRuntime: "2.36" } }))).toBe("glibc");
    expect(detectLibc("linux", () => null, () => ({ header: {}, sharedObjects: ["/lib/ld-musl-x86_64.so.1"] }))).toBe("musl");
    expect(detectLibc("linux", () => null, () => null)).toBeNull();
  });
});
