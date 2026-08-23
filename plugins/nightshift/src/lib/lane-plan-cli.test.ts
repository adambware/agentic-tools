// CLI-shell tests for bin/lane-plan: exit codes, the stdout/stderr split, and
// --out. Pattern mirrors src/lib/tier2-gate-cli.test.ts (spawns the built
// artifact from a tmpdir pack).
//
// bin/lane-plan.ts is a pure argv shell over lib/lane-plan (E4); the lane ->
// data tables and every refusal reason are covered against the lib directly
// in lane-plan.test.ts. This file asserts only the CLI contract: exit 0 with
// plan JSON on stdout and nothing else on stdout vs. exit 2 with
// "lane-plan: <reason>" on stderr and NOTHING on stdout, plus --out.
//
// NOTE: these spawn bin/lane-plan.mjs, which the build step produces from
// src/bin/lane-plan.ts. They only pass after `npm run build` has run.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson } from "./io.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve to <plugin-root>/bin/lane-plan.mjs
const BIN = join(__dirname, "..", "..", "bin", "lane-plan.mjs");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-lpcli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function vectorsYaml(ids: string[]): string {
  const entries = ids
    .map(
      (id) =>
        `  - id: ${id}\n    title: T ${id}\n    kind: vector\n    area: ["app/${id}/*"]\n    ` +
        `weight: high\n    interval_days: 7\n    owner: security\n`,
    )
    .join("");
  return `vectors:\n${entries}`;
}

function seedSecurityPack(root: string): void {
  mkdirSync(join(root, "registries"), { recursive: true });
  writeFileSync(join(root, "manifest.yml"), "pack_format: 1\nproject: probe\n");
  writeFileSync(join(root, "registries", "vectors.yml"), vectorsYaml(["V1"]));
}

// ---------------------------------------------------------------------------
// Design-lane fixture builders — mirrors lane-plan.test.ts's helpers (kept
// local here since this file spawns the built CLI and must not depend on
// lane-plan.test.ts's internals).
// ---------------------------------------------------------------------------

// A7/T8: a design-ready manifest now also needs a LOOPBACK base_url and an
// explicit non-production `environment` assertion, or the CLI refuses.
function manifestWithBrowser(): string {
  return (
    "pack_format: 1\nproject: probe\nstack_adapter:\n  browser:\n" +
    '    tool: playwright-mcp\n    base_url: "http://localhost:3000"\n' +
    "    environment: local\n"
  );
}

function flowsYaml(entries: { id: string; persona?: string }[]): string {
  const body = entries
    .map((e) => {
      const personaLine = e.persona !== undefined ? `    persona: ${e.persona}\n` : "";
      return (
        `  - id: ${e.id}\n    title: T ${e.id}\n    kind: flow\n    area: ["/x"]\n    ` +
        `weight: high\n    interval_days: 7\n    owner: design\n${personaLine}`
      );
    })
    .join("");
  return `flows:\n${body}`;
}

function personasYaml(ids: string[]): string {
  const body = ids.map((id) => `  - id: ${id}\n    account_type: customer\n`).join("");
  return `personas:\n${body}`;
}

/** Minimal design-ready pack: manifest w/ browser, one flow, one seeded persona. */
function seedDesignPack(root: string): void {
  mkdirSync(join(root, "registries"), { recursive: true });
  mkdirSync(join(root, "fixtures"), { recursive: true });
  writeFileSync(join(root, "manifest.yml"), manifestWithBrowser());
  writeFileSync(
    join(root, "registries", "flows.yml"),
    flowsYaml([{ id: "FLOW-01", persona: "end-user" }]),
  );
  writeFileSync(join(root, "fixtures", "personas.yml"), personasYaml(["end-user"]));
}

/**
 * Snapshot of every entry's relative path under root, recursively — files
 * record size + mtime, directories are recorded too so a refusal that mkdir's
 * an empty directory would still change the snapshot (see lane-plan.test.ts's
 * snapshotTree for the same reasoning).
 */
