// Full-branch tests for $OPS/config.yml reading (A7, T4). This is the one
// place "which repos, which lanes, how wide" gets decided — `bin/ns` only
// echoes what this module hands back — so every normalized field, every
// tolerance (the lane-MAP spelling dashboard-cli.ts already accepts), and
// every refusal reason is pinned here. Pattern mirrors lane-plan.test.ts:
// tmpdir + literal YAML fixtures written by the test, never examples/*.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  readOpsConfig,
  expandPath,
  findRepo,
  resolveTarget,
  DEFAULT_MAX_CONCURRENT_REVIEWERS,
} from "./ops-config.js";
import type { OpsConfig } from "./ops-config.js";

let dir: string;
let configPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-opsconfig-"));
  configPath = join(dir, "config.yml");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write `yaml` to this test's config.yml and return its path. */
function write(yaml: string): string {
  writeFileSync(configPath, yaml);
  return configPath;
}

const HOME = "/home/op";

// ---------------------------------------------------------------------------
// Happy path — the canonical shape from docs/v3/a7-ops-launcher.md §config.yml
// ---------------------------------------------------------------------------

describe("readOpsConfig: canonical shape (a7-ops-launcher.md)", () => {
  it("normalizes every field of the documented example", () => {
    // This is the exact fenced block from the doc, byte for byte. If the doc
    // and the reader ever drift, this test is what catches it — not a human
    // squinting at two files side by side.
    write(
      `repos:\n` +
        `  - path: ~/code/novudesk\n` +
        `    lanes: [security, design]\n` +
        `    enabled: true\n` +
        `dashboard: { out: dashboard.html, open_after_run: true }\n` +
        `sentinel: { enabled: false, hour: 7, cooldown_days: 2, weekly_floor_days: 7 }\n` +
        `max_concurrent_reviewers: 3\n`,
    );
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config).toEqual({
      repos: [
        {
          name: "novudesk",
          path: join(HOME, "code", "novudesk"),
          enabled: true,
          lanes: ["security", "design"],
        },
      ],
      dashboard: { out: "dashboard.html", open_after_run: true },
      sentinel: { enabled: false, hour: 7, cooldown_days: 2, weekly_floor_days: 7 },
      max_concurrent_reviewers: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// Lane-MAP tolerance — dashboard-cli.ts already accepts `lanes: {security:
// true}`; this ONE config file feeds both readers, so a repo that renders
// with both lanes silently off (the exact failure A6 hit) must not happen
// just because the operator wrote the map spelling instead of the list.
// ---------------------------------------------------------------------------

describe("readOpsConfig: lane-MAP tolerance", () => {
  it("accepts {security: true, design: off} and only enables security", () => {
    // "off" is not the YAML 1.1 boolean here (core schema parses it as the
    // string "off"), so this also proves the map reader checks for `true` /
    // "on" specifically rather than "any truthy-looking value".
    write(`repos:\n  - path: ${dir}/a\n    lanes: { security: true, design: off }\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.repos[0]!.lanes).toEqual(["security"]);
  });

  it("accepts the string \"on\" as equivalent to true in the map form", () => {
    write(`repos:\n  - path: ${dir}/a\n    lanes: { security: on, design: on }\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.repos[0]!.lanes).toEqual(["security", "design"]);
  });

  it("sanity — the map form is not vacuously true: false/absent keys are excluded", () => {
    // Proves the filter can actually produce an empty result, not just
    // "always includes both lanes no matter what's in the map".
    write(`repos:\n  - path: ${dir}/a\n    lanes: { security: false }\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.repos[0]!.lanes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Defaults — dashboard / sentinel / max_concurrent_reviewers / enabled / lanes
// ---------------------------------------------------------------------------

describe("readOpsConfig: defaults when sections are absent", () => {
  it("fills dashboard, sentinel, and max_concurrent_reviewers with documented defaults", () => {
    write(`repos:\n  - path: ${dir}/a\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.dashboard).toEqual({ out: "dashboard.html", open_after_run: true });
    expect(res.config.sentinel).toEqual({
      enabled: false,
      hour: 7,
      cooldown_days: 2,
      weekly_floor_days: 7,
    });
    expect(res.config.max_concurrent_reviewers).toBe(DEFAULT_MAX_CONCURRENT_REVIEWERS);
    // No `lanes:` key at all -> no lane is silently assumed enabled.
    expect(res.config.repos[0]!.lanes).toEqual([]);
  });

  it("enabled defaults to true when the key is absent", () => {
    write(`repos:\n  - path: ${dir}/a\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.repos[0]!.enabled).toBe(true);
  });

  it("enabled: false is honored, not overridden by the default", () => {
    write(`repos:\n  - path: ${dir}/a\n    enabled: false\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.repos[0]!.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// name fallback to path basename
// ---------------------------------------------------------------------------

describe("readOpsConfig: display name fallback", () => {
  it("falls back to the path's basename when name is absent", () => {
    write(`repos:\n  - path: ${dir}/repos/novudesk\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.repos[0]!.name).toBe("novudesk");
    expect(res.config.repos[0]!.name).not.toBe("undefined");
    expect(res.config.repos[0]!.name).not.toBe("");
  });

  it("falls back to the basename when name is a blank string, not the literal blank", () => {
    // A repo whose display name comes out "" or "undefined" would corrupt
    // $OPS/evidence/<name>/ paths — this must never happen, even from a
    // config that "sort of" set a name.
    write(`repos:\n  - path: ${dir}/repos/novudesk\n    name: "   "\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.repos[0]!.name).toBe("novudesk");
  });

  it("sanity — an explicit name is honored over the basename (fallback isn't hardcoded)", () => {
    write(`repos:\n  - path: ${dir}/repos/novudesk\n    name: custom-name\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.repos[0]!.name).toBe("custom-name");
  });

  it("strips trailing slashes so a trailing-slash path still yields a real basename", () => {
    write(`repos:\n  - path: "${dir}/repos/novudesk/"\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.repos[0]!.name).toBe("novudesk");
  });
});

// ---------------------------------------------------------------------------
// expandPath — direct unit tests on every branch
// ---------------------------------------------------------------------------

describe("expandPath", () => {
  const base = "/cfg/dir";

  it("expands a leading ~/ against home", () => {
    expect(expandPath("~/code/x", HOME, base)).toBe(join(HOME, "code", "x"));
  });

  it("expands a bare ~ to home itself", () => {
    expect(expandPath("~", HOME, base)).toBe(HOME);
  });

  it("resolves an absolute path as-is (ignoring base and home)", () => {
    expect(expandPath("/abs/path", HOME, base)).toBe(resolve("/abs/path"));
  });

  it("resolves a relative path against the CONFIG FILE's directory, not cwd", () => {
    // This is the load-bearing behavior: a relative `path:` in config.yml
    // means "next to my config", not "wherever the operator happened to run
    // `ns` from". Using process.cwd() here would make the same config file
    // resolve to different repos depending on shell location.
    expect(expandPath("code/x", HOME, base)).toBe(resolve(base, "code", "x"));
    expect(expandPath("code/x", HOME, base)).not.toBe(resolve(process.cwd(), "code", "x"));
  });

  it("leaves \"~user\" UNEXPANDED — must not silently mangle it into a base-relative path", () => {
    // "~user" cannot be resolved (this module doesn't know other users'
    // homes) and must not be treated as if it started with a plain "~/" —
    // sanity-checked against expand-~/ above to prove they take different
    // branches rather than both landing on the same resolved path by luck.
    const got = expandPath("~user/x", HOME, base);
    expect(got).toBe(resolve(base, "~user", "x"));
    expect(got).not.toBe(join(HOME, "user", "x"));
  });
});

// ---------------------------------------------------------------------------
// Structural refusals — every operator-fixable problem returns {ok:false,
// reason}, never a throw. One test per branch, asserting the reason text.
// ---------------------------------------------------------------------------

describe("readOpsConfig structural refusals", () => {
  it("refuses a missing config file", () => {
    const res = readOpsConfig(join(dir, "nope.yml"), { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ops config not found/);
  });

  it("refuses invalid YAML", () => {
    write("not: valid: yaml: [::\n");
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not valid YAML/);
  });

  it("refuses a document that is not a YAML mapping", () => {
    write("- just\n- a\n- list\n");
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not a YAML mapping/);
  });

  it("refuses a config with no `repos:` key", () => {
    write("dashboard: { out: dashboard.html }\n");
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no `repos:` list/);
  });

  it("refuses an empty `repos:` list", () => {
    write("repos: []\n");
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/`repos:` is empty/);
  });

  it("refuses a repos entry that is not a mapping", () => {
    write('repos:\n  - "just-a-string"\n');
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/repos\[0\] is not a mapping/);
  });

  it("refuses a repo with no `path:`", () => {
    write("repos:\n  - enabled: true\n");
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/repos\[0\] has no `path:`/);
  });

  it("refuses two repos that resolve to the same display name", () => {
    // Evidence and digests are stored per name ($OPS/evidence/<name>/,
    // $OPS/digests/<name>.md); a silent collision means one repo's data
    // quietly overwrites the other's.
    write(`repos:\n  - path: ${dir}/code/app\n  - path: ${dir}/other/app\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/resolve to the display name/);
      expect(res.reason).toContain('"app"');
    }
  });

  it.each([
    ["0", "0"],
    ["-1", "-1"],
    ["1.5", "1.5"],
    ['"x"', "x"],
  ])("refuses max_concurrent_reviewers: %s", (yamlValue, expectedInReason) => {
    write(`repos:\n  - path: ${dir}/a\nmax_concurrent_reviewers: ${yamlValue}\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/max_concurrent_reviewers must be an integer >= 1/);
      expect(res.reason).toContain(expectedInReason);
    }
  });

  it.each([24, -1])("refuses sentinel.hour out of 0-23 (got %d)", (hour) => {
    write(`repos:\n  - path: ${dir}/a\nsentinel: { hour: ${hour} }\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/sentinel\.hour must be an integer 0-23/);
  });

  it("refuses a negative sentinel.cooldown_days", () => {
    write(`repos:\n  - path: ${dir}/a\nsentinel: { cooldown_days: -1 }\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/cooldown_days must be an integer >= 0/);
  });

  it("refuses sentinel.weekly_floor_days < 1", () => {
    write(`repos:\n  - path: ${dir}/a\nsentinel: { weekly_floor_days: 0 }\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/weekly_floor_days must be an integer >= 1/);
  });
});

// ---------------------------------------------------------------------------
// readOpsConfig must NOT require repo paths to exist — `ns status` has to be
// able to list a repo whose clone is missing and say so, rather than
// refusing to load the whole config.
// ---------------------------------------------------------------------------

describe("readOpsConfig: does not require repo paths to exist", () => {
  it("loads successfully even though the repo path is not on disk", () => {
    write(`repos:\n  - path: ${dir}/never/cloned\n`);
    const res = readOpsConfig(configPath, { home: HOME });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.repos[0]!.path).toBe(join(dir, "never", "cloned"));
  });
});

// ---------------------------------------------------------------------------
// findRepo — by name, by exact resolved path, and the miss case
// ---------------------------------------------------------------------------

describe("findRepo", () => {
  function loadTwoRepoConfig(): OpsConfig {
    write(
      `repos:\n` +
        `  - path: ${dir}/code/novudesk\n` +
        `  - path: ${dir}/code/other\n    name: renamed\n`,
    );
    const res = readOpsConfig(configPath, { home: HOME });
    if (!res.ok) throw new Error(`fixture setup failed: ${res.reason}`);
    return res.config;
  }

  it("finds a repo by its display name", () => {
    const config = loadTwoRepoConfig();
    expect(findRepo(config, "renamed")?.path).toBe(join(dir, "code", "other"));
  });

  it("finds a repo by its exact resolved path", () => {
    const config = loadTwoRepoConfig();
    const target = join(dir, "code", "novudesk");
    expect(findRepo(config, target)?.name).toBe("novudesk");
  });

  it("returns undefined on a miss (neither name nor path matches)", () => {
    const config = loadTwoRepoConfig();
    expect(findRepo(config, "nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveTarget — happy path + every refusal
// ---------------------------------------------------------------------------

describe("resolveTarget", () => {
  let repoA: string;
  let repoDisabled: string;
  let config: OpsConfig;

  beforeEach(() => {
    repoA = join(dir, "repoA");
    repoDisabled = join(dir, "repoB-disabled-target");
    mkdirSync(join(repoA, ".nightshift"), { recursive: true });
    mkdirSync(repoDisabled, { recursive: true }); // no .nightshift needed; disabled short-circuits first
    config = {
      repos: [
        { name: "repoA", path: repoA, enabled: true, lanes: ["security"] },
        { name: "repoB-disabled", path: repoDisabled, enabled: false, lanes: ["security", "design"] },
      ],
      dashboard: { out: "dashboard.html", open_after_run: true },
      sentinel: { enabled: false, hour: 7, cooldown_days: 2, weekly_floor_days: 7 },
      max_concurrent_reviewers: 5,
    };
  });

  it("happy path: resolves packDir/metricsDir/runRoot/max_concurrent_reviewers", () => {
    const res = resolveTarget(config, "repoA", "security");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.target.repo).toBe(config.repos[0]!);
    expect(res.target.lane).toBe("security");
    expect(res.target.packDir).toBe(join(repoA, ".nightshift"));
    expect(res.target.metricsDir).toBe(join(repoA, ".nightshift", "metrics"));
    expect(res.target.runRoot).toBe(join(repoA, ".nightshift", ".run"));
    expect(res.target.max_concurrent_reviewers).toBe(5);
  });

  it("refuses an unknown lane", () => {
    const res = resolveTarget(config, "repoA", "bogus");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/unknown lane "bogus"/);
      expect(res.reason).toMatch(/security.*design|design.*security/);
    }
  });

  it("refuses an unknown repo, listing the configured repos", () => {
    const res = resolveTarget(config, "nope", "security");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/repo "nope" is not in the ops config/);
      expect(res.reason).toContain("repoA");
      expect(res.reason).toContain("repoB-disabled");
    }
  });

  it("says \"(none)\" when the config has no repos at all", () => {
    const empty: OpsConfig = { ...config, repos: [] };
    const res = resolveTarget(empty, "nope", "security");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("(none)");
  });

  it("refuses a disabled repo", () => {
    const res = resolveTarget(config, "repoB-disabled", "security");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/repo "repoB-disabled" is disabled in the ops config/);
  });

  it("refuses a lane not in the repo's configured lanes list", () => {
    // repoA only lists `security`; asking for `design` is a config problem,
    // distinct from the repo/lane just not existing.
    const res = resolveTarget(config, "repoA", "design");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/lane "design" is not enabled for repo "repoA"/);
      expect(res.reason).toContain("[security]");
    }
  });

  it("refuses when the repo path does not exist on disk", () => {
    const missing: OpsConfig = {
      ...config,
      repos: [{ name: "gone", path: join(dir, "never-cloned"), enabled: true, lanes: ["security"] }],
    };
    const res = resolveTarget(missing, "gone", "security");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/repo path for "gone" is not a directory/);
  });

  it("refuses when the repo path is a file, not a directory", () => {
    const filePath = join(dir, "repo-is-a-file");
    writeFileSync(filePath, "x");
    const fileRepo: OpsConfig = {
      ...config,
      repos: [{ name: "flat", path: filePath, enabled: true, lanes: ["security"] }],
    };
    const res = resolveTarget(fileRepo, "flat", "security");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/repo path for "flat" is not a directory/);
  });

  it("refuses when the repo directory has no .nightshift pack", () => {
    const noPackDir = join(dir, "repo-no-pack");
    mkdirSync(noPackDir, { recursive: true });
    const noPack: OpsConfig = {
      ...config,
      repos: [{ name: "nopack", path: noPackDir, enabled: true, lanes: ["security"] }],
    };
    const res = resolveTarget(noPack, "nopack", "security");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no \.nightshift pack in/);
  });
});
