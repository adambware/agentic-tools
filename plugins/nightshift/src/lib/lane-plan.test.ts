// Full-branch tests for buildLanePlan: one case per refusal reason, plus both
// happy paths. buildLanePlan is READ-ONLY and total — every operator-fixable
// problem returns {ok:false, reason} instead of throwing, and no refusal may
// write anything into the pack. Pattern mirrors select-run.test.ts (tmpdir +
// literal YAML fixtures written by the test, not depend on examples/*).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLanePlan } from "./lane-plan.js";
import { isSafeId } from "./validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// <plugin-root>/examples/novudesk/.nightshift and <plugin-root>/templates/.nightshift
const PLUGIN_ROOT = join(__dirname, "..", "..");
const NOVUDESK_PACK = join(PLUGIN_ROOT, "examples", "novudesk", ".nightshift");
const TEMPLATE_PACK = join(PLUGIN_ROOT, "templates", ".nightshift");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-laneplan-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture builders — minimal literal YAML, written fresh per test.
// ---------------------------------------------------------------------------

const MANIFEST_NO_BROWSER = `pack_format: 1\nproject: probe\n`;

function manifestWithBrowser(opts: { tool?: string; base_url?: string } = {}): string {
  const tool = opts.tool === undefined ? "playwright-mcp" : opts.tool;
  const baseUrl = opts.base_url === undefined ? "https://staging.probe.example" : opts.base_url;
  const toolLine = tool === "" ? "" : `    tool: ${tool}\n`;
  const urlLine = baseUrl === "" ? "" : `    base_url: "${baseUrl}"\n`;
  return `pack_format: 1\nproject: probe\nstack_adapter:\n  browser:\n${toolLine}${urlLine}`;
}

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

/** Minimal security-ready pack: manifest, one vector. */
function seedSecurityPack(root: string): void {
  mkdirSync(join(root, "registries"), { recursive: true });
  writeFileSync(join(root, "manifest.yml"), MANIFEST_NO_BROWSER);
  writeFileSync(join(root, "registries", "vectors.yml"), vectorsYaml(["V1"]));
}

