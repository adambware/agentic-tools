// 0.8.0 D2: the built-in d.node_modules check ([harness] node_modules = "fail" | "warn" | "off").
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { eligible, hostPlatform, type Platform } from "./node-modules.js";
import { deps, put, repo } from "./testkit.js";

const CFG = ".loops/env-check.toml";
const LINUX: Platform = { os: "linux", cpu: "x64", libc: "glibc" };
type Pkgs = Record<string, Record<string, unknown>>;
const I = (c: string) => `sha512-${c.repeat(8)}==`;
const LEFT = { "node_modules/left-pad": { version: "1.3.0", resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", integrity: I("a") } };
const lock = (pkgs: Pkgs, lockfileVersion = 3, root: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion, requires: true, packages: { "": { name: "app", version: "1.0.0", ...root }, ...pkgs } }, null, 2);
const hidden = (pkgs: Pkgs, lockfileVersion = 3) => JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion, requires: true, packages: pkgs }, null, 2);

function check(o: { level?: string; locked: Pkgs; installed?: Pkgs | null; noNodeModules?: boolean; version?: number; files?: Record<string, string>; extra?: (root: string) => void; args?: string[]; platform?: Platform; root?: Record<string, unknown> }) {
  const level = o.level === undefined ? 'node_modules = "fail"\n' : o.level;
  const root = repo({ "package.json": "{}\n", "package-lock.json": lock(o.locked, o.version, o.root), ...o.files, [CFG]: `schema_version = 1\n[harness]\n${level}files = ["package.json"]\n` });
  if (!o.noNodeModules) {
    put(root, "node_modules/.keep", "");
    if (o.installed !== null) put(root, "node_modules/.package-lock.json", hidden(o.installed ?? o.locked));
  }
  o.extra?.(root);
  const t = deps(root);
  const code = main(["env-check", ...(o.args ?? [])], { ...t.d, platform: o.platform ?? LINUX });
  const out = t.out.join("\n");
  return { code, out, err: t.err.join("\n"), rows: out.split("\n").filter((l) => l.includes(" d.node_modules ")) };
}

