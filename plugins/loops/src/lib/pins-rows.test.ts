// How a pin source's raw value reaches an env-check row: kept raw by pins.ts, escaped once by the renderer.
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { deps, put, repo } from "./testkit.js";

// Value: protects=PR #25 review note 4: an engines range holding a newline is one INFO row, the newline written as \n, and
// --json keeps it raw; fails_when=the renderer stops escaping row text or a producer pre-escapes it; why_new=no row read a
// multi-line range; seam=none; no_claim=other control characters (the T1 escape tests cover them)
describe("a range is one row however it is written", () => {
  it("an engines range with a newline renders as one escaped INFO row", () => {
    const root = repo({ "README.md": "x\n", ".nvmrc": "22.1.0\n", "package.json": JSON.stringify({ engines: { node: ">=20\n<23" } }) });
    put(root, ".loops/env-check.toml", `schema_version = 1\n[[pins]]\ntool = "node"\nsources = ["nvmrc", "engines"]\ncompare = "exact"\nlocal = "off"\n`);
    const t = deps(root);
    expect(main(["env-check"], t.d)).toBe(0);
    const rows = t.out.join("\n").split("\n").filter((l) => l.includes("a.pins.node"));
    expect(rows).toEqual([expect.stringMatching(/^PASS a\.pins\.node {2}node 22\.1\.0/), 'INFO a.pins.node  engines:package.json: ">=20\\n<23" is a range, not compared']);
    const j = deps(root);
    main(["env-check", "--json"], j.d);
    expect(JSON.stringify(JSON.parse(j.out.join("\n")))).toContain('\\">=20\\n<23\\" is a range');
  });
});
