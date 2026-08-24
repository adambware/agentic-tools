// Unit + integration tests for dashboard-cli (v3 A6). Exercises the real
// pack-loading path (readYaml/readJsonl/atomicWrite) against a temp $OPS and
// a cpSync'd copy of examples/novudesk, per the conventions in
// record-cost-run.test.ts. No mocking of fs — every scenario is a real
// on-disk pack.
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  cpSync,
  existsSync,
  readFileSync,
  unlinkSync,
  symlinkSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runDashboard, parseDigest, type DashboardOpts } from "./dashboard-cli.js";
import { readYaml } from "./io.js";
import { ORPHAN_AGE_DAYS } from "./dashboard-run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..", "..");
const NOVUDESK_PACK = join(PLUGIN_ROOT, "examples", "novudesk", ".nightshift");

const TODAY = "2026-06-21";
const GENERATED_AT = "2026-06-21 07:00";
const ENGINE_VERSION = "test";

let tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A fresh $OPS + a cpSync'd copy of the novudesk pack, both lanes enabled. */
function setupOps(): { opsDir: string; repoDir: string; configPath: string; outPath: string } {
  const dir = makeTmpDir("ns-dashboard-");
  const opsDir = join(dir, "ops");
  mkdirSync(opsDir, { recursive: true });
  const repoDir = join(dir, "novudesk");
  cpSync(NOVUDESK_PACK, join(repoDir, ".nightshift"), { recursive: true });
  const configPath = join(opsDir, "config.yml");
  writeFileSync(
    configPath,
    [
      "repos:",
      "  - name: novudesk",
      `    path: "${repoDir}"`,
      "    lanes:",
      "      security: true",
      "      design: true",
      "",
    ].join("\n"),
  );
  return { opsDir, repoDir, configPath, outPath: join(opsDir, "dashboard.html") };
}

function baseOpts(configPath: string, outPath: string): DashboardOpts {
  return {
    configPath,
    outPath,
    today: TODAY,
    generatedAt: GENERATED_AT,
    engineVersion: ENGINE_VERSION,
  };
}

afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// 1. runDashboard end-to-end
// ---------------------------------------------------------------------------

