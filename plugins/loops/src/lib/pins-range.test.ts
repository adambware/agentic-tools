// 0.8.0 B1: `range = "check"` compares a pin against each range a source yields (engines, requires-python, a range
// input), with bundled semver. This file holds the normative operator table and the expected results.
import { describe, expect, it } from "vitest";
import { parseConfig } from "./env-config.js";
import { main } from "./loops-cli.js";
import { UsageError } from "./proc.js";
import { inRange, semverRange } from "./pins.js";
import { deps, put, repo } from "./testkit.js";

// Value: protects=the B1 operator table (what each written range means to loops); fails_when=a PEP 440 operator is read
// with semver's meaning (`>3.11` as >=3.12, `<=3.11` as <3.12, `~=3.11` as ~3.11), or a form loops cannot read exactly
// (`!=`, `===`, a prerelease, a word) is checked instead of staying INFO; why_new=ranges were never compared; seam=none;
// no_claim=which sources use PEP 440 (covered by the env-check rows below)
describe("semverRange: the range forms range = \"check\" reads", () => {
  it.each([
    // npm / Actions semver (engines, setup-* range inputs): passed to semver as written.
    [">=20.11", false, ">=20.11.0"],
    [">= 20 <22", false, ">=20.0.0 <22.0.0-0"],
    ["^20.11", false, ">=20.11.0 <21.0.0-0"],
    ["~1.20.3", false, ">=1.20.3 <1.21.0-0"],
    ["20 || 22", false, ">=20.0.0 <21.0.0-0||>=22.0.0 <23.0.0-0"],
    ["18 - 20", false, ">=18.0.0 <21.0.0-0"],
    ["<=20", false, "<21.0.0-0"], // an X-range: every 20.x
    [">20", false, ">=21.0.0"],
    ["=20.11.1", false, "20.11.1"],
    ["~> v2", false, ">=2.0.0 <3.0.0-0"], // goreleaser-action's default
    ["1.26.x || >=1.27", false, ">=1.26.0 <1.27.0-0||>=1.27.0"],
    // PEP 440 (requires-python, Poetry, Pipfile): a partial version is zero-padded, `,` is and.
    [">=3.10", true, ">=3.10.0"],
    [">3.11", true, ">3.11.0"],
    ["<=3.11", true, "<=3.11.0"],
    ["<3.13", true, "<3.13.0"],
    ["==3.12.4", true, "3.12.4"],
    ["==3.12", true, "3.12.0"],
    ["==3.12.*", true, ">=3.12.0 <3.13.0-0"],
    ["~=3.11", true, ">=3.11.0 <4.0.0"],
    ["~=3.11.2", true, ">=3.11.2 <3.12.0"],
    [">=3.10, <3.13", true, ">=3.10.0 <3.13.0"],
    ["^3.11", true, ">=3.11.0 <4.0.0-0"], // Poetry's caret, as semver's
    ["~3.11", true, ">=3.11.0 <3.12.0-0"], // Poetry's tilde, as semver's
    ["^3.9 || ^3.11", true, ">=3.9.0 <4.0.0-0||>=3.11.0 <4.0.0-0"],
  ])("%s (PEP 440: %s) reads as %s", (range, pep, want) => {
    expect(semverRange(range, pep)).toBe(want);
  });

  it.each([
    ["!=20", false],
    ["===20.11.1", false],
    ["~=3.12", false], // a PEP 440 operator outside a Python packaging file: semver would read it as ~3.12
    [">=3.10, <3.12", false], // `,` is not semver
    [">=22.0.0-rc.1", false], // a prerelease
    ["lts/*", false], // an alias: not a range isRange accepts
    ["stable", false],
    ["latest", false],
    ["3.13t", false],
    ["20", false], // a lone version is not a range
    [">=3.10, !=3.11.*, <4", true],
    ["===3.12.4", true],
    [">=3.13.0rc1", true],
    ["~=3", true], // PEP 440 needs two components
    [">=3.*", true], // a wildcard only follows ==
    ["3.10 - 3.12", true], // no hyphen ranges in PEP 440
    ["~> 3", true],
    ["=3.12", true],
  ])("%s (PEP 440: %s) is not checked (stays INFO)", (range, pep) => {
    expect(semverRange(range, pep)).toBeNull();
  });
});

