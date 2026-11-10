// 0.8.0 B6: an asdf shim that more than one active plugin version provides is a WARN a.local.<tool> row.
import { symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { shimOf } from "./proc.js";
import { deps, put, repo, shim, tmp } from "./testkit.js";

const CFG = ".loops/env-check.toml";
const PIN = (source = "tool-versions") => `schema_version = 1\n[[pins]]\ntool = "golangci-lint"\nsources = ["${source}"]\n`;
// The shape of the pilot's shim: golangci-lint's own plugin and a copy `go install`ed inside a Go install, plus an
// older Go that is no longer active.
const HEADER = ["golang 1.24.0", "golang 1.26.1", "golangci-lint 2.13.2"];
const lintShim = (header = HEADER) =>
  shim("golangci-lint", `${header.map((h) => `# asdf-plugin: ${h}`).join("\n")}\necho "golangci-lint has version 2.13.2 built with go1.26.1"`);
const FIX =
  "find the stray copy (asdf which golangci-lint, then the bin dir of each listed provider; a Go-installed tool is in that Go install's bin dir), remove it, then run asdf reshim; ask the machine owner if unsure";

function check(files: Record<string, string>, env: Record<string, string> = {}, opts: { shimDir?: string; config?: string; around?: (root: string) => void } = {}) {
  const root = repo({ "README.md": "x\n", ...files });
  put(root, CFG, opts.config ?? PIN());
  opts.around?.(root);
  const dir = opts.shimDir ?? lintShim();
  const t = deps(root, { PATH: `${dir}:${process.env.PATH}`, ...env });
  const code = main(["env-check"], t.d);
  const local = t.out.join("\n").split("\n").filter((l) => / a\.local\./.test(l));
  return { code, dir, local };
}
const ambiguous = (dir: string, providers: string) => `WARN a.local.golangci-lint  ambiguous shim: provided by ${providers} (shim ${join(dir, "golangci-lint")}) — fix: ${FIX}`;
const PASS = "PASS a.local.golangci-lint  local golangci-lint 2.13.2 matches pin 2.13.2";

// Value: protects=B6 (pilot: 0 FAIL while 3 of 20 runs executed a stray go-installed golangci-lint behind the asdf
// shim); fails_when=the shim header's providers stop being intersected with asdf's active versions, or one source of
// the active version (env var, nearest .tool-versions, $HOME) is not read; why_new=a.local only ran the tool by name;
// seam=none; no_claim=mise shims, installs/ scans, which copy asdf actually runs
describe("ambiguous asdf shim (B6)", () => {
  it("two active providers WARN after the version row, naming each provider and the shim path", () => {
    const r = check({ ".tool-versions": "golang 1.26.1\ngolangci-lint 2.13.2\n" });
    expect(r.code).toBe(0);
    expect(r.local).toEqual([PASS, ambiguous(r.dir, "golang 1.26.1 and golangci-lint 2.13.2")]);
  });

  it("an inactive historical provider gives no WARN", () => {
    expect(check({ ".tool-versions": "golang 1.25.0\ngolangci-lint 2.13.2\n" }).local).toEqual([PASS]);
    expect(check({ ".tool-versions": "golangci-lint 2.13.2\n" }).local).toEqual([PASS]);
  });

  it("ASDF_<PLUGIN>_VERSION, upper-cased with dashes as underscores, wins over every file", () => {
    // golangci-lint is pinned from a file asdf does not read, so only the env var makes its plugin active.
    const viaEnv = check({ "tools.txt": "golangci-lint 2.13.2\n", ".tool-versions": "golang 1.26.1\n" }, { ASDF_GOLANGCI_LINT_VERSION: "2.13.2" }, { config: PIN("tool-versions:tools.txt") });
    expect(viaEnv.local).toEqual([PASS, ambiguous(viaEnv.dir, "golang 1.26.1 and golangci-lint 2.13.2")]);
    const over = check({ ".tool-versions": "golang 1.25.0\ngolangci-lint 2.13.2\n" }, { ASDF_GOLANG_VERSION: "1.26.1" });
    expect(over.local).toEqual([PASS, ambiguous(over.dir, "golang 1.26.1 and golangci-lint 2.13.2")]);
    expect(check({ ".tool-versions": "golang 1.26.1\ngolangci-lint 2.13.2\n" }, { ASDF_GOLANG_VERSION: "1.25.0" }).local).toEqual([PASS]);
  });

  it("the nearest .tool-versions that lists the plugin, walking up from the checkout, decides", () => {
    const up = check({ ".tool-versions": "golangci-lint 2.13.2\n" }, {}, { around: (root) => put(dirname(root), ".tool-versions", "golang 1.26.1\n") });
    expect(up.local).toEqual([PASS, ambiguous(up.dir, "golang 1.26.1 and golangci-lint 2.13.2")]);
    const near = check({ ".tool-versions": "golang 1.25.0\ngolangci-lint 2.13.2\n" }, {}, { around: (root) => put(dirname(root), ".tool-versions", "golang 1.26.1\n") });
    expect(near.local).toEqual([PASS]);
  });

  it("$HOME/.tool-versions is the last source", () => {
    const home = tmp();
    put(home, ".tool-versions", "golang 1.26.1\n");
    const r = check({ ".tool-versions": "golangci-lint 2.13.2\n" }, { HOME: home });
    expect(r.local).toEqual([PASS, ambiguous(r.dir, "golang 1.26.1 and golangci-lint 2.13.2")]);
  });

  it("every version on a .tool-versions line is active; the provider is named by the first one listed that the shim has", () => {
    const r = check({ ".tool-versions": "golang 1.25.0 1.26.1 1.24.0\ngolangci-lint 2.13.2 # pinned\n" });
    expect(r.local).toEqual([PASS, ambiguous(r.dir, "golang 1.26.1 and golangci-lint 2.13.2")]);
  });

  it("two versions of one plugin are one provider, and a shim that is no asdf shim is never read for providers", () => {
    const one = check({ ".tool-versions": "golangci-lint 2.13.2 2.12.0\n" }, {}, { shimDir: lintShim(["golangci-lint 2.12.0", "golangci-lint 2.13.2"]) });
    expect(one.local).toEqual([PASS]);
    expect(check({ ".tool-versions": "golang 1.26.1\ngolangci-lint 2.13.2\n" }, {}, { shimDir: shim("golangci-lint", 'echo "golangci-lint has version 2.13.2"') }).local).toEqual([PASS]);
  });

  it("three active providers are all named", () => {
    const r = check({ ".tool-versions": "golang 1.26.1\ngolangci-lint 2.13.2\nnodejs 22.1.0\n" }, {}, { shimDir: lintShim([...HEADER, "nodejs 22.1.0"]) });
    expect(r.local).toEqual([PASS, ambiguous(r.dir, "golang 1.26.1, golangci-lint 2.13.2 and nodejs 22.1.0")]);
  });
});

describe("shimOf providers (B6)", () => {
  it("lists an asdf shim's header plugin versions in order, and none for a mise shim", () => {
    const d = tmp();
    put(d, "lint", '#!/usr/bin/env bash\n# asdf-plugin: golang 1.26.1\n# asdf-plugin: golangci-lint 2.13.2\n# asdf-plugin: noversion\nexec asdf exec "lint" "$@"\n', true);
    expect(shimOf(join(d, "lint"))?.providers).toEqual([
      { plugin: "golang", version: "1.26.1" },
      { plugin: "golangci-lint", version: "2.13.2" },
    ]);
    put(d, "mise", "#!/bin/sh\n", true);
    symlinkSync(join(d, "mise"), join(d, "tool"));
    expect(shimOf(join(d, "tool"))?.providers).toEqual([]);
  });
});
