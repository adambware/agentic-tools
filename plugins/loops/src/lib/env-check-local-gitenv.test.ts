// 0.8.0 D7: [[local]] checks and a.local probes run on gitEnv, not the raw inherited GIT_* variables.
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { deps, put, repo, shim, tmp } from "./testkit.js";

const SHOW = 'echo "PASS x.env dir=${GIT_DIR:-none} index=${GIT_INDEX_FILE:-none} params=${GIT_CONFIG_PARAMETERS:-none} count=${GIT_CONFIG_COUNT:-none}"';

function envOf(env: (root: string) => Record<string, string>) {
  const root = repo({ "README.md": "x\n" });
  put(root, ".loops/env-check.toml", 'schema_version = 1\n[[local]]\nid = "x.env"\nrun = ".loops/checks/env.sh"\n');
  put(root, ".loops/checks/env.sh", `#!/bin/sh\n${SHOW}\n`, true);
  const t = deps(root, env(root));
  main(["env-check"], t.d);
  return t.out.join("\n") || t.err.join("\n");
}

// Value: protects=D7 (a [[local]] run from a hook inherited a foreign GIT_DIR and read another repo); fails_when=the
// local env goes back to raw c.env; why_new=on base the check sees the foreign GIT_DIR, so the first test is red;
// seam=none; no_claim=every git-spawning tool a check may run
describe("[[local]] git env (D7)", () => {
  it("a foreign GIT_DIR is dropped; GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT are kept", () => {
    const out = envOf(() => ({ GIT_DIR: join(tmp(), "other.git"), GIT_CONFIG_PARAMETERS: "'core.abbrev=9'", GIT_CONFIG_COUNT: "0" }));
    expect(out).toContain("PASS x.env  dir=none index=none params='core.abbrev=9' count=0");
  });

  it("a hook's own existing GIT_INDEX_FILE in this git-dir is kept", () => {
    const out = envOf((root) => {
      const idx = join(root, ".git", "index.lock");
      copyFileSync(join(root, ".git", "index"), idx);
      return { GIT_INDEX_FILE: idx, GIT_DIR: join(root, ".git") };
    });
    expect(out).toMatch(/PASS x\.env  dir=none index=\S+index\.lock /);
  });

  it("a.local probes get the same env", () => {
    const root = repo({ ".tool-versions": "gtool 1.2.3\n" });
    put(root, ".loops/env-check.toml", 'schema_version = 1\n[[pins]]\ntool = "gtool"\nsources = ["tool-versions"]\n');
    const dir = shim("gtool", 'if [ -n "$GIT_DIR" ]; then echo "gtool 9.9.9"; else echo "gtool 1.2.3"; fi');
    const t = deps(root, { PATH: `${dir}:${process.env.PATH}`, GIT_DIR: join(tmp(), "other.git") });
    main(["env-check"], t.d);
    expect(t.out.join("\n")).toContain("PASS a.local.gtool  local gtool 1.2.3 matches pin 1.2.3");
  });
});