/**
 * Snapshot of every entry's relative path under root, recursively — files
 * record size + mtime, directories are recorded too (as `{ dir: true }`) so a
 * refusal that mkdir's an empty directory (and writes nothing into it) still
 * changes the snapshot. A files-only snapshot would be blind to exactly the
 * "stamps nothing / leaves no .run dir" failure mode the read-only guarantee
 * below exists to catch.
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

// ---------------------------------------------------------------------------
// Structural refusals (both lanes)
// ---------------------------------------------------------------------------

describe("buildLanePlan structural refusals", () => {
  it("refuses an unknown lane", () => {
    const res = buildLanePlan({ packDir: dir, lane: "bogus" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unknown lane/);
  });

  it("refuses a missing pack directory", () => {
    const res = buildLanePlan({ packDir: join(dir, "nope"), lane: "security" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/pack directory not found/);
  });

  it("refuses a packDir that is not a directory", () => {
    const filePath = join(dir, "not-a-dir");
    writeFileSync(filePath, "x");
    const res = buildLanePlan({ packDir: filePath, lane: "security" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not a directory/);
  });

  it("refuses a missing manifest.yml", () => {
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/manifest not found/);
  });

  it("refuses an unparseable manifest.yml", () => {
    writeFileSync(join(dir, "manifest.yml"), "not: valid: yaml: [::\n");
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not valid YAML/);
  });

  it("refuses a manifest that is not a YAML mapping", () => {
    writeFileSync(join(dir, "manifest.yml"), "- just\n- a\n- list\n");
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not a YAML mapping/);
  });

  it("refuses a missing registry file for the lane", () => {
    writeFileSync(join(dir, "manifest.yml"), MANIFEST_NO_BROWSER);
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/registry not found/);
  });

  it("refuses a registry with zero entries for the lane", () => {
    mkdirSync(join(dir, "registries"), { recursive: true });
    writeFileSync(join(dir, "manifest.yml"), MANIFEST_NO_BROWSER);
    writeFileSync(join(dir, "registries", "vectors.yml"), "vectors: []\n");
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no entries for lane "security"/);
  });

  it("refuses the templates pack's empty flows: [] for the design lane", () => {
    const res = buildLanePlan({ packDir: TEMPLATE_PACK, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no entries for lane "design"/);
  });
});

// ---------------------------------------------------------------------------
// Design-lane-specific refusals
// ---------------------------------------------------------------------------

describe("buildLanePlan design-lane refusals", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "registries"), { recursive: true });
    writeFileSync(
      join(dir, "registries", "flows.yml"),
      flowsYaml([{ id: "FLOW-01", persona: "end-user" }]),
    );
  });

  it("refuses when stack_adapter.browser is absent", () => {
    writeFileSync(join(dir, "manifest.yml"), MANIFEST_NO_BROWSER);
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/stack_adapter\.browser is missing/);
  });

  it("refuses when browser.tool is absent", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ tool: "" }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/browser\.tool is missing or blank/);
  });

  it("refuses when browser.tool is blank", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ tool: '"   "' }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/browser\.tool is missing or blank/);
  });

  it("refuses an unsupported browser.tool, listing supported adapters, without falling back to ux-reviewer", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ tool: "puppeteer-mcp" }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    // The load-bearing assertion: this must be a refusal, never an ok:true plan
    // carrying the tool-less base agent "ux-reviewer" as a silent fallback.
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/has no ux-reviewer agent/);
    expect(res.reason).toMatch(/supported adapters/);
    expect(res.reason).toMatch(/playwright-mcp/);
    expect(res.reason).toMatch(/puppeteer-mcp/);
  });

  it("refuses when browser.base_url is absent", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ base_url: "" }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/browser\.base_url is missing or blank/);
  });

  it("refuses when browser.base_url is blank", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ base_url: "   " }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/browser\.base_url is missing or blank/);
  });

  it("refuses when personas.yml is missing but personas.example.yml exists, naming the template", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser());
    mkdirSync(join(dir, "fixtures"), { recursive: true });
    writeFileSync(join(dir, "fixtures", "personas.example.yml"), personasYaml(["end-user"]));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/seeded personas not found/);
      expect(res.reason).toMatch(/personas\.example\.yml/);
    }
  });

  it("refuses when personas.yml is missing with no template either", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser());
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/seeded personas not found/);
      expect(res.reason).not.toMatch(/found the template/);
    }
  });

  it("refuses when personas.yml has an absent personas list", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser());
    mkdirSync(join(dir, "fixtures"), { recursive: true });
    writeFileSync(join(dir, "fixtures", "personas.yml"), "not_personas: []\n");
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no `personas:` list/);
  });

  it("refuses when personas.yml has an empty personas list", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser());
    mkdirSync(join(dir, "fixtures"), { recursive: true });
    writeFileSync(join(dir, "fixtures", "personas.yml"), "personas: []\n");
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/empty `personas:` list/);
  });

  it("refuses when a persona entry has no string id", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser());
    mkdirSync(join(dir, "fixtures"), { recursive: true });
    writeFileSync(
      join(dir, "fixtures", "personas.yml"),
      "personas:\n  - account_type: customer\n",
    );
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/have no string `id`/);
  });

  it("refuses when a flow's persona ref does not resolve, naming the flow id", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser());
    mkdirSync(join(dir, "fixtures"), { recursive: true });
    writeFileSync(join(dir, "fixtures", "personas.yml"), personasYaml(["end-user"]));
    // Overwrite the flows fixture written in beforeEach with an unresolved persona ref.
    writeFileSync(
      join(dir, "registries", "flows.yml"),
      flowsYaml([{ id: "FLOW-99", persona: "ghost-user" }]),
    );
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/references personas that are not seeded/);
      expect(res.reason).toMatch(/FLOW-99/);
    }
  });
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("buildLanePlan happy paths", () => {
  it("returns the security plan: vectors registry, security agent triple, no browser/personas", () => {
    seedSecurityPack(dir);
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.registry).toBe(join(dir, "registries", "vectors.yml"));
    expect(res.plan.agents).toEqual({
      reviewer: "security-reviewer",
      refuter_tier1: "security-refuter",
      refuter_tier2: "security-refuter-2",
    });
    expect(res.plan.browser).toBeUndefined();
    expect(res.plan.personas).toBeUndefined();
  });

  it("returns the design plan for playwright-mcp: flows registry, ux-reviewer-playwright, browser + personas", () => {
    seedDesignPack(dir);
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.registry).toBe(join(dir, "registries", "flows.yml"));
    expect(res.plan.agents).toEqual({
      reviewer: "ux-reviewer-playwright",
      refuter_tier1: "ux-refuter",
      refuter_tier2: "ux-refuter-2",
    });
    expect(res.plan.browser).toEqual({
      tool: "playwright-mcp",
      base_url: "https://staging.probe.example",
    });
    expect(res.plan.personas).toBe(join(dir, "fixtures", "personas.yml"));
  });

  it("succeeds against the fully-seeded examples/novudesk pack for the design lane", () => {
    const res = buildLanePlan({ packDir: NOVUDESK_PACK, lane: "design" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.lane).toBe("design");
    expect(res.plan.agents.reviewer).toBe("ux-reviewer-playwright");
    expect(res.plan.browser?.tool).toBe("playwright-mcp");
    expect(res.plan.personas).toBe(join(NOVUDESK_PACK, "fixtures", "personas.yml"));
  });
});

// ---------------------------------------------------------------------------
// Read-only guarantee + id/path safety
// ---------------------------------------------------------------------------

describe("buildLanePlan read-only guarantee", () => {
  it("leaves the pack byte-identical (no writes, no new dirs/files) on refusal", () => {
    // A pack that fails deep into the design-lane checks (personas list is
    // present but empty) exercises the most write-tempting path there is.
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser());
    mkdirSync(join(dir, "registries"), { recursive: true });
    writeFileSync(join(dir, "registries", "flows.yml"), flowsYaml([{ id: "FLOW-01" }]));
    mkdirSync(join(dir, "fixtures"), { recursive: true });
    writeFileSync(join(dir, "fixtures", "personas.yml"), "personas: []\n");

    const before = snapshotTree(dir);
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    const after = snapshotTree(dir);

    expect(res.ok).toBe(false);
    expect(after).toEqual(before);
  });

  it("leaves the pack byte-identical on the security happy path too (read-only, not just refusals)", () => {
    seedSecurityPack(dir);
    const before = snapshotTree(dir);
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    const after = snapshotTree(dir);
    expect(res.ok).toBe(true);
    expect(after).toEqual(before);
  });
});

describe("buildLanePlan emitted-id safety", () => {
  it("emits agentType strings and a registry path that pass isSafeId / stay inside packDir", () => {
    seedDesignPack(dir);
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const agentType of Object.values(res.plan.agents)) {
      expect(isSafeId(agentType)).toBe(true);
    }
    // The registry path is inside packDir and its basename is a safe id.
    expect(res.plan.registry.startsWith(dir)).toBe(true);
    const base = res.plan.registry.slice(res.plan.registry.lastIndexOf("/") + 1);
    expect(isSafeId(base)).toBe(true);
  });
});
