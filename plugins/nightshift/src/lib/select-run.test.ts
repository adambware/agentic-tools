import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSelect } from "./select-run.js";
import { readJson } from "./io.js";
import type { GitRunner } from "./git.js";
import type { Surface } from "./types.js";

let dir: string;
const noGit: GitRunner = { changedFilesSince: () => [] };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-select-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

const MANIFEST = "window_budget_k:\n  security: 2\n  design: 1\n";
const VECTORS = `vectors:
  - id: A
    title: A
    kind: vector
    area: ["app/a/*"]
    weight: critical
    interval_days: 7
    owner: security
    last_reviewed: 2026-06-20
  - id: B
    title: B
    kind: vector
    area: ["app/b/*"]
    weight: low
    interval_days: 90
    owner: security
  - id: C
    title: C
    kind: vector
    area: ["app/c/*"]
    weight: high
    interval_days: 14
    owner: design
`;

describe("runSelect", () => {
  it("selects top-K for the lane and writes surfaces.json atomically", () => {
    const out = join(dir, "out", "surfaces.json");
    const res = runSelect({
      vectorsPath: write("vectors.yml", VECTORS),
      manifestPath: write("manifest.yml", MANIFEST),
      lane: "security",
      today: "2026-06-21",
      repo: dir,
      outPath: out,
      git: noGit,
    });
    expect(res.k).toBe(2);
    expect(res.selected).toBe(2); // only A and B are security; C is design
    expect(existsSync(out)).toBe(true);
    const surfaces = readJson<Surface[]>(out)!;
    // B never reviewed => maximally stale => sorts above freshly-reviewed A
    expect(surfaces.map((s) => s.id)).toEqual(["B", "A"]);
  });

  it("honors change_flag from the injected git runner", () => {
    const out = join(dir, "surfaces.json");
    const git: GitRunner = { changedFilesSince: () => ["app/a/policy.rb"] };
    runSelect({
      vectorsPath: write("vectors.yml", VECTORS),
      manifestPath: write("manifest.yml", MANIFEST),
      lane: "security",
      today: "2026-06-21",
      repo: dir,
      outPath: out,
      git,
    });
    const surfaces = readJson<Surface[]>(out)!;
    expect(surfaces.find((s) => s.id === "A")!.change_flag).toBe(1);
  });

  it("throws when the registry file is missing", () => {
    expect(() =>
      runSelect({
        vectorsPath: join(dir, "nope.yml"),
        manifestPath: write("manifest.yml", MANIFEST),
        lane: "security",
        today: "2026-06-21",
        repo: dir,
        outPath: join(dir, "o.json"),
        git: noGit,
      }),
    ).toThrow(/registry not found/);
  });

  it("throws when the manifest is missing", () => {
    expect(() =>
      runSelect({
        vectorsPath: write("vectors.yml", VECTORS),
        manifestPath: join(dir, "nope.yml"),
        lane: "security",
        today: "2026-06-21",
        repo: dir,
        outPath: join(dir, "o.json"),
        git: noGit,
      }),
    ).toThrow(/manifest not found/);
  });

  it("throws when window_budget_k is absent or invalid for the lane", () => {
    expect(() =>
      runSelect({
        vectorsPath: write("vectors.yml", VECTORS),
        manifestPath: write("bad.yml", "window_budget_k:\n  design: 1\n"),
        lane: "security",
        today: "2026-06-21",
        repo: dir,
        outPath: join(dir, "o.json"),
        git: noGit,
      }),
    ).toThrow(/window_budget_k\.security/);
  });

  it("writes an empty surfaces.json when no entries match the lane", () => {
    const out = join(dir, "surfaces.json");
    const res = runSelect({
      vectorsPath: write("vectors.yml", "vectors: []\n"),
      manifestPath: write("manifest.yml", MANIFEST),
      lane: "security",
      today: "2026-06-21",
      repo: dir,
      outPath: out,
      git: noGit,
    });
    expect(res.selected).toBe(0);
    expect(readJson<Surface[]>(out)).toEqual([]);
  });
});