// Value: protects=D2 (a stale or partial node_modules passes every other check, then a tool fails in a confusing way);
// fails_when=the check ignores a version/integrity difference, a stale extra, a missing dev or link, or FAILs on a
// package npm skips on this platform; why_new=node_modules is an unknown [harness] key on base (exit 2), so every test
// that sets it is red there; seam=Deps.platform (os/cpu/libc injected); no_claim=real npm installs (hand-written lockfiles)
describe("d.node_modules (D2)", () => {
  it("is off by default and when set to off", () => {
    for (const level of ["", 'node_modules = "off"\n']) {
      const r = check({ level, locked: LEFT, noNodeModules: true });
      expect(r.code, level).toBe(0);
      expect(r.rows, level).toEqual([]);
    }
  });

  it("does not run under --static", () => {
    const r = check({ locked: LEFT, noNodeModules: true, args: ["--static"] });
    expect(r.code).toBe(0);
    expect(r.rows).toEqual([]);
    const req = check({ locked: LEFT, noNodeModules: true, args: ["--static", "--require-checks=d.node_modules"] });
    expect(req.out).toContain("d.node_modules produced only SKIP/INFO rows (SKIP d.node_modules: not run in --static mode)");
  });

  it("an invalid level is exit 2", () => {
    const r = check({ level: 'node_modules = "yes"\n', locked: LEFT });
    expect(r.code).toBe(2);
    expect(r.err).toContain("[harness]: node_modules must be fail|warn|off");
  });

  it("a clean install PASSes", () => {
    const r = check({ locked: LEFT });
    expect(r.code).toBe(0);
    expect(r.rows).toEqual(["PASS d.node_modules  package-lock.json: node_modules matches (1 package)"]);
  });

  it("a missing node_modules/ is a FAIL, or a WARN at warn, with npm ci in that directory as the fix", () => {
    const r = check({ locked: LEFT, noNodeModules: true });
    expect(r.code).toBe(1);
    expect(r.rows).toEqual(["FAIL d.node_modules  package-lock.json: node_modules/ missing (1 package to install) — fix: npm ci"]);
    const w = check({ level: 'node_modules = "warn"\n', locked: LEFT, noNodeModules: true });
    expect(w.code).toBe(0);
    expect(w.rows[0]).toMatch(/^WARN d\.node_modules  package-lock\.json: node_modules\/ missing/);
    const sub = check({ locked: {}, files: { "web/package-lock.json": lock(LEFT) } });
    expect(sub.rows).toContain("FAIL d.node_modules  web/package-lock.json: node_modules/ missing (1 package to install) — fix: (cd web && npm ci)");
  });

  it("version drift names the first differing package", () => {
    const r = check({ locked: { ...LEFT, "node_modules/zz": { version: "2.0.0", integrity: I("z") } }, installed: { "node_modules/left-pad": { ...LEFT["node_modules/left-pad"], version: "1.3.1" }, "node_modules/zz": { version: "2.0.1", integrity: I("z") } } });
    expect(r.code).toBe(1);
    expect(r.rows).toEqual(["FAIL d.node_modules  package-lock.json: left-pad is 1.3.1, the lockfile wants 1.3.0 (and 1 more) — fix: npm ci"]);
  });

  it("integrity drift differs", () => {
    const r = check({ locked: LEFT, installed: { "node_modules/left-pad": { ...LEFT["node_modules/left-pad"], integrity: I("b") } } });
    expect(r.rows).toEqual(["FAIL d.node_modules  package-lock.json: left-pad 1.3.0 integrity differs from the lockfile — fix: npm ci"]);
  });

  it("a package npm skips on this os, cpu or libc never differs", () => {
    const opt = { optional: true, version: "1.0.0", integrity: I("p") };
    const locked = {
      ...LEFT,
      "node_modules/@x/darwin-arm64": { ...opt, os: ["darwin"], cpu: ["arm64"] },
      "node_modules/@x/linux-arm64-gnu": { ...opt, os: ["linux"], cpu: ["arm64"], libc: ["glibc"] },
      "node_modules/@x/linux-x64-musl": { ...opt, os: ["linux"], cpu: ["x64"], libc: ["musl"] },
      "node_modules/@x/not-linux": { ...opt, os: ["!linux"] },
      "node_modules/@x/linux-x64-gnu": { ...opt, os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
    };
    const r = check({ locked, installed: { ...LEFT, "node_modules/@x/linux-x64-gnu": locked["node_modules/@x/linux-x64-gnu"] } });
    expect(r.code).toBe(0);
    expect(r.rows).toEqual(["PASS d.node_modules  package-lock.json: node_modules matches (2 packages)"]);
    // On musl the gnu build is the one npm skips, so its absence passes; a non-optional excluded package never differs either.
    const musl = check({ locked: { ...locked, "node_modules/@x/win": { version: "1.0.0", os: ["win32"] } }, installed: { ...LEFT, "node_modules/@x/linux-x64-musl": locked["node_modules/@x/linux-x64-musl"] }, platform: { ...LINUX, libc: "musl" } });
    expect(musl.rows).toEqual(["PASS d.node_modules  package-lock.json: node_modules matches (2 packages)"]);
  });

  it("libc filters as npm does: never eligible off linux or on an unknown libc", () => {
    const p = { libc: ["glibc"] };
    expect(eligible(p, { os: "darwin", cpu: "arm64", libc: null })).toBe(false);
    expect(eligible(p, { ...LINUX, libc: "musl" })).toBe(false);
    expect(eligible(p, { ...LINUX, libc: null })).toBe(false);
    expect(eligible({ os: "any" }, LINUX)).toBe(true);
    expect(eligible({ os: ["!win32", "!darwin"] }, LINUX)).toBe(true);
    expect(eligible({ cpu: "arm64" }, LINUX)).toBe(false);
    const host = hostPlatform();
    expect([host.os, host.cpu]).toEqual([process.platform, process.arch]);
    if (process.platform !== "linux") expect(host.libc).toBeNull();
  });

  it("a platform-eligible optional package that is missing is a WARN, never a FAIL", () => {
    const locked = { ...LEFT, "node_modules/fsevents": { version: "2.3.3", integrity: I("f"), optional: true, os: ["linux"] }, "node_modules/dopt": { version: "1.0.0", devOptional: true } };
    const r = check({ locked, installed: LEFT });
    expect(r.code).toBe(0);
    expect(r.rows).toEqual([
      "WARN d.node_modules  package-lock.json: optional package dopt not installed (and 1 more); npm skips an optional package whose install failed — fix: npm ci, and read its output for the optional package's error",
    ]);
  });

  it("a missing dev package differs and names --omit=dev", () => {
    const r = check({ locked: { ...LEFT, "node_modules/vitest": { version: "4.0.0", integrity: I("v"), dev: true } }, installed: LEFT });
    expect(r.code).toBe(1);
    expect(r.rows[0]).toBe("FAIL d.node_modules  package-lock.json: dev package vitest not installed (an install with --omit=dev? npm ci installs dev packages) — fix: npm ci");
  });

  it("a stale package the lockfile does not list differs", () => {
    const r = check({ locked: LEFT, installed: { ...LEFT, "node_modules/left-pad/node_modules/old": { version: "0.1.0", integrity: I("o") } } });
    expect(r.rows).toEqual(["FAIL d.node_modules  package-lock.json: left-pad/node_modules/old is installed but not in the lockfile — fix: npm ci"]);
  });

  it("workspaces: only the root tree is compared and each member link must exist", () => {
    const locked = {
      ...LEFT,
      "node_modules/a": { resolved: "packages/a", link: true },
      "packages/a": { name: "a", version: "0.1.0" },
      "packages/a/node_modules/only-in-a": { version: "9.9.9", integrity: I("q") },
    };
    const files = { "packages/a/package.json": '{"name":"a"}\n', "packages/a/package-lock.json": lock({ "node_modules/nope": { version: "1.0.0" } }) };
    const installed = { ...LEFT, "node_modules/a": locked["node_modules/a"] };
    const ok = check({ locked, installed, files, root: { workspaces: ["packages/*"] }, extra: (root) => put(root, "node_modules/a/package.json", '{"name":"a"}\n') });
    expect(ok.code).toBe(0);
    expect(ok.rows).toEqual(["PASS d.node_modules  package-lock.json: node_modules matches (2 packages)"]);
    const gone = check({ locked, installed, files, root: { workspaces: ["packages/*"] } });
    expect(gone.code).toBe(1);
    expect(gone.rows).toEqual(["FAIL d.node_modules  package-lock.json: workspace link a missing — fix: npm ci"]);
  });

  it("a lockfileVersion other than 2 or 3 is INFO unsupported lockfile", () => {
    for (const v of [1, 4]) {
      const r = check({ locked: LEFT, version: v, noNodeModules: true });
      expect(r.code, String(v)).toBe(0);
      expect(r.rows).toEqual([`INFO d.node_modules  package-lock.json: unsupported lockfile (lockfileVersion ${v}; 2 and 3 are read), not compared`]);
    }
    expect(check({ locked: LEFT, version: 2 }).rows[0]).toMatch(/^PASS /);
  });

  it("no node_modules/.package-lock.json is a cannot-verify WARN", () => {
    const r = check({ locked: LEFT, installed: null });
    expect(r.code).toBe(0);
    expect(r.rows).toEqual(["WARN d.node_modules  package-lock.json: cannot verify node_modules (no node_modules/.package-lock.json; it is written by npm 7 or later) — fix: npm ci"]);
  });
});
