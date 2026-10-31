import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileGlob } from "./glob.js";
import { main } from "./loops-cli.js";
import { parseNameStatus } from "./zone-cli.js";
import { classifyPath, parseRiskZones } from "./zone.js";
import { deps, put, repo, sh, tmp } from "./testkit.js";

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
    ["schema 2", doc(ROWS, "> Schema version 2."), /^rz\.md:3: schema 2 unsupported by loops 0\.4\.0/],
    ["unknown zone", doc(["| `a` | orange | no | none | x |"]), /^rz\.md:8: unknown zone "orange"/],
    ["inherited zone name", doc(["| `a` | constructor | no | none | x |"]), /^rz\.md:8: unknown zone "constructor"/],
    ["bad prod", doc(["| `a` | red | maybe | none | x |"]), /^rz\.md:8: Prod must be yes, no or \?/],
    ["wrong columns", doc(["| `a` | red | no | none |"]), /^rz\.md:8: expected 5 columns, found 4/],
    ["no backticks", doc(["| a | red | no | none | x |"]), /^rz\.md:8: Glob cell has no backticked glob/],
    ["bad glob", doc(["| `[a]*` | red | no | none | x |"]), /^rz\.md:8: unsupported glob/],
    ["no rows", doc([]), /^rz\.md:5: `## Zones` table has no rows/],
    ["no section", "> Schema version 1\n", /^rz\.md:1: no `## Zones`/],
  ];
  it.each(bad)("%s is an error with file:line", (_n, text, re) => {
    expect(() => parseRiskZones(text, "rz.md")).toThrow(re);
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
