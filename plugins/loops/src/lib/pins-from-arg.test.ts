// 0.8.0 B4: a Dockerfile `FROM ${ARG}` resolved through the global ARG scope; B8: golangci-lint-action `install-mode: ""`.
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { PinError, readSource, type PinValue } from "./pins.js";
import { deps, put, repo, tmp } from "./testkit.js";

const show = (x: PinValue): string => (x.range ? `range ${x.v}` : x.v);
/** The values `spec` reads for `tool` from `files`, and the notes it adds. */
const read = (spec: string, tool: string, files: Record<string, string>): [string[], string[]] => {
  const root = tmp();
  for (const [f, c] of Object.entries(files)) put(root, f, c);
  const notes: string[] = [];
  return [readSource(root, Object.keys(files), tool, spec, notes).map(show), notes];
};
const fails = (tool: string, files: Record<string, string>, re: RegExp) => {
  const root = tmp();
  for (const [f, c] of Object.entries(files)) put(root, f, c);
  expect(() => readSource(root, Object.keys(files), tool, "dockerfile")).toThrow(PinError);
  expect(() => readSource(root, Object.keys(files), tool, "dockerfile")).toThrow(re);
};
const D = (text: string) => ({ Dockerfile: text });
const BUILD_TIME = (image: string, line: number) => `dockerfile:Dockerfile: FROM ${image} (line ${line}): image set at build time, not compared`;

