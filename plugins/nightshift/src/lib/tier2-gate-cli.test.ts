// CLI-shell tests for bin/tier2-gate: the argv contract only — required flag,
// mode dispatch, exit codes, and the one-line stderr summaries the workflow
// logs. Pattern mirrors src/lib/run-meta-cli.test.ts (spawns the built artifact).
//
// bin/tier2-gate.ts is a pure argv shell over lib/tier2-gate-run (E4); its ONE
// decision is gate-vs-assemble. Every invariant (the predicate, id safety, the
// pending⊇survivors multiset gate) is covered in tier2-gate-run.test.ts against
// the lib directly.
//
// NOTE: these spawn bin/tier2-gate.mjs, which the build step produces from
// src/bin/tier2-gate.ts. They only pass after `npm run build` has run.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson } from "./io.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve to <plugin-root>/bin/tier2-gate.mjs
const BIN = join(__dirname, "..", "..", "bin", "tier2-gate.mjs");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-t2cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cand(surface: string, symptom: string, severity = "medium", confidence = "high") {
  return {
    dedupe_key: { surface, symptom, root_cause: "rc" },
    severity,
    confidence,
    needs_human_verification: false,
  };
}

function writeSurvivors(value: unknown, name = "candidates.json"): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}

function writeSurfaceFile(sid: string, name: string, value: unknown): void {
  const d = join(dir, "surfaces", sid);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, name), JSON.stringify(value, null, 2) + "\n");
}

function runCli(argv: string[]): { code: number | null; stderr: string } {
  const result = spawnSync("node", [BIN, ...argv], { encoding: "utf8" });
  return { code: result.status, stderr: result.stderr ?? "" };
}

describe("bin/tier2-gate argv contract", () => {
  it("exits 2 and names --run-dir when it is missing", () => {
    const { code, stderr } = runCli([]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/run-dir/);
  });

  it("exits 2 via the catch path when candidates.json does not exist", () => {
    const { code, stderr } = runCli(["--run-dir", dir]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/survivors file not found/);
  });

  it("exits 2 when --assemble has no survivors source to recompute from", () => {
    // assemble recomputes the gate split from candidates.json before it reads
    // tier2.json, so with nothing on disk it fails at the recompute step.
    const { code, stderr } = runCli(["--run-dir", dir, "--assemble"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/survivors file not found/);
  });

  it("exits 2 when --assemble runs before the gate wrote tier2.json", () => {
    writeSurvivors([cand("a", "crit", "critical")]);
    const { code, stderr } = runCli(["--run-dir", dir, "--assemble"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/tier2\.json not found/);
  });
});

describe("bin/tier2-gate gate mode", () => {
  it("exits 0 and reports gated/surfaces/pass on stderr", () => {
    writeSurvivors([
      cand("a", "crit", "critical"),
      cand("b", "shaky", "medium", "low"),
      cand("a", "meh"),
    ]);
    const { code, stderr } = runCli(["--run-dir", dir]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/tier2-gate: gated=2 surfaces=\[a,b\] pass=1/);
    expect(readJson(join(dir, "tier2.json"))).toEqual(["a", "b"]);
  });

  it("reads an alternate survivors file via --survivors", () => {
    writeSurvivors([cand("a", "crit", "critical")], "candidates.json");
    const alt = writeSurvivors([], "merged.json");
    const { code, stderr } = runCli(["--run-dir", dir, "--survivors", alt]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/gated=0 surfaces=\[\] pass=0/);
  });
});

describe("bin/tier2-gate assemble mode", () => {
  it("exits 0 and reports the assembled counts on stderr", () => {
    const gatedA = cand("a", "a1", "critical");
    const gatedA2 = cand("a", "a2", "high");
    const passOne = cand("a", "pass");
    writeSurvivors([gatedA, gatedA2, passOne]);
    expect(runCli(["--run-dir", dir]).code).toBe(0);

    // Tier-2 refuter keeps only a1.
    writeSurfaceFile("a", "tier2.survivors.json", [gatedA]);

    const { code, stderr } = runCli(["--run-dir", dir, "--assemble"]);
    expect(code).toBe(0);
    expect(stderr).toMatch(
      /tier2-gate: assembled=2 \(pass=1 tier2_survivors=1\) rejected_tier2=1/,
    );
    expect(readJson(join(dir, "candidates.tier2.json"))).toEqual([passOne, gatedA]);
  });

  it("selects assemble mode from a bare --assemble followed by another flag", () => {
    // parseArgs yields "true" for a flag whose next token starts with '--';
    // mode selection is presence-based, so ordering must not matter.
    writeSurvivors([]);
    expect(runCli(["--run-dir", dir]).code).toBe(0);
    const { code, stderr } = runCli(["--assemble", "--run-dir", dir]);
    expect(code).toBe(0);
    expect(stderr).toMatch(/assembled=0 \(pass=0 tier2_survivors=0\) rejected_tier2=0/);
  });

  it("exits 2 naming the sid when a gated surface has no tier2.survivors.json", () => {
    writeSurvivors([cand("a", "crit", "critical")]);
    expect(runCli(["--run-dir", dir]).code).toBe(0);
    const { code, stderr } = runCli(["--run-dir", dir, "--assemble"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/tier2\.survivors\.json missing for gated surface a/);
  });
});
