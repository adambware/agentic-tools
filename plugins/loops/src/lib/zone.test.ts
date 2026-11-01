import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileGlob } from "./glob.js";
import { main } from "./loops-cli.js";
import { parseNameStatus } from "./zone-cli.js";
import { classifyPath, parseRiskZones, summarize } from "./zone.js";
import { deps, put, repo, sh, tmp } from "./testkit.js";
import { run } from "./proc.js";
import { VERSION } from "./version.js";

const ROWS = [
  "| `.github/workflows/**`, `Makefile` | red | yes | orchestration | ci |",
  "| `src/{api,db}/**` | red | ? | config, orchestration | core |",
  "| `src/**/*.test.ts` | green | no | none | tests |",
  "| `docs/**`, `*.md` | green | no | none | docs |",
  "| `src/ui/**` | yellow | no | ui | ui |",
];
const doc = (rows = ROWS, header = "> Schema version 1.") => `# risk-zones: app-node

${header}

## Zones
| Glob | Zone | Prod | Evidence class | Why (evidence) |
|---|---|---|---|---|
${rows.join("\n")}

## Ship prefix
- red: "/ship — red zone (<category>): full review + <one extra review chosen at L0>"
- yellow: "/ship — yellow zone: routine review, red-team focus on <area>"
- green: "/ship" (routine)
- docs-only: "/ship — docs only: minimal review"
- trivial S0: "Minimal ship. Skip the in-depth review."
`;

describe("glob", () => {
  const cases: [string, string, boolean][] = [
    ["*.md", "README.md", true],
    ["*.md", "docs/a.md", false], // * does not cross /
    ["*", ".env", true], // * matches dotfiles, unlike bash
    ["**/*.vcf", "a.vcf", true], // **/ is zero or more dirs
    ["**/*.vcf", "x/y/a.vcf", true],
    ["a/**", "a/b/c.txt", true],
    ["a/**", "a", false],
    ["a/**/b", "a/b", true],
    ["a/**/b", "a/x/y/b", true],
    ["a/?.txt", "a/x.txt", true],
    ["a/?.txt", "a/xy.txt", false],
    ["src/{api,db}/**", "src/db/x.go", true],
    ["src/{api,{db,ui}}/**", "src/ui/x.go", true],
    ["a.b", "axb", false], // dots are literal
    ["Makefile", "makefile", false], // case-sensitive
    [".github/**", ".github/workflows/x\n.yml", true], // ** crosses a newline in a filename, so a red row still matches
  ];
  it.each(cases)("%s vs %s", (g, p, want) => {
    expect(compileGlob(g).some((re) => re.test(p))).toBe(want);
  });

  it.each(["[ab].go", "!x", "/abs", "{a..b}", "{a,b", "a}", "{a}"])("rejects %s", (g) => {
    expect(() => compileGlob(g)).toThrow();
  });
});

