// Full-branch tests for buildLanePlan: one case per refusal reason, plus both
// happy paths. buildLanePlan is READ-ONLY and total — every operator-fixable
// problem returns {ok:false, reason} instead of throwing, and no refusal may
// write anything into the pack. Pattern mirrors select-run.test.ts (tmpdir +
// literal YAML fixtures written by the test, not depend on examples/*).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLanePlan,
  checkDesignPack,
  isLoopbackHost,
  NON_PRODUCTION_ENVIRONMENTS,
} from "./lane-plan.js";
import { readYaml } from "./io.js";
import { isSafeAgentType, isSafeId } from "./validate.js";

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

function manifestWithBrowser(
  opts: { tool?: string; base_url?: string; environment?: string } = {},
): string {
  const tool = opts.tool === undefined ? "playwright-mcp" : opts.tool;
  // A7/T8: the default fixture is what a design-ready pack now looks like — a
  // LOOPBACK base_url plus an explicit non-production assertion. Every pre-T8
  // case below keeps passing through this builder, so a regression that dropped
  // either gate would show up as those cases silently going green on a manifest
  // that names a remote host.
  const baseUrl = opts.base_url === undefined ? "http://localhost:3000" : opts.base_url;
  const environment = opts.environment === undefined ? "local" : opts.environment;
  const toolLine = tool === "" ? "" : `    tool: ${tool}\n`;
  const urlLine = baseUrl === "" ? "" : `    base_url: "${baseUrl}"\n`;
  const envLine = environment === "" ? "" : `    environment: ${environment}\n`;
  return `pack_format: 1\nproject: probe\nstack_adapter:\n  browser:\n${toolLine}${urlLine}${envLine}`;
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

  // ── T8 (A7): environment safety ───────────────────────────────────────────
  // Two INDEPENDENT gates, both mandatory. Each block below holds the other
  // half of the manifest valid, so a passing test proves the named gate fired
  // on its own rather than riding on the other one's refusal.

  it("refuses a non-loopback base_url even though the non-prod assertion is present", () => {
    writeFileSync(
      join(dir, "manifest.yml"),
      manifestWithBrowser({ base_url: "https://staging.probe.example", environment: "local" }),
    );
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/is not a LOOPBACK host/);
    expect(res.reason).toContain("staging.probe.example");
  });

  it("refuses a base_url whose loopback-looking text is only userinfo (browser resolves the real host)", () => {
    // http://localhost@prod.example/ CONTAINS "localhost" but a browser drives
    // prod.example. A substring check would pass this; hostname parsing must not.
    writeFileSync(
      join(dir, "manifest.yml"),
      manifestWithBrowser({ base_url: "http://localhost@prod.probe.example/app" }),
    );
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/is not a LOOPBACK host/);
    expect(res.reason).toContain('resolved host: "prod.probe.example"');
  });

  it("refuses 0.0.0.0 — the unspecified address is not loopback", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ base_url: "http://0.0.0.0:3000" }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/is not a LOOPBACK host/);
  });

  it("refuses a base_url that is not an absolute URL", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ base_url: "localhost:3000/app" }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/is not an absolute URL|only http\/https are drivable/);
  });

  it("refuses a non-http scheme", () => {
    writeFileSync(
      join(dir, "manifest.yml"),
      manifestWithBrowser({ base_url: "file:///Users/probe/app/index.html" }),
    );
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/only http\/https are drivable/);
  });

  it("refuses when environment is absent even though base_url IS loopback", () => {
    writeFileSync(
      join(dir, "manifest.yml"),
      manifestWithBrowser({ base_url: "http://127.0.0.1:3000", environment: "" }),
    );
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/browser\.environment is missing/);
    expect(res.reason).toMatch(/local, dev, test/);
  });

  it('refuses environment: staging BY NAME — the "up but shared" failure mode', () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ environment: "staging" }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain("staging");
    expect(res.reason).toMatch(/not yours to submit forms against/);
  });

  it("refuses environment: production BY NAME", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ environment: "production" }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not yours to submit forms against/);
  });

  it("refuses an unrecognized environment value rather than assuming it is safe", () => {
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ environment: "sandbox" }));
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/is not a recognized non-production environment/);
    expect(res.reason).toMatch(/asserts nothing/);
  });

  it("does NOT refuse the security lane on the same unsafe manifest (T8 is design-only)", () => {
    // The security lane never drives a browser, so an unsafe browser block must
    // not become a reason to refuse it — that would be scope creep with a
    // side effect nobody asked for.
    writeFileSync(
      join(dir, "manifest.yml"),
      manifestWithBrowser({ base_url: "https://prod.probe.example", environment: "production" }),
    );
    mkdirSync(join(dir, "registries"), { recursive: true });
    writeFileSync(join(dir, "registries", "vectors.yml"), vectorsYaml(["V-01"]));
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    expect(res.ok).toBe(true);
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
      reviewer: "nightshift:security-reviewer",
      refuter_tier1: "nightshift:security-refuter",
      refuter_tier2: "nightshift:security-refuter-2",
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
      reviewer: "nightshift:ux-reviewer-playwright",
      refuter_tier1: "nightshift:ux-refuter",
      refuter_tier2: "nightshift:ux-refuter-2",
    });
    expect(res.plan.browser).toEqual({
      tool: "playwright-mcp",
      base_url: "http://localhost:3000",
      environment: "local",
    });
    expect(res.plan.personas).toBe(join(dir, "fixtures", "personas.yml"));
  });

  it("succeeds against the fully-seeded examples/novudesk pack for the design lane", () => {
    const res = buildLanePlan({ packDir: NOVUDESK_PACK, lane: "design" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.lane).toBe("design");
    expect(res.plan.agents.reviewer).toBe("nightshift:ux-reviewer-playwright");
    expect(res.plan.browser?.tool).toBe("playwright-mcp");
    expect(res.plan.personas).toBe(join(NOVUDESK_PACK, "fixtures", "personas.yml"));
  });
});

