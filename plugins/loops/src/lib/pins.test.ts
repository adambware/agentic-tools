import { describe, expect, it, vi } from "vitest";
import * as glob from "./glob.js";
import { cmp, disagreement, localOk, PinError, pinOf, readSource, ver, type PinValue } from "./pins.js";
import { put, tmp } from "./testkit.js";

vi.mock("./glob.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./glob.js")>();
  return { ...actual, compileGlob: vi.fn(actual.compileGlob) };
});

const WF = (setup: string) => `name: ci
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
${setup}
      - run: make ci
`;
const SETUP_GO = (w: string) => `      - uses: actions/setup-go@v5\n        with:\n          ${w}\n`;
const SETUP_NODE = (w: string) => `      - uses: actions/setup-node@v4\n        with:\n          ${w}\n`;

/** A pin as its version, a range as `range <raw value>` (ranges are reported, never compared). */
const show = (x: PinValue): string => (x.range ? `range ${x.v}` : x.v);
/** The 1-based line of the version input in `WF(SETUP_*(...))`. */
const L = 8;
const unsupported = (value: string, file: string, line: number) =>
  new RegExp(`unsupported form "${value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}" in ${file.replace(/[./]/g, "\\$&")}:${line}; pin an exact version`);

// [kind spec, tool, files, expected versions]
const hits: [string, string, Record<string, string>, string[]][] = [
  ["tool-versions", "go", { ".tool-versions": "nodejs 20.11.0\ngo 1.26.1\n" }, ["1.26.1"]],
  ["tool-versions", "go", { ".tool-versions": "golang 1.26.1\n" }, ["1.26.1"]], // asdf's plugin name
  ["tool-versions", "go", { ".tool-versions": "golang 1.2\ngo 1.26.1\n" }, ["1.2", "1.26.1"]], // every alias line is read, so a conflict is seen
  ["tool-versions", "node", { ".tool-versions": "nodejs 20.11.0\n" }, ["20.11.0"]],
  ["tool-versions:mise/.tool-versions", "go", { "mise/.tool-versions": "go 1.25.4\n" }, ["1.25.4"]],
  ["nvmrc", "node", { ".nvmrc": "v20.11\n" }, ["20.11"]],
  ["node-version", "node", { ".node-version": "22\n" }, ["22"]],
  ["python-version", "python", { ".python-version": "3.12.1\n" }, ["3.12.1"]],
  ["python-version", "python", { ".python-version": "3.13.0rc1\n" }, ["3.13.0rc1"]], // a prerelease keeps its suffix
  ["nvmrc", "node", { ".nvmrc": "v22.0.0-rc.1\n" }, ["22.0.0-rc.1"]],
  ["go-mod", "go", { "go.mod": "module x\n\ngo 1.26rc1\n" }, ["1.26rc1"]],
  ["dockerfile", "node", { Dockerfile: "FROM node:22.0.0-bookworm-slim\nFROM node:20-alpine3.20\n" }, ["22.0.0", "20"]], // an image variant is not a prerelease
  ["go-mod", "go", { "go.mod": "module x\n\ngo 1.25\n" }, ["1.25"]],
  ["go-mod", "go", { "go.mod": "module x\n\ngo 1.25\ntoolchain go1.25.4\n" }, ["1.25.4"]],
  ["go-mod", "go", { "go.mod": "module x\n\ngo 1.25 // the floor\ntoolchain go1.25.4 // pinned\r\n" }, ["1.25.4"]], // a `//` comment ends the value
  ["go-mod", "go", { "go.mod": "module x\n\ngo ~> v1\n" }, ["1"]], // the whole value, operator and all, is classified
  // engines is always a range: its raw value is reported, never reduced to a bound (rows that tested bound math are retired).
  ["engines", "node", { "package.json": '{"engines":{"node":">=20.1 <23"}}' }, ["range >=20.1 <23"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"^20 || ^18"}}' }, ["range ^20 || ^18"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"22.x || 16.*"}}' }, ["range 22.x || 16.*"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"20.11.0"}}' }, ["range 20.11.0"]], // an exact-looking engines value is still a range
  ["engines", "node", { "package.json": '{"engines":{"node":">20.0.0-rc.1"}}' }, ["range >20.0.0-rc.1"]], // a prerelease bound is passed through as written
  ["engines", "node", { "package.json": '{"engines":{"node":"18 - 20.0.0-rc.1"}}' }, ["range 18 - 20.0.0-rc.1"]],
  ["engines", "node", { "package.json": '{"engines":{"node":"<20"}}' }, ["range <20"]], // no lower bound is no longer a FAIL: nothing computes one
  ["dockerfile", "go", { Dockerfile: "FROM registry.example:5000/golang:1.26.1 AS build\nFROM registry.example:5000/node:20\n" }, ["1.26.1"]], // a registry port is not a tag
  ["dockerfile", "node", { Dockerfile: "FROM node:20@sha256:abc\n" }, ["20"]], // a digest after a version tag is fine
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - with:\n          go-version: 1.26.3\n        uses: actions/setup-go@v5\n") }, ["1.26.3"]], // with: before uses:
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - name: go\n        with:\n          cache: true\n          go-version: 1.26.4\n        uses: actions/setup-go@v5\n        env:\n          go-version: 1.1\n") }, ["1.26.4"]],
  ["dockerfile", "go", { Dockerfile: "FROM golang:1.26.1-alpine AS build\nFROM alpine:3.20\nARG GO_VERSION=1.26.1\n" }, ["1.26.1", "1.26.1"]],
  ["dockerfile:build/Dockerfile", "node", { "build/Dockerfile": "FROM --platform=x node:20-slim\n" }, ["20"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.26.1' # pinned")) }, ["1.26.1"]],
  ["setup-go:.github/workflows/*.yml", "go", { ".github/workflows/a.yml": WF(SETUP_GO("go-version: 1.25")), ".github/workflows/b.yml": WF("      - run: echo none") }, ["1.25"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: go.mod")), "go.mod": "go 1.24\n" }, ["1.24"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: .nvmrc\n"), ".nvmrc": "20\n" }, ["20"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"), "package.json": '{"version":"1.2.3","engines":{"node":">=20"}}' }, ["range >=20"]], // engines through a -file is a range too
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"), "package.json": '{"version":"1.2.3","volta":{"node":"22.1.0"},"engines":{"node":">=20"}}' }, ["22.1.0"]],
  ["setup-go", "go", { ".github/workflows/ci.yaml": WF(SETUP_GO("go-version: 1.26.2")) }, ["1.26.2"]],
  ["golangci-action", "golangci-lint", { ".github/workflows/ci.yml": WF("      - uses: golangci/golangci-lint-action@v6\n        with:\n          version: v1.62.2\n          args: --timeout=5m\n") }, ["1.62.2"]],
  ["goreleaser-action", "goreleaser", { ".github/workflows/release.yml": WF("      - uses: goreleaser/goreleaser-action@v6\n        with:\n          distribution: goreleaser\n          version: \"~> v2\"\n") }, ["2"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - name: py\n        uses: actions/setup-python@v5\n        with:\n          python-version: \"3.12\"\n") }, ["3.12"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: \"actions/setup-node@v4\"\n        with:\n          node-version: 18\n") }, ["18"]], // quoted uses
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - 'uses': 'actions/setup-node@v4'\n        \"with\":\n          \"node-version\": 18\n") }, ["18"]], // quoted keys
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with: { cache: npm, node-version: 16 } # flow\n") }, ["16"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: { go-version-file: go.mod, cache: false }\n"), "go.mod": "go 1.26.1\n" }, ["1.26.1"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: {}\n      - uses: actions/setup-go@v5\n        with: { \"go-version\": '1.25.2', cache: \"a,b\" }\n") }, ["1.25.2"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: go.work")), "go.work": "go 1.26\n\nuse ./svc\n" }, ["1.26"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: .go-version")), ".go-version": "1.26.1\n" }, ["1.26.1"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[build-system]\nrequires = ["setuptools>=61.0"]\n\n[project]\nname = "app"\nrequires-python = ">=3.10, !=3.11.*, <4"\n' }, ["range >=3.10, !=3.11.*, <4"]], // requires-python is always a range
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": "[project]\nrequires-python = '~=3.11'\n[tool.x]\nrequires-python = '>=2.7'\n" }, ["range ~=3.11"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[project]\nrequires-python = ">=3.13.0rc1"\n' }, ["range >=3.13.0rc1"]], // a PEP 440 prerelease bound is passed through as written
  ["dockerfile", "node", { Dockerfile: "FROM node:22.0.0-rc.1-alpine\nFROM node:22.0.0-rc.1\n" }, ["22.0.0-rc.1", "22.0.0-rc.1"]], // a prerelease survives variant stripping
  ["dockerfile", "terraform", { Dockerfile: "FROM hashicorp/terraform:1.10.0-rc1\n" }, ["1.10.0-rc1"]],
  ["dockerfile", "python", { Dockerfile: "FROM python:3.13.0rc1-slim\nFROM python:3.12-slim-bookworm\n" }, ["3.13.0rc1", "3.12"]],
  ["dockerfile", "node", { Dockerfile: 'ARG NODE_VERSION="20.11.0"\nFROM node:${NODE_VERSION}-alpine\n' }, ["20.11.0"]], // a quoted ARG value
  ["dockerfile", "go", { Dockerfile: "ARG GO_VERSION='1.26.1'\nFROM golang:${GO_VERSION}\n" }, ["1.26.1"]],
  ["dockerfile", "node", { Dockerfile: 'ARG NODE_VERSION="18"\nFROM node:20\n' }, ["20", "18"]], // a quoted ARG beside a FROM tag is still seen
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=\"20-dev\"\n" }, ["20-dev"]], // an ARG value is classified as written: a bare -dev there is a prerelease
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - { uses: actions/setup-go@v5, with: { go-version: '1.25' } }\n") }, ["1.25"]], // a flow-mapped step is read
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: { go-version: '1.25',\n          cache: true }\n") }, ["1.25"]], // a multi-line flow map is read
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version:\n            18")) }, ["18"]], // value on the next line
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: |\n            18")) }, ["18"]], // block scalar
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: |\n            3.11\n            3.12\n") }, ["3.11", "3.12"]], // every line of a multi-version input
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: |\n            3.11\n            >=3.12\n") }, ["3.11", "range >=3.12"]], // each line is a pin or a range on its own
  // A direct range input installs some newer version, so it is no pin: it is reported as a range, never compared.
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '>=1.20'")) }, ["range >=1.20"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '^1.20'")) }, ["range ^1.20"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '>1.20'")) }, ["range >1.20"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '~1.20.3'")) }, ["range ~1.20.3"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20 || 22")) }, ["range 20 || 22"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 18 - 20")) }, ["range 18 - 20"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: '>=3.10'\n") }, ["range >=3.10"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: '~=3.12'\n") }, ["range ~=3.12"]],
  ["goreleaser-action", "goreleaser", { ".github/workflows/ci.yml": WF("      - uses: goreleaser/goreleaser-action@v6\n        with:\n          version: '^2.5'\n") }, ["range ^2.5"]],
  ["golangci-action", "golangci-lint", { ".github/workflows/ci.yml": WF("      - uses: golangci/golangci-lint-action@v6\n        with:\n          version: '>=1.62'\n") }, ["range >=1.62"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: '>=20'") + SETUP_NODE("node-version: 20.11.0")) }, ["range >=20", "20.11.0"]], // a range beside a pin in one source
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: Actions/Setup-Node@v4\n        with:\n          Node-Version: 16\n") }, ["16"]], // action refs and input names are case-insensitive
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version: ''\n          node-version-file: .nvmrc\n"), ".nvmrc": "20\n" }, ["20"]], // an empty input beside its -file uses the file
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.20'")) }, ["1.20"]],
  // A range no wider than its stated components installs the same series a partial version does.
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.20.x'")) }, ["1.20"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20.x")) }, ["20"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: '~20.11'")) }, ["20.11"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: ^20")) }, ["20"]],
  ["goreleaser-action", "goreleaser", { ".github/workflows/ci.yml": WF("      - uses: goreleaser/goreleaser-action@v6\n        with:\n          version: '~> v2.5'\n") }, ["2.5"]],
  ["python-version", "python", { ".python-version": "# pinned\n3.12.1\n3.11.7\n" }, ["3.12.1"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": "jobs:\n  a:\n    env:\n      x: &go { uses: actions/setup-go@v5, with: { go-version: '1.26.1' } }\n    steps:\n      - *go\n" }, ["1.26.1"]], // an aliased step
  // An ARG value is a pin by the classifier every reader uses: as written, with no version taken out of other text.
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=20.11.0\n" }, ["20.11.0"]],
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=20\n" }, ["20"]],
  // A FROM tag with a literal version before the `$` reads that version, variants dropped as for other tags.
  ["dockerfile", "node", { Dockerfile: "FROM node:18-${DISTRO}\n" }, ["18"]],
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=20.11.0\nFROM node:${NODE_VERSION}-alpine\n" }, ["20.11.0"]], // a tag starting with `$` is skipped, its ARG read
  // The pin-only readers accept every pin form the classifier accepts.
  ["tool-versions", "node", { ".tool-versions": "nodejs =20.11.1\n" }, ["20.11.1"]],
  ["tool-versions", "node", { ".tool-versions": "nodejs ~20.11\n" }, ["20.11"]],
  ["tool-versions", "node", { ".tool-versions": "nodejs ^20\n" }, ["20"]],
  ["tool-versions", "go", { ".tool-versions": "go 1.26.x\n" }, ["1.26"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version-file: package.json")), "package.json": '{"volta":{"node":"=20.11.1"}}' }, ["20.11.1"]],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version-file: package.json")), "package.json": '{"volta":{"node":"^20"}}' }, ["20"]],
];

describe("readSource hits", () => {
  it.each(hits)("%s for %s", (spec, tool, files, want) => {
    const root = tmp();
    for (const [f, c] of Object.entries(files)) put(root, f, c);
    expect(readSource(root, Object.keys(files), tool, spec).map(show)).toEqual(want);
  });

  it("marks engines as a range with its raw value, a pin as no range, and stamps the source", () => {
    const root = tmp();
    put(root, "package.json", '{"engines":{"node":">=20"}}');
    expect(readSource(root, [], "node", "engines")).toEqual([{ src: "engines:package.json", v: ">=20", range: true }]);
    put(root, ".github/workflows/ci.yml", WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"));
    expect(readSource(root, [".github/workflows/ci.yml"], "node", "setup-node")).toEqual([{ src: "setup-node:.github/workflows/ci.yml", v: ">=20", range: true }]);
    put(root, ".nvmrc", "v20.11\n");
    expect(readSource(root, [], "node", "nvmrc")).toEqual([{ src: "nvmrc:.nvmrc", v: "20.11", range: false }]);
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

  it("reads quoted uses and flow-map with in every globbed workflow", () => {
    const root = tmp();
    put(root, ".github/workflows/a.yml", WF("      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n"));
    put(root, ".github/workflows/b.yml", WF("      - uses: \"actions/setup-node@v4\"\n        with:\n          node-version: 18\n      - uses: actions/setup-node@v4\n        with: { node-version: 16 }\n"));
    const files = [".github/workflows/a.yml", ".github/workflows/b.yml"];
    expect(readSource(root, files, "node", "setup-node").map((x) => `${x.src}=${x.v}`)).toEqual(["setup-node:.github/workflows/a.yml=20", "setup-node:.github/workflows/b.yml=18", "setup-node:.github/workflows/b.yml=16"]);
  });

  it("compiles a source glob once, not once per tracked file", () => {
    const root = tmp();
    put(root, ".github/workflows/ci.yml", WF(SETUP_GO("go-version: 1.26.1")));
    const tracked = [".github/workflows/ci.yml", ...Array.from({ length: 500 }, (_, i) => `src/f${i}.go`)];
    vi.mocked(glob.compileGlob).mockClear();
    expect(readSource(root, tracked, "go", "setup-go").map((x) => x.v)).toEqual(["1.26.1"]);
    expect(vi.mocked(glob.compileGlob)).toHaveBeenCalledTimes(1);
  });

  it("does not read a with: that belongs to another step or a nested key", () => {
    const root = tmp();
    put(root, ".github/workflows/ci.yml", WF("      - with:\n          go-version: 1.1\n        uses: actions/checkout@v4\n      - uses: actions/setup-go@v5\n        env:\n          go-version: 1.2\n        with:\n          cache: true\n          extra:\n            go-version: 1.3\n"));
    expect(() => readSource(root, [".github/workflows/ci.yml"], "go", "setup-go")).toThrow(/no go version found/);
  });

  // One readable step must never hide another: either both values are read or the source fails.
  it.each([
    ["value on the next line", SETUP_NODE("node-version:\n            18"), ["20", "18"]],
    ["block scalar", SETUP_NODE("node-version: >-\n            18"), ["20", "18"]],
    ["mixed-case action ref", "      - uses: Actions/Setup-Node@v4\n        with:\n          node-version: 16\n", ["20", "16"]],
  ])("reads a second setup-node job whose step has its %s", (_n, step, want) => {
    const root = tmp();
    put(root, ".github/workflows/a.yml", "jobs:\n  a:\n    steps:\n" + SETUP_NODE("node-version: 20"));
    put(root, ".github/workflows/b.yml", "jobs:\n  b:\n    steps:\n" + step);
    expect(readSource(root, [".github/workflows/a.yml", ".github/workflows/b.yml"], "node", "setup-node").map((x) => x.v)).toEqual(want);
  });

  it.each([
    ["a run: block scalar", "      - run: |\n          grep 'uses: actions/setup-node@v4' x\n"],
    ["a comment on run:", "      - run: echo hi # uses: actions/setup-node@v4\n"],
    ["a comment on uses:", "      - uses: actions/checkout@v4  # replaces: uses: actions/setup-node@v4\n"],
    ["another input", "      - uses: some/action@v1\n        with:\n          script: 'uses: actions/setup-node@v4'\n"],
  ])("a uses: mention in %s is not an unread step", (_n, extra) => {
    const root = tmp();
    put(root, ".github/workflows/ci.yml", WF(SETUP_NODE("node-version: 20") + extra));
    expect(readSource(root, [".github/workflows/ci.yml"], "node", "setup-node").map((x) => x.v)).toEqual(["20"]);
  });

  it("reads with: entries in linear time on long whitespace runs", () => {
    const root = tmp();
    put(root, ".github/workflows/ci.yml", WF(SETUP_NODE("cache: a" + " ".repeat(200_000) + "b\n          node-version: 22.1.0 # lts")));
    const t = performance.now();
    expect(readSource(root, [".github/workflows/ci.yml"], "node", "setup-node").map((x) => x.v)).toEqual(["22.1.0"]);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

// A configured source that cannot be parsed is an error, never a pass.
const misses: [string, string, Record<string, string>, RegExp][] = [
  ["tool-versions", "go", { ".tool-versions": "nodejs 20\n" }, /no go version found/],
  ["tool-versions", "go", {}, /\.tool-versions not found/],
  ["nvmrc", "node", { ".nvmrc": "lts/*\n" }, unsupported("lts/*", ".nvmrc", 1)],
  ["go-mod", "go", { "go.mod": "module x\n" }, /no go version found/],
  ["go-mod", "node", { "go.mod": "go 1.25\n" }, /no node version found/],
  ["engines", "node", { "package.json": "{not json" }, /not valid JSON/],
  ["engines", "node", { "package.json": '{"engines":{"npm":">=9"}}' }, /no node version found/],
  ["engines", "node", { "package.json": '{"engines":{"node":20}}' }, /engines\.node/], // a non-string engines value is a FAIL that names the key
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"), "package.json": '{"version":"1.2.3"}' }, /no volta\.node or engines\.node/],
  ["dockerfile", "go", { Dockerfile: "FROM golang:latest\n" }, /unsupported form "[^"]*latest" in Dockerfile:1; pin an exact version/], // a non-version tag of the tool image
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: ${{ matrix.go }}")) }, /go-version "\$\{\{ matrix\.go \}\}" is not a literal version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: [1.25, 1.26]")) }, /go-version "\[1\.25, 1\.26\]" is not a literal version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: { go-version: '${{ matrix.go }}', cache: true }\n") }, /is not a literal version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: *common\n") }, /alias \*common at line 7 has no anchor/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: 1.26.1") + "      - uses: actions/setup-go@v5\n        with: { go-version: '${{ env.GO }}' }\n") }, /is not a literal version/], // one readable step does not excuse another
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[build-system]\nrequires = ["setuptools>=61.0"]\n' }, /no project\.requires-python/],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: Pipfile\n"), Pipfile: '[packages]\ndjango = "==4.2.7"\n' }, /no requires\.python_version/], // never reads a package pin as the python version
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: nope.mod")) }, /go-version-file nope\.mod not found/],
  ["setup-go:.github/workflows/*.yml", "go", {}, /no file matches/],
  ["golangci-action", "golangci-lint", { ".github/workflows/ci.yml": WF("      - uses: golangci/golangci-lint-action@v6\n        with:\n          version: latest\n") }, unsupported("latest", ".github/workflows/ci.yml", L)],
  ["goreleaser-action", "goreleaser", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: 1.25")) }, /no goreleaser version found/],
  // A present but unreadable version input fails even beside a pinned step, at the line of the value (the second step's is line 11).
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.22'") + SETUP_GO("go-version: stable")) }, unsupported("stable", ".github/workflows/ci.yml", 11)],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.22'") + SETUP_GO("go-version: oldstable")) }, unsupported("oldstable", ".github/workflows/ci.yml", 11)],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version: lts/*")) }, unsupported("lts/*", ".github/workflows/ci.yml", 11)],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version: node")) }, unsupported("node", ".github/workflows/ci.yml", 11)],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version: current")) }, unsupported("current", ".github/workflows/ci.yml", 11)],
  // `latest` is no longer skipped: it is an unsupported form like any other word.
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: latest")) }, unsupported("latest", ".github/workflows/ci.yml", L)],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version: latest")) }, unsupported("latest", ".github/workflows/ci.yml", 11)],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: latest\n") }, unsupported("latest", ".github/workflows/ci.yml", L)],
  ["goreleaser-action", "goreleaser", { ".github/workflows/ci.yml": WF("      - uses: goreleaser/goreleaser-action@v6\n        with:\n          version: latest\n") }, unsupported("latest", ".github/workflows/ci.yml", L)],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with: { cache: npm, node-version: lts/iron }\n") }, unsupported("lts/iron", ".github/workflows/ci.yml", 7)], // a flow map: the line of the value
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20.11.0-custom")) }, unsupported("20.11.0-custom", ".github/workflows/ci.yml", L)], // a version followed by other text
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version: ''")) }, /node-version has no value/],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version:")) }, /node-version has no value/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.22'") + SETUP_GO("go-version-file:")) }, /go-version-file has no value/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.22'") + SETUP_GO("go-version-file: sub/go.mod")), "sub/go.mod": "module y\n" }, /go-version-file sub\/go\.mod has no go version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.22'") + SETUP_GO("go-version-file: .tool-versions")), ".tool-versions": "nodejs 20\n" }, /go-version-file \.tool-versions has no go version/],
  // YAML 1.2 (what Actions parses) reads an unquoted 1.20 as the number 1.2.
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: 1.20")) }, /go-version: unquoted 1\.20 reads as 1\.2; quote it/],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: 3.10\n") }, /unquoted 3\.10 reads as 3\.1/],
  ["setup-go", "go", { ".github/workflows/ci.yml": "jobs:\n  a:\n    stepz:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: '1.1'\n" }, /actions\/setup-go step at line 4 cannot be read/], // a uses: outside any steps list
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.26.1'") + "      - uses: actions/setup-go@v5\n        with: { go-version: '1.25'\n") }, /not valid YAML/], // a workflow that fails to parse is a FAIL, not a skip
  // A plain version file is pins-only: a range there is still a FAIL.
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version-file: .nvmrc")), ".nvmrc": ">=20\n" }, /">=20" is a range/],
  ["nvmrc", "node", { ".nvmrc": "^20.11\n" }, /"\^20\.11" is a range/],
  // Every reader names the file and line of an unsupported value.
  ["tool-versions", "go", { ".tool-versions": "go 1.26.1\ngolang ref:abc123\n" }, unsupported("ref:abc123", ".tool-versions", 2)],
  ["tool-versions", "node", { ".tool-versions": "nodejs system\n" }, unsupported("system", ".tool-versions", 1)],
  ["tool-versions", "python", { ".tool-versions": "# python\npython path:/opt/py\n" }, unsupported("path:/opt/py", ".tool-versions", 2)],
  ["tool-versions", "node", { ".tool-versions": "nodejs lts\n" }, unsupported("lts", ".tool-versions", 1)],
  ["nvmrc", "node", { ".nvmrc": "lts/iron\n" }, unsupported("lts/iron", ".nvmrc", 1)],
  ["nvmrc", "node", { ".nvmrc": "node\n" }, unsupported("node", ".nvmrc", 1)],
  ["nvmrc", "node", { ".nvmrc": "# pinned by ops\n\nstable\n" }, unsupported("stable", ".nvmrc", 3)], // the first non-blank, non-comment line
  ["nvmrc", "node", { ".nvmrc": "20.11.0-custom\n" }, unsupported("20.11.0-custom", ".nvmrc", 1)], // a version followed by other text
  ["nvmrc:web/.nvmrc", "node", { "web/.nvmrc": "latest\n" }, unsupported("latest", "web/.nvmrc", 1)], // the repo-relative file
  ["node-version", "node", { ".node-version": "lts/*\n" }, unsupported("lts/*", ".node-version", 1)],
  ["python-version", "python", { ".python-version": "system\n" }, unsupported("system", ".python-version", 1)],
  ["go-mod", "go", { "go.mod": "module x\n\ngo stable\n" }, unsupported("stable", "go.mod", 3)],
  ["dockerfile", "node", { Dockerfile: "FROM node\n" }, /unsupported form "[^"]*node[^"]*" in Dockerfile:1; pin an exact version/], // the tool image with no tag
  ["dockerfile", "node", { Dockerfile: "FROM alpine:3.20 AS base\nFROM node AS build\n" }, /unsupported form "[^"]*" in Dockerfile:2; pin an exact version/],
  ["dockerfile", "go", { Dockerfile: "FROM localhost:5000/golang@sha256:abc\n" }, /unsupported form "[^"]*" in Dockerfile:1; pin an exact version/], // a digest only
  ["dockerfile", "node", { Dockerfile: "FROM node:20\nFROM node:lts-alpine3.20 AS build\n" }, /unsupported form "[^"]*lts-alpine3\.20[^"]*" in Dockerfile:2; pin an exact version/], // a non-version tag
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=lts\nFROM node:${NODE_VERSION}\n" }, unsupported("lts", "Dockerfile", 1)],
  ["dockerfile", "node", { Dockerfile: "FROM node:${NODE_VERSION}-alpine\n" }, /no node version found/], // a ${VAR} tag is skipped (its ARG is the pin), not unsupported
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version-file: package.json")), "package.json": '{"volta":{"node":"lts"}}' }, unsupported("lts", "package.json", 1)],
  // Value: protects=an unsupported volta.node names its own line in a multi-line package.json; fails_when=the line search
  // starts before "volta" (finding the earlier "lts"); why_new=the row above is one-line JSON; seam=none; no_claim=none beyond protects
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version-file: package.json")), "package.json": '{\n  "name": "lts",\n  "engines": { "node": ">=20" },\n  "volta": {\n    "node": "lts"\n  }\n}\n' }, unsupported("lts", "package.json", 5)],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: Pipfile\n"), Pipfile: '[requires]\npython_version = "latest"\n' }, unsupported("latest", "Pipfile", 2)],
  ["setup-go", "go", { ".github/workflows/ci.yml": "x: &w { go-version: '1.1' }\njobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          <<: *w\n          cache: true\n" }, /merge key/],
  // An ARG value that is not a pin by the classifier is unsupported: no version is taken out of a range, a variable or text.
  ["dockerfile", "node", { Dockerfile: 'ARG NODE_VERSION="20 || 22"\n' }, unsupported("20 || 22", "Dockerfile", 1)],
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=20${SUFFIX}\nFROM node:${NODE_VERSION}\n" }, unsupported("20${SUFFIX}", "Dockerfile", 1)],
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=${NODE_MAJOR}\n" }, unsupported("${NODE_MAJOR}", "Dockerfile", 1)],
  ["dockerfile", "node", { Dockerfile: "FROM node:20\nARG NODE_VERSION=\n" }, unsupported("", "Dockerfile", 2)],
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=latest\n" }, unsupported("latest", "Dockerfile", 1)],
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=20-alpine\n" }, unsupported("20-alpine", "Dockerfile", 1)], // a variant in an ARG is other text
  ["dockerfile", "python", { Dockerfile: "ARG PYTHON_VERSION=3.12.4-slim-bookworm\nFROM python:${PYTHON_VERSION}\n" }, unsupported("3.12.4-slim-bookworm", "Dockerfile", 1)],
  // A `$` tag that does not start with a literal version is unsupported.
  ["dockerfile", "node", { Dockerfile: "FROM node:lts-${X}\n" }, unsupported("node:lts-${X}", "Dockerfile", 1)],
  // A `$` that continues the version (no variant separator before it) leaves the version unknown, as an ARG value does.
  ["dockerfile", "node", { Dockerfile: "ARG NODE_MINOR=11\nFROM node:20.${NODE_MINOR}.0\n" }, unsupported("node:20.${NODE_MINOR}.0", "Dockerfile", 2)],
  ["dockerfile", "node", { Dockerfile: "FROM node:20${SUFFIX}\n" }, unsupported("node:20${SUFFIX}", "Dockerfile", 1)],
  // So does a `$` after a prerelease word: the version is complete only once a variant separator ends it.
  ["dockerfile", "python", { Dockerfile: "FROM python:3.13rc${BUILD}\n" }, unsupported("python:3.13rc${BUILD}", "Dockerfile", 1)],
  ["dockerfile", "node", { Dockerfile: "FROM node:22-rc${N}\n" }, unsupported("node:22-rc${N}", "Dockerfile", 1)],
  // An ARG value is its whole shell word: quotes may wrap the whole value only, so text joined to a quoted part is not a pin.
  ["dockerfile", "node", { Dockerfile: 'ARG NODE_VERSION="20"${SUFFIX}\n' }, unsupported('"20"${SUFFIX}', "Dockerfile", 1)],
  ["dockerfile", "node", { Dockerfile: 'ARG NODE_VERSION="2""2"\n' }, unsupported('"2""2"', "Dockerfile", 1)],
  ["dockerfile", "node", { Dockerfile: "ARG B=1 NODE_VERSION='20'.11.1\n" }, unsupported("'20'.11.1", "Dockerfile", 1)],
  // A go or toolchain directive is its whole value up to a `//` comment: text after the version is not a pin.
  ["go-mod", "go", { "go.mod": "module x\n\ngo 1.26 latest\n" }, unsupported("1.26 latest", "go.mod", 3)],
  ["go-mod", "go", { "go.mod": "module x\n\ngo 1.25\ntoolchain go1.26.1 local\n" }, unsupported("1.26.1 local", "go.mod", 4)],
  // A range in a pin-only reader is unsupported, at its file and line.
  ["tool-versions", "node", { ".tool-versions": "# node\nnodejs >=20\n" }, unsupported(">=20", ".tool-versions", 2)],
  ["go-mod", "go", { "go.mod": "module x\n\ngo >=1.20\n" }, unsupported(">=1.20", "go.mod", 3)],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version-file: package.json")), "package.json": '{\n  "volta": {\n    "node": "^20.11"\n  }\n}\n' }, unsupported("^20.11", "package.json", 3)],
  // Value: protects=a Pipfile python_version that is not a string FAILs; fails_when=the non-string guard is dropped and 3 reads as a
  // pin; why_new=no row gave Pipfile a non-string value; seam=none; no_claim=none beyond protects
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: Pipfile\n"), Pipfile: "[requires]\npython_version = 3\n" }, /requires\.python_version is not a string/],
  // An empty or comment-only plain version file holds no version: a FAIL, also as one of several glob matches.
  ["nvmrc", "node", { ".nvmrc": "" }, /no version in \.nvmrc/],
  ["python-version", "python", { ".python-version": "# none yet\n\n" }, /no version in \.python-version/],
  ["nvmrc:**/.nvmrc", "node", { "a/.nvmrc": "20\n", "b/.nvmrc": "# none\n" }, /no version in b\/\.nvmrc/],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version-file: .nvmrc")), ".nvmrc": "\n" }, /no version in \.nvmrc/],
];

