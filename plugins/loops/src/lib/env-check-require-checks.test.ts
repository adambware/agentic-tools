// 0.8.0 C2: `env-check --require-checks[=<ids>]`, so CI fails when a check it relies on stops running.
import { describe, expect, it } from "vitest";
import { parseConfig, RESERVED_IDS } from "./env-config.js";
import { main } from "./loops-cli.js";
import { parseFlags, UsageError } from "./proc.js";
import { deps, put, repo } from "./testkit.js";

const HEAD = "schema_version = 1\n";
const CFG = ".loops/env-check.toml";
const GO_PIN = `[[pins]]\ntool = "go"\nsources = ["go-mod"]\n`;
const NODE_PIN = `[[pins]]\ntool = "node"\nsources = ["nvmrc"]\n`;
const FILES = { "go.mod": "module x\n\ngo 1.26.1\n", ".nvmrc": "20.11.1\n" };
/** A [[local]] check `id` whose script prints `lines`; static = true unless `full`. */
const LOCAL = (id: string, script: string, full = false) => `[[local]]\nid = "${id}"\nrun = "${script}"\n${full ? "" : "static = true\n"}`;

function setup(config: string, files: Record<string, string> = {}): string {
  const root = repo({ "README.md": "x\n", ...FILES, ...files });
  put(root, CFG, HEAD + config);
  return root;
}
function check(root: string, ...args: string[]) {
  const t = deps(root);
  const code = main(["env-check", "--static", ...args], t.d);
  const out = t.out.join("\n");
  const lines = out.split("\n");
  return { code, out, err: t.err.join("\n"), lines, required: lines.filter((l) => l.startsWith("FAIL x.required")) };
}
const script = (rel: string, ...lines: string[]): Record<string, string> => ({ [`${rel}*`]: `#!/bin/sh\n${lines.map((l) => `echo '${l}'`).join("\n")}\n` });

// Value: protects=the opt flag kind (bare = true, =v = value) that --require-checks needs; fails_when=the space form is
// taken as the value (a typo'd CI line would then silently pass a different check list), or "=" alone is accepted as an
// empty list; why_new=parseFlags had no optional-value kind; seam=none; no_claim=env-check's use of it (below)
describe("parseFlags optional-value flags (C2)", () => {
  const spec = { bool: ["static"], opt: ["require-checks"] };
  it("is true bare and the value after =", () => {
    expect(parseFlags(["--require-checks"], spec)).toEqual({ "require-checks": true });
    expect(parseFlags(["--require-checks=a.pins.go,b.x"], spec)).toEqual({ "require-checks": "a.pins.go,b.x" });
    expect(parseFlags(["--require-checks", "--static"], spec)).toEqual({ "require-checks": true, static: true });
  });
  it("rejects an empty value after =", () => {
    expect(() => parseFlags(["--require-checks="], spec)).toThrow(UsageError);
    expect(() => parseFlags(["--require-checks="], spec)).toThrow(/--require-checks= needs a value/);
  });
  it("does not take the next argument as its value, and says to write =<value>", () => {
    expect(() => parseFlags(["--require-checks", "a.pins.go"], spec)).toThrow(UsageError);
    expect(() => parseFlags(["--require-checks", "a.pins.go"], spec)).toThrow(/unexpected argument a\.pins\.go.*--require-checks=a\.pins\.go/);
  });
  it("rejects a repeated flag instead of letting the last one drop an earlier list", () => {
    for (const argv of [["--require-checks=a.pins.go", "--require-checks=b.x"], ["--require-checks=a.pins.go", "--require-checks"], ["--require-checks", "--require-checks=a.pins.go"]]) {
      expect(() => parseFlags(argv, spec)).toThrow(/--require-checks given twice/);
    }
  });
});

// Value: protects=the reserved x.* ids (a [[local]] named x.required could fake or hide the engine's own row);
// fails_when=x.required is accepted as a [[local]] id, or the two reserved ids drift apart; why_new=x.required is new;
// seam=none; no_claim=x.none's wording (env-check.test.ts)
describe("reserved ids (C2)", () => {
  it("are x.none and x.required, in one constant", () => {
    expect(RESERVED_IDS).toEqual(["x.none", "x.required"]);
  });
  it("x.required as a [[local]] id is exit 2", () => {
    expect(() => parseConfig(HEAD + LOCAL("x.required", "c.sh"), CFG)).toThrow(/\[\[local\]\] #1: id x\.required is reserved for env-check's own/);
    const r = check(setup(LOCAL("x.required", "c.sh"), script("c.sh", "PASS x.required ok")));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/id x\.required is reserved/);
  });
});