describe("T8 accepted loopback + environment forms", () => {
  for (const url of [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://127.0.0.2:8080",
    "http://probe.localhost:3000",
    "https://localhost:8443/app",
    "http://[::1]:3000",
  ]) {
    it(`accepts base_url ${url}`, () => {
      seedDesignPack(dir);
      writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ base_url: url }));
      const res = buildLanePlan({ packDir: dir, lane: "design" });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.plan.browser?.base_url).toBe(url);
    });
  }

  for (const env of ["local", "dev", "test", "LOCAL", "  Dev  "]) {
    it(`accepts environment "${env}" and normalizes it to lower case`, () => {
      seedDesignPack(dir);
      writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ environment: `"${env}"` }));
      const res = buildLanePlan({ packDir: dir, lane: "design" });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.plan.browser?.environment).toBe(env.trim().toLowerCase());
    });
  }
});

describe("NON_PRODUCTION_ENVIRONMENTS is the published allow-list", () => {
  it("is exactly the set the refusal reasons and the manifest schema name", () => {
    expect([...NON_PRODUCTION_ENVIRONMENTS]).toEqual(["local", "dev", "test"]);
  });
});

describe("isLoopbackHost", () => {
  for (const host of ["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "127.255.255.254", "::1", "[::1]", "0:0:0:0:0:0:0:1"]) {
    it(`treats "${host}" as loopback`, () => {
      expect(isLoopbackHost(host)).toBe(true);
    });
  }
  for (const host of ["0.0.0.0", "example.com", "localhost.example.com", "128.0.0.1", "127.0.0.256", "::2", "10.0.0.1", ""]) {
    it(`treats "${host}" as NOT loopback`, () => {
      expect(isLoopbackHost(host)).toBe(false);
    });
  }
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

describe("agent types are PLUGIN-QUALIFIED (regression: the first real run dispatched bare names)", () => {
  // The agents ship in the nightshift plugin and `bin/ns` hands every session
  // `--plugin-dir $ENGINE`, so the run's agents come from the same tree as its
  // bins. A plugin agent is addressable by its qualified name; the bare name
  // resolves only if something ELSE in the session also provides one. The first
  // real run dispatched the bare names: every reviewer came back "agent type not
  // found", and the workflow still returned {"status":"complete"}.
  it("the security lane emits nightshift:-qualified agent types", () => {
    seedSecurityPack(dir);
    const res = buildLanePlan({ packDir: dir, lane: "security" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.agents).toEqual({
      reviewer: "nightshift:security-reviewer",
      refuter_tier1: "nightshift:security-refuter",
      refuter_tier2: "nightshift:security-refuter-2",
    });
  });

  it("the design lane qualifies its per-adapter reviewer too", () => {
    seedDesignPack(dir);
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.agents.reviewer).toBe("nightshift:ux-reviewer-playwright");
    expect(res.plan.agents.refuter_tier1).toBe("nightshift:ux-refuter");
    expect(res.plan.agents.refuter_tier2).toBe("nightshift:ux-refuter-2");
  });

  it("every qualified type names an agent file that actually exists on disk", () => {
    // The tables stay BARE precisely so this check is possible: strip the one
    // qualifier and the remainder is the agents/<name>.md filename.
    seedSecurityPack(dir);
    seedDesignPack(dir);
    for (const lane of ["security", "design"] as const) {
      const res = buildLanePlan({ packDir: dir, lane });
      if (!res.ok) continue;
      for (const agentType of Object.values(res.plan.agents)) {
        const [plugin, name] = agentType.split(":");
        expect(plugin).toBe("nightshift");
        expect(
          existsSync(join(PLUGIN_ROOT, "agents", `${name}.md`)),
          `agents/${name}.md is missing but ${agentType} is dispatched to it`,
        ).toBe(true);
      }
    }
  });
});

describe("buildLanePlan emitted-id safety", () => {
  it("emits agentType strings and a registry path that pass isSafeId / stay inside packDir", () => {
    seedDesignPack(dir);
    const res = buildLanePlan({ packDir: dir, lane: "design" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const agentType of Object.values(res.plan.agents)) {
      expect(isSafeAgentType(agentType)).toBe(true);
      // The qualifier is the ONLY thing that may carry a colon: strip it and the
      // remainder is still a path-segment-safe id, because the same charset is
      // what protects the surface dirs downstream.
      expect(isSafeId(agentType.split(":").pop()!)).toBe(true);
    }
    // The registry path is inside packDir and its basename is a safe id.
    expect(res.plan.registry.startsWith(dir)).toBe(true);
    const base = res.plan.registry.slice(res.plan.registry.lastIndexOf("/") + 1);
    expect(isSafeId(base)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkDesignPack — the static gate bin/dashboard shares with the launcher.
//
// The dashboard used to decide design-lane readiness on its own, from two
// existsSync-shaped checks, and so advertised as "ready" packs that `ns` refuses
// every single time (staging base_url, no `environment` assertion, a browser
// tool with no agent file). These tests pin the two properties that make one
// shared predicate safe: it produces the launcher's exact first refusal, in the
// launcher's exact order, and it reaches its verdict without the flows registry.
// ---------------------------------------------------------------------------

describe("checkDesignPack", () => {
  const manifestPath = (): string => join(dir, "manifest.yml");
  const check = () =>
    checkDesignPack({ packDir: dir, manifest: readYaml(manifestPath()), manifestPath: manifestPath() });

  it("resolves a design-ready pack, including the persona ids flows may name", () => {
    seedDesignPack(dir);
    const res = check();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reviewer).toBe("ux-reviewer-playwright");
    expect(res.browser).toEqual({
      tool: "playwright-mcp",
      base_url: "http://localhost:3000",
      environment: "local",
    });
    expect([...res.seeded]).toEqual(["end-user"]);
  });

  // The ordering guard. Each case breaks ONE prerequisite; problems[0].reason
  // must still be the string buildLanePlan refuses with, which is what stops a
  // future edit from quietly reshuffling A5's refusal order.
  const BROKEN: [string, () => void][] = [
    ["no browser block", () => writeFileSync(join(dir, "manifest.yml"), MANIFEST_NO_BROWSER)],
    ["blank tool", () => writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ tool: "" }))],
    [
      "unknown tool",
      () => writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ tool: "cypress" })),
    ],
    [
      "missing base_url",
      () => writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ base_url: "" })),
    ],
    [
      "remote base_url",
      () =>
        writeFileSync(
          join(dir, "manifest.yml"),
          manifestWithBrowser({ base_url: "https://novudesk.example.com" }),
        ),
    ],
    [
      "production environment",
      () =>
        writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ environment: "production" })),
    ],
    [
      "missing environment",
      () => writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ environment: "" })),
    ],
    ["no personas file", () => rmSync(join(dir, "fixtures", "personas.yml"))],
    [
      "empty personas list",
      () => writeFileSync(join(dir, "fixtures", "personas.yml"), "personas: []\n"),
    ],
  ];

  it.each(BROKEN)("%s: problems[0] is the launcher's refusal, verbatim", (_name, breakIt) => {
    seedDesignPack(dir);
    breakIt();
    const res = check();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const plan = buildLanePlan({ packDir: dir, lane: "design" });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(res.problems[0]!.reason).toBe(plan.reason);
  });

  it("every problem carries a markdown-backticked summary for the dashboard", () => {
    seedDesignPack(dir);
    writeFileSync(join(dir, "manifest.yml"), manifestWithBrowser({ environment: "staging" }));
    const res = check();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    for (const p of res.problems) expect(p.summary).toMatch(/`[^`]+`/);
    expect(res.problems[0]!.summary).toContain("`stack_adapter.browser.environment`");
    expect(res.problems[0]!.summary).toContain("`staging`");
  });

  it("collects EVERY independent prerequisite, so a setup shows all its remaining work", () => {
    seedDesignPack(dir);
    writeFileSync(
      join(dir, "manifest.yml"),
      manifestWithBrowser({
        tool: "cypress",
        base_url: "https://novudesk.example.com",
        environment: "production",
      }),
    );
    rmSync(join(dir, "fixtures", "personas.yml"));
    const res = check();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const summaries = res.problems.map((p) => p.summary).join(" and ");
    expect(summaries).toContain("`stack_adapter.browser.tool`");
    expect(summaries).toContain("`stack_adapter.browser.base_url`");
    expect(summaries).toContain("`stack_adapter.browser.environment`");
    expect(summaries).toContain("`fixtures/personas.yml`");
    // ...and the launcher still hears about exactly the first one.
    const plan = buildLanePlan({ packDir: dir, lane: "design" });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(res.problems[0]!.reason).toBe(plan.reason);
  });

  it("does not read the flows registry — the dashboard already has the entries", () => {
    // buildLanePlan refuses this pack (no registry), but readiness of the PACK
    // itself is unchanged by it. If this ever starts failing, the predicate has
    // grown a second read of a file its other caller already loaded.
    seedDesignPack(dir);
    rmSync(join(dir, "registries", "flows.yml"));
    expect(check().ok).toBe(true);
    expect(buildLanePlan({ packDir: dir, lane: "design" }).ok).toBe(false);
  });

  it("a missing manifest.yml reads as an absent browser block, not a crash", () => {
    seedDesignPack(dir);
    rmSync(join(dir, "manifest.yml"));
    const res = check();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.problems[0]!.summary).toBe("`stack_adapter.browser` is missing");
  });
});