describe("readSource misses", () => {
  it.each(misses)("%s for %s", (spec, tool, files, re) => {
    const root = tmp();
    for (const [f, c] of Object.entries(files)) put(root, f, c);
    expect(() => readSource(root, Object.keys(files), tool, spec)).toThrow(PinError);
    expect(() => readSource(root, Object.keys(files), tool, spec)).toThrow(re);
  });
});

const v = (src: string, ver: string, range = false): PinValue => ({ src, v: ver, range });

describe("compare modes", () => {
  it("cmp compares the components both sides state", () => {
    expect([cmp("1.26", "1.26.1"), cmp("1.26.0", "1.26.1"), cmp("1.25", "1.26"), cmp("2", "1.9"), cmp("1.26.1", "1.26.9", 2)]).toEqual([0, -1, -1, 1, 0]);
  });

  const cases: [string, "exact" | "minor" | "major", PinValue[], string | null][] = [
    ["exact agrees on stated parts", "exact", [v("a", "1.26"), v("b", "1.26.1")], null],
    ["exact flags a patch drift", "exact", [v("a", "1.26.0"), v("b", "1.26.1")], "a=1.26.0, b=1.26.1 disagree (exact)"],
    ["exact compares every pair, not just the first", "exact", [v("a", "1.26"), v("b", "1.26.1"), v("c", "1.26.2")], "a=1.26, b=1.26.1, c=1.26.2 disagree (exact)"],
    ["minor compares every pair, not just the first", "minor", [v("a", "1"), v("b", "1.25"), v("c", "1.26.0")], "a=1, b=1.25, c=1.26.0 disagree (minor)"],
    ["exact agrees when the less specific source is first", "exact", [v("a", "1.26"), v("b", "1.26.1"), v("c", "1.26.1")], null],
    ["minor ignores the patch", "minor", [v("a", "1.26.0"), v("b", "1.26.9")], null],
    ["minor flags a minor drift", "minor", [v("a", "1.25.0"), v("b", "1.26.0")], "a=1.25.0, b=1.26.0 disagree (minor)"],
    ["major ignores the minor", "major", [v("a", "20.1"), v("b", "20.9")], null],
    ["major flags a major drift", "major", [v("a", "18"), v("b", "20")], "a=18, b=20 disagree (major)"],
    // Only pins enter the comparison: a range never bounds them (the two 0.4.1 floor rows flip to agreement).
    ["exact ignores a range next to a higher pin", "exact", [v("engines", ">=20.11.0", true), v("nvmrc", "22.1.0")], null],
    ["minor ignores a range next to a higher pin", "minor", [v("engines", ">=20.11.0", true), v("nvmrc", "22.1.0")], null],
    ["exact no longer flags a pin below a range", "exact", [v("engines", ">=20.0.0", true), v("nvmrc", "18.2.0")], null],
    ["major no longer flags a pin below a range", "major", [v("engines", ">=20.0.0", true), v("nvmrc", "18.2.0")], null],
    ["exact ignores a range next to a partial pin", "exact", [v("engines", ">=20.11.0", true), v("nvmrc", "20")], null],
    ["major ignores a range between agreeing pins", "major", [v("n", "20.4.0"), v("e", ">=20.5.0", true), v("t", "20.6.0")], null],
    ["exact leaves a range out of a pin disagreement", "exact", [v("e", "20", true), v("n", "18"), v("t", "16")], "n=18, t=16 disagree (exact)"],
    ["exact never compares two ranges", "exact", [v("e", ">=18", true), v("f", "^22", true), v("n", "20.11.0")], null],
  ];
  it.each(cases)("%s", (_n, mode, vals, want) => {
    expect(disagreement(vals, mode)).toBe(want);
  });

  it.each(["20.11.0", "20.11.1"])("engines >20.11.0 with .nvmrc %s: the range is read raw and not compared", (nvmrc) => {
    const root = tmp();
    put(root, "package.json", '{"engines":{"node":">20.11.0"}}');
    put(root, ".nvmrc", nvmrc + "\n");
    const vals = [...readSource(root, ["package.json"], "node", "engines"), ...readSource(root, [".nvmrc"], "node", "nvmrc")];
    expect(vals.map(show)).toEqual(["range >20.11.0", nvmrc]);
    expect(disagreement(vals, "exact")).toBeNull();
  });

  it("keeps a prerelease distinct from its release", () => {
    expect([cmp("22.0.0-rc.1", "22.0.0"), cmp("22.0.0", "22.0.0-rc.1"), cmp("22.0.0-rc.1", "22.0.0-rc.1"), cmp("22.0.0-rc.2", "22.0.0-rc.10"), cmp("1.26rc1", "1.26.0")]).toEqual([-1, 1, 0, -1, -1]);
    expect([cmp("22.0.0-rc.1", "22.0.5", 2), cmp("22", "22.0.0-rc.1"), cmp("1.26rc1", "1.26.3", 2)]).toEqual([0, 1, -1]); // a prerelease counts once the compare reaches its last component
    expect(disagreement([v("nvmrc", "22.0.0-rc.1"), v("tv", "22.0.0")], "exact")).toBe("nvmrc=22.0.0-rc.1, tv=22.0.0 disagree (exact)");
    expect(disagreement([v("nvmrc", "22.0.0-rc.1"), v("tv", "22.0.3")], "minor")).toBeNull();
    expect([localOk("22.0.0-rc.1", "22.0.0", "exact"), localOk("22.0.0-rc.1", "22.0.0-rc.1", "exact")]).toEqual([false, true]);
    expect(pinOf([v("a", "22"), v("b", "22.0.0-rc.1")], "exact")).toBe("22.0.0-rc.1");
  });

  it("a Dockerfile image variant is no prerelease, but a hyphenated rc image is", () => {
    const root = tmp();
    put(root, "Dockerfile", "FROM python:3.12.4-slim-bookworm\nFROM node:22.0.0-rc.1-alpine\n");
    expect(disagreement([v("python-version:.python-version", "3.12.4"), ...readSource(root, ["Dockerfile"], "python", "dockerfile")], "exact")).toBeNull();
    expect(disagreement([v("nvmrc:.nvmrc", "22.0.0"), ...readSource(root, ["Dockerfile"], "node", "dockerfile")], "exact")).toBe("nvmrc:.nvmrc=22.0.0, dockerfile:Dockerfile=22.0.0-rc.1 disagree (exact)");
  });

  it("does not read patchlevels, build ids or vendor suffixes in probe output as prereleases", () => {
    expect([ver("ruby 3.1.4p223 (2023-03-30 revision 957bb7cb81)"), ver("hugo v0.139.0-abc123def+extended darwin/arm64"), ver("Docker Compose version v2.29.7-desktop.1"), ver("OpenSSL 1.1.1w  11 Sep 2023"), ver("docker-compose version 1.29.2-1")]).toEqual(["3.1.4", "0.139.0", "2.29.7", "1.1.1", "1.29.2"]);
    expect(localOk(ver("ruby 3.1.4p223")!, "3.1.4", "exact")).toBe(true);
    // real prereleases keep their identity
    expect([ver("v22.0.0-rc.1"), ver("Python 3.13.0rc1"), ver("go version go1.26rc1 linux/amd64"), ver("3.13-dev"), ver("20.0.0-beta-30"), ver("v23.0.0-nightly20240101abc"), ver("3.14.0a2"), ver("3.14.0.dev0")]).toEqual(["22.0.0-rc.1", "3.13.0rc1", "1.26rc1", "3.13-dev", "20.0.0-beta-30", "23.0.0-nightly20240101abc", "3.14.0a2", "3.14.0.dev0"]);
  });

  it("an .nvmrc prerelease against a .tool-versions release fails exact", () => {
    const root = tmp();
    put(root, ".nvmrc", "22.0.0-rc.1\n");
    put(root, ".tool-versions", "nodejs 22.0.0\n");
    const vals = [...readSource(root, [], "node", "nvmrc"), ...readSource(root, [], "node", "tool-versions")];
    expect(disagreement(vals, "exact")).toBe("nvmrc:.nvmrc=22.0.0-rc.1, tool-versions:.tool-versions=22.0.0 disagree (exact)");
  });

  it("pinOf and localOk follow the mode", () => {
    expect(pinOf([v("a", "1.26.1")], "exact")).toBe("1.26.1");
    expect([pinOf([v("a", "1.26"), v("b", "1.26.1")], "exact"), pinOf([v("a", "1.26.1"), v("b", "1.26.2")], "exact"), pinOf([v("a", "1"), v("b", "1.25")], "minor")]).toEqual(["1.26.1", "1.26.1", "1.25"]);
    expect(pinOf([v("e", ">=20.11.0", true), v("n", "20")], "exact")).toBe("20"); // a range is never the pin, even listed first
    expect([localOk("1.26.9", "1.26.1", "minor"), localOk("1.26.9", "1.26.1", "exact"), localOk("20.5.0", "20", "major"), localOk("21.0.0", "20", "major")]).toEqual([true, false, true, false]);
  });
});