// Value: protects=C2 usage errors (a malformed CI line must stop the job, not check nothing); fails_when=the space form,
// an empty value or item, a malformed or reserved id, or a combination with --compose-project runs instead of exit 2;
// why_new=--require-checks is new; seam=none; no_claim=matching (below)
describe("--require-checks usage (C2)", () => {
  const root = () => setup(GO_PIN);
  it("the space form is exit 2 and names the = form", () => {
    const r = check(root(), "--require-checks", "a.pins.go");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--require-checks=a\.pins\.go/);
  });
  it("--require-checks= is exit 2", () => {
    const r = check(root(), "--require-checks=");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--require-checks= needs a value/);
  });
  it.each([
    ["pins.go", /"pins\.go" must look like <a-e or x>\.<name>/],
    ["f.x", /"f\.x" must look like/],
    ["a.", /"a\." must look like/],
    ["a.pins.[go]", /"a\.pins\.\[go\]" must look like/],
    ["*.go", /"\*\.go" must look like/],
    ["a.pins.go,,b.x", /empty id in "a\.pins\.go,,b\.x"/],
    ["a.pins.go,", /empty id/],
    ["x.none", /x\.none is reserved/],
    ["a.pins.go,x.required", /x\.required is reserved/],
  ])("--require-checks=%s is exit 2", (ids, re) => {
    const r = check(root(), `--require-checks=${ids}`);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(re);
  });
  it("does not combine with --compose-project", () => {
    const t = deps(setup(`${GO_PIN}[compose]\nmode = "test"\nfiles = ["compose.yml"]\n`, { "compose.yml": "services: {}\n" }));
    expect(main(["env-check", "--compose-project", "--require-checks"], t.d)).toBe(2);
    expect(t.err.join("\n")).toMatch(/--require-checks does not combine with --compose-project/);
  });
});

// Value: protects=C2 bare form (a CI job whose config checks nothing must go red, not pass on a WARN); fails_when=bare
// --require-checks leaves x.none a WARN or exit 0, or the list form drops the x.none FAIL; why_new=x.none was always a
// WARN; seam=none; no_claim=x.none without the flag (guard below)
describe("--require-checks bare: x.none is a FAIL (C2)", () => {
  it("a run that checked nothing is FAIL x.none, exit 1", () => {
    const r = check(setup(""), "--require-checks");
    expect(r.code).toBe(1);
    expect(r.lines).toContainEqual(expect.stringMatching(/^FAIL x\.none {2}no check ran under --static/));
    expect(r.out).toMatch(/env-check: 1 FAIL, 0 WARN, 0 PASS/);
  });
  it("the list form implies it, and x.required rows follow x.none, last", () => {
    const r = check(setup(""), "--require-checks=a.pins.go");
    expect(r.code).toBe(1);
    const rows = r.lines.filter((l) => /^(PASS|WARN|FAIL|SKIP|INFO) /.test(l));
    expect(rows.slice(-2).map((l) => l.split("  ")[0])).toEqual(["FAIL x.none", "FAIL x.required"]);
  });
  it("a run that checked something has no x.none row", () => {
    const r = check(setup(GO_PIN), "--require-checks");
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/x\.none|x\.required/);
  });
});

