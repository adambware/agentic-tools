// CLI-shell tests for bin/merge-candidates: the requireArg exit-2 contract, the
// --surfaces default, the stderr summary line, and exit 2 on an invariant
// violation. Pattern mirrors src/lib/run-meta-cli.test.ts.
//
// Tests spawn the built bin/merge-candidates.mjs (committed artifact produced by
// `npm run build`). bin/merge-candidates.ts is a pure argv shell over
// lib/merge-candidates-run (E4); all decision logic is covered in
// merge-candidates-run.test.ts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve to <plugin-root>/bin/merge-candidates.mjs
const BIN = join(__dirname, "..", "..", "bin", "merge-candidates.mjs");

let dir: string;
let runDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-mccli-"));
  runDir = join(dir, ".run", "ns-2026-08-23-sec-01");
  mkdirSync(runDir, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cand(surface: string): unknown {
  return {
    dedupe_key: { surface, symptom: "sym", root_cause: "rc" },
    severity: "critical",
    confidence: "high",
    needs_human_verification: true,
  };
}

function writeSurfaces(ids: string[], path = join(runDir, "surfaces.json")): string {
  const surfaces = ids.map((id) => ({
    id,
    title: `Surface ${id}`,
    weight: "high",
    area: ["app/x"],
    staleness: 1,
    change_flag: 0,
    score: 4,
    band: "medium",
  }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(surfaces, null, 2) + "\n");
  return path;
}

function writeSurfaceDir(sid: string, omit: string[] = []): void {
  const d = join(runDir, "surfaces", sid);
  mkdirSync(d, { recursive: true });
  const files: Array<[string, unknown]> = [
    ["reviewed.json", [sid]],
    ["candidates.proposed.json", [cand(sid)]],
    ["candidates.json", [cand(sid)]],
  ];
  for (const [name, value] of files) {
    if (omit.includes(name)) continue;
    writeFileSync(join(d, name), JSON.stringify(value, null, 2) + "\n");
  }
}

function runCli(argv: string[]): { code: number | null; stderr: string } {
  const result = spawnSync("node", [BIN, ...argv], { encoding: "utf8" });
  return { code: result.status, stderr: result.stderr ?? "" };
}

describe("bin/merge-candidates argv exit-2 paths", () => {
  it("exits 2 and names --run-dir in stderr when --run-dir is missing", () => {
    const { code, stderr } = runCli([]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/run-dir/);
  });

  it("exits 2 when --run-dir points at a dir with no surfaces.json", () => {
    const { code, stderr } = runCli(["--run-dir", runDir]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/surfaces file not found/);
  });

  it("exits 2 on a §9.15 binding violation and writes no run-level output", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1");
    mkdirSync(join(runDir, "surfaces", "s2"), { recursive: true });
    writeFileSync(join(runDir, "surfaces", "s2", "reviewed.json"), JSON.stringify(["s2"]));
    // s2's proposed candidate claims s1 — the wrong registry entry.
    writeFileSync(
      join(runDir, "surfaces", "s2", "candidates.proposed.json"),
      JSON.stringify([cand("s1")]),
    );
    writeFileSync(join(runDir, "surfaces", "s2", "candidates.json"), JSON.stringify([]));

    const { code, stderr } = runCli(["--run-dir", runDir]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/does not match its surface dir "s2"/);
    for (const f of ["reviewed.json", "candidates.proposed.json", "candidates.json"]) {
      expect(existsSync(join(runDir, f))).toBe(false);
    }
  });

  it("exits 2 on an unsafe surface id", () => {
    writeSurfaces(["../escape"]);
    const { code, stderr } = runCli(["--run-dir", runDir]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/unsafe surface id/);
  });
});

describe("bin/merge-candidates success paths", () => {
  it("defaults --surfaces to <run-dir>/surfaces.json and exits 0", () => {
    writeSurfaces(["s1", "s2"]);
    writeSurfaceDir("s1");
    writeSurfaceDir("s2");
    const { code, stderr } = runCli(["--run-dir", runDir]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/merged=2 skipped=0 proposed=2 survivors=2/);
    expect(existsSync(join(runDir, "reviewed.json"))).toBe(true);
  });

  it("honors an explicit --surfaces path", () => {
    const alt = join(dir, "elsewhere", "selected.json");
    writeSurfaces(["s1"], alt);
    writeSurfaceDir("s1");
    const { code, stderr } = runCli(["--run-dir", runDir, "--surfaces", alt]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/merged=1/);
  });

  it("lists the skipped surface ids in the stderr summary (§9.16 partial fan-out)", () => {
    writeSurfaces(["s1", "s2", "s3"]);
    writeSurfaceDir("s1");
    writeSurfaceDir("s2", ["candidates.json"]); // refuter crashed
    // s3's dir never created at all
    const { code, stderr } = runCli(["--run-dir", runDir]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/merged=1 skipped=2 \[s2,s3\]/);
    expect(stderr).toMatch(/proposed=1 survivors=1/);
  });

  it("writes three empty arrays when every surface dir is missing", () => {
    writeSurfaces(["s1", "s2"]);
    const { code, stderr } = runCli(["--run-dir", runDir]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/merged=0 skipped=2 \[s1,s2\] proposed=0 survivors=0/);
    for (const f of ["reviewed.json", "candidates.proposed.json", "candidates.json"]) {
      expect(existsSync(join(runDir, f))).toBe(true);
    }
  });
});
