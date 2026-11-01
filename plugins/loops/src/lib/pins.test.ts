import { describe, expect, it, vi } from "vitest";
import * as glob from "./glob.js";
import { belowFloor, cmp, disagreement, localOk, PinError, pinOf, readSource, ver, type PinValue } from "./pins.js";
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
  ["engines", "node", { "package.json": '{"engines":{"node":">20.0.0-rc.1"}}' }, ["20.0.0-rc.1.0"]], // an exclusive prerelease bound floors at its immediate successor, so rc.2 passes
  ["engines", "node", { "package.json": '{"engines":{"node":">=20.0.0-beta-30"}}' }, ["20.0.0-beta-30"]], // a hyphen inside the prerelease is not a second bound
  ["engines", "node", { "package.json": '{"engines":{"node":">20.0.0-beta-30"}}' }, ["20.0.0-beta-30.0"]],
  ["engines", "node", { "package.json": '{"engines":{"node":">=20.0.0-0"}}' }, ["20.0.0-0"]], // an inclusive prerelease bound keeps its prerelease
  ["engines", "node", { "package.json": '{"engines":{"node":">=20.0.0-rc.1 <21"}}' }, ["20.0.0-rc.1"]],
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
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: \"actions/setup-node@v4\"\n        with:\n          node-version: 18\n") }, ["18"]], // quoted uses
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - 'uses': 'actions/setup-node@v4'\n        \"with\":\n          \"node-version\": 18\n") }, ["18"]], // quoted keys
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with: { cache: npm, node-version: 16 } # flow\n") }, ["16"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: { go-version-file: go.mod, cache: false }\n"), "go.mod": "go 1.26.1\n" }, ["1.26.1"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: {}\n      - uses: actions/setup-go@v5\n        with: { \"go-version\": '1.25.2', cache: \"a,b\" }\n") }, ["1.25.2"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: go.work")), "go.work": "go 1.26\n\nuse ./svc\n" }, ["1.26"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: .go-version")), ".go-version": "1.26.1\n" }, ["1.26.1"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[build-system]\nrequires = ["setuptools>=61.0"]\n\n[project]\nname = "app"\nrequires-python = ">=3.10, !=3.11.*, <4"\n' }, ["3.10"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": "[project]\nrequires-python = '~=3.11'\n[tool.x]\nrequires-python = '>=2.7'\n" }, ["3.11"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[project]\nrequires-python = ">3.9"\n' }, ["3.9.1"]],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[project]\nrequires-python = ">=3.13.0rc1"\n' }, ["3.13.0rc1"]], // a PEP 440 prerelease bound keeps its prerelease
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[project]\nrequires-python = ">3.13.0rc1"\n' }, ["3.13.0rc1.0"]], // like engines: an exclusive prerelease bound floors at its immediate successor
  ["dockerfile", "node", { Dockerfile: "FROM node:22.0.0-rc.1-alpine\nFROM node:22.0.0-rc.1\n" }, ["22.0.0-rc.1", "22.0.0-rc.1"]], // a prerelease survives variant stripping
  ["dockerfile", "terraform", { Dockerfile: "FROM hashicorp/terraform:1.10.0-rc1\n" }, ["1.10.0-rc1"]],
  ["dockerfile", "python", { Dockerfile: "FROM python:3.13.0rc1-slim\nFROM python:3.12-slim-bookworm\n" }, ["3.13.0rc1", "3.12"]],
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=20-alpine\n" }, ["20"]], // an ARG variant is not a prerelease
  ["dockerfile", "python", { Dockerfile: "ARG PYTHON_VERSION=3.12.4-slim-bookworm\nFROM python:${PYTHON_VERSION}\n" }, ["3.12.4"]],
  ["dockerfile", "node", { Dockerfile: 'ARG NODE_VERSION="20.11.0"\nFROM node:${NODE_VERSION}-alpine\n' }, ["20.11.0"]], // a quoted ARG value
  ["dockerfile", "go", { Dockerfile: "ARG GO_VERSION='1.26.1'\nFROM golang:${GO_VERSION}\n" }, ["1.26.1"]],
  ["dockerfile", "node", { Dockerfile: 'ARG NODE_VERSION="18"\nFROM node:20\n' }, ["20", "18"]], // a quoted ARG beside a FROM tag is still seen
  ["dockerfile", "node", { Dockerfile: "ARG NODE_VERSION=\"20-dev\"\n" }, ["20"]],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - { uses: actions/setup-go@v5, with: { go-version: '1.25' } }\n") }, ["1.25"]], // a flow-mapped step is read
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: { go-version: '1.25',\n          cache: true }\n") }, ["1.25"]], // a multi-line flow map is read
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version:\n            18")) }, ["18"]], // value on the next line
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: |\n            18")) }, ["18"]], // block scalar
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: |\n            3.11\n            3.12\n") }, ["3.11", "3.12"]], // every line of a multi-version input
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
  ["nvmrc", "node", { ".nvmrc": "lts/*\n" }, /no version in "lts/],
  ["go-mod", "go", { "go.mod": "module x\n" }, /no go version found/],
  ["go-mod", "node", { "go.mod": "go 1.25\n" }, /no node version found/],
  ["engines", "node", { "package.json": "{not json" }, /not valid JSON/],
  ["engines", "node", { "package.json": '{"engines":{"npm":">=9"}}' }, /no node version found/],
  ["engines", "node", { "package.json": '{"engines":{"node":"<20"}}' }, /engines\.node "<20" has no lower bound/],
  ["engines", "node", { "package.json": '{"engines":{"node":"<20.0.0-0"}}' }, /engines\.node "<20\.0\.0-0" has no lower bound/], // a prerelease tag is not a bound
  ["setup-node", "node", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-node@v4\n        with:\n          node-version-file: package.json\n"), "package.json": '{"version":"1.2.3"}' }, /no volta\.node or engines\.node/],
  ["dockerfile", "go", { Dockerfile: "FROM golang:latest\n" }, /no go version found/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: ${{ matrix.go }}")) }, /go-version "\$\{\{ matrix\.go \}\}" is not a literal version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: [1.25, 1.26]")) }, /go-version "\[1\.25, 1\.26\]" is not a literal version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: { go-version: '${{ matrix.go }}', cache: true }\n") }, /is not a literal version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-go@v5\n        with: *common\n") }, /alias \*common at line 7 has no anchor/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: 1.26.1") + "      - uses: actions/setup-go@v5\n        with: { go-version: '${{ env.GO }}' }\n") }, /is not a literal version/], // one readable step does not excuse another
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[build-system]\nrequires = ["setuptools>=61.0"]\n' }, /no project\.requires-python/],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"), "pyproject.toml": '[project]\nrequires-python = "<3.13"\n' }, /requires-python "<3\.13" has no lower bound/],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: Pipfile\n"), Pipfile: '[packages]\ndjango = "==4.2.7"\n' }, /no requires\.python_version/], // never reads a package pin as the python version
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version-file: nope.mod")) }, /go-version-file nope\.mod not found/],
  ["setup-go:.github/workflows/*.yml", "go", {}, /no file matches/],
  ["golangci-action", "golangci-lint", { ".github/workflows/ci.yml": WF("      - uses: golangci/golangci-lint-action@v6\n        with:\n          version: latest\n") }, /no golangci-lint version found/],
  ["goreleaser-action", "goreleaser", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: 1.25")) }, /no goreleaser version found/],
  // A present but unreadable version input fails even beside a pinned step; only a literal `latest` is ignored.
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.22'") + SETUP_GO("go-version: stable")) }, /go-version "stable" is not a version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '1.22'") + SETUP_GO("go-version: oldstable")) }, /go-version "oldstable" is not a version/],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version: lts/*")) }, /node-version "lts\/\*" is not a version/],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version: node")) }, /node-version "node" is not a version/],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20") + SETUP_NODE("node-version: current")) }, /node-version "current" is not a version/],
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
  // A range wider than its stated components installs some newer version, so it is no pin (setup-go reads >=1.20 as the newest Go).
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '>=1.20'")) }, /go-version ">=1\.20" is a range, not a pinned version/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '^1.20'")) }, /go-version "\^1\.20" is a range/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '>1.20'")) }, /go-version ">1\.20" is a range/],
  ["setup-go", "go", { ".github/workflows/ci.yml": WF(SETUP_GO("go-version: '~1.20.3'")) }, /go-version "~1\.20\.3" is a range/],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 20 || 22")) }, /node-version "20 \|\| 22" is a range/],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: 18 - 20")) }, /node-version "18 - 20" is a range/],
  ["setup-python", "python", { ".github/workflows/ci.yml": WF("      - uses: actions/setup-python@v5\n        with:\n          python-version: '>=3.10'\n") }, /python-version ">=3\.10" is a range/],
  ["goreleaser-action", "goreleaser", { ".github/workflows/ci.yml": WF("      - uses: goreleaser/goreleaser-action@v6\n        with:\n          version: '^2.5'\n") }, /version "\^2\.5" is a range/],
  ["setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version-file: .nvmrc")), ".nvmrc": ">=20\n" }, /">=20" is a range/],
  ["nvmrc", "node", { ".nvmrc": "^20.11\n" }, /"\^20\.11" is a range/],
  ["setup-go", "go", { ".github/workflows/ci.yml": "x: &w { go-version: '1.1' }\njobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          <<: *w\n          cache: true\n" }, /merge key/],
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
    ["exact ignores a range floor next to a higher exact pin", "exact", [v("engines", "20.11.0", true), v("nvmrc", "22.1.0")], null],
    ["minor ignores a range floor next to a higher exact pin", "minor", [v("engines", "20.11.0", true), v("nvmrc", "22.1.0")], null],
    ["exact flags an exact pin below a range floor", "exact", [v("engines", "20.0.0", true), v("nvmrc", "18.2.0")], "nvmrc=18.2.0 below the floor 20.0.0"],
    ["major flags an exact pin below a range floor", "major", [v("engines", "20.0.0", true), v("nvmrc", "18.2.0")], "nvmrc=18.2.0 below the floor 20.0.0"],
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

  it("keeps a prerelease distinct from its release", () => {
    expect([cmp("22.0.0-rc.1", "22.0.0"), cmp("22.0.0", "22.0.0-rc.1"), cmp("22.0.0-rc.1", "22.0.0-rc.1"), cmp("22.0.0-rc.2", "22.0.0-rc.10"), cmp("1.26rc1", "1.26.0")]).toEqual([-1, 1, 0, -1, -1]);
    expect([cmp("22.0.0-rc.1", "22.0.5", 2), cmp("22", "22.0.0-rc.1"), cmp("1.26rc1", "1.26.3", 2)]).toEqual([0, 1, -1]); // a prerelease counts once the compare reaches its last component
    expect(disagreement([v("nvmrc", "22.0.0-rc.1"), v("tv", "22.0.0")], "exact")).toBe("nvmrc=22.0.0-rc.1, tv=22.0.0 disagree (exact)");
    expect(disagreement([v("nvmrc", "22.0.0-rc.1"), v("tv", "22.0.3")], "minor")).toBeNull();
    expect(disagreement([v("engines", "22", true), v("nvmrc", "22.0.0-rc.1")], "floor")).toBe("nvmrc=22.0.0-rc.1 below the floor 22");
    expect([localOk("22.0.0-rc.1", "22.0.0", "exact"), localOk("22.0.0-rc.1", "22.0.0-rc.1", "exact"), localOk("22.0.0-rc.1", "22", "floor")]).toEqual([false, true, false]);
    expect([belowFloor("20.0.0-rc.1", [v("e", "20", true)]), belowFloor("20.0.1-rc.1", [v("e", "20", true)])]).toEqual(["20", null]);
    expect(pinOf([v("a", "22"), v("b", "22.0.0-rc.1")], "exact")).toBe("22.0.0-rc.1");
  });

  it("a Dockerfile image variant is no prerelease, but a hyphenated rc image is", () => {
    const root = tmp();
    put(root, "Dockerfile", "ARG PYTHON_VERSION=3.12.4-slim-bookworm\nFROM node:22.0.0-rc.1-alpine\n");
    expect(disagreement([v("python-version:.python-version", "3.12.4"), ...readSource(root, ["Dockerfile"], "python", "dockerfile")], "exact")).toBeNull();
    expect(disagreement([v("nvmrc:.nvmrc", "22.0.0"), ...readSource(root, ["Dockerfile"], "node", "dockerfile")], "exact")).toBe("nvmrc:.nvmrc=22.0.0, dockerfile:Dockerfile=22.0.0-rc.1 disagree (exact)");
  });

  it("does not read patchlevels, build ids or vendor suffixes in probe output as prereleases", () => {
    expect([ver("ruby 3.1.4p223 (2023-03-30 revision 957bb7cb81)"), ver("hugo v0.139.0-abc123def+extended darwin/arm64"), ver("Docker Compose version v2.29.7-desktop.1"), ver("OpenSSL 1.1.1w  11 Sep 2023"), ver("docker-compose version 1.29.2-1")]).toEqual(["3.1.4", "0.139.0", "2.29.7", "1.1.1", "1.29.2"]);
    expect(localOk(ver("ruby 3.1.4p223")!, "3.1.4", "exact")).toBe(true);
    // real prereleases keep their identity
    expect([ver("v22.0.0-rc.1"), ver("Python 3.13.0rc1"), ver("go version go1.26rc1 linux/amd64"), ver("3.13-dev"), ver("20.0.0-beta-30"), ver("v23.0.0-nightly20240101abc"), ver("3.14.0a2"), ver("3.14.0.dev0")]).toEqual(["22.0.0-rc.1", "3.13.0rc1", "1.26rc1", "3.13-dev", "20.0.0-beta-30", "23.0.0-nightly20240101abc", "3.14.0a2", "3.14.0.dev0"]);
  });

  it("a requires-python prerelease floor accepts a later prerelease of the same release", () => {
    const root = tmp();
    put(root, ".github/workflows/ci.yml", WF("      - uses: actions/setup-python@v5\n        with:\n          python-version-file: pyproject.toml\n"));
    put(root, "pyproject.toml", '[project]\nrequires-python = ">=3.13.0rc1"\n');
    const vals = readSource(root, [".github/workflows/ci.yml"], "python", "setup-python");
    expect([localOk("3.13.0rc2", pinOf(vals, "floor"), "floor"), belowFloor("3.13.0rc2", vals), belowFloor("3.13.0b4", vals)]).toEqual([true, null, "3.13.0rc1"]);
    expect(disagreement([...vals, v("python-version:.python-version", "3.13.0rc2")], "floor")).toBeNull();
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
    expect(pinOf([v("e", "18", true), v("f", "20", true), v("n", "22")], "floor")).toBe("20");
    expect(pinOf([v("n", "20"), v("e", "20.11.0", true)], "exact")).toBe("20"); // a floor is never promoted to the exact pin
    expect([belowFloor("20.5.0", [v("n", "20"), v("e", "20.11.0", true)]), belowFloor("20.12.0", [v("n", "20"), v("e", "20.11.0", true)])]).toEqual(["20.11.0", null]); // ...but still binds the local toolchain
    expect(pinOf([v("e1", "20", true), v("e2", "20.11.0", true)], "floor")).toBe("20.11.0");
    expect(pinOf([v("e1", "20.11.0", true), v("e2", "20", true)], "floor")).toBe("20.11.0");
    expect(belowFloor("20.5.0", [v("e1", "20", true), v("e2", "20.11.0", true)])).toBe("20.11.0");
    expect([localOk("1.26.9", "1.26.1", "minor"), localOk("1.26.9", "1.26.1", "exact"), localOk("22.0.0", "20", "floor"), localOk("18.0.0", "20", "floor")]).toEqual([true, false, true, false]);
  });
});