const read = (spec: string, tool: string, files: Record<string, string>): string[] => {
  const root = tmp();
  for (const [f, c] of Object.entries(files)) put(root, f, c);
  return readSource(root, Object.keys(files), tool, spec).map(show);
};
const fails = (spec: string, tool: string, files: Record<string, string>, re: RegExp) => {
  const root = tmp();
  for (const [f, c] of Object.entries(files)) put(root, f, c);
  expect(() => readSource(root, Object.keys(files), tool, spec)).toThrow(PinError);
  expect(() => readSource(root, Object.keys(files), tool, spec)).toThrow(re);
};
const SETUP_PY = (w: string) => `      - uses: actions/setup-python@v5\n        with:\n          ${w}\n`;
const PYPROJECT = (toml: string) => ({ ".github/workflows/ci.yml": WF(SETUP_PY("python-version-file: pyproject.toml")), "pyproject.toml": toml });

describe("pyproject.toml is read as TOML", () => {
  it.each([
    ["dotted keys", 'project.name = "a"\nproject.requires-python = ">=3.10"\n', ["range >=3.10"]],
    ["an inline table", 'project = { name = "a", requires-python = ">=3.10" }\n', ["range >=3.10"]],
    ["a [ line inside a multi-line array", '[project]\nclassifiers = [\n  ["a", "b"],\n]\nrequires-python = ">=3.10"\n', ["range >=3.10"]],
    ["a header inside a multi-line string", '[tool.x]\ndoc = """\n[project]\nrequires-python = ">=2.7"\n"""\n[project]\nrequires-python = ">=3.12"\n', ["range >=3.12"]],
    ["an exact-looking value (still a range)", '[project]\nrequires-python = "==3.12.4"\n', ["range ==3.12.4"]],
    ["no lower bound (no longer a FAIL)", '[project]\nrequires-python = "<3.13"\n', ["range <3.13"]],
  ])("reads requires-python with %s", (_n, toml, want) => {
    expect(read("setup-python", "python", PYPROJECT(toml))).toEqual(want);
  });

  it.each([
    ["invalid TOML", '[project]\nrequires-python = ">=3.10"\n[project]\n', /not valid TOML/],
    ["a non-string requires-python", "[project]\nrequires-python = 3\n", /requires-python is not a string/],
  ])("fails on %s", (_n, toml, re) => fails("setup-python", "python", PYPROJECT(toml), re));
});