describe("runDashboard (end-to-end)", () => {
  it("renders a self-contained HTML dashboard for a configured repo", () => {
    const { configPath, outPath } = setupOps();
    const { html } = runDashboard(baseOpts(configPath, outPath));

    expect(existsSync(outPath)).toBe(true);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("novudesk");
    expect(html).not.toContain("<script");

    const onDisk = readFileSync(outPath, "utf8");
    expect(onDisk).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// 2. Design-lane readiness detection
// ---------------------------------------------------------------------------

describe("design-lane readiness", () => {
  it("renders the design lane as ready when personas.yml + base_url are both present", () => {
    const { repoDir, configPath, outPath } = setupOps();
    const packDir = join(repoDir, ".nightshift");

    // Confirm the pack's actual readiness inputs before asserting on the render,
    // so this test fails loudly if the fixture pack ever stops being ready.
    const personasExist = existsSync(join(packDir, "fixtures", "personas.yml"));
    const manifest = readYaml<{ stack_adapter?: { browser?: { base_url?: string } } }>(
      join(packDir, "manifest.yml"),
    );
    const baseUrl = manifest?.stack_adapter?.browser?.base_url;
    expect(personasExist).toBe(true);
    expect(baseUrl).toBeTruthy();

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("design lane");
    expect(html).not.toContain("pack is not ready");
    expect(html).toContain("FLOW-01");
  });

  it("renders the design lane as not-ready when personas.yml is removed", () => {
    const { repoDir, configPath, outPath } = setupOps();
    const personasPath = join(repoDir, ".nightshift", "fixtures", "personas.yml");
    expect(existsSync(personasPath)).toBe(true);
    unlinkSync(personasPath);

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("pack is not ready");
    expect(html).toContain("personas.yml");
    expect(html).toContain("is missing");
  });

  // The page's readiness verdict is bin/lane-plan's, not an approximation of it.
  // Each pack below has BOTH of the things the old two-line check looked at —
  // fixtures/personas.yml and a base_url — and is still one `ns` refuses every
  // time. The dashboard is the operator's only view of the fleet, so rendering
  // any of them as a live lane is the page lying about the one thing it is for.
  function writeBrowserManifest(
    repoDir: string,
    browser: { tool?: string; base_url?: string; environment?: string },
  ): void {
    const line = (k: string, v: string | undefined) => (v === undefined ? [] : [`    ${k}: "${v}"`]);
    writeFileSync(
      join(repoDir, ".nightshift", "manifest.yml"),
      [
        "pack_format: 1",
        "project: novudesk",
        "stack_adapter:",
        "  browser:",
        ...line("tool", browser.tool),
        ...line("base_url", browser.base_url),
        ...line("environment", browser.environment),
        "",
      ].join("\n"),
    );
  }

  const READY = {
    tool: "playwright-mcp",
    base_url: "http://novudesk.localhost:3000",
    environment: "local",
  };

  it("a PRODUCTION environment is not-ready, and the page names the field", () => {
    const { repoDir, configPath, outPath } = setupOps();
    writeBrowserManifest(repoDir, { ...READY, environment: "production" });

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("pack is not ready");
    expect(html).toContain("<code>stack_adapter.browser.environment</code>");
    expect(html).toContain("<code>production</code>");
    expect(html).toContain("not a non-production environment");
  });

  it("a non-loopback base_url is not-ready, and the page names the host", () => {
    const { repoDir, configPath, outPath } = setupOps();
    writeBrowserManifest(repoDir, { ...READY, base_url: "https://novudesk.example.com" });

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("pack is not ready");
    expect(html).toContain("<code>novudesk.example.com</code>");
    expect(html).toContain("is not loopback");
  });

  it("an unknown browser tool is not-ready — an adapter with no agent file is a refusal", () => {
    const { repoDir, configPath, outPath } = setupOps();
    writeBrowserManifest(repoDir, { ...READY, tool: "cypress" });

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("pack is not ready");
    expect(html).toContain("<code>cypress</code>");
    expect(html).toContain("has no ux-reviewer agent");
  });

  it("a missing `environment` assertion is not-ready — silence is not consent", () => {
    const { repoDir, configPath, outPath } = setupOps();
    writeBrowserManifest(repoDir, { tool: READY.tool, base_url: READY.base_url });

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("pack is not ready");
    expect(html).toContain("<code>stack_adapter.browser.environment</code>");
    expect(html).toContain("is unset");
  });

  it("two unmet prerequisites still join with ' and ', so the copy says 'until both exist'", () => {
    const { repoDir, configPath, outPath } = setupOps();
    writeBrowserManifest(repoDir, { tool: READY.tool, base_url: READY.base_url });
    unlinkSync(join(repoDir, ".nightshift", "fixtures", "personas.yml"));

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("until both exist");
  });

  it("a pack that clears every gate is still rendered 'on', not scared off by the new checks", () => {
    const { repoDir, configPath, outPath } = setupOps();
    writeBrowserManifest(repoDir, READY);

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).not.toContain("pack is not ready");
    expect(html).toContain("FLOW-01");
  });
});

// ---------------------------------------------------------------------------
// 3. parseDigest
// ---------------------------------------------------------------------------

describe("parseDigest", () => {
  it("parses a generated: line and Decisions bullets", () => {
    const dir = makeTmpDir("ns-digest-");
    const digestPath = join(dir, "novudesk.md");
    writeFileSync(
      digestPath,
      [
        "generated: 2026-06-20 07:00",
        "",
        "## Decisions",
        "",
        "- decision one",
        "- decision two",
        "",
        "## Notes",
        "- not a decision",
      ].join("\n"),
    );

    const digest = parseDigest(digestPath, "novudesk", 2, TODAY);
    expect(digest).not.toBeNull();
    expect(digest!.generated_at).toBe("2026-06-20 07:00");
    expect(digest!.age_days).toBe(1);
    expect(digest!.runs_behind).toBe(2);
    expect(digest!.items).toHaveLength(2);
    expect(digest!.items.map((i) => i.text)).toEqual(["decision one", "decision two"]);
  });

  // Regression: the FIRST live `ns digest` run rendered the dashboard's
  // "Decisions needed" panel from the FINDINGS list, in truncated fragments.
  // Two independent parser defects, both named here after the failure.
  it("regression: a numbered 'Top 3 human decisions needed' heading was never matched", () => {
    const dir = makeTmpDir("ns-digest-");
    const digestPath = join(dir, "acme.md");
    writeFileSync(
      digestPath,
      [
        "generated: 2026-06-20 07:00",
        "",
        "## 1. Top 3 human decisions needed",
        "",
        "**1. Allowlist the engine's own helper scripts.**",
        "",
        "## 2. New findings",
        "",
        "- a finding, which is NOT a decision",
      ].join("\n"),
    );

    const digest = parseDigest(digestPath, "acme", 0, TODAY);
    // The old anchored /^#+\s*decisions/ missed this heading, fell through to
    // bullets-anywhere, and returned the finding instead of the decision.
    // The list marker is stripped, exactly as it is for a "- " bullet; what
    // matters is that the DECISION comes back, not the finding below it.
    expect(digest!.items.map((i) => i.text)).toEqual([
      "Allowlist the engine's own helper scripts.",
    ]);
  });

  it("regression: a hard-wrapped decision was truncated at its first line break", () => {
    const dir = makeTmpDir("ns-digest-");
    const digestPath = join(dir, "acme.md");
    writeFileSync(
      digestPath,
      [
        "generated: 2026-06-20 07:00",
        "",
        "## Decisions",
        "",
        "- the nightly is burning money",
        "  without producing findings",
        "- second decision",
      ].join("\n"),
    );

    const digest = parseDigest(digestPath, "acme", 0, TODAY);
    expect(digest!.items.map((i) => i.text)).toEqual([
      "the nightly is burning money without producing findings",
      "second decision",
    ]);
  });

  it("falls back to top-level bullets when there is no Decisions heading", () => {
    const dir = makeTmpDir("ns-digest-");
    const digestPath = join(dir, "novudesk.md");
    writeFileSync(
      digestPath,
      [
        "generated: 2026-06-20 07:00",
        "",
        "Some notes, no heading here.",
        "",
        "- top bullet one",
        "- top bullet two",
      ].join("\n"),
    );

    const digest = parseDigest(digestPath, "novudesk", 0, TODAY);
    expect(digest).not.toBeNull();
    expect(digest!.items).toHaveLength(2);
    expect(digest!.items.map((i) => i.text)).toEqual(["top bullet one", "top bullet two"]);
  });

  it("returns null when the digest file is missing", () => {
    const dir = makeTmpDir("ns-digest-");
    const digest = parseDigest(join(dir, "nope.md"), "novudesk", 0, TODAY);
    expect(digest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Evidence stat (T23): existing file links, missing file is an explicit state
// ---------------------------------------------------------------------------

describe("evidence linking", () => {
  it("links existing evidence and flags missing evidence as gone, not a dead link", () => {
    const { opsDir, repoDir, configPath, outPath } = setupOps();
    const findingsPath = join(repoDir, ".nightshift", "metrics", "findings", "2026-06.jsonl");

    const present = {
      dedupe_key: {
        surface: "ND-EVID-01",
        symptom: "evidence present test",
        root_cause: "evidence stat coverage (dashboard-cli.test.ts)",
      },
      severity: "low",
      confidence: "high",
      needs_human_verification: false,
      evidence: "evidence/novudesk/present.png",
      first_seen: "2026-06-20",
      last_seen: "2026-06-20",
      run_id: "test-evidence-present",
    };
    const missing = {
      dedupe_key: {
        surface: "ND-EVID-02",
        symptom: "evidence absent test",
        root_cause: "evidence stat coverage (dashboard-cli.test.ts)",
      },
      severity: "low",
      confidence: "high",
      needs_human_verification: false,
      evidence: "evidence/novudesk/missing.png",
      first_seen: "2026-06-20",
      last_seen: "2026-06-20",
      run_id: "test-evidence-missing",
    };
    appendFileSync(findingsPath, JSON.stringify(present) + "\n" + JSON.stringify(missing) + "\n");

    // Only the "present" file actually exists on disk under $OPS/evidence/.
    mkdirSync(join(opsDir, "evidence", "novudesk"), { recursive: true });
    writeFileSync(join(opsDir, "evidence", "novudesk", "present.png"), "fake-png-bytes");

    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain('href="evidence/novudesk/present.png"');
    expect(html).toContain("evidence no longer on disk");
  });
});

// ---------------------------------------------------------------------------
// 5. Config missing
// ---------------------------------------------------------------------------

describe("runDashboard — missing config", () => {
  it("throws when the config file does not exist", () => {
    const dir = makeTmpDir("ns-dashboard-missing-");
    const configPath = join(dir, "config.yml");
    const outPath = join(dir, "dashboard.html");
    expect(() => runDashboard(baseOpts(configPath, outPath))).toThrow(/config not found/);
  });
});

// ---------------------------------------------------------------------------
// Config contract: the shape the operator is actually told to write
// ---------------------------------------------------------------------------

describe("the documented $OPS/config.yml shape is consumable", () => {
  /** Exactly the shape in docs/v3/a7-ops-launcher.md and plan §WS7:
   *  a lane ARRAY, a boolean `enabled`, and no `name` key. */
  function setupDocumentedConfig(enabled = true) {
    const dir = makeTmpDir("ns-dashboard-doccfg-");
    const opsDir = join(dir, "ops");
    mkdirSync(opsDir, { recursive: true });
    const repoDir = join(dir, "novudesk");
    cpSync(NOVUDESK_PACK, join(repoDir, ".nightshift"), { recursive: true });
    const configPath = join(opsDir, "config.yml");
    writeFileSync(
      configPath,
      [
        "repos:",
        `  - path: "${repoDir}"`,
        "    lanes: [security, design]",
        `    enabled: ${enabled}`,
        "dashboard: { out: dashboard.html, open_after_run: true }",
        "",
      ].join("\n"),
    );
    return { configPath, outPath: join(opsDir, "dashboard.html") };
  }

  it("a lane ARRAY enables those lanes (not 'lane not enabled' for both)", () => {
    const { configPath, outPath } = setupDocumentedConfig();
    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).not.toContain("Lane not enabled for this repo.");
  });

  it("a missing `name` falls back to the path basename, never 'undefined'", () => {
    const { configPath, outPath } = setupDocumentedConfig();
    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("novudesk");
    expect(html).not.toContain("undefined");
  });

  it("`enabled: false` drops the repo from the page entirely", () => {
    const { configPath, outPath } = setupDocumentedConfig(false);
    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).not.toContain("novudesk");
  });

  it("the lane-MAP spelling still works — both config dialects are accepted", () => {
    const { configPath, outPath } = setupOps();
    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).not.toContain("Lane not enabled for this repo.");
  });
});

// ---------------------------------------------------------------------------
// One bad repo must not take down the multi-repo page
// ---------------------------------------------------------------------------

describe("per-repo failure isolation", () => {
  it("a corrupt JSONL line in one repo leaves the other repos rendered", () => {
    const dir = makeTmpDir("ns-dashboard-iso-");
    const opsDir = join(dir, "ops");
    mkdirSync(opsDir, { recursive: true });
    const goodRepo = join(dir, "goodrepo");
    const badRepo = join(dir, "badrepo");
    cpSync(NOVUDESK_PACK, join(goodRepo, ".nightshift"), { recursive: true });
    cpSync(NOVUDESK_PACK, join(badRepo, ".nightshift"), { recursive: true });
    // A truncated append — the realistic corruption for an append-only file.
    appendFileSync(join(badRepo, ".nightshift", "metrics", "daily.jsonl"), '{"date":"2026-\n');

    const configPath = join(opsDir, "config.yml");
    writeFileSync(
      configPath,
      [
        "repos:",
        `  - path: "${goodRepo}"`,
        "    lanes: [security]",
        `  - path: "${badRepo}"`,
        "    lanes: [security]",
        "",
      ].join("\n"),
    );
    const { html } = runDashboard(baseOpts(configPath, join(opsDir, "dashboard.html")));
    // The bad repo is named and marked unreadable...
    expect(html).toContain("badrepo");
    expect(html).toContain("unreadable");
    // ...and the good repo still rendered its real content.
    expect(html).toContain("goodrepo");
    expect(html).toContain("Every other repo on this page is unaffected.");
  });
});

// ---------------------------------------------------------------------------
// Evidence scan must not follow symlinks
// ---------------------------------------------------------------------------

describe("evidence scan is symlink-safe", () => {
  it("a symlink cycle under evidence/ does not hang the rebuild", () => {
    const { opsDir, configPath, outPath } = setupOps();
    const evDir = join(opsDir, "evidence");
    mkdirSync(join(evDir, "sub"), { recursive: true });
    writeFileSync(join(evDir, "sub", "shot.png"), "x");
    // evidence/sub/loop -> evidence  (a cycle: sub/loop/sub/loop/sub/...)
    symlinkSync(evDir, join(evDir, "sub", "loop"), "dir");
    // Completing at all IS the assertion — the pre-fix walk recursed forever.
    const { html } = runDashboard(baseOpts(configPath, outPath));
    expect(html).toContain("<footer>");
  });

  it("a broken symlink is skipped rather than crashing the scan", () => {
    const { opsDir, configPath, outPath } = setupOps();
    const evDir = join(opsDir, "evidence");
    mkdirSync(evDir, { recursive: true });
    writeFileSync(join(evDir, "real.png"), "x");
    symlinkSync(join(evDir, "does-not-exist.png"), join(evDir, "dangling.png"));
    expect(() => runDashboard(baseOpts(configPath, outPath))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Regression: the config path forms an operator actually writes
// ---------------------------------------------------------------------------

describe("regression: a `~/…` or relative repo path rendered as 'pack missing'", () => {
  // Every other test here writes an ABSOLUTE path, which is why this survived to
  // the first real bring-up. The TEMPLATE config ships `path: ~/code/my-project`,
  // and `join("~/code/x", ".nightshift")` is a RELATIVE path resolved against the
  // dashboard process's cwd — so it never exists, and the not-found branch
  // rendered the one onboarded repo as "pack missing / Cannot read this repo",
  // with no runs and no cost, minutes after a successful run of that repo.
  // `ns status` was fine the whole time: it goes through readOpsConfig, which
  // expands. A living document reporting a healthy repo as absent is worse than
  // a stale one.
  function opsWith(pathLine: string, repoParent: string): { configPath: string; outPath: string } {
    const dir = makeTmpDir("ns-dashboard-path-");
    const opsDir = join(dir, "ops");
    mkdirSync(opsDir, { recursive: true });
    cpSync(NOVUDESK_PACK, join(repoParent, "novudesk", ".nightshift"), { recursive: true });
    const configPath = join(opsDir, "config.yml");
    writeFileSync(
      configPath,
      ["repos:", "  - name: novudesk", `    path: "${pathLine}"`, "    lanes:", "      security: true", ""].join("\n"),
    );
    return { configPath, outPath: join(opsDir, "dashboard.html") };
  }

  it("expands a leading ~ instead of reporting the pack missing", () => {
    const fakeHome = makeTmpDir("ns-home-");
    const realHome = process.env.HOME;
    try {
      process.env.HOME = fakeHome;
      const { configPath, outPath } = opsWith("~/novudesk", fakeHome);
      const { html } = runDashboard(baseOpts(configPath, outPath));
      expect(html).not.toMatch(/pack missing/);
      expect(html).not.toMatch(/Cannot read this repo/);
    } finally {
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
    }
  });

  it("resolves a relative path against the CONFIG's directory, not the cwd", () => {
    // "next to my config" is the documented meaning (ops-config.expandPath), and
    // it must not depend on where the operator happened to run `ns`.
    const dir = makeTmpDir("ns-dashboard-rel-");
    const opsDir = join(dir, "ops");
    mkdirSync(opsDir, { recursive: true });
    cpSync(NOVUDESK_PACK, join(opsDir, "novudesk", ".nightshift"), { recursive: true });
    const configPath = join(opsDir, "config.yml");
    writeFileSync(
      configPath,
      ["repos:", "  - name: novudesk", '    path: "novudesk"', "    lanes:", "      security: true", ""].join("\n"),
    );
    const outPath = join(opsDir, "dashboard.html");
    const cwd = process.cwd();
    try {
      process.chdir(makeTmpDir("ns-elsewhere-"));
      const { html } = runDashboard(baseOpts(configPath, outPath));
      expect(html).not.toMatch(/pack missing/);
    } finally {
      process.chdir(cwd);
    }
  });

  it("still reports pack missing when the pack really IS gone (the check is not vacuous)", () => {
    const dir = makeTmpDir("ns-dashboard-gone-");
    const opsDir = join(dir, "ops");
    mkdirSync(opsDir, { recursive: true });
    const configPath = join(opsDir, "config.yml");
    writeFileSync(
      configPath,
      ["repos:", "  - name: novudesk", '    path: "novudesk"', "    lanes:", "      security: true", ""].join("\n"),
    );
    const { html } = runDashboard(baseOpts(configPath, join(opsDir, "dashboard.html")));
    expect(html).toMatch(/pack missing/);
  });

  it("finds an orphaned run dir under a `~/…` repo path, not just its pack", () => {
    // scanOrphanRunDirs used to build `.nightshift/.run` from the raw
    // `cfg.path` even after loadRepo was fixed to expand it — so a `~/…`
    // config still hid orphaned run dirs, silently, one level below the bug
    // this describe block is named for. Same fixture shape as the sibling
    // "expands a leading ~" test, plus a stale `.run/<id>` dir to find.
    const fakeHome = makeTmpDir("ns-home-");
    const realHome = process.env.HOME;
    try {
      process.env.HOME = fakeHome;
      const { configPath, outPath } = opsWith("~/novudesk", fakeHome);
      const runDir = join(fakeHome, "novudesk", ".nightshift", ".run", "stale-run-1");
      mkdirSync(runDir, { recursive: true });
      const now = new Date(`${TODAY}T12:00:00Z`);
      const staleMtime = new Date(now.getTime() - (ORPHAN_AGE_DAYS + 3) * 86_400_000);
      utimesSync(runDir, staleMtime, staleMtime);

      const { html } = runDashboard({ ...baseOpts(configPath, outPath), now });

      expect(html).toContain(`orphaned run dir older than ${ORPHAN_AGE_DAYS} days`);
      expect(html).toContain("novudesk/.nightshift/.run/stale-run-1/");
    } finally {
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
    }
  });
});