const read = (spec: string, tool: string, files: Record<string, string>): string[] => {
  const root = tmp();
  for (const [f, c] of Object.entries(files)) put(root, f, c);
  return readSource(root, Object.keys(files), tool, spec).map((x) => x.v);
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
    ["dotted keys", 'project.name = "a"\nproject.requires-python = ">=3.10"\n', ["3.10"]],
    ["an inline table", 'project = { name = "a", requires-python = ">=3.10" }\n', ["3.10"]],
    ["a [ line inside a multi-line array", '[project]\nclassifiers = [\n  ["a", "b"],\n]\nrequires-python = ">=3.10"\n', ["3.10"]],
    ["a header inside a multi-line string", '[tool.x]\ndoc = """\n[project]\nrequires-python = ">=2.7"\n"""\n[project]\nrequires-python = ">=3.12"\n', ["3.12"]],
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
    ["caret", '[tool.poetry]\nname = "x"\nversion = "0.1.0"\n\n[tool.poetry.dependencies]\npython = "^3.11"\n', ["3.11"]],
    ["tilde", '[tool.poetry.dependencies]\npython = "~3.10"\n', ["3.10"]],
    ["a comma range", '[tool.poetry.dependencies]\npython = ">=3.9,<4.0"\n', ["3.9"]],
    ["a space-separated range", '[tool.poetry.dependencies]\npython = ">=3.9 <4.0"\n', ["3.9"]],
    ["a wildcard", '[tool.poetry.dependencies]\npython = "3.11.*"\n', ["3.11"]],
    ["a bare version", '[tool.poetry.dependencies]\npython = "3.11"\n', ["3.11"]],
    ["|| alternatives (the lowest)", '[tool.poetry.dependencies]\npython = ">=3.11 || ^3.9"\n', ["3.9"]],
  ])("reads a Poetry %s as a floor", (_n, toml, want) => {
    expect(read("setup-python", "python", PYPROJECT(toml))).toEqual(want);
  });

  it.each([
    ["[project] present: Poetry is not read", '[project]\nname = "x"\n[tool.poetry.dependencies]\npython = "^3.11"\n', /no project\.requires-python$/],
    ["neither key", '[tool.poetry]\nname = "x"\n', /no project\.requires-python or tool\.poetry\.dependencies\.python/],
    ["no lower bound", '[tool.poetry.dependencies]\npython = "*"\n', /tool\.poetry\.dependencies\.python "\*" has no lower bound/],
    ["an alternative with no lower bound", '[tool.poetry.dependencies]\npython = "<3.9 || >=3.11"\n', /has no lower bound/],
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
    ["any file whose first line is a version", SETUP_NODE("node-version-file: .github/node-version"), { ".github/node-version": "20.11.0\n" }, ["20.11.0"]],
    ["a file named like .node-version-ci", SETUP_NODE("node-version-file: .node-version-ci"), { ".node-version-ci": "20\n" }, ["20"]],
  ])("a -file input reads %s, as setup-node does", (_n, step, files, want) => {
    expect(read("setup-node", "node", { ".github/workflows/ci.yml": WF(step), ...files })).toEqual(want);
  });

  it.each([
    ["a range", { ".node-version-ci": ">=20\n" }, ".node-version-ci", /">=20" is a range/],
    ["a structured file", { "versions.json": '{"node": "20"}\n' }, "versions.json", /no version in "\{"node": "20"\}"/],
  ])("an unknown -file holding %s fails", (_n, files, f, re) => fails("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE(`node-version-file: ${f}`)), ...files }, re));

  it.each([
    ["python_version", '[[source]]\nurl = "https://pypi.org/simple"\n[packages]\ndjango = "==4.2.7"\n[requires]\npython_version = "3.12"\n', ["3.12"]],
    ["python_full_version over python_version", '[requires]\npython_version = "3.12"\npython_full_version = "3.12.4"\n', ["3.12.4"]],
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
    ["node", "FROM cgr.dev/chainguard/node:20-dev AS build\nFROM cgr.dev/chainguard/node:20\nARG NODE_VERSION=20.11-dev\n", ["20", "20", "20.11"]],
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

describe("prerelease lower bounds", () => {
  it("an inclusive engines prerelease floor accepts a later prerelease of the same release", () => {
    const root = tmp();
    put(root, "package.json", '{"engines":{"node":">=20.0.0-rc.1"}}');
    const vals = readSource(root, ["package.json"], "node", "engines");
    expect([belowFloor("20.0.0-rc.2", vals), belowFloor("20.0.0-beta.1", vals), belowFloor("20.0.0-rc.1", vals)]).toEqual([null, "20.0.0-rc.1", null]);
    expect(disagreement([...vals, v("nvmrc", "20.0.0-rc.2")], "floor")).toBeNull();
    put(root, "package.json", '{"engines":{"node":">=20.0.0-0"}}');
    expect(belowFloor("20.0.0-rc.1", readSource(root, ["package.json"], "node", "engines"))).toBeNull();
  });

  it.each([
    ["engines", { "package.json": '{"engines":{"node":">20.0.0-rc.1"}}' }, "node", ["20.0.0-rc.1", "20.0.0-rc.2", "20.0.0"]],
    ["setup-python", PYPROJECT('[project]\nrequires-python = ">3.13.0rc1"\n'), "python", ["3.13.0rc1", "3.13.0rc2", "3.13.0"]],
  ])("an exclusive %s prerelease bound rejects the bound and admits the next prerelease", (spec, files, tool, [at, next, rel]) => {
    const root = tmp();
    for (const [f, c] of Object.entries(files)) put(root, f, c);
    const vals = readSource(root, Object.keys(files), tool, spec);
    expect([belowFloor(at!, vals) !== null, belowFloor(next!, vals), belowFloor(rel!, vals)]).toEqual([true, null, null]);
  });
});

describe("implementations and keywords are not versions", () => {
  it.each(["pypy3.9", "pypy-3.10", "graalpy-24.0"])("setup-python %s is not a version", (pv) =>
    fails("setup-python", "python", { ".github/workflows/ci.yml": WF(SETUP_PY(`python-version: '${pv}'`)) }, new RegExp(`python-version "${pv.replace(/\./g, "\\.")}" is not a version`)),
  );
  it("setup-node lts/-1 is not a version", () => fails("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: lts/-1")) }, /node-version "lts\/-1" is not a version/));
  it.each([
    ["nvmrc", "node", { ".nvmrc": "lts/-1\n" }, /no version in "lts\/-1"/],
    ["python-version", "python", { ".python-version": "pypy3.9-7.3.11\n" }, /no version in "pypy3\.9-7\.3\.11"/],
    ["tool-versions", "python", { ".tool-versions": "python pypy3.9-7.3.11\n" }, /no python version found/],
  ])("%s does not read a version out of an implementation or keyword", (spec, tool, files, re) => fails(spec, tool, files, re));
  it("a Dockerfile tag that starts with a keyword is not read", () => {
    expect(read("dockerfile", "node", { Dockerfile: "FROM node:lts-alpine3.20 AS build\nFROM node:20\n" })).toEqual(["20"]);
  });
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
  it("a direct latest still ignores the file", () =>
    fails("setup-node", "node", { ".github/workflows/ci.yml": WF(SETUP_NODE("node-version: latest\n          node-version-file: .nvmrc")), ".nvmrc": "18\n" }, /no node version found/));
});