describe("pyproject.toml falls back to Poetry as setup-python does", () => {
  it.each([
    ["caret", '[tool.poetry]\nname = "x"\nversion = "0.1.0"\n\n[tool.poetry.dependencies]\npython = "^3.11"\n', ["range ^3.11"]],
    ["tilde", '[tool.poetry.dependencies]\npython = "~3.10"\n', ["range ~3.10"]],
    ["a comma range", '[tool.poetry.dependencies]\npython = ">=3.9,<4.0"\n', ["range >=3.9,<4.0"]],
    ["a space-separated range", '[tool.poetry.dependencies]\npython = ">=3.9 <4.0"\n', ["range >=3.9 <4.0"]],
    ["a wildcard", '[tool.poetry.dependencies]\npython = "3.11.*"\n', ["range 3.11.*"]],
    ["a bare version", '[tool.poetry.dependencies]\npython = "3.11"\n', ["range 3.11"]],
    ["|| alternatives", '[tool.poetry.dependencies]\npython = ">=3.11 || ^3.9"\n', ["range >=3.11 || ^3.9"]],
    ["* (no lower bound, no longer a FAIL)", '[tool.poetry.dependencies]\npython = "*"\n', ["range *"]],
    ["an alternative with no lower bound (no longer a FAIL)", '[tool.poetry.dependencies]\npython = "<3.9 || >=3.11"\n', ["range <3.9 || >=3.11"]],
  ])("reads a Poetry %s as a range, raw", (_n, toml, want) => {
    expect(read("setup-python", "python", PYPROJECT(toml))).toEqual(want);
  });

  it.each([
    ["[project] present: Poetry is not read", '[project]\nname = "x"\n[tool.poetry.dependencies]\npython = "^3.11"\n', /no project\.requires-python$/],
    ["neither key", '[tool.poetry]\nname = "x"\n', /no project\.requires-python or tool\.poetry\.dependencies\.python/],
    ["a non-string python", '[tool.poetry.dependencies]\npython = [{ version = "^3.11" }]\n', /tool\.poetry\.dependencies\.python is not a string/],
  ])("fails when %s", (_n, toml, re) => fails("setup-python", "python", PYPROJECT(toml), re));
});

