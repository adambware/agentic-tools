import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { put, shim, tmp } from "./testkit.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const wrapper = join(HERE, "..", "..", "templates", "env-check");
const NODE_ROW =
  "FAIL d.tools  node not runnable here (not on PATH, or a version-manager shim with no version set) — fix: install node, or set a version for this checkout (a .tool-versions line for asdf, mise use node@<version> for mise)\n";

const sandbox = (env: Record<string, string>, ...args: string[]) => {
  const r = spawnSync("/bin/sh", [wrapper, ...args], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const nodeDir = (): string => {
  const dir = tmp();
  symlinkSync(process.execPath, join(dir, "node"));
  return dir;
};
/** A $HOME whose bin/loops is a sh engine that says it ran. */
const homeWithEngine = (): string => {
  const home = tmp();
  shim("loops", 'echo "home ran $*"', join(home, "bin"));
  return home;
};
/** An executable engine with a `#!/usr/bin/env node` shebang, like the bundled bin/loops.mjs. */
const nodeEngine = (dir = tmp()): string => {
  put(dir, "loops", "#!/usr/bin/env node\nprocess.stdout.write('node ran ' + process.argv.slice(2).join(' '));\n", true);
  return join(dir, "loops");
};
/** A version-manager shim (asdf/mise style) with no version set: noise on both streams, nonzero exit. */
const unsetShimDir = (): string =>
  shim("node", 'echo "No version is set for command node"\necho "mise ERROR No version is set for shim: node" >&2\nexit 126');

describe("wrapper templates/env-check exit contract", () => {
  it("is valid POSIX sh and executable", () => {
    expect(spawnSync("/bin/sh", ["-n", wrapper]).status).toBe(0);
    expect(() => accessSync(wrapper, constants.X_OK)).not.toThrow();
  });

  it("exits 2 for an explicit LOOPS_BIN that is a directory or missing, without running $HOME/bin/loops", () => {
    for (const bad of [tmp(), join(tmp(), "nope")]) {
      const r = sandbox({ PATH: nodeDir(), HOME: homeWithEngine(), LOOPS_BIN: bad });
      expect(r).toEqual({ code: 2, out: "", err: `env-check: LOOPS_BIN=${bad} is not a file\n` });
    }
  });

  it("checks LOOPS_BIN before node: a bad LOOPS_BIN exits 2 even when node cannot run", () => {
    const bad = tmp();
    expect(sandbox({ PATH: unsetShimDir(), HOME: tmp(), LOOPS_BIN: bad })).toMatchObject({ code: 2, out: "" });
  });

  it("exits 2 for a dangling $HOME/bin/loops symlink instead of reporting the engine not installed", () => {
    const home = tmp();
    mkdirSync(join(home, "bin"));
    const link = join(home, "bin", "loops");
    symlinkSync(join(tmp(), "moved", "loops.mjs"), link);
    expect(sandbox({ PATH: nodeDir(), HOME: home })).toEqual({ code: 2, out: "", err: `env-check: ${link} is a broken link (target missing)\n` });
  });

  it("runs a `#!/usr/bin/env node` engine with the caller's args when node runs", () => {
    const home = tmp();
    nodeEngine(join(home, "bin"));
    expect(sandbox({ PATH: nodeDir(), HOME: home }, "--json")).toMatchObject({ code: 0, out: "node ran env-check --json" });
  });

  it("prints the d.tools FAIL row on stderr, nothing on stdout, and exits 1 when node is an unset version-manager shim", () => {
    const home = tmp();
    nodeEngine(join(home, "bin"));
    expect(sandbox({ PATH: unsetShimDir(), HOME: home }, "--json")).toEqual({ code: 1, out: "", err: NODE_ROW });
    expect(sandbox({ PATH: unsetShimDir(), HOME: tmp(), LOOPS_BIN: nodeEngine() })).toEqual({ code: 1, out: "", err: NODE_ROW });
  });

  it("exits 1 with the same row when node is not on PATH but an engine exists", () => {
    expect(sandbox({ PATH: tmp(), HOME: tmp(), LOOPS_BIN: nodeEngine() })).toEqual({ code: 1, out: "", err: NODE_ROW });
  });

  it("exits 3 only when no candidate exists, with or without node", () => {
    for (const PATH of [nodeDir(), tmp(), unsetShimDir()]) {
      const r = sandbox({ PATH, HOME: tmp() });
      expect(r).toMatchObject({ code: 3, out: "env-check: not run\n" });
      expect(r.err).toContain("engine not installed");
    }
  });

  it("the exit 3 hint carries the install line and the full README install URL, not CONTRIBUTING.md", () => {
    const r = sandbox({ PATH: nodeDir(), HOME: tmp() });
    expect(r.code).toBe(3);
    expect(r.err).toContain("mkdir -p ~/bin && ln -sf /path/to/agentic-tools/plugins/loops/bin/loops.mjs ~/bin/loops");
    expect(r.err).toContain("https://github.com/adambware/agentic-tools/blob/main/plugins/loops/README.md#install");
    expect(r.err).not.toContain("CONTRIBUTING");
  });
});
