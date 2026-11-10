// 0.8.0 B2: `[[pins]] optional = [...]`, sources that are read when present and skipped when absent.
import { describe, expect, it } from "vitest";
import { parseConfig } from "./env-config.js";
import { main } from "./loops-cli.js";
import { UsageError } from "./proc.js";
import { deps, put, repo } from "./testkit.js";

const HEAD = "schema_version = 1\n";
const CFG = ".loops/env-check.toml";
const q = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
const PIN = (tool: string, sources: string[], optional: string[], local = '"off"') =>
  `${HEAD}[[pins]]\ntool = "${tool}"\nsources = ${q(sources)}\noptional = ${q(optional)}\nlocal = ${local}\n`;

function check(config: string, files: Record<string, string>) {
  const root = repo({ "README.md": "x\n", ...files });
  put(root, CFG, config);
  const t = deps(root);
  const code = main(["env-check"], t.d);
  const lines = t.out.join("\n").split("\n");
  return { code, err: t.err.join("\n"), lines, pins: lines.filter((l) => / a\.(pins|local)\./.test(l)) };
}

// Value: protects=B2 subset validation (a typo or a bare filename in optional must not silently make nothing optional);
// fails_when=an optional entry outside sources is accepted, or the error stops naming it; why_new=optional is a new key;
// seam=none; no_claim=how an optional source is read (rows below)
describe("[[pins]] optional: config validation (B2)", () => {
  it("holds exact source specifications, defaulting to none", () => {
    expect(parseConfig(`${HEAD}[[pins]]\ntool = "node"\nsources = ["nvmrc"]\n`, CFG).pins[0]!.optional).toEqual([]);
    const cfg = parseConfig(PIN("node", ["nvmrc", "tool-versions:.tool-versions"], ["tool-versions:.tool-versions"]), CFG);
    expect(cfg.pins[0]!.optional).toEqual(["tool-versions:.tool-versions"]);
  });

  it.each([
    [["nvmrc"], [".nvmrc"], /\[\[pins\]\] #1: optional ".nvmrc" is not in sources/], // a filename, not the spec
    [["nvmrc", "tool-versions:.tool-versions"], ["tool-versions"], /optional "tool-versions" is not in sources/], // not as written
    [["nvmrc"], ["nvmrc", "engines"], /optional "engines" is not in sources/],
  ])("sources %j with optional %j is exit 2 naming the stray entry", (sources, optional, re) => {
    expect(() => parseConfig(PIN("node", sources, optional), CFG)).toThrow(UsageError);
    expect(() => parseConfig(PIN("node", sources, optional), CFG)).toThrow(re);
  });

  it("must be a list of strings", () => {
    expect(() => parseConfig(`${HEAD}[[pins]]\ntool = "node"\nsources = ["nvmrc"]\noptional = "nvmrc"\n`, CFG)).toThrow(/optional must be a list of strings/);
  });

  it("env-check exits 2 on a stray entry", () => {
    const r = check(PIN("node", ["nvmrc"], [".nvmrc"]), { ".nvmrc": "20.11.1\n" });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/optional "\.nvmrc" is not in sources/);
  });
});

// Value: protects=B2 optional sources (pilot ask: a fresh worktree or a repo without one file FAILed a.pins); fails_when=
// an absent optional source FAILs, a missing non-optional source stops FAILing, a present-but-invalid optional source is
// skipped, or an all-absent pin is anything but one SKIP; why_new=every listed source was required; seam=none;
// no_claim=which files a kind reads (pins.test.ts)
describe("optional pin sources (B2)", () => {
  const NODE = ["nvmrc", "tool-versions"];

  it("an absent optional source is skipped", () => {
    const r = check(PIN("node", NODE, ["tool-versions"]), { ".nvmrc": "20.11.1\n" });
    expect([r.code, r.pins]).toEqual([0, ["PASS a.pins.node  node 20.11.1 (nvmrc:.nvmrc)"]]);
  });

  it("a present optional source is read and compared", () => {
    const r = check(PIN("node", NODE, ["tool-versions"]), { ".nvmrc": "20.11.1\n", ".tool-versions": "nodejs 22.1.0\n" });
    expect(r.code).toBe(1);
    expect(r.pins).toEqual([expect.stringMatching(/^FAIL a\.pins\.node  nvmrc:\.nvmrc=20\.11\.1, tool-versions:\.tool-versions=22\.1\.0 disagree/)]);
  });

  it("a missing non-optional source still FAILs", () => {
    const r = check(PIN("node", NODE, ["tool-versions"]), { ".tool-versions": "nodejs 20.11.1\n" });
    expect(r.code).toBe(1);
    expect(r.pins).toEqual([expect.stringMatching(/^FAIL a\.pins\.node  nvmrc: \.nvmrc not found/)]);
  });

  it("only absence is suppressed: a present-but-invalid optional source FAILs", () => {
    const r = check(PIN("node", NODE, ["tool-versions"]), { ".nvmrc": "20.11.1\n", ".tool-versions": "golang 1.26.1\n" });
    expect(r.code).toBe(1);
    expect(r.pins).toEqual([expect.stringMatching(/^FAIL a\.pins\.node  tool-versions: no node version found in \.tool-versions/)]);
  });

  it("a glob with zero matches counts as absent", () => {
    const glob = "setup-go:.github/workflows/*.yml";
    const r = check(PIN("go", ["go-mod", glob], [glob]), { "go.mod": "module x\n\ngo 1.26.1\n" });
    expect([r.code, r.pins]).toEqual([0, ["PASS a.pins.go  go 1.26.1 (go-mod:go.mod)"]]);
  });

  it("a non-optional glob with zero matches still FAILs", () => {
    const r = check(PIN("go", ["go-mod", "setup-go:.github/workflows/*.yml"], []), { "go.mod": "module x\n\ngo 1.26.1\n" });
    expect(r.code).toBe(1);
    expect(r.pins).toEqual([expect.stringMatching(/^FAIL a\.pins\.go  setup-go:\.github\/workflows\/\*\.yml: no file matches/)]);
  });

  it("every source optional and none present is one SKIP, with no a.local row", () => {
    const r = check(PIN("node", NODE, NODE, '"fail"'), {});
    expect([r.code, r.pins]).toEqual([0, ["SKIP a.pins.node  no source present (all optional: nvmrc, tool-versions)"]]);
  });

  it("every source optional and one present is checked as usual", () => {
    const r = check(PIN("node", NODE, NODE), { ".tool-versions": "nodejs 20.11.1\n" });
    expect([r.code, r.pins]).toEqual([0, ["PASS a.pins.node  node 20.11.1 (tool-versions:.tool-versions)"]]);
  });
});
