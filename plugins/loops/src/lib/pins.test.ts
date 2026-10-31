import { describe, expect, it } from "vitest";
import { cmp, disagreement, localOk, PinError, pinOf, readSource, type PinValue } from "./pins.js";
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
  ["dockerfile", "go", { Dockerfile: "FROM golang:1.26.1-alpine AS build\nFROM alpine:3.20\nARG GO_VERSION=1.26.1\n" }, ["1.26.1", "1.26.1"]],
  ["dockerfile:build/Dockerfile", "node", { "build/Dockerfile": "FROM --platform=x node:20-slim\n" }, ["20"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.26.1' # pinned")) }, ["1.26.1"]],
  ["setup-go:.github/workflows/*.yml", "go", { ".github/workflows/a.yml": WF(SETUP_GO("go-version: 1.25")), ".github/workflows/b.yml": WF("      - run: echo none") }, ["1.25"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: go.mod")), "go.mod": "go 1.24\n" }, ["1.24"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: .nvmrc\n"), ".nvmrc": "20\n" }, ["20"]],
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
  });

  it("does not read a step's neighbours: go-version of the next step is not setup-go's", () => {
    const root = tmp();
    put(root, ".github/workflows/ci.yml", WF(SETUP_GO("cache: true") + "      - name: other\n        with:\n          go-version: 1.1\n"));
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
    ["minor ignores the patch", "minor", [v("a", "1.26.0"), v("b", "1.26.9")], null],
    ["minor flags a minor drift", "minor", [v("a", "1.25.0"), v("b", "1.26.0")], "a=1.25.0, b=1.26.0 disagree (minor)"],
    ["major ignores the minor", "major", [v("a", "20.1"), v("b", "20.9")], null],
    ["major flags a major drift", "major", [v("a", "18"), v("b", "20")], "a=18, b=20 disagree (major)"],
    ["floor accepts versions above it", "floor", [v("engines", "20", true), v("nvmrc", "22.1.0"), v("tv", "20.5")], null],
    ["floor flags a version below it", "floor", [v("engines", "20", true), v("nvmrc", "18.2.0")], "nvmrc=18.2.0 below the floor 20"],
    ["floor needs a floor source", "floor", [v("nvmrc", "20")], "compare = floor needs a floor source (engines)"],
  ];
  it.each(cases)("%s", (_n, mode, vals, want) => {
    expect(disagreement(vals, mode)).toBe(want);
  });

  it("pinOf and localOk follow the mode", () => {
    expect(pinOf([v("a", "1.26.1")], "exact")).toBe("1.26.1");
    expect(pinOf([v("e", "18", true), v("f", "20", true), v("n", "22")], "floor")).toBe("20");
    expect([localOk("1.26.9", "1.26.1", "minor"), localOk("1.26.9", "1.26.1", "exact"), localOk("22.0.0", "20", "floor"), localOk("18.0.0", "20", "floor")]).toEqual([true, false, true, false]);
  });
});
