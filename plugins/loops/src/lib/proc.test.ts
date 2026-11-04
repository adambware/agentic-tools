import { chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv, redactHome, shimOf } from "./proc.js";
import { put, tmp } from "./testkit.js";

describe("shimOf", () => {
  it("reads an asdf shim's header and the asdf it execs, without running it", () => {
    const d = tmp();
    put(d, "byname", '#!/usr/bin/env bash\n# asdf-plugin: golang 1.26.6\nexec asdf exec "byname" "$@"\n', true);
    put(d, "bypath", '#!/usr/bin/env bash\n# asdf-plugin: nodejs 20.0.0\n# asdf-plugin: nodejs 22.1.0\nexec /home/u/.asdf/bin/asdf exec "bypath" "$@"\n', true);
    put(d, "quoted", '#!/usr/bin/env bash\n# asdf-plugin: x 1\nexec "/opt/asdf dir/bin/asdf" exec "quoted" "$@"\n', true);
    put(d, "varpath", '#!/usr/bin/env bash\n# asdf-plugin: x 1\nexec $ASDF_DIR/bin/asdf exec "varpath" "$@"\n', true);
    expect(shimOf(join(d, "byname"))).toEqual({ manager: "asdf", cmd: null });
    expect(shimOf(join(d, "bypath"))).toEqual({ manager: "asdf", cmd: "/home/u/.asdf/bin/asdf" });
    expect(shimOf(join(d, "quoted"))).toEqual({ manager: "asdf", cmd: "/opt/asdf dir/bin/asdf" });
    expect(shimOf(join(d, "varpath"))).toEqual({ manager: "asdf", cmd: null }); // not a plain absolute path: PATH lookup
  });

  it("never takes an exec'd program not named asdf as the asdf to ask, so a planted shim cannot pick what runs", () => {
    const d = tmp();
    put(d, "evil", '#!/usr/bin/env bash\n# asdf-plugin: x 1\nexec /tmp/payload exec "evil" "$@"\n', true);
    put(d, "lookalike", '#!/usr/bin/env bash\n# asdf-plugin: x 1\nexec "/opt/asdf/bin/asdf-wrapper" exec "lookalike" "$@"\n', true);
    expect(shimOf(join(d, "evil"))).toEqual({ manager: "asdf", cmd: null });
    expect(shimOf(join(d, "lookalike"))).toEqual({ manager: "asdf", cmd: null });
  });

  it("takes a symlink to the mise binary as a mise shim, but not mise itself", () => {
    const d = tmp();
    put(d, "mise", "#!/bin/sh\n", true);
    symlinkSync(join(d, "mise"), join(d, "tool"));
    symlinkSync(join(d, "mise"), join(d, "mise-link"));
    expect(shimOf(join(d, "tool"))).toEqual({ manager: "mise", cmd: join(d, "mise") });
    expect(shimOf(join(d, "mise-link"))).toEqual({ manager: "mise", cmd: join(d, "mise") });
    expect(shimOf(join(d, "mise"))).toBeNull();
  });

  it("is null for a plain script, a header past the first lines, an unreadable file or a missing one", () => {
    const d = tmp();
    put(d, "plain", "#!/bin/sh\necho hi\n", true);
    put(d, "late", `#!/bin/sh\n${"#\n".repeat(5000)}# asdf-plugin: x 1\n`, true);
    put(d, "inline", '#!/bin/sh\necho "# asdf-plugin: x 1"\n', true);
    put(d, "locked", "#!/usr/bin/env bash\n# asdf-plugin: x 1\n", true);
    chmodSync(join(d, "locked"), 0o111);
    expect(shimOf(join(d, "plain"))).toBeNull();
    expect(shimOf(join(d, "late"))).toBeNull();
    expect(shimOf(join(d, "inline"))).toBeNull();
    if (process.getuid?.() !== 0) expect(shimOf(join(d, "locked"))).toBeNull();
    expect(shimOf(join(d, "nope"))).toBeNull();
  });
});

describe("gitEnv", () => {
  it("drops git's repo-local variables and keeps the rest, without changing its argument", () => {
    const env = { GIT_DIR: "/x/.git", GIT_INDEX_FILE: "/x/i", GIT_CONFIG_PARAMETERS: "'a.b'='c'", GIT_COMMON_DIR: "/x", GIT_SSH_COMMAND: "ssh", GIT_CONFIG_GLOBAL: "/g", PATH: "/bin" };
    expect(gitEnv(env)).toEqual({ GIT_SSH_COMMAND: "ssh", GIT_CONFIG_GLOBAL: "/g", PATH: "/bin" });
    expect(env.GIT_DIR).toBe("/x/.git");
  });
});

describe("redactHome", () => {
  const home = "/Users/bob";
  it.each([
    ["a longer name", "/Users/bob2/x", "/Users/bob2/x"],
    ["a dotted sibling", "/Users/bob.old/x and /Users/bob-x", "/Users/bob.old/x and /Users/bob-x"],
    ["home deeper in another path", "/x/Users/bob/y", "/x/Users/bob/y"],
    ["a PATH list", "a:/Users/bob:/Users/bobby:/Users/bob/bin", "a:~:/Users/bobby:~/bin"],
    ["prose and punctuation", "in /Users/bob/x, (/Users/bob) root=/Users/bob/y //Users/bob", "in ~/x, (~) root=~/y /~"],
    ["quoted words", "cd '/Users/bob' && cd '/Users/bob/x y' && cd '/Users/bob2'", "cd ~ && cd ~/'x y' && cd '/Users/bob2'"],
  ])("redacts only at a path-segment boundary on both sides: %s", (_n, s, want) => {
    expect(redactHome(s, home)).toBe(want);
    expect(redactHome(s, `${home}/`)).toBe(want);
  });

  it("matches HOME literally, with no pattern built from it", () => {
    for (const h of ["/h/a.b", "/h/a+b", "/h/a(b", "/h/a.b+c(d)"]) {
      const lookalike = h.replace(/[.+(]/g, "X");
      expect(redactHome(`${h}/x ${lookalike}/x ${h}`, h)).toBe(`~/x ${lookalike}/x ~`);
    }
  });

  it("redacts nothing when HOME is not an absolute path", () => {
    for (const h of ["build", "build/", "./build", "~", "", "/", "//"]) expect(redactHome("build/x /tmp/build/y ~/z", h)).toBe("build/x /tmp/build/y ~/z");
  });
});