function snapshotTree(
  root: string,
): Record<string, { size: number; mtimeMs: number } | { dir: true }> {
  const out: Record<string, { size: number; mtimeMs: number } | { dir: true }> = {};
  function walk(dirPath: string, prefix: string): void {
    for (const name of readdirSync(dirPath).sort()) {
      const full = join(dirPath, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      const st = statSync(full);
      if (st.isDirectory()) {
        out[rel] = { dir: true };
        walk(full, rel);
      } else {
        out[rel] = { size: st.size, mtimeMs: st.mtimeMs };
      }
    }
  }
  walk(root, "");
  return out;
}

function runCli(argv: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [BIN, ...argv], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("bin/lane-plan argv contract", () => {
  it("exits 2 and names --pack when it is missing", () => {
    const { code, stderr } = runCli(["--lane", "security"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/pack/);
  });

  it("exits 2 and names --lane when it is missing", () => {
    const { code, stderr } = runCli(["--pack", dir]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/lane/);
  });
});

describe("bin/lane-plan refusal", () => {
  it("exits 2, writes nothing to stdout, and prefixes the reason with lane-plan: on stderr", () => {
    // dir has no manifest.yml yet — pack directory itself exists but is incomplete.
    const { code, stdout, stderr } = runCli(["--pack", dir, "--lane", "security"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^lane-plan: manifest not found/);
  });

  it("exits 2 for an unknown lane, still with nothing on stdout", () => {
    const { code, stdout, stderr } = runCli(["--pack", dir, "--lane", "bogus"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^lane-plan: unknown lane/);
  });
});

describe("bin/lane-plan success", () => {
  it("exits 0, prints the plan JSON on stdout, and a one-line summary on stderr", () => {
    seedSecurityPack(dir);
    const { code, stdout, stderr } = runCli(["--pack", dir, "--lane", "security"]);
    expect(code).toBe(0);
    const plan = JSON.parse(stdout);
    expect(plan.lane).toBe("security");
    expect(plan.registry).toBe(join(dir, "registries", "vectors.yml"));
    expect(plan.agents.reviewer).toBe("security-reviewer");
    expect(stderr).toMatch(
      /^lane-plan: lane=security registry=.*vectors\.yml reviewer=security-reviewer/,
    );
  });

  it("writes the same plan to --out as atomic JSON, in addition to stdout", () => {
    seedSecurityPack(dir);
    const outPath = join(dir, "out", "plan.json");
    const { code, stdout } = runCli(["--pack", dir, "--lane", "security", "--out", outPath]);
    expect(code).toBe(0);
    const stdoutPlan = JSON.parse(stdout);
    const filePlan = readJson(outPath);
    expect(filePlan).toEqual(stdoutPlan);
  });
});

// ---------------------------------------------------------------------------
// Design-lane CLI coverage (HOLE 1) — the six pre-existing tests above are all
// `--lane security`; the design gate had zero CLI-level coverage, and the
// CLI's headline contract ("a refusing run writes NOTHING and prints NOTHING
// to stdout") was untested end to end.
// ---------------------------------------------------------------------------

describe("bin/lane-plan design-lane refusal", () => {
  it("exits 2 and names stack_adapter.browser when it is missing, with stdout EMPTY", () => {
    mkdirSync(join(dir, "registries"), { recursive: true });
    writeFileSync(join(dir, "manifest.yml"), "pack_format: 1\nproject: probe\n");
    writeFileSync(
      join(dir, "registries", "flows.yml"),
      flowsYaml([{ id: "FLOW-01", persona: "end-user" }]),
    );
    const { code, stdout, stderr } = runCli(["--pack", dir, "--lane", "design"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^lane-plan: /);
    expect(stderr).toMatch(/stack_adapter\.browser is missing/);
  });

  it("exits 2 when fixtures/personas.yml is missing, with stdout EMPTY", () => {
    mkdirSync(join(dir, "registries"), { recursive: true });
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser());
    writeFileSync(
      join(dir, "registries", "flows.yml"),
      flowsYaml([{ id: "FLOW-01", persona: "end-user" }]),
    );
    const { code, stdout, stderr } = runCli(["--pack", dir, "--lane", "design"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^lane-plan: /);
    expect(stderr).toMatch(/seeded personas not found/);
  });

  it("a refusing run with --out outside the pack does NOT create the --out file", () => {
    // Incomplete pack (no manifest.yml at all) -> guaranteed refusal.
    const outsideDir = mkdtempSync(join(tmpdir(), "ns-lpcli-out-"));
    const outPath = join(outsideDir, "plan.json");
    try {
      const { code, stdout } = runCli(["--pack", dir, "--lane", "design", "--out", outPath]);
      expect(code).toBe(2);
      expect(stdout).toBe("");
      // The load-bearing assertion: today's ordering (refuse before writeJson)
      // must never be undone by a future refactor that hoists the --out write
      // above the refusal branch and ships green anyway.
      expect(existsSync(outPath)).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("a refusing run with --out inside the pack leaves the pack tree unchanged", () => {
    // Incomplete pack (no manifest.yml at all) -> guaranteed refusal.
    const before = snapshotTree(dir);
    const outPath = join(dir, "out", "plan.json");
    const { code, stdout } = runCli(["--pack", dir, "--lane", "design", "--out", outPath]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    const after = snapshotTree(dir);
    expect(after).toEqual(before);
  });
});

describe("bin/lane-plan design-lane success", () => {
  it("exits 0 and stdout parses to a plan naming ux-reviewer-playwright", () => {
    seedDesignPack(dir);
    const { code, stdout, stderr } = runCli(["--pack", dir, "--lane", "design"]);
    expect(code).toBe(0);
    const plan = JSON.parse(stdout);
    expect(plan.lane).toBe("design");
    expect(plan.agents.reviewer).toBe("ux-reviewer-playwright");
    expect(stderr).toMatch(/^lane-plan: lane=design/);
  });
});

describe("bin/lane-plan unsupported adapter", () => {
  it("exits 2 with the 'has no ux-reviewer agent — supported adapters' wording for an ordinary unsupported tool", () => {
    seedDesignPack(dir);
    writeFileSync(
      join(dir, "manifest.yml"),
      "pack_format: 1\nproject: probe\nstack_adapter:\n  browser:\n" +
        '    tool: puppeteer-mcp\n    base_url: "http://localhost:3000"\n' +
        "    environment: local\n",
    );
    const { code, stdout, stderr } = runCli(["--pack", dir, "--lane", "design"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/has no ux-reviewer agent — supported adapters/);
  });

  it("exits 2 with the 'has no ux-reviewer agent' wording for a JS prototype key (constructor), NOT the isSafeId backstop message", () => {
    seedDesignPack(dir);
    writeFileSync(
      join(dir, "manifest.yml"),
      "pack_format: 1\nproject: probe\nstack_adapter:\n  browser:\n" +
        '    tool: constructor\n    base_url: "http://localhost:3000"\n' +
        "    environment: local\n",
    );
    const { code, stdout, stderr } = runCli(["--pack", dir, "--lane", "design"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/has no ux-reviewer agent — supported adapters/);
    expect(stderr).not.toMatch(/is not path-segment safe/);
  });
});