describe("plain version files", () => {
  it.each([
    ["nvmrc", "node", { ".nvmrc": "20 # LTS\n" }, ["20"]],
    ["nvmrc", "node", { ".nvmrc": "v20.11.0 # iron\n" }, ["20.11.0"]],
    ["node-version", "node", { ".node-version": "20.11.1 # lts\n" }, ["20.11.1"]],
    ["python-version", "python", { ".python-version": "3.12.4  # project default\n" }, ["3.12.4"]],
  ])("%s reads a pin with a trailing comment", (spec, tool, files, want) => {
    expect(read(spec, tool, files)).toEqual(want);
  });

  it("a range with a trailing comment is still a range", () => fails("nvmrc", "node", { ".nvmrc": ">=20 # any\n" }, /">=20" is a range/));

  it.each([
    [".nvmrc in a subdirectory", "web/.nvmrc", { "web/.nvmrc": "20.11.0\n" }, ["20.11.0"]],
    [".node-version", ".node-version", { ".node-version": "20\n" }, ["20"]],
  ])("a supported -file basename reads %s", (_n, f, files, want) => {
    expect(read("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE(`node-version-file: ${f}`)), ...files })).toEqual(want);
  });

  // Only the supported basenames are read: any other -file name is an unsupported form, with no plain-file fallback.
  it.each([
    ["a version", { ".github/node-version": "20.11.0\n" }, ".github/node-version"],
    ["a version, named like .node-version-ci", { ".node-version-ci": "20\n" }, ".node-version-ci"],
    ["a range", { ".node-version-ci": ">=20\n" }, ".node-version-ci"],
    ["a structured file", { "versions.json": '{"node": "20"}\n' }, "versions.json"],
  ])("an unknown -file basename holding %s fails as unsupported", (_n, files, f) =>
    fails("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE(`node-version-file: ${f}`)), ...files }, new RegExp(`unsupported form: node-version-file \\S*${f.split("/").pop()!.replace(/\./g, "\\.")} in \\.github/workflows/ci\\.yml:8 is not a supported version file \\(.*\\.nvmrc.*\\); pin an exact version`)),
  );

  it.each([
    ["python_version", '[[source]]\nurl = "https://pypi.org/simple"\n[packages]\ndjango = "==4.2.7"\n[requires]\npython_version = "3.12"\n', ["3.12"]],
    ["python_full_version over python_version", '[requires]\npython_version = "3.12"\npython_full_version = "3.12.4"\n', ["3.12.4"]],
    ["a range python_version (reported, not a FAIL)", '[requires]\npython_version = ">=3.10"\n', ["range >=3.10"]],
  ])("python-version-file: Pipfile reads [requires] %s", (_n, pipfile, want) => {
    expect(read("setup-python", "python", { ".github/workflows/ci.yml": WF(SETUP_PY("python-version-file: Pipfile")), Pipfile: pipfile })).toEqual(want);
  });
});

describe("workflow step shapes", () => {
  it("reads a composite action's runs.steps", () => {
    expect(read("setup-go:.github/actions/*/action.yml", "go", { ".github/actions/s/action.yml": "runs:\n  using: composite\n  steps:\n    - uses: actions/setup-go@v5\n      with:\n        go-version: '1.25'\n" })).toEqual(["1.25"]);
  });

  it("reads a step reachable from two steps lists once", () => {
    expect(read("setup-go", "go", { ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - &s\n        uses: actions/setup-go@v5\n        with:\n          go-version: '1.25'\n  b:\n    steps:\n      - *s\n" })).toEqual(["1.25"]);
  });

  it.each([
    ["a scalar", "foo", /with: of actions\/setup-go at line 5 is not a mapping/],
    ["a sequence", "[a]", /with: of actions\/setup-go at line 5 is not a mapping/],
  ])("a with: that is %s fails", (_n, w, re) => fails("setup-go", "go", { ".github/workflows/ci.yml": `jobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n        with: ${w}\n` }, re));
});

describe("Dockerfile image variants", () => {
  it.each([
    ["node", "FROM cgr.dev/chainguard/node:20-dev AS build\nFROM cgr.dev/chainguard/node:20\nFROM cgr.dev/chainguard/node:20.11-dev\n", ["20", "20", "20.11"]],
    ["python", "FROM cgr.dev/chainguard/python:3.12-dev\nFROM cgr.dev/chainguard/python:3.12.4-dev-slim\n", ["3.12", "3.12.4"]],
  ])("a bare -dev tag is the Chainguard dev variant, not a prerelease (%s)", (tool, dockerfile, want) => {
    expect(read("dockerfile", tool, { Dockerfile: dockerfile })).toEqual(want);
  });

  it.each([
    ["openjdk", "FROM openjdk:22-ea-15-jdk-slim\n", ["22-ea-15"]], // OpenJDK early-access build
    ["python", "FROM python:3.14-rc-slim\n", ["3.14-rc"]],
    ["node", "FROM node:23-next\nARG NODE_VERSION=23.0.0-dev.1\n", ["23-next", "23.0.0-dev.1"]], // a -dev with a number is a prerelease
    ["node", "FROM node:22-pre\n", ["22-pre"]],
  ])("other prerelease suffixes keep their identity in a %s tag", (tool, dockerfile, want) => {
    expect(read("dockerfile", tool, { Dockerfile: dockerfile })).toEqual(want);
  });

  it("a Chainguard -dev image agrees with a plain pin", () => {
    const vals = read("dockerfile", "node", { Dockerfile: "FROM cgr.dev/chainguard/node:20-dev AS build\nFROM cgr.dev/chainguard/node:20\n" });
    expect(disagreement([v("nvmrc:.nvmrc", "20"), ...vals.map((x) => v("dockerfile", x))], "exact")).toBeNull();
    expect(ver("3.13-dev")).toBe("3.13-dev"); // outside a Dockerfile -dev is still a prerelease
  });
});

describe("implementations and keywords are unsupported forms", () => {
  it.each(["pypy3.9", "pypy-3.10", "graalpy-24.0"])("setup-python %s is unsupported", (pv) =>
    fails("setup-python", "python", { ".github/workflows/ci.yml": WF(SETUP_PY(`python-version: '${pv}'`)) }, unsupported(pv, ".github/workflows/ci.yml", L)),
  );
  it("setup-node lts/-1 is unsupported", () => fails("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: lts/-1")) }, unsupported("lts/-1", ".github/workflows/ci.yml", L)));
  it.each([
    ["nvmrc", "node", { ".nvmrc": "lts/-1\n" }, unsupported("lts/-1", ".nvmrc", 1)],
    ["python-version", "python", { ".python-version": "pypy3.9-7.3.11\n" }, unsupported("pypy3.9-7.3.11", ".python-version", 1)],
    ["tool-versions", "python", { ".tool-versions": "python pypy3.9-7.3.11\n" }, unsupported("pypy3.9-7.3.11", ".tool-versions", 1)], // no longer skipped
  ])("%s does not read a version out of an implementation or keyword", (spec, tool, files, re) => fails(spec, tool, files, re));
  it("a Dockerfile tool-image tag that starts with a keyword is unsupported, not skipped", () =>
    fails("dockerfile", "node", { Dockerfile: "FROM node:lts-alpine3.20 AS build\nFROM node:20\n" }, /unsupported form "[^"]*lts-alpine3\.20[^"]*" in Dockerfile:1; pin an exact version/));
  it.each([
    ["v20", ["20"]],
    ["'~20.11'", ["20.11"]],
  ])("setup-node %s still reads", (nv, want) => {
    expect(read("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE(`node-version: ${nv}`)) })).toEqual(want);
  });
});

describe("semver equality", () => {
  it.each([
    ["nvmrc", { ".nvmrc": "=20.11.1\n" }, ["20.11.1"]],
    ["node-version", { ".node-version": "=v20.11.1\n" }, ["20.11.1"]],
    ["setup-node", { ".github/workflows/ci.yml": WF(SETUP_NODE('node-version: "= v20.11.1"')) }, ["20.11.1"]],
  ])("%s reads =X as the exact pin X", (spec, files, want) => {
    expect(read(spec, "node", files)).toEqual(want);
  });
  it.each([
    ["nvmrc", "node", { ".nvmrc": "==20.11.1\n" }, /"==20\.11\.1" is a range/],
    ["python-version", "python", { ".python-version": "=3.12.1\n" }, /"=3\.12\.1" is a range/], // pyenv has no `=`
  ])("%s keeps other equality forms as ranges", (spec, tool, files, re) => fails(spec, tool, files, re));
});

describe("a direct version input wins over its -file, as the setup actions do", () => {
  it.each([
    ["setup-node", "node", SETUP_NODE("node-version: 22\n          node-version-file: .nvmrc"), { ".nvmrc": "18\n" }, ["22"]],
    ["setup-node", "node", SETUP_NODE("node-version-file: .nvmrc\n          node-version: 22"), {}, ["22"]], // the ignored file may be missing
    ["setup-go", "go", SETUP_GO("go-version: 1.26.1\n          go-version-file: go.mod"), { "go.mod": "module x\n\ngo 1.24.0\n" }, ["1.26.1"]],
    ["setup-python", "python", SETUP_PY("python-version: '3.12'\n          python-version-file: .python-version"), { ".python-version": "3.11\n" }, ["3.12"]],
  ])("%s", (spec, tool, step, extra, want) => {
    expect(read(spec, tool, { ".github/workflows/ci.yml": WF(step), ...extra })).toEqual(want);
  });
  it("a direct latest still ignores the file, and is itself unsupported", () =>
    fails("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: latest\n          node-version-file: .nvmrc")), ".nvmrc": "18\n" }, unsupported("latest", ".github/workflows/ci.yml", L)));
  it("a direct range wins over the file and is reported as a range", () =>
    expect(read("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: '>=20'\n          node-version-file: .nvmrc")), ".nvmrc": "18\n" })).toEqual(["range >=20"]));
});