// Value: protects=C2 required ids (the Compose + Go pilot relies on a.pins.go in CI: deleting the go pin must turn CI
// red); fails_when=a missing or skip-only required id passes, a lookalike [[local]] row or a longer id satisfies a
// built-in id, an id folded into another row's also list stops counting, or the x.required cause is unnamed;
// why_new=--require-checks is new; seam=none; no_claim=which checks run under --static (env-check.test.ts)
describe("--require-checks=<ids> (C2)", () => {
  it("is satisfied by a PASS row with the id", () => {
    const r = check(setup(GO_PIN + NODE_PIN), "--require-checks=a.pins.go,a.pins.node");
    expect(r.code).toBe(0);
    expect(r.required).toEqual([]);
  });

  it("deleting the go pin turns a.pins.go into FAIL x.required not configured, exit 1", () => {
    const root = setup(GO_PIN + NODE_PIN);
    expect(check(root, "--require-checks=a.pins.go").code).toBe(0);
    put(root, CFG, HEAD + NODE_PIN);
    const r = check(root, "--require-checks=a.pins.go");
    expect(r.code).toBe(1);
    expect(r.required).toEqual([expect.stringMatching(/^FAIL x\.required {2}a\.pins\.go not configured: no check produced this id — fix: /)]);
  });

  it("is satisfied by a WARN or a FAIL row (the check ran)", () => {
    const r = check(setup(GO_PIN, { "go.mod": "module x\n" }), "--require-checks=a.pins.go");
    expect(r.lines).toContainEqual(expect.stringMatching(/^FAIL a\.pins\.go /));
    expect(r.required).toEqual([]);
    const w = check(setup(LOCAL("x.lint", "c.sh"), script("c.sh", "WARN x.lint meh")), "--require-checks=x.lint");
    expect(w.code).toBe(0);
    expect(w.required).toEqual([]);
  });

  it("dedupes the list", () => {
    const r = check(setup(NODE_PIN), "--require-checks=a.pins.go,a.pins.go");
    expect(r.required).toHaveLength(1);
  });

  it("names each unsatisfied id in its own row, in the order written", () => {
    const r = check(setup(NODE_PIN), "--require-checks=b.y,a.pins.node,a.pins.go");
    expect(r.code).toBe(1);
    expect(r.required.map((l) => l.split("  ")[1]!.split(" ")[0])).toEqual(["b.y", "a.pins.go"]);
  });

  it("a glob a.pins.* is satisfied by any built-in pin row, and not configured without one", () => {
    expect(check(setup(GO_PIN), "--require-checks=a.pins.*").required).toEqual([]);
    const r = check(setup(LOCAL("x.lint", "c.sh"), script("c.sh", "PASS x.lint ok")), "--require-checks=a.pins.*");
    expect(r.code).toBe(1);
    expect(r.required).toEqual([expect.stringMatching(/^FAIL x\.required {2}a\.pins\.\* not configured: no check produced an id matching it/)]);
  });

  it("an id folded into another row's also list by collapse still counts", () => {
    const r = check(setup(LOCAL("x.one", "one.sh") + LOCAL("x.two", "two.sh"), { ...script("one.sh", "PASS x.one ok"), ...script("two.sh", "PASS x.two ok") }), "--require-checks=x.two");
    expect(r.lines).toContainEqual(expect.stringMatching(/^PASS x\.one {2}ok \(also: x\.two\)$/));
    expect(r.code).toBe(0);
    expect(r.required).toEqual([]);
  });

  it("a [[local]] row with a built-in-looking id or output never satisfies a built-in id", () => {
    const same = check(setup(LOCAL("a.pins.go", "c.sh"), script("c.sh", "PASS a.pins.go fake")), "--require-checks=a.pins.go");
    expect(same.lines).toContainEqual(expect.stringMatching(/^PASS a\.pins\.go {2}fake$/));
    expect(same.code).toBe(1);
    expect(same.required).toEqual([expect.stringMatching(/a\.pins\.go not configured: no check produced this id \(a \[\[local\]\] row with it does not count: a-e ids are satisfied only by built-in checks\)/)]);
    const sub = check(setup(LOCAL("a.pins", "c.sh"), script("c.sh", "PASS a.pins.go fake")), "--require-checks=a.pins.go");
    expect(sub.code).toBe(1);
    const glob = check(setup(LOCAL("a.pins", "c.sh"), script("c.sh", "PASS a.pins.go fake")), "--require-checks=a.pins.*");
    expect(glob.code).toBe(1);
  });

  it("an x.* id is satisfied by a [[local]] row", () => {
    const r = check(setup(LOCAL("x.lint", "c.sh"), script("c.sh", "PASS x.lint ok")), "--require-checks=x.lint");
    expect(r.code).toBe(0);
  });

  it("a longer id never satisfies a shorter one (exact match), but a glob the user wrote can", () => {
    const root = setup(LOCAL("x.go", "c.sh"), script("c.sh", "PASS x.go.setup ok"));
    const r = check(root, "--require-checks=x.go");
    expect(r.code).toBe(1);
    expect(r.required).toEqual([expect.stringMatching(/x\.go not configured/)]);
    expect(check(root, "--require-checks=x.go*").code).toBe(0);
  });

  it("a required id with only SKIP/INFO rows names them as the cause", () => {
    const r = check(setup(LOCAL("x.slow", "c.sh", true), script("c.sh", "PASS x.slow ok")), "--require-checks=x.slow");
    expect(r.code).toBe(1);
    expect(r.required).toEqual([expect.stringMatching(/^FAIL x\.required {2}x\.slow produced only SKIP\/INFO rows \(SKIP x\.slow: not run in --static mode\) — fix: /)]);
    expect(r.required[0]).toMatch(/fix: make the check run under --static \(a \[\[local\]\] needs static = true; CI=true implies --static\), or drop x\.slow from --require-checks$/);
    const info = check(setup(LOCAL("x.note", "c.sh"), script("c.sh", "INFO x.note fyi")), "--require-checks=x.note");
    expect(info.required).toEqual([expect.stringMatching(/x\.note produced only SKIP\/INFO rows \(INFO x\.note: fyi\)/)]);
    const shared = check(setup(`${GO_PIN}[shared_checkout]\nhint = "use a worktree"\n`), "--require-checks=c.shared");
    expect(shared.required).toEqual([expect.stringMatching(/c\.shared produced only SKIP\/INFO rows \(SKIP c\.shared: not checked in --static mode\)/)]);
    expect(shared.required[0]).toMatch(/fix: c\.shared is a built-in check that --static does not run .*, or drop c\.shared from --require-checks$/);
  });

  it("a.local.go under --static is skipped there, not unconfigured", () => {
    const r = check(setup(GO_PIN), "--require-checks=a.local.go");
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/^SKIP a\.local\.go/m);
    expect(r.required).toEqual([expect.stringMatching(/a\.local\.go produced only SKIP\/INFO rows \(SKIP a\.local\.go: not run in --static mode\)/)]);
    // A built-in check --static leaves out cannot be made to run there: the fix says so, with no [[local]] advice.
    expect(r.required[0]).toMatch(/fix: a\.local\.go is a built-in check that --static does not run \(run env-check without --static, outside CI, to see it\), or drop a\.local\.go from --require-checks$/);
    expect(r.required[0]).not.toMatch(/static = true|\[\[local\]\]/);
    const off = check(setup(`${GO_PIN}local = "off"\n`), "--require-checks=a.local.go");
    expect(off.required).toEqual([expect.stringMatching(/a\.local\.go not configured/)]);
  });

  it("--json carries the x.required and x.none rows and the exit", () => {
    const t = deps(setup(""));
    expect(main(["env-check", "--static", "--json", "--require-checks=a.pins.go"], t.d)).toBe(1);
    const j = JSON.parse(t.out.join("\n"));
    expect(j.exit).toBe(1);
    expect(j.summary.fail).toBe(2);
    expect(j.results.slice(-2)).toEqual([
      expect.objectContaining({ level: "FAIL", id: "x.none", source: "builtin" }),
      expect.objectContaining({ level: "FAIL", id: "x.required", message: expect.stringMatching(/^a\.pins\.go not configured/), fix: expect.any(String), source: "builtin" }),
    ]);
  });

  it("--quiet still shows the x.required rows", () => {
    const r = check(setup(NODE_PIN), "--quiet", "--require-checks=a.pins.go");
    expect(r.required).toHaveLength(1);
  });
});

// Value: guards 0.7 behavior (green on base): without --require-checks, x.none stays a WARN with exit 0 and no
// x.required row appears; fails_when=the flag's handling leaks into a run without it; seam=none
describe("without --require-checks (guard)", () => {
  it("x.none stays a WARN, exit 0", () => {
    const r = check(setup(""));
    expect(r.code).toBe(0);
    expect(r.lines).toContainEqual(expect.stringMatching(/^WARN x\.none {2}no check ran under --static/));
    expect(r.out).not.toMatch(/x\.required/);
  });
  it("a run with checks has neither row", () => {
    const r = check(setup(GO_PIN + NODE_PIN));
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/x\.none|x\.required/);
  });
  it("x.none as a [[local]] id is still exit 2", () => {
    expect(() => parseConfig(HEAD + LOCAL("x.none", "c.sh"), CFG)).toThrow(/id x\.none is reserved/);
  });
});