// Value: protects=B1 series containment (a series pin is the set of versions it names); fails_when=a series pin is
// compared as its lowest version (pin 20 vs >=20.11 PASSes) or a partial overlap FAILs; why_new=new check; seam=none;
// no_claim=row text
describe("inRange: a pin against a range", () => {
  it.each([
    ["20", ">=20.11", false, "partly"], // 20.x is only partly inside
    ["20.11.1", ">=20.11", false, "inside"],
    ["20", ">=20", false, "inside"],
    ["20.11", "<=20", false, "inside"],
    ["18", ">=20", false, "outside"],
    ["18.2.0", ">=20.0.0", false, "outside"],
    ["20", "20 || 22", false, "inside"],
    ["21", "20 || 22", false, "outside"],
    ["1.26", "^1.20", false, "inside"],
    ["1.26.1", "~1.20.3", false, "outside"],
    ["2", "~> v2", false, "inside"],
    ["2.5.0", "~> v2", false, "inside"],
    ["3.11", "<=3.11", true, "partly"], // PEP 440: <=3.11 is <=3.11.0
    ["3.11.0", "<=3.11", true, "inside"],
    ["3.12", "~=3.11", true, "inside"],
    ["4.0", "~=3.11", true, "outside"],
    ["3.12.4", "==3.12.4", true, "inside"],
    ["3.12", "==3.12.4", true, "partly"],
    ["3.12.4", "==3.12", true, "outside"], // PEP 440: ==3.12 is 3.12.0
    ["3.13", ">=3.10, <3.13", true, "outside"],
    ["3.12.1", ">=3.10, <3.13", true, "inside"],
  ])("pin %s vs %s (PEP 440: %s) is %s", (pin, range, pep, want) => {
    expect(inRange(pin, range, pep)).toBe(want);
  });

  it.each([
    ["20", "lts/*", false],
    ["3.13", "3.13t", false],
    ["22.0.0-rc.1", ">=22", false], // a prerelease pin
    ["3.13.0rc1", ">=3.12", true],
    ["3.12", ">=3.10, !=3.11.*", true],
  ])("pin %s vs %s (PEP 440: %s) is not checked", (pin, range, pep) => {
    expect(inRange(pin, range, pep)).toBeNull();
  });
});

const HEAD = "schema_version = 1\n";
const CFG = ".loops/env-check.toml";
const NODE = (range?: string) => `${HEAD}[[pins]]\ntool = "node"\nsources = ["nvmrc", "engines"]\nlocal = "off"\n${range ? `range = "${range}"\n` : ""}`;
const ENGINES = (r: string) => JSON.stringify({ engines: { node: r } });
function check(config: string, files: Record<string, string>) {
  const root = repo({ "README.md": "x\n", ...files });
  put(root, CFG, config);
  const t = deps(root);
  const code = main(["env-check"], t.d);
  const rows = t.out.join("\n").split("\n").filter((l) => / a\.pins\./.test(l));
  return { code, rows, heads: rows.map((l) => l.split(" — fix: ")[0]) };
}