describe("parseRiskZones", () => {
  it("parses rows, expanding nothing until matched, and the ship bullets", () => {
    const rz = parseRiskZones(doc(), "rz.md");
    expect(rz.rows.map((r) => r.glob)).toEqual([".github/workflows/**", "Makefile", "src/{api,db}/**", "src/**/*.test.ts", "docs/**", "*.md", "src/ui/**"]);
    expect(rz.ship.green).toBe('"/ship" (routine)');
    expect(rz.ship.red).toContain("full review");
    expect(rz.ship["trivial S0"]).toBe("Minimal ship. Skip the in-depth review.");
  });

  const bad: [string, string, RegExp][] = [
    ["no schema", doc(ROWS, "> no version here"), /^rz\.md:1: missing "Schema version/],
    ["schema 2", doc(ROWS, "> Schema version 2."), new RegExp(`^rz\\.md:3: schema 2 unsupported by loops ${VERSION.replace(/\./g, "\\.")}`)],
    ["unknown zone", doc(["| `a` | orange | no | none | x |"]), /^rz\.md:8: unknown zone "orange"/],
    ["inherited zone name", doc(["| `a` | constructor | no | none | x |"]), /^rz\.md:8: unknown zone "constructor"/],
    ["bad prod", doc(["| `a` | red | maybe | none | x |"]), /^rz\.md:8: Prod must be yes, no or \?/],
    ["wrong columns", doc(["| `a` | red | no | none |"]), /^rz\.md:8: expected 5 columns, found 4/],
    ["no backticks", doc(["| a | red | no | none | x |"]), /^rz\.md:8: Glob cell has no backticked glob/],
    ["bad glob", doc(["| `[a]*` | red | no | none | x |"]), /^rz\.md:8: unsupported glob/],
    ["pipe-less row in the table", doc([ROWS[0]!, "`Makefile` | green | no | none | x |"]), /^rz\.md:9: table row must start with `\|`/],
    ["no rows", doc([]), /^rz\.md:5: `## Zones` table has no rows/],
    ["no section", "> Schema version 1\n", /^rz\.md:1: no `## Zones`/],
  ];
  it.each(bad)("%s is an error with file:line", (_n, text, re) => {
    expect(() => parseRiskZones(text, "rz.md")).toThrow(re);
  });

  it("rejects a pipe-less table anywhere in the Zones section, before or after the piped one", () => {
    const pipeless = "Glob | Zone | Prod | Evidence class | Why\n--- | --- | --- | --- | ---\n`Makefile` | red | yes | orchestration | ci";
    const after = doc(ROWS).replace("\n\n## Ship", `\n\n${pipeless}\n\n## Ship`);
    const before = doc(ROWS).replace("## Zones\n", `## Zones\n${pipeless}\n\n`);
    expect(() => parseRiskZones(after, "rz.md")).toThrow(/^rz\.md:15: table must use leading pipes/);
    expect(() => parseRiskZones(before, "rz.md")).toThrow(/^rz\.md:7: table must use leading pipes/);
    // GFM: a piped delimiter under a pipe-less header still renders as a table
    for (const delim of ["|---|---|---|---|---|", "| --- | --- | --- | --- | --- |"]) {
      const mixed = doc(ROWS).replace("\n\n## Ship", `\n\n${pipeless.replace(/^--- .*$/m, delim)}\n\n## Ship`);
      expect(() => parseRiskZones(mixed, "rz.md")).toThrow(/^rz\.md:15: table must use leading pipes/);
    }
  });

  it("does not mistake prose around the table for rows", () => {
    const text = doc(ROWS).replace("## Zones\n", "## Zones\nintro a | b prose\n\n").replace("\n\n## Ship", "\n\ntrailing a | b prose\n\n## Ship");
    expect(parseRiskZones(text, "rz.md").rows).toHaveLength(7);
  });

  it("maps columns by name, not position", () => {
    const text = doc([]).replace(
      "| Glob | Zone | Prod | Evidence class | Why (evidence) |\n|---|---|---|---|---|",
      "| Zone | Why | Glob | Evidence class | Prod |\n|---|---|---|---|---|\n| red | ci | `Makefile` | orchestration | yes |",
    );
    expect(classifyPath(parseRiskZones(text, "rz.md"), "Makefile")).toMatchObject({ zone: "red", prod: true, evidence: ["orchestration"] });
  });
});

describe("classifyPath", () => {
  const rz = parseRiskZones(doc(), "rz.md");
  it("takes the highest zone of all matching rows, unions evidence, treats ? as prod", () => {
    expect(classifyPath(rz, "src/api/x.test.ts")).toMatchObject({ zone: "red", prod: true, evidence: ["config", "orchestration"] });
  });
  it("rounds an unmatched path up to yellow, with no prod", () => {
    expect(classifyPath(rz, "scripts/x.sh")).toMatchObject({ zone: "yellow", unmatched: true, prod: false });
  });
  it("is green only through a green row", () => {
    expect(classifyPath(rz, "docs/a/b.txt")).toMatchObject({ zone: "green", unmatched: false });
  });
});

describe("summarize", () => {
  it("scales linearly in the paths one row matches", () => {
    const rz = parseRiskZones(doc(["| `src/**` | red | yes | none | x |"]), "rz.md");
    const infos = Array.from({ length: 50_000 }, (_, i) => classifyPath(rz, `src/f${i}.ts`));
    const t = performance.now();
    const s = summarize(infos);
    expect(performance.now() - t).toBeLessThan(500);
    expect(s.drivers).toHaveLength(1);
    expect(s.drivers[0]!.paths).toHaveLength(50_000);
  });
});

describe("parseNameStatus", () => {
  it("counts both sides of a rename and deletions", () => {
    expect(parseNameStatus("M\0a.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0A\0b.ts\0")).toEqual(["a.ts", "old.ts", "new.ts", "gone.ts", "b.ts"]);
  });
});

describe("loops zone", () => {
  const zone = (cwd: string, args: string[], stdin = "") => {
    const t = deps(cwd, {}, stdin);
    const code = main(["zone", ...args], t.d);
    return { code, out: t.out.join("\n"), err: t.err.join("\n") };
  };
  const withDoc = (text = doc()) => {
    const dir = tmp();
    writeFileSync(join(dir, "rz.md"), text);
    return join(dir, "rz.md");
  };

  it("prints the golden text for a red change", () => {
    const r = zone(tmp(), ["--file", withDoc(), "--paths", ".github/workflows/ci.yml", "Makefile", "src/ui/a.ts", "scripts/x.sh", "README.md"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`zone: red
prod: yes (l7: required; prod-touching: 2 paths; 1 unmatched (counted as no))
evidence: orchestration, ui
driving rows:
  red  \`.github/workflows/**\`  1 path: .github/workflows/ci.yml
  red  \`Makefile\`  1 path: Makefile
paths: 5 (red 2, yellow 2 incl. 1 unmatched, green 1)
ship: /ship — red zone (<category>): full review + <one extra review chosen at L0>
judgment left to L0: <category>, <one extra review chosen at L0>; docs-only / trivial S0 rows;
  one-way changes (migration, deleted history, published release, public post) are red regardless`);
  });

  it("names the no-row default as the yellow driver, and lists alt bullets when all green", () => {
    const y = zone(tmp(), ["--file", withDoc(), "--paths", "scripts/x.sh"]);
    expect(y.out).toContain("  yellow  (no row: default yellow)  1 path: scripts/x.sh");
    expect(y.out).toContain("ship: /ship — yellow zone: routine review");
    const g = zone(tmp(), ["--file", withDoc(), "--paths", "README.md", "docs/a.txt"]);
    expect(g.out).toContain('ship: "/ship" (routine)');
    expect(g.out).toContain("alt: docs-only: /ship — docs only: minimal review | trivial S0: Minimal ship. Skip the in-depth review.");
  });

  it("emits json, an --explain table, and zone none for no paths", () => {
    const j = JSON.parse(zone(tmp(), ["--file", withDoc(), "--json", "--paths", "src/db/a.go", "x"]).out);
    expect(j).toMatchObject({ schema: 1, zone: "red", prod: true, unmatched: 1, counts: { red: 1, yellow: 1, green: 0 } });
    expect(j.paths[0]).toMatchObject({ path: "src/db/a.go", globs: ["src/{api,db}/**"] });
    expect(zone(tmp(), ["--file", withDoc(), "--paths", "Makefile", "--explain"]).out).toContain("  red    prod  Makefile  <- `Makefile`");
    expect(zone(tmp(), ["--file", withDoc(), "--stdin"], "").out).toBe("zone: none");
  });

  it("reads --stdin newline- and NUL-separated", () => {
    expect(JSON.parse(zone(tmp(), ["--file", withDoc(), "--json", "--stdin"], "Makefile\nREADME.md\n").out).counts.red).toBe(1);
    expect(JSON.parse(zone(tmp(), ["--file", withDoc(), "--json", "--stdin", "-z"], "a b.md\0Makefile\0").out).paths.map((p: { path: string }) => p.path)).toEqual(["Makefile", "a b.md"]);
  });

  it("preserves filename bytes: no trimming, CR stripped only for newline stdin", () => {
    const glob = (args: string[], stdin: string) => JSON.parse(zone(tmp(), ["--file", withDoc(), "--json", ...args], stdin).out).paths.map((p: { path: string; zone: string }) => [p.path, p.zone]);
    expect(glob(["--paths", " docs/a.md", " "], "")).toEqual([[" ", "yellow"], [" docs/a.md", "yellow"]]);
    expect(glob(["--stdin", "-z"], " Makefile\0  \0README.md \0")).toEqual([["  ", "yellow"], [" Makefile", "yellow"], ["README.md ", "yellow"]]);
    expect(glob(["--stdin"], "Makefile\r\ndocs/a.md\r\n")).toEqual([["Makefile", "red"], ["docs/a.md", "green"]]);
  });

  it("rejects a --stdin separator mismatch instead of reading one giant path", () => {
    const nul = "docs/README.md\0Makefile\0";
    const nl = "docs/README.md\nMakefile\n";
    for (const [args, stdin, hint] of [[["--stdin"], nul, "-z"], [["--stdin", "-z"], nl, "drop -z"]] as const) {
      const r = zone(tmp(), ["--file", withDoc(), "--json", ...args], stdin);
      expect([r.code, r.out, r.err]).toEqual([2, "", expect.stringContaining(hint)]);
    }
    // a lone unterminated name with no newline is one path
    expect(zone(tmp(), ["--file", withDoc(), "--stdin", "-z"], "Makefile").code).toBe(0);
  });

  it("rejects a path holding a line break from any input, since `**` would match across it", () => {
    const inputs: [string[], string][] = [
      [["--stdin", "-z"], "docs/README.md\nMakefile\0docs/x\0"], // two producers, only one with -z
      [["--stdin", "-z"], "docs/README.md\nMakefile\n\0"],
      [["--stdin", "-z"], "a\nb.md\0"],
      [["--stdin", "-z"], "Makefile\r\0"],
      [["--stdin", "-z"], "docs/README.md\rMakefile"],
      [["--stdin"], "docs/README.md\rMakefile\r"],
      [["--paths", "docs/README.md\nMakefile"], ""], // --paths "$(git diff --name-only)"
      [["--paths", "docs/a.md", "docs/README.md\rMakefile"], ""],
    ];
    for (const [args, stdin] of inputs) {
      const r = zone(tmp(), ["--file", withDoc(), "--json", ...args], stdin);
      expect([r.code, r.out, r.err], JSON.stringify(args.concat(stdin))).toEqual([2, "", expect.stringContaining("line break")]);
    }
  });

  it("exits 2 naming the file when the policy path is unreadable", () => {
    const dir = tmp();
    const r = zone(tmp(), ["--file", dir, "--paths", "a"]);
    expect([r.code, r.err]).toEqual([2, expect.stringContaining(`cannot read ${dir}`)]);
  });

  it("exits 2 with file:line on a bad file, a missing ship bullet, bad flags, or both inputs", () => {
    const badDoc = zone(tmp(), ["--file", withDoc(doc(["| `a` | pink | no | none | x |"])), "--paths", "a"]);
    expect([badDoc.code, badDoc.err]).toEqual([2, expect.stringMatching(/rz\.md:8: unknown zone "pink"/)]);
    const noShip = zone(tmp(), ["--file", withDoc(doc().replace(/- red:.*\n/, "")), "--paths", "Makefile"]);
    expect([noShip.code, noShip.err]).toEqual([2, expect.stringContaining('no "- red:" bullet')]);
    const noShipJson = zone(tmp(), ["--file", withDoc(doc().replace(/- red:.*\n/, "")), "--paths", "Makefile", "--json"]);
    expect([noShipJson.code, noShipJson.out, noShipJson.err]).toEqual([2, "", expect.stringContaining('no "- red:" bullet')]);
    expect(zone(tmp(), ["--file", withDoc(), "--bogus"]).code).toBe(2);
    expect(zone(tmp(), ["--file", withDoc(), "--paths", "a", "--stdin"]).code).toBe(2);
    expect(zone(tmp(), ["--file", "/nonexistent/rz.md", "--paths", "a"]).code).toBe(2);
    expect(zone(tmp(), ["--file", withDoc()]).err).toContain("not a git repository");
  });

  describe("git inputs", () => {
    const setup = () => {
      const root = repo({ "risk-zones.md": doc(), "Makefile": "all:\n", "docs/a.md": "a\n", "src/old.ts": "o\n", "src/gone.ts": "g\n", "src/keep.ts": "k\n" });
      sh(root, "checkout", "-q", "-b", "feature");
      return root;
    };
    const paths = (cwd: string, ...args: string[]): string[] => JSON.parse(zone(cwd, ["--json", ...args]).out).paths.map((p: { path: string }) => p.path);

    it("diffs against the merge base: renames count both sides, deletions count", () => {
      const root = setup();
      sh(root, "mv", "src/old.ts", "src/new.ts");
      sh(root, "rm", "-q", "src/gone.ts");
      put(root, "docs/b.md", "b\n");
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "change");
      expect(paths(root)).toEqual(["docs/b.md", "src/gone.ts", "src/new.ts", "src/old.ts"]);
    });

    it("includes dirty and untracked by default, but not ignored files; --committed excludes them", () => {
      const root = setup();
      put(root, "Makefile", "all:\n\techo\n");
      put(root, "untracked.txt", "u\n");
      put(root, ".gitignore", "ignored.log\n");
      put(root, "ignored.log", "i\n");
      expect(paths(root)).toEqual([".gitignore", "Makefile", "untracked.txt"]);
      expect(zone(root, ["--committed"]).out).toBe("zone: none");
    });

    it("classifies git-reported filenames holding a line break as they are", () => {
      const root = setup();
      put(root, "docs/x\nMakefile", "n\n"); // untracked; `**` crosses the break, so docs/** still matches
      put(root, "src/api/y\r\nz.ts", "n\n");
      const r = JSON.parse(zone(root, ["--json"]).out);
      expect(r.zone).toBe("red");
      expect(r.paths.map((p: { path: string; zone: string }) => [p.path, p.zone])).toEqual([["docs/x\nMakefile", "green"], ["src/api/y\r\nz.ts", "red"]]);
      // and from the committed diff
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "odd names");
      expect(paths(root, "--committed")).toEqual(["docs/x\nMakefile", "src/api/y\r\nz.ts"]);
    });

    it("quotes control characters in text and --explain output so a name cannot forge a line; json is untouched", () => {
      const root = setup();
      const nl = "src/db/x\nzone: green";
      const esc = "src/api/y\u001b[2Jz.ts";
      put(root, nl, "n\n");
      put(root, esc, "n\n");
      put(root, "src/api/ok.ts", "n\n");
      for (const args of [[], ["--explain"]]) {
        const r = zone(root, args);
        expect(r.code).toBe(0);
        expect(r.out.split("\n").filter((l) => l.startsWith("zone:")), args.join(" ")).toEqual(["zone: red"]);
        expect(r.out).toContain(JSON.stringify(esc));
        expect(r.out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
      }
      const e = zone(root, ["--explain"]).out;
      expect(e).toContain(`  red    prod  ${JSON.stringify(nl)}  <- \`src/{api,db}/**\``);
      expect(e).toContain("src/api/ok.ts  <-"); // plain names stay unquoted
      const j = JSON.parse(zone(root, ["--json"]).out);
      expect(j.paths.map((p: { path: string }) => p.path)).toContain(nl);
    });

    describe("submodules", () => {
      const withSub = (ignore: boolean) => {
        const sub = repo({ "a.txt": "1\n" });
        const root = repo({ "risk-zones.md": doc(["| `vendor/**` | red | no | none | vendored |", "| `*.md` | green | no | none | docs |"]) });
        sh(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vendor/sub");
        if (ignore) sh(root, "config", "-f", ".gitmodules", "submodule.vendor/sub.ignore", "all");
        sh(root, "add", "-A");
        sh(root, "commit", "-q", "-m", "add submodule");
        sh(root, "branch", "base");
        sh(root, "checkout", "-q", "-b", "feature");
        put(root, "notes.md", "n\n");
        sh(root, "add", "notes.md");
        sh(root, "commit", "-q", "-m", "notes");
        const bump = () => {
          put(sub, "a.txt", "2\n");
          sh(sub, "commit", "-qam", "bump");
          sh(join(root, "vendor/sub"), "pull", "-q", "--ff-only");
        };
        return { root, bump };
      };
      const zoneOf = (root: string, ...args: string[]): string => JSON.parse(zone(root, ["--json", "--base", "base", ...args]).out).zone;

      it("sees a committed pointer bump even when .gitmodules sets ignore=all", () => {
        const { root, bump } = withSub(true);
        bump();
        sh(root, "add", "-f", "vendor/sub");
        sh(root, "commit", "-q", "-m", "bump submodule");
        for (const args of [["--committed"], []]) expect(zoneOf(root, ...args)).toBe("red");
        sh(root, "config", "diff.ignoreSubmodules", "all"); // a config-level default must not hide it either
        expect(zoneOf(root, "--committed")).toBe("red");
      });

      it("sees an uncommitted pointer bump under ignore=all and diff.ignoreSubmodules=all", () => {
        const { root, bump } = withSub(true);
        sh(root, "config", "diff.ignoreSubmodules", "all");
        bump(); // superproject not committed
        expect(zoneOf(root)).toBe("red");
        expect(zoneOf(root, "--committed")).toBe("green");
        sh(root, "add", "-f", "vendor/sub"); // staged, working copy still at the new pointer
        expect(zoneOf(root)).toBe("red");
      });

      it("does not count a submodule whose only change is untracked files; tracked edits still count", () => {
        const { root } = withSub(false);
        put(join(root, "vendor/sub"), "build.log", "junk\n");
        expect(zoneOf(root)).toBe("green");
        put(join(root, "vendor/sub"), "a.txt", "edited\n");
        expect(zoneOf(root)).toBe("red");
      });
    });

    it("survives 150k untracked files and a huge diff (no spread-push stack overflow)", () => {
      const root = setup();
      const many = Array.from({ length: 150_000 }, (_, i) => `out/f${i}`);
      const runner: typeof run = (cmd, args, opts) => {
        if (args[0] === "ls-files") return { code: 0, stdout: many.join("\0") + "\0", stderr: "", timedOut: false };
        if (args[0] === "diff" && args.includes("--cached")) return { code: 0, stdout: many.map((p) => `M\0${p}\0`).join(""), stderr: "", timedOut: false };
        return run(cmd, args, opts);
      };
      const t = deps(root);
      t.d.run = runner;
      expect(main(["zone", "--json"], t.d)).toBe(0);
      expect(JSON.parse(t.out.join("")).paths).toHaveLength(150_000);
    });

    it("includes staged paths whose working copy was restored to HEAD", () => {
      const root = setup();
      put(root, "Makefile", "all:\n\techo\n");
      sh(root, "add", "Makefile");
      put(root, "Makefile", "all:\n");
      expect(paths(root)).toEqual(["Makefile"]);
    });

    it("resolves the base as origin/HEAD, origin/main, main, or --base", () => {
      const root = setup();
      put(root, "docs/b.md", "b\n");
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "docs");
      expect(paths(root)).toEqual(["docs/b.md"]); // falls back to main
      sh(root, "update-ref", "refs/remotes/origin/main", "HEAD~1");
      sh(root, "checkout", "-q", "main");
      sh(root, "merge", "-q", "feature");
      sh(root, "checkout", "-q", "-b", "other");
      expect(paths(root)).toEqual(["docs/b.md"]); // origin/main (HEAD~1) wins over main (== HEAD)
      expect(paths(root, "--base", "main")).toEqual([]);
      const bad = zone(root, ["--base", "nope"]);
      expect([bad.code, bad.err]).toEqual([2, expect.stringContaining("no base ref found")]);
    });
  });
});
