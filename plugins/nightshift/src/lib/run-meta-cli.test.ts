// CLI-shell tests for bin/run-meta: verify that missing required flags each
// cause exit 2 with a stderr message naming the missing flag.
// Pattern mirrors src/lib/validate-cli.test.ts (argv/exit-code paths).
//
// Tests spawn the already-built bin/run-meta.mjs (committed artifact).
// bin/run-meta.ts is a pure argv shell over lib/run-meta-build (E4); the
// only decision logic tested here is the requireArg exit-2 contract.
//
// A4/T2 note: --tier2 is an OPTIONAL passthrough, so its behavior (rejected_tier2
// accounting, the tier-2 identity gate, the "file not found" abort) is covered in
// run-meta-build.test.ts against the lib directly. Only the flag's exit-code
// contract is asserted here — this file runs against the committed .mjs, which
// carries --tier2 only after the next `npm run build`.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve to <plugin-root>/bin/run-meta.mjs
const BIN = join(__dirname, "..", "..", "bin", "run-meta.mjs");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-rmcli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSurfaces(): string {
  const p = join(dir, "surfaces.json");
  writeFileSync(p, JSON.stringify([{ id: "s1", title: "S1", weight: "high", area: [] }]) + "\n");
  return p;
}

function writeProposed(): string {
  const p = join(dir, "candidates.proposed.json");
  writeFileSync(p, JSON.stringify([]) + "\n");
  return p;
}

function writeSurvivors(): string {
  const p = join(dir, "candidates.json");
  writeFileSync(p, JSON.stringify([]) + "\n");
  return p;
}

function writeReviewed(): string {
  const p = join(dir, "reviewed.json");
  writeFileSync(p, JSON.stringify(["s1"]) + "\n");
  return p;
}

/** Full valid args except for the one under test. */
function fullArgs(overrides: Record<string, string | undefined> = {}): string[] {
  const defaults: Record<string, string> = {
    "--surfaces": writeSurfaces(),
    "--proposed": writeProposed(),
    "--survivors": writeSurvivors(),
    "--reviewed": writeReviewed(),
    "--run-id": "ns-2026-06-21-sec-test",
    "--lane": "security",
    "--pack": dir,
    "--out": join(dir, "run.json"),
    "--today": "2026-06-21",
  };
  const merged = { ...defaults, ...overrides };
  const argv: string[] = [];
  for (const [flag, value] of Object.entries(merged)) {
    if (value !== undefined) {
      argv.push(flag, value);
    }
  }
  return argv;
}

function runCli(argv: string[]): { code: number | null; stderr: string } {
  const result = spawnSync("node", [BIN, ...argv], {
    encoding: "utf8",
    env: { ...process.env, NIGHTSHIFT_TODAY: "2026-06-21" },
  });
  return { code: result.status, stderr: result.stderr ?? "" };
}

describe("bin/run-meta argv exit-2 paths", () => {
  it("exits 2 and names --run-id in stderr when --run-id is missing", () => {
    const argv = fullArgs({ "--run-id": undefined });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/run-id/);
  });

  it("exits 2 and names --out in stderr when --out is missing", () => {
    const argv = fullArgs({ "--out": undefined });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/out/);
  });

  it("exits 2 and names --surfaces in stderr when --surfaces is missing", () => {
    const argv = fullArgs({ "--surfaces": undefined });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/surfaces/);
  });

  it("exits 2 and names --reviewed in stderr when --reviewed is missing", () => {
    const argv = fullArgs({ "--reviewed": undefined });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/reviewed/);
  });

  it("exits 0 with all required flags present and valid files", () => {
    const argv = fullArgs();
    const { code } = runCli(argv);
    expect(code).toBe(0);
  });

  it("defaults lane to 'security' and writes run.json when --lane is omitted", () => {
    const outPath = join(dir, "run.json");
    const argv = fullArgs({ "--lane": undefined, "--out": outPath });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(0);
    expect(stderr).toMatch(/lane=security/);
    const meta = JSON.parse(readFileSync(outPath, "utf8")) as { lane: string };
    expect(meta.lane).toBe("security");
  });

  it("exits 0 when the optional --tier2 flag points at a valid candidates file", () => {
    // Both halves of the run's refuter accounting present. Asserts the exit
    // contract only: the shell must accept the optional flag, not reject it as
    // unknown. The rejected_tier2 value itself is asserted in the lib tests.
    const tier2Path = join(dir, "candidates.tier2.json");
    writeFileSync(tier2Path, JSON.stringify([]) + "\n");
    const argv = fullArgs({ "--tier2": tier2Path });
    const { code } = runCli(argv);
    expect(code).toBe(0);
  });

  it("exits 2 via the catch path when --surfaces points at a nonexistent file", () => {
    // The flag is present (requireArg passes), but the file does not exist, so
    // buildRunMeta throws inside the try-body and the shell's catch -> exit 2.
    const argv = fullArgs({ "--surfaces": join(dir, "no-such-surfaces.json") });
    const { code, stderr } = runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toMatch(/surfaces file not found/);
  });
});
