import { describe, expect, it } from "vitest";
import { belowFloor, cmp, disagreement, localOk, PinError, pinOf, readSource, type PinValue } from "./pins.js";
import { put, tmp } from "./testkit.js";

const WF = (setup: string) => `name: ci
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
${setup}
      - run: make ci
`;
const SETUP_GO = (w: string) => `      - uses: actions/setup-go@v5\n        with:\n          ${w}\n`;

// [kind spec, tool, files, expected versions]
const hits: [string, string, Record<string, string>, string[]][] = [
  ["tool-versions", "go", { ".tool-versions": "nodejs 20.11.0\ngolang 1.2\ngo 1.26.1\n" }, ["1.26.1"]],
  ["tool-versions", "node", { ".tool-versions": "nodejs 20.11.0\n" }, ["20.11.0"]],
  ["tool-versions:mise/.tool-versions", "go", { "mise/.tool-versions": "go 1.25.4\n" }, ["1.25.4"]],
  ["nvmrc", "node", { ".nvmrc": "v20.11\n" }, ["20.11"]],
  ["node-version", "node", { ".node-version": "22\n" }, ["22"]],
  ["python-version", "python", { ".python-version": "3.12.1\n" }, ["3.12.1"]],
  ["go-mod", "go", { "go.mod": "module x\n\ngo 1.25\n" }, ["1.25"]],
  ["go-mod", "go", { "go.mod": "module x\n\ngo 1.25\ntoolchain go1.25.4\n" }, ["1.25.4"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">=20.1 <23"}}' }, ["20.1"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">=18.17"}}' }, ["18.17"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"^20.11.0"}}' }, ["20.11.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">=18 <21"}}' }, ["18"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"^20 || ^18"}}' }, ["18"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"22.x || 16.*"}}' }, ["16"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">=20.11.0 || >=20"}}' }, ["20"]], // lowest alternative; "20" is 20.0.0, below 20.11.0
  ["engines", "node", { "package.json": '{"engines":{"node":">=18.0.0 >=20.0.0"}}' }, ["20.0.0"]], // strongest bound within an alternative
  ["engines", "node", { "package.json": '{"engines":{"node":">=20 >=20.11.0 <23"}}' }, ["20.11.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">20.11.0"}}' }, ["20.11.1"]], // exclusive: the lowest satisfying version, not the bound itself
  ["engines", "node", { "package.json": '{"engines":{"node":">20.11"}}' }, ["20.12.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"~>20.11"}}' }, ["20.11"]], // node-semver "~>" is tilde, not an exclusive ">"
  ["engines", "node", { "package.json": '{"engines":{"node":"~> 20.11.0"}}' }, ["20.11.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">20"}}' }, ["21.0.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"> 20.x"}}' }, ["21.0.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">20.11.*"}}' }, ["20.12.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">=20.11.0"}}' }, ["20.11.0"]], // inclusive stays
  ["engines", "node", { "package.json": '{"engines":{"node":">18 >=20.1.0"}}' }, ["20.1.0"]], // strongest of a mixed alternative
  ["engines", "node", { "package.json": '{"engines":{"node":">20.0.0-rc.1"}}' }, ["20.0.0"]], // the stable core satisfies a prerelease bound
  ["engines", "node", { "package.json": '{"engines":{"node":">=20.0.0-beta-30"}}' }, ["20.0.0"]], // a hyphen inside the prerelease is not a second bound
  ["engines", "node", { "package.json": '{"engines":{"node":">20.0.0-beta-30"}}' }, ["20.0.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"18 - 20.0.0-rc.1"}}' }, ["18"]], // a prerelease upper bound of a hyphen range is dropped whole
  ["engines", "node", { "package.json": '{"engines":{"node":"18 - 20.0.0-beta-30"}}' }, ["18"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">20.0.0+build"}}' }, ["20.0.1"]], // build metadata is not a prerelease
  ["engines", "node", { "package.json": '{"engines":{"node":"18.0.0 - 20.0.0"}}' }, ["18.0.0"]], // the end of a hyphen range is not a bound
  ["dockerfile", "go", { Dockerfile: "FROM registry.example:5000/golang:1.26.1 AS build\nFROM localhost:5000/golang@sha256:abc\nFROM registry.example:5000/node:20\n" }, ["1.26.1"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - with:\n          go-version: 1.26.3\n        uses: actions/setup-go@v5\n") }, ["1.26.3"]], // with: before uses:
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - name: go\n        with:\n          cache: true\n          go-version: 1.26.4\n        uses: actions/setup-go@v5\n        env:\n          go-version: 1.1\n") }, ["1.26.4"]],
  ["dockerfile", "go", { Dockerfile: "FROM golang:1.26.1-alpine AS build\nFROM alpine:3.20\nARG GO_VERSION=1.26.1\n" }, ["1.26.1", "1.26.1"]],
  ["dockerfile:build/Dockerfile", "node", { "build/Dockerfile": "FROM --platform=x node:20-slim\n" }, ["20"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.26.1' # pinned")) }, ["1.26.1"]],
  ["setup-go:.github/workflows/*.yml", "go", { ".github/workflows/a.yml": WF(SETUP_GO("go-version: 1.25")), ".github/workflows/b.yml": WF("      - run: echo none") }, ["1.25"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: go.mod")), "go.mod": "go 1.24\n" }, ["1.24"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: .nvmrc\n"), ".nvmrc": "20\n" }, ["20"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"), "package.json": '{"version":"1.2.3","engines":{"node":">=20"}}' }, ["20"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"), "package.json": '{"version":"1.2.3","volta":{"node":"22.1.0"},"engines":{"node":">=20"}}' }, ["22.1.0"]],
  ["setup-go", "go", { ".github/workflows/ci.yaml": WF(SETUP_GO("go-version: 1.26.2")) }, ["1.26.2"]],
  ["golangci-action", "golangci-lint", { ".github/workflows/ci.yml": WF("      - uses: golangci/golangci-lint-action@v6\n        with:\n          version: v1.62.2\n          args: --timeout=5m\n") }, ["1.62.2"]],
  ["goreleaser-action", "goreleaser", { ".github/workflows/release.yml": WF("      - uses: goreleaser/goreleaser-action@v6\n        with:\n          distribution: goreleaser\n          version: \"~> v2\"\n") }, ["2"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - name: py\n        uses: actions/setup-python@v5\n        with:\n          python-version: \"3.12\"\n") }, ["3.12"]],
];

describe("readSource hits", () => {
  it.each(hits)("%s for %s", (spec, tool, files, want) => {
    const root = tmp();
    for (const [f, c] of Object.entries(files)) put(root, f, c);
    expect(readSource(root, Object.keys(files), tool, spec).map((v) => v.v)).toEqual(want);
  });

  it("marks engines as a floor and stamps the source", () => {
    const root = tmp();
    put(root, "package.json", '{"engines":{"node":">=20"}}');
    expect(readSource(root, [], "node", "engines")).toEqual([{ src: "engines:package.json", v: "20", floor: true }]);
    put(root, ".github/workflows/ci.yml", WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"));
    expect(readSource(root, [".github/workflows/ci.yml"], "node", "setup-node")).toEqual([{ src: "setup-node:.github/workflows/ci.yml", v: "20", floor: true }]);
  });

  it("does not read a step's neighbours: go-version of the next step is not setup-go's", () => {
    const root = tmp();
    put(root, ".github/workflows/ci.yml", WF(SETUP_GO("cache: true") + "      - name: other\n        with:\n          go-version: 1.1\n"));
    expect(() => readSource(root, [".github/workflows/ci.yml"], "go", "setup-go")).toThrow(/no go version found/);
  });

  it("reads a step written as a bare dash with its keys on the following lines (and CRLF)", () => {
    const root = tmp();
    const bareDash = "      -\n        uses: actions/setup-go@v5\n        with:\n          go-version: 1.25.0\n";
    put(root, ".github/workflows/ci.yml", WF(SETUP_GO("go-version: 1.26.1") + bareDash));
    expect(readSource(root, [".github/workflows/ci.yml"], "go", "setup-go").map((v) => v.v)).toEqual(["1.26.1", "1.25.0"]);
    put(root, ".github/workflows/ci.yml", WF("      - # setup\n        uses: actions/setup-go@v5\n        with:\n          go-version: 1.24.0\n").replace(/\n/g, "\r\n"));
    expect(readSource(root, [".github/workflows/ci.yml"], "go", "setup-go").map((v) => v.v)).toEqual(["1.24.0"]);
  });

  it("does not read a with: that belongs to another step or a nested key", () => {
    const root = tmp();
    put(root, ".github/workflows/ci.yml", WF("      - with:\n          go-version: 1.1\n        uses: actions/checkout@v4\n      - uses: actions/setup-go@v5\n        env:\n          go-version: 1.2\n        with:\n          cache: true\n          extra:\n            go-version: 1.3\n"));
    expect(() => readSource(root, [".github/workflows/ci.yml"], "go", "setup-go")).toThrow(/no go version found/);
  });
});

// A configured source that cannot be parsed is an error, never a pass.
const misses: [string, string, Record<string, string>, RegExp][] = [
  ["tool-versions", "go", { ".tool-versions": "nodejs 20\n" }, /no go version found/],
  ["tool-versions", "go", {}, /\.tool-versions not found/],
  ["nvmrc", "node", { ".nvmrc": "lts/*\n" }, /no version in "lts/],
  ["go-mod", "go", { "go.mod": "module x\n" }, /no go version found/],
  ["go-mod", "node", { "go.mod": "go 1.25\n" }, /no node version found/],
  ["engines", "node", { "package.json": "{not json" }, /not valid JSON/],
  ["engines", "node", { "package.json": '{"engines":{"npm":">=9"}}' }, /no node version found/],
  ["engines", "node", { "package.json": '{"engines":{"node":"<20"}}' }, /engines\.node "<20" has no lower bound/],
  ["engines", "node", { "package.json": '{"engines":{"node":"<20.0.0-0"}}' }, /engines\.node "<20\.0\.0-0" has no lower bound/], // a prerelease tag is not a bound
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"), "package.json": '{"version":"1.2.3"}' }, /no volta\.node or engines\.node/],
  ["dockerfile", "go", { Dockerfile: "FROM golang:latest\n" }, /no go version found/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: ${{ matrix.go }}")) }, /no go version found/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: nope.mod")) }, /go-version-file nope\.mod not found/],
  ["setup-go:.github/workflows/*.yml", "go", {}, /no file matches/],
  ["golangci-action", "golangci-lint", { ".github/workflows/ci.yml": WF("      - uses: golangci/golangci-lint-action@v6\n        with:\n          version: latest\n") }, /no golangci-lint version found/],
  ["goreleaser-action", "goreleaser", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: 1.25")) }, /no goreleaser version found/],
];

describe("readSource misses", () => {
  it.each(misses)("%s for %s", (spec, tool, files, re) => {
    const root = tmp();
    for (const [f, c] of Object.entries(files)) put(root, f, c);
    expect(() => readSource(root, Object.keys(files), tool, spec)).toThrow(PinError);
    expect(() => readSource(root, Object.keys(files), tool, spec)).toThrow(re);
  });
});

const v = (src: string, ver: string, floor = false): PinValue => ({ src, v: ver, floor });

describe("compare modes", () => {
  it("cmp compares the components both sides state", () => {
    expect([cmp("1.26", "1.26.1"), cmp("1.26.0", "1.26.1"), cmp("1.25", "1.26"), cmp("2", "1.9"), cmp("1.26.1", "1.26.9", 2)]).toEqual([0, -1, -1, 1, 0]);
  });

  const cases: [string, "exact" | "minor" | "major" | "floor", PinValue[], string | null][] = [
    ["exact agrees on stated parts", "exact", [v("a", "1.26"), v("b", "1.26.1")], null],
    ["exact flags a patch drift", "exact", [v("a", "1.26.0"), v("b", "1.26.1")], "a=1.26.0, b=1.26.1 disagree (exact)"],
    ["exact compares every pair, not just the first", "exact", [v("a", "1.26"), v("b", "1.26.1"), v("c", "1.26.2")], "a=1.26, b=1.26.1, c=1.26.2 disagree (exact)"],
    ["minor compares every pair, not just the first", "minor", [v("a", "1"), v("b", "1.25"), v("c", "1.26.0")], "a=1, b=1.25, c=1.26.0 disagree (minor)"],
    ["exact agrees when the less specific source is first", "exact", [v("a", "1.26"), v("b", "1.26.1"), v("c", "1.26.1")], null],
    ["minor ignores the patch", "minor", [v("a", "1.26.0"), v("b", "1.26.9")], null],
    ["minor flags a minor drift", "minor", [v("a", "1.25.0"), v("b", "1.26.0")], "a=1.25.0, b=1.26.0 disagree (minor)"],
    ["major ignores the minor", "major", [v("a", "20.1"), v("b", "20.9")], null],
    ["major flags a major drift", "major", [v("a", "18"), v("b", "20")], "a=18, b=20 disagree (major)"],
    ["floor accepts versions above it", "floor", [v("engines", "20", true), v("nvmrc", "22.1.0"), v("tv", "20.5")], null],
    ["floor flags a version below it", "floor", [v("engines", "20", true), v("nvmrc", "18.2.0")], "nvmrc=18.2.0 below the floor 20"],
    ["floor takes the strongest of several floors", "floor", [v("e1", "20", true), v("e2", "20.11.0", true), v("nvmrc", "20.5.0")], "nvmrc=20.5.0 below the floor 20.11.0"],
    ["floor order does not matter", "floor", [v("e2", "20.11.0", true), v("e1", "20", true), v("nvmrc", "20.5.0")], "nvmrc=20.5.0 below the floor 20.11.0"],
    ["floor from an exclusive bound rejects the bound itself", "floor", [v("engines", "20.11.1", true), v("nvmrc", "20.11.0")], "nvmrc=20.11.0 below the floor 20.11.1"],
    ["floor from an exclusive bound accepts the next version", "floor", [v("engines", "20.11.1", true), v("nvmrc", "20.11.1")], null],
    ["floor needs a floor source", "floor", [v("nvmrc", "20")], "compare = floor needs a floor source (engines)"],
  ];
  it.each(cases)("%s", (_n, mode, vals, want) => {
    expect(disagreement(vals, mode)).toBe(want);
  });

  it.each([["20.11.0", "nvmrc:.nvmrc=20.11.0 below the floor 20.11.1"], ["20.11.1", null]])("engines >20.11.0 with .nvmrc %s under floor", (nvmrc, want) => {
    const root = tmp();
    put(root, "package.json", '{"engines":{"node":">20.11.0"}}');
    put(root, ".nvmrc", nvmrc + "\n");
    const vals = [...readSource(root, ["package.json"], "node", "engines"), ...readSource(root, [".nvmrc"], "node", "nvmrc")];
    expect(disagreement(vals, "floor")).toBe(want);
  });

  it("pinOf and localOk follow the mode", () => {
    expect(pinOf([v("a", "1.26.1")], "exact")).toBe("1.26.1");
    expect([pinOf([v("a", "1.26"), v("b", "1.26.1")], "exact"), pinOf([v("a", "1.26.1"), v("b", "1.26.2")], "exact"), pinOf([v("a", "1"), v("b", "1.25")], "minor")]).toEqual(["1.26.1", "1.26.1", "1.25"]);
    expect(pinOf([v("e", "18", true), v("f", "20", true), v("n", "22")], "floor")).toBe("20");
    expect(pinOf([v("n", "20"), v("e", "20.11.0", true)], "exact")).toBe("20"); // a floor is never promoted to the exact pin
    expect([belowFloor("20.5.0", [v("n", "20"), v("e", "20.11.0", true)]), belowFloor("20.12.0", [v("n", "20"), v("e", "20.11.0", true)])]).toEqual(["20.11.0", null]); // ...but still binds the local toolchain
    expect(pinOf([v("e1", "20", true), v("e2", "20.11.0", true)], "floor")).toBe("20.11.0");
    expect(pinOf([v("e1", "20.11.0", true), v("e2", "20", true)], "floor")).toBe("20.11.0");
    expect(belowFloor("20.5.0", [v("e1", "20", true), v("e2", "20.11.0", true)])).toBe("20.11.0");
    expect([localOk("1.26.9", "1.26.1", "minor"), localOk("1.26.9", "1.26.1", "exact"), localOk("22.0.0", "20", "floor"), localOk("18.0.0", "20", "floor")]).toEqual([true, false, true, false]);
  });
});