describe("a range is only made of versions: a word or other text after a version is unsupported", () => {
  const CI = ".github/workflows/ci.yml";
  it.each([
    ["setup-node", "node", WF(SETUP_NODE("node-version: '20 latest'") + SETUP_NODE("node-version: 20.11.0")), unsupported("20 latest", CI, L)],
    ["setup-node", "node", WF(SETUP_NODE("node-version: '^lts20'")), unsupported("^lts20", CI, L)],
    ["setup-node", "node", WF(SETUP_NODE("node-version: '>=20 || lts'")), unsupported(">=20 || lts", CI, L)],
    ["setup-python", "python", WF(SETUP_PY("python-version: '3.10, pypy'")), unsupported("3.10, pypy", CI, L)],
    // YAML keeps the comment text inside a block scalar, so the action receives `3.11 # old`.
    ["setup-python", "python", WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: |\n            3.11 # old\n"), unsupported("3.11 # old", CI, L)],
    ["golangci-action", "golangci-lint", WF("      - uses: golangci/golangci-lint-action@v6\n        with:\n          version: 'v1.62 nightly'\n"), unsupported("v1.62 nightly", CI, L)],
  ])("%s %s", (spec, tool, wf, re) => fails(spec, tool, { [CI]: wf }, re));
  it.each([
    ["Pipfile", { [CI]: WF(SETUP_PY("python-version-file: Pipfile")), Pipfile: '[requires]\npython_version = "3.10, pypy"\n' }, unsupported("3.10, pypy", "Pipfile", 2)],
    ["nvmrc", { ".nvmrc": "20 latest\n" }, unsupported("20 latest", ".nvmrc", 1)],
  ] as const)("%s", (spec, files, re) => fails(spec === "nvmrc" ? "nvmrc" : "setup-python", spec === "nvmrc" ? "node" : "python", files, re));
  it.each([
    ["node-version: '>= 20 < 23'", "range >= 20 < 23"],
    ["node-version: '20.x || 22.x'", "range 20.x || 22.x"],
    ["node-version: '~> 20.11.1'", "range ~> 20.11.1"],
  ])("setup-node %s is still a range", (w, want) => expect(read("setup-node", "node", { [CI]: WF(SETUP_NODE(w)) })).toEqual([want]));
  it("setup-python '!=3.11' is a range (a PEP 440 exclusion), reported not compared", () =>
    expect(read("setup-python", "python", { [CI]: WF(SETUP_PY("python-version: '!=3.11'")) })).toEqual(["range !=3.11"]));
});

describe("Dockerfile instructions are read wherever Docker reads them", () => {
  it.each([
    ["an indented FROM with no tag", "FROM node:20.11.0 AS a\n  FROM node AS b\n", /unsupported form "[^"]*node[^"]*" in Dockerfile:2; pin an exact version/],
    ["a tab-indented FROM with a non-version tag", "FROM node:20.11.0 AS a\n\tFROM node:latest AS b\n", /unsupported form "node:latest" in Dockerfile:2; pin an exact version/],
    ["a FROM continued onto the next line", "FROM node:20.11.0 AS a\nFROM \\\n  node:latest AS b\n", /unsupported form "node:latest" in Dockerfile:3; pin an exact version/],
    ["a FROM with two flags", "FROM --platform=x --link node:latest\n", /unsupported form "node:latest" in Dockerfile:1; pin an exact version/],
    ["an indented ARG", "FROM node:20.11.0\n  ARG NODE_VERSION=lts\n", unsupported("lts", "Dockerfile", 2)],
    ["the tool's ARG as a second key", "ARG BASE=x NODE_VERSION=lts\n", unsupported("lts", "Dockerfile", 1)],
    ["the tool's ARG on a continued line", "ARG BASE=x \\\n    NODE_VERSION=lts\n", unsupported("lts", "Dockerfile", 2)],
    // A comment line is never continued: a FROM after `# note \\` is its own instruction.
    ["a FROM after a comment ending in a backslash", "# note \\\nFROM node:latest\n", /unsupported form "node:latest" in Dockerfile:2; pin an exact version/],
    // An empty line inside a continuation is dropped, so the continuation goes on to the image.
    ["a continued FROM across an empty line", "FROM \\\n\n  node:latest\n", /unsupported form "node:latest" in Dockerfile:3; pin an exact version/],
    // The line is the image's, not the line an AS clause on a continuation line ends on.
    ["a tagless FROM with AS on a continuation line", "FROM node \\\n    AS x\n", /unsupported form "node" in Dockerfile:1; pin an exact version/],
    ["an unterminated heredoc (Docker rejects it too)", "FROM node:20\nRUN <<EOF\nFROM node:latest\n", /unterminated heredoc <<EOF in Dockerfile:2/],
    ["a heredoc that ends before a FROM", "FROM node:20\nRUN <<EOF\necho hi\nEOF\nFROM node:latest\n", /unsupported form "node:latest" in Dockerfile:5; pin an exact version/],
    // `<<` inside quotes is not a heredoc word (Docker splits the line into shell words first), so nothing is skipped.
    ["a FROM after a double-quoted <<EOF", 'FROM node:20\nRUN echo "use <<EOF for docs"\nFROM node:latest\nRUN <<EOF\necho\nEOF\n', /unsupported form "node:latest" in Dockerfile:3; pin an exact version/],
    ["a FROM after a single-quoted <<EOF", "FROM node:20\nRUN echo 'use <<EOF for docs'\nFROM node:latest\nRUN <<EOF\necho\nEOF\n", /unsupported form "node:latest" in Dockerfile:3; pin an exact version/],
    // Value: protects=Dockerfile logical-line edge shapes keep their file:line: a continuation open at EOF, CRLF endings, and
    // `<<` on an instruction that takes no heredoc; fails_when=the EOF flush is dropped (the FROM vanishes), \r leaks into the
    // text or the heredoc terminator match, or the RUN|COPY|ADD guard is removed (the LABEL line then reads as an unterminated
    // heredoc); why_new=the rows above end every continuation, use LF, and only open heredocs on RUN; seam=none; no_claim=none beyond protects
    ["a FROM whose last line ends in a backslash", "FROM node:20\nFROM node:latest \\\n", /unsupported form "node:latest" in Dockerfile:2; pin an exact version/],
    ["CRLF line endings keep the physical line", "FROM node:20\r\nRUN a \\\r\n  && b\r\nFROM node:latest\r\n", /unsupported form "node:latest" in Dockerfile:4; pin an exact version/],
    ["a << word on a LABEL is no heredoc", "FROM node:20\nLABEL <<EOF\nFROM node:latest\n", /unsupported form "node:latest" in Dockerfile:3; pin an exact version/],
    // The line is counted in UTF-16 units, as the instruction text is indexed: a character outside the BMP shifts nothing.
    ["an ARG value after an emoji on a continued line", 'ARG A="🙂🙂🙂🙂" NODE_VERSION=lts \\\n  B=1\n', unsupported("lts", "Dockerfile", 1)],
    // An instruction still open at EOF gets the same heredoc check as any other.
    ["a heredoc opened on a continuation left open at EOF", "FROM node:20\nRUN <<EOF \\\n", /unterminated heredoc <<EOF in Dockerfile:2/],
    // A line of any length is read: the line map grows without a spread.
    ["a FROM after a 500,000-character RUN line", `FROM node:20\nRUN ${"a".repeat(500_000)}\nFROM node:latest\n`, /unsupported form "node:latest" in Dockerfile:3; pin an exact version/],
    // Only the default `\` escape is read: a parser directive that changes it is unsupported, at its line.
    ["a backtick escape directive", "# escape=`\nFROM node:20\n", unsupported("escape=`", "Dockerfile", 1)],
    ["an escape directive after a byte-order mark", "\uFEFF# escape=`\nFROM node:20\n", unsupported("escape=`", "Dockerfile", 1)],
    ["a spaced escape directive after a syntax directive", "# syntax=docker/dockerfile:1\n#  ESCAPE = `\nFROM node:20\n", unsupported("escape=`", "Dockerfile", 2)],
  ])("%s", (_n, dockerfile, re) => fails("dockerfile", "node", { Dockerfile: dockerfile }, re));
  it("reads every NAME=value pair on an ARG line for the tool", () =>
    fails("dockerfile", "python", { Dockerfile: "ARG NODE_VERSION=20 PYTHON_VERSION=latest\n" }, unsupported("latest", "Dockerfile", 1)));
  it.each([
    ["an indented FROM", "  FROM node:20.11.0\n", ["20.11.0"]],
    ["a continued FROM", "FROM \\\n  node:20.11.0 AS a\n", ["20.11.0"]],
    ["a second-key ARG", 'ARG BASE=x NODE_VERSION="20.11.0"\n', ["20.11.0"]],
    ["a FROM word inside a continued RUN is not an instruction", "FROM node:20\nRUN echo \\\n  FROM node\n", ["20"]],
    // A comment line inside a continuation is dropped without ending it.
    ["an instruction after a continuation with a comment in it", "RUN a \\\n# c\n    && b\nFROM node:18\n", ["18"]],
    ["a FROM word after a comment inside a continued RUN", "FROM node:20\nRUN a \\\n# c\n    FROM node:latest\n", ["20"]],
    // A heredoc body is not instructions.
    ["a FROM in a RUN heredoc body", "FROM node:20\nRUN <<EOF\nFROM node:latest\nEOF\n", ["20"]],
    ["a FROM in a quoted <<- heredoc body", "FROM node:20\nRUN cat <<-\"EOT\" > /x\n\tFROM node:latest\n\tEOT\nFROM node:18\n", ["20", "18"]],
    ["a FROM in a backslash-quoted heredoc body", "FROM node:20\nRUN <<\\EOF\nFROM node:latest\nEOF\n", ["20"]],
    // COPY and ADD take heredocs like RUN; a single-quoted name and CRLF endings close it the same way.
    // Value: protects=a COPY/ADD heredoc body, a single-quoted name and a CRLF heredoc are skipped and reading resumes after the
    // delimiter; fails_when=the guard is narrowed to RUN, quotes stay on the name, or \r breaks the delimiter match; why_new=the rows
    // above open heredocs only on RUN with LF endings; seam=none; no_claim=none beyond protects
    ["a FROM in a COPY heredoc body", "FROM node:20\nCOPY <<EOF /x\nFROM node:latest\nEOF\n", ["20"]],
    ["a FROM in an ADD heredoc body", "FROM node:20\nADD <<EOF /x\nFROM node:latest\nEOF\nFROM node:18\n", ["20", "18"]],
    ["a FROM in a single-quoted heredoc body", "FROM node:20\nRUN cat <<'EOF'\nFROM node:latest\nEOF\n", ["20"]],
    ["a FROM in a heredoc body under CRLF endings", "FROM node:20\r\nRUN <<EOF\r\nFROM node:latest\r\nEOF\r\nFROM node:18\r\n", ["20", "18"]],
    ["a FROM in a heredoc whose name has a dash", "FROM node:20\nRUN <<END-OF-SCRIPT\nFROM node:latest\nEND-OF-SCRIPT\n", ["20"]],
    ["a FROM in a heredoc whose name is partly quoted", 'FROM node:20\nRUN <<E"OF"\nFROM node:latest\nEOF\n', ["20"]],
    // A version a variant separator ends is complete, wherever the `$` comes after it.
    ["a FROM with a variable after a variant word", "FROM node:20-alpine${ALPINE}\n", ["20"]],
    // An escape directive of `\`, one after a blank line and one after an instruction are not changes of escape.
    ["a FROM after a backslash escape directive", "# escape=\\\nFROM node:20\n", ["20"]],
    ["a FROM after an escape comment past a blank line", "\n# escape=`\nFROM node:20\n", ["20"]],
    ["a FROM before an escape comment", "FROM node:20\n# escape=`\n", ["20"]],
  ])("%s still reads", (_n, dockerfile, want) => expect(read("dockerfile", "node", { Dockerfile: dockerfile })).toEqual(want));
});

describe("a tagless FROM naming an earlier stage alias is a stage reference", () => {
  it("skips the reference and keeps the tool image's pin", () =>
    expect(read("dockerfile", "node", { Dockerfile: "FROM node:20.11.0 AS node\nFROM node AS runtime\n" })).toEqual(["20.11.0"]));
  it("matches the alias case-insensitively", () =>
    expect(read("dockerfile", "node", { Dockerfile: "FROM node:20.11.0 AS Node\nFROM node AS runtime\n" })).toEqual(["20.11.0"]));
  it("reads no node version from a stage that aliases another image", () =>
    fails("dockerfile", "node", { Dockerfile: "FROM alpine AS node\nFROM node AS runtime\n" }, /no node version found/));
  it("still fails a tagless tool image when no earlier stage has that alias", () =>
    fails("dockerfile", "node", { Dockerfile: "FROM node AS build\n" }, /unsupported form "[^"]*node[^"]*" in Dockerfile:1; pin an exact version/));
  it("does not take a later alias as a reference", () =>
    fails("dockerfile", "node", { Dockerfile: "FROM node\nFROM alpine AS node\n" }, /unsupported form "[^"]*node[^"]*" in Dockerfile:1; pin an exact version/));
});

describe("package.json volta is a pin or unsupported, never skipped", () => {
  const CI = ".github/workflows/ci.yml";
  it.each([
    ["a number", '{"volta":{"node":18},"engines":{"node":">=20"}}'],
    ["an object", '{"volta":{"node":{"v":"lts"}},"engines":{"node":">=20"}}'],
    ["null", '{"volta":{"node":null},"engines":{"node":">=20"}}'],
  ])("a volta.node that is %s is a FAIL, not a fall back to engines", (_n, pkgJson) =>
    fails("setup-node", "node", { [CI]: WF(SETUP_NODE("node-version-file: package.json")), "package.json": pkgJson }, /volta\.node is not a string/));
  it("an absent volta.node still falls back to engines (a range)", () =>
    expect(read("setup-node", "node", { [CI]: WF(SETUP_NODE("node-version-file: package.json")), "package.json": '{"volta":{"npm":"10.2.0"},"engines":{"node":">=20"}}' })).toEqual(["range >=20"]));
});