// Value: protects=B1 opt-in (range = "check" changes the range row's level; info and the default keep 0.7's INFO row);
// fails_when=the default starts comparing, or check leaves every range INFO, or the row id changes from a.pins.<tool>;
// why_new=new key; seam=none; no_claim=local rows (local = "off")
describe('[[pins]] range = "check" (B1)', () => {
  it.each([
    ["20.11.1", ">=20.11", 0, 'PASS a.pins.node  engines:package.json: pin 20.11.1 is inside ">=20.11"'],
    ["20", ">=20.11", 0, 'WARN a.pins.node  engines:package.json: pin 20 is only partly inside ">=20.11"'],
    ["18.2.0", ">=20.0.0", 1, 'FAIL a.pins.node  engines:package.json: pin 18.2.0 is outside ">=20.0.0"'],
  ])("pin %s with engines %s", (pin, range, code, row) => {
    const r = check(NODE("check"), { ".nvmrc": `${pin}\n`, "package.json": ENGINES(range) });
    expect(r.code).toBe(code);
    expect(r.heads).toEqual([`PASS a.pins.node  node ${pin} (nvmrc:.nvmrc)`, row]);
  });

  it("a WARN and a FAIL carry a fix naming both ways out", () => {
    const warn = check(NODE("check"), { ".nvmrc": "20\n", "package.json": ENGINES(">=20.11") });
    expect(warn.rows[1]).toMatch(/ — fix: pin a version the range wholly allows \(a series pin names every version in it\), or widen the range$/);
    const fail = check(NODE("check"), { ".nvmrc": "18\n", "package.json": ENGINES(">=20") });
    expect(fail.rows[1]).toMatch(/ — fix: pin a version inside the range, or change the range$/);
  });

  it.each([["info"], [undefined]])("range = %s keeps the INFO row", (range) => {
    const r = check(NODE(range), { ".nvmrc": "18.2.0\n", "package.json": ENGINES(">=20.0.0") });
    expect(r.code).toBe(0);
    expect(r.heads).toEqual(["PASS a.pins.node  node 18.2.0 (nvmrc:.nvmrc)", 'INFO a.pins.node  engines:package.json: ">=20.0.0" is a range, not compared']);
  });

  it("a range it cannot read stays INFO and says why", () => {
    const r = check(NODE("check"), { ".nvmrc": "20.11.1\n", "package.json": ENGINES(">=20 !=21") });
    expect(r.code).toBe(0);
    expect(r.heads[1]).toBe('INFO a.pins.node  engines:package.json: ">=20 !=21" is a range, not compared (not a form range = "check" reads)');
    const lone = check(NODE("check"), { ".nvmrc": "20.11.1\n", "package.json": ENGINES("20") }); // exact-looking: no range form
    expect([lone.code, lone.heads[1]]).toEqual([0, 'INFO a.pins.node  engines:package.json: "20" is a range, not compared (not a form range = "check" reads)']);
  });

  it("pins that disagree leave each range INFO", () => {
    const r = check(NODE("check").replace('"nvmrc", "engines"', '"nvmrc", "node-version", "engines"'), { ".nvmrc": "20\n", ".node-version": "22\n", "package.json": ENGINES(">=20") });
    expect(r.code).toBe(1);
    expect(r.heads[1]).toBe('INFO a.pins.node  engines:package.json: ">=20" is a range, not compared (the pins disagree)');
  });

  it("a setup-node range input is checked", () => {
    const wf = "jobs:\n  ci:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22 || 24'\n";
    const r = check(NODE("check").replace('"nvmrc", "engines"', '"nvmrc", "setup-node"'), { ".nvmrc": "20.11.1\n", ".github/workflows/ci.yml": wf });
    expect(r.code).toBe(1);
    expect(r.heads[1]).toBe('FAIL a.pins.node  setup-node:.github/workflows/ci.yml: pin 20.11.1 is outside "22 || 24"');
  });

  it("requires-python is read as PEP 440: <=3.11 is <=3.11.0, so a 3.11 series pin is only partly inside", () => {
    const wf = "jobs:\n  ci:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n";
    const cfg = `${HEAD}[[pins]]\ntool = "python"\nsources = ["python-version", "setup-python"]\nlocal = "off"\nrange = "check"\n`;
    const r = check(cfg, { ".python-version": "3.11\n", ".github/workflows/ci.yml": wf, "pyproject.toml": '[project]\nrequires-python = ">=3.10, <=3.11"\n' });
    expect(r.heads[1]).toBe('WARN a.pins.python  setup-python:.github/workflows/ci.yml: pin 3.11 is only partly inside ">=3.10, <=3.11"');
  });
});

describe("range config", () => {
  it("defaults to info and accepts check", () => {
    expect(parseConfig(`${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\n`, CFG).pins[0]!.range).toBe("info");
    expect(parseConfig(`${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\nrange = "check"\n`, CFG).pins[0]!.range).toBe("check");
  });

  it("rejects any other value (exit 2)", () => {
    expect(() => parseConfig(`${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\nrange = "warn"\n`, CFG)).toThrow(UsageError);
    expect(() => parseConfig(`${HEAD}[[pins]]\ntool = "go"\nsources = ["go-mod"]\nrange = "warn"\n`, CFG)).toThrow(/\[\[pins\]\] #1: range must be check\|info/);
  });

  it('the compare = "floor" removal error names range = "check"', () => {
    expect(() => parseConfig(`${HEAD}[[pins]]\ntool = "node"\nsources = ["nvmrc", "engines"]\ncompare = "floor"\n`, CFG)).toThrow(/floor was removed in loops 0\.6\.0.*range = "check"/);
  });
});