// Value: protects=a whole-image FROM variable is read through the ARGs Docker lets FROM see (global scope, last
// definition wins, `${A:-default}`), and an image only the build can name is INFO, never a FAIL; fails_when=`FROM ${BASE}` is
// silently skipped again, a stage-scoped ARG is read as the image, or a default-less ARG FAILs; why_new=0.7.x skipped every
// `FROM ${VAR}`; seam=none; no_claim=a build.args override (the INFO and README say it can replace the default)
describe("Dockerfile FROM ${ARG} through the global ARG scope", () => {
  it.each([
    ["a global ARG", "ARG BASE=node:20.11.0-alpine\nFROM ${BASE}\n", ["20.11.0"]],
    ["the bare $A form", "ARG BASE=node:20\nFROM $BASE AS build\n", ["20"]],
    ["a redefinition in the global scope (the last one wins)", "ARG BASE=node:18\nARG BASE=node:22.1.0\nFROM ${BASE}\n", ["22.1.0"]],
    ["two pairs on one ARG line", "ARG X=1 BASE=node:20\nFROM ${BASE}\n", ["20"]],
    ["a quoted value", 'ARG BASE="node:20.11.0"\nFROM ${BASE}\n', ["20.11.0"]],
    ["a value built from an earlier global ARG", "ARG REG=registry.example:5000\nARG BASE=${REG}/node:20\nFROM ${BASE}\n", ["20"]],
    ["a variable name with a literal tag", "ARG IMG=node\nFROM ${IMG}:20.11.0\n", ["20.11.0"]],
    ["`${A:-default}` with A unset", "FROM ${BASE:-node:20.11.0}\n", ["20.11.0"]],
    ["`${A:-default}` with A declared without a value", "ARG BASE\nFROM ${BASE:-node:20}\n", ["20"]],
    ["`${A:-default}` with A set (A wins)", "ARG BASE=node:22\nFROM ${BASE:-node:20}\n", ["22"]],
    ["a default with a registry path", "FROM ${BASE:-docker.io/library/node:20}\n", ["20"]],
    ["the tool's version ARG inside the global value", "ARG NODE_VERSION=20.11.0\nARG BASE=node:${NODE_VERSION}\nFROM ${BASE}\n", ["20.11.0", "20.11.0"]],
    ["the go image", "ARG GO_IMAGE=golang:1.26.1\nFROM ${GO_IMAGE} AS build\n", ["1.26.1"], "go"],
    // Value: protects=each shell modifier keeps Docker's meaning (`:` tests empty, `+` the alternate, single quotes);
    // fails_when=`-`/`:-` or `+`/`:+` swap or single quotes are kept; why_new=only `:-` was read; seam=none; no_claim=other modifiers
    ["`${A:-default}` with A set empty (empty counts as unset)", "ARG BASE=\nFROM ${BASE:-node:20}\n", ["20"]],
    ["`${A+alt}` with A set empty (set, so the alternate)", "ARG BASE=\nFROM ${BASE+node:20}\n", ["20"]],
    ["`${A:+alt}` with A set", "ARG T=1\nFROM ${T:+node:20.11.0}\n", ["20.11.0"]],
    ["a single-quoted value", "ARG BASE='node:20.11.0'\nFROM ${BASE}\n", ["20.11.0"]],
  ])("reads %s", (_n, text, want, tool = "node") => expect(read("dockerfile", tool, D(text))).toEqual([want, []]));

  // A resolved image that is not the tool's image is handled as that literal image would be.
  it("a resolved non-tool image is skipped like a literal one", () => {
    expect(read("dockerfile", "node", D("ARG BASE=alpine:3.20\nFROM ${BASE}\nFROM node:20\n"))).toEqual([["20"], []]);
    fails("node", D("ARG BASE=alpine:3.20\nFROM ${BASE}\n"), /no node version found in Dockerfile/);
    expect(read("dockerfile", "node", D("FROM node:20 AS base\nARG X\nFROM alpine\nFROM ${STAGE:-base}\n"))).toEqual([["20"], []]); // a stage alias
  });
  it("a resolved tool image is read as a literal one: an unsupported tag FAILs at the FROM line", () => {
    fails("node", D("ARG BASE=node:latest\nFROM ${BASE}\n"), /unsupported form "node:latest" in Dockerfile:2; pin an exact version/);
    fails("node", D("FROM ${BASE:-node}\n"), /unsupported form "node" in Dockerfile:1; pin an exact version/);
  });

  it.each([
    ["no default", "ARG BASE\nFROM ${BASE}\nFROM node:20\n", "${BASE}", 2],
    ["no ARG at all", "FROM $BASE\nFROM node:20\n", "$BASE", 1],
    ["an ARG declared only inside a stage", "FROM node:20 AS a\nARG BASE=node:18\nFROM ${BASE}\n", "${BASE}", 3],
    ["a redeclaration without a value", "ARG BASE=node:18\nARG BASE\nFROM ${BASE}\nFROM node:20\n", "${BASE}", 3],
    ["an empty value", "ARG BASE=\nFROM ${BASE}\nFROM node:20\n", "${BASE}", 2],
    ["a global value built from an unset ARG", "ARG BASE=node:${V}\nFROM ${BASE}\nFROM node:20\n", "${BASE}", 2],
    ["another modifier", "ARG BASE=node:18\nFROM ${BASE%:*}:20\nFROM node:20\n", "${BASE%:*}:20", 2],
    // Value: protects=a modifier that expands to an empty image is a note, never a read of its fallback; fails_when=`${A-w}`
    // is read as `${A:-w}` or `${A:+w}` as `${A+w}` on an empty A; why_new=no row had an empty A; seam=none; no_claim=none beyond
    ["`${A-default}` with A set empty", "ARG BASE=\nFROM ${BASE-node:18}\nFROM node:20\n", "${BASE-node:18}", 2],
    ["`${A:+alt}` with A set empty", "ARG T=\nFROM ${T:+node:18}\nFROM node:20\n", "${T:+node:18}", 2],
  ])("%s is INFO image set at build time, not FAIL", (_n, text, image, line) =>
    expect(read("dockerfile", "node", D(text))).toEqual([["20"], [BUILD_TIME(image, line)]]));

  // A build-time note never stands in for a pin when a stage of the tool's own image has none.
  it("a tool stage with no pinned version still FAILs beside an image set at build time", () => {
    fails("node", D("ARG NODE_VERSION\nARG RUNTIME\nFROM node:${NODE_VERSION} AS build\nFROM ${RUNTIME}\n"), /no node version found in Dockerfile/);
    const root = tmp();
    const files = { "web/Dockerfile": "FROM node:${NODE_VERSION}\n", "base/Dockerfile": "ARG BASE\nFROM ${BASE}\n" };
    for (const [f, c] of Object.entries(files)) put(root, f, c);
    expect(() => readSource(root, Object.keys(files), "node", "dockerfile:**/Dockerfile")).toThrow(/no node version found in 2 files/);
  });
  // Value: protects=a tool-image FROM reached through another variable, tagged with the unset version ARG, FAILs as the
  // direct `FROM node:${NODE_VERSION}` does; fails_when=the indirect form becomes a build-time note again and the Dockerfile
  // silently yields no pin (a false PASS beside .nvmrc); why_new=every FAIL row used a direct tool FROM; seam=none;
  // no_claim=none beyond protects
  it.each([
    ["an image ARG holding the version ARG", "ARG NODE_VERSION\nARG BASE=node:${NODE_VERSION}-alpine\nFROM ${BASE}\n"],
    ["an image-name ARG with the version ARG as tag", "ARG IMG=node\nARG NODE_VERSION\nFROM ${IMG}:${NODE_VERSION}\n"],
  ])("a tool stage set up through %s with no value still FAILs", (_n, text) => fails("node", D(text), /no node version found in Dockerfile/));
  it("an indirect tool stage reads the version ARG a stage gives it, as the direct form does", () => {
    expect(read("dockerfile", "node", D("ARG IMG=node\nARG NODE_VERSION\nFROM ${IMG}:${NODE_VERSION}\nARG NODE_VERSION=20.11.1\n"))).toEqual([["20.11.1"], []]);
  });
  // Value: protects=ARG expansion is bounded, so a small Dockerfile cannot blow up memory: past the bound the image is a
  // build-time note; fails_when=the size check is dropped and doubling ARGs expand without limit; why_new=no test chained
  // ARGs; seam=none; no_claim=the exact bound
  it("an expansion past the size bound is a build-time note, never a huge image", () => {
    const args = Array.from({ length: 22 }, (_, i) => `ARG A${i + 1}=\${A${i}}\${A${i}}`).join("\n");
    expect(read("dockerfile", "node", D(`ARG A0=x\n${args}\nFROM \${A22}\nFROM node:20\n`))).toEqual([["20"], [BUILD_TIME("${A22}", 24)]]);
  });
  it("a Dockerfile whose only tool FROM is set at build time yields no pin and no FAIL of its own", () => {
    expect(read("dockerfile", "node", D("ARG BASE\nFROM ${BASE}\n"))).toEqual([[], [BUILD_TIME("${BASE}", 2)]]);
  });

  // The row a user sees: the other source's PASS, then the INFO (never a FAIL from the Dockerfile).
  it("renders as PASS from the other source and an INFO row", () => {
    const root = repo({ "README.md": "x\n", ".nvmrc": "20.11.0\n", Dockerfile: "ARG BASE\nFROM ${BASE}\n" });
    put(root, ".loops/env-check.toml", `schema_version = 1\n[[pins]]\ntool = "node"\nsources = ["nvmrc", "dockerfile"]\ncompare = "exact"\nlocal = "off"\n`);
    const t = deps(root);
    expect(main(["env-check"], t.d)).toBe(0);
    const rows = t.out.join("\n").split("\n").filter((l) => l.includes("a.pins.node"));
    expect(rows).toEqual([expect.stringMatching(/^PASS a\.pins\.node {2}node 20\.11\.0 \(nvmrc:\.nvmrc\)/), `INFO a.pins.node  ${BUILD_TIME("${BASE}", 2)}`]);
  });
  it("a Dockerfile-only pin set at build time is the usual no-exact-pin FAIL, with the INFO after it", () => {
    const root = repo({ "README.md": "x\n", Dockerfile: "ARG BASE\nFROM ${BASE}\n" });
    put(root, ".loops/env-check.toml", `schema_version = 1\n[[pins]]\ntool = "node"\nsources = ["dockerfile"]\ncompare = "exact"\nlocal = "off"\n`);
    const t = deps(root);
    expect(main(["env-check"], t.d)).toBe(1);
    const rows = t.out.join("\n").split("\n").filter((l) => l.includes("a.pins.node"));
    expect(rows).toEqual([expect.stringMatching(/^FAIL a\.pins\.node {2}no exact pin among sources \(dockerfile\); /), `INFO a.pins.node  ${BUILD_TIME("${BASE}", 2)}`]);
  });
  it("a resolved default that disagrees with the other source FAILs", () => {
    const root = repo({ "README.md": "x\n", ".nvmrc": "20.11.0\n", Dockerfile: "ARG BASE=node:22.1.0\nFROM ${BASE}\n" });
    put(root, ".loops/env-check.toml", `schema_version = 1\n[[pins]]\ntool = "node"\nsources = ["nvmrc", "dockerfile"]\ncompare = "exact"\nlocal = "off"\n`);
    const t = deps(root);
    expect(main(["env-check"], t.d)).toBe(1);
    expect(t.out.join("\n")).toMatch(/FAIL a\.pins\.node {2}nvmrc:\.nvmrc=20\.11\.0, dockerfile:Dockerfile=22\.1\.0 disagree \(exact\)/);
  });
});

// Value: protects=an empty install-mode is the action's default (binary), so go.mod is still read; fails_when=`""` is read as a
// non-binary mode and the step FAILs "without a version"; why_new=0.7.2 note; seam=none; no_claim=none beyond protects
describe("golangci-lint-action install-mode empty is unset", () => {
  const CI = ".github/workflows/ci.yml";
  const MOD = "module x\n\ngo 1.25\n\nrequire github.com/golangci/golangci-lint/v2 v2.1.5 // indirect\n";
  const wf = (mode: string) =>
    `name: ci\njobs:\n  lint:\n    steps:\n      - uses: golangci/golangci-lint-action@v8\n        with:\n          install-mode: ${mode}\n`;
  it.each([['""'], ["''"], [""], ["~"]])("install-mode: %s reads go.mod as binary does", (m) =>
    expect(read("golangci-action", "golangci-lint", { [CI]: wf(m), "go.mod": MOD })).toEqual([["2.1.5"], []]));
});
