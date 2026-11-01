import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { escaped, fetchMergedPrs, isFixPr, loadConfig, type MergedPr, ownsProject, parsePrList, PR_LIMIT, projectKey } from "./repos.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-09-01T00:00:00.000Z");

function pr(number: number, title: string, day: number, files: string[]): MergedPr {
  return { number, title, mergedAt: T0 + day * DAY, files };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loops-repos-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadConfig", () => {
  const write = (v: unknown) => {
    const f = join(tmp, "config.json");
    writeFileSync(f, JSON.stringify(v));
    return f;
  };

  it("expands ~ and resolves a relative path against the config's dir", () => {
    const c = loadConfig(write({ repos: [{ slug: "o/a", path: "~/src/a" }, { slug: "o/b", path: "b" }, { slug: "o/c", path: "/abs/c/" }] }));
    expect(c.repos).toEqual([
      { slug: "o/a", path: join(homedir(), "src", "a"), escape_ignore: [] },
      { slug: "o/b", path: join(tmp, "b"), escape_ignore: [] },
      { slug: "o/c", path: "/abs/c", escape_ignore: [] },
    ]);
  });

  it.each([
    [{}, /repos array/],
    [{ repos: [{ slug: "nope", path: "/x" }] }, /owner\/name/],
    [{ repos: [{ slug: "o/a" }] }, /path/],
    [{ repos: [{ slug: "o/a", path: "/x" }, { slug: "o/a", path: "/y" }] }, /duplicate/],
  ])("refuses a malformed config %j", (v, msg) => {
    expect(() => loadConfig(write(v))).toThrow(msg);
  });
});

describe("ownsProject", () => {
  it("claims the checkout and its .claude/worktrees, not a sibling sharing the prefix", () => {
    const repo = "/Users/u/Dev/app";
    expect(projectKey(repo)).toBe("-Users-u-Dev-app");
    expect(ownsProject(repo, "-Users-u-Dev-app")).toBe(true);
    expect(ownsProject(repo, "-Users-u-Dev-app--claude-worktrees-fix-1-abc123")).toBe(true);
    expect(ownsProject(repo, "-Users-u-Dev-app-two")).toBe(false);
    expect(ownsProject(repo, "-Users-u-Dev-app-two--claude-worktrees-x")).toBe(false);
    expect(ownsProject(repo, "-Users-u-Dev")).toBe(false);
  });
});

describe("parsePrList", () => {
  it("reads gh's shape", () => {
    expect(parsePrList([{ number: 3, title: "t", mergedAt: "2026-09-01T00:00:00Z", files: [{ path: "a.ts", additions: 1 }] }])).toEqual([
      { number: 3, title: "t", mergedAt: T0, files: ["a.ts"] },
    ]);
  });

  it.each([
    [{}],
    [[{ number: 1, title: "t", mergedAt: "Sep 1", files: [] }]],
    [[{ number: 1, title: "t", mergedAt: "2026-09-01T00:00:00Z" }]],
    [[{ number: 1, title: "t", mergedAt: "2026-09-01T00:00:00Z", files: [{}] }]],
  ])("refuses a changed shape %j", (v) => {
    expect(() => parsePrList(v)).toThrow();
  });
});

describe("isFixPr", () => {
  it.each([
    ["fix: crash", true],
    ["fix(api): crash", true],
    ["Fix the login", true],
    ['Revert "feat: x"', true],
    ["hotfix: prod", true],
    ["v0.2.1 fix(loops): parser", true],
    ["0.3.0 Fix it", true],
    ["Fixture refresh", false],
    ["feat: fix-ups later", false],
    ["docs: how to fix", false],
  ])("%s -> %s", (title, want) => {
    expect(isFixPr(pr(1, title, 0, []))).toBe(want);
  });
});

describe("escaped", () => {
  const base = pr(1, "feat: a", 0, ["a.ts", "b.ts"]);

  it("counts a later fix touching one of its files within 14 days", () => {
    expect(escaped(base, [base, pr(2, "fix: b", 3, ["b.ts"])])).toBe(true);
    expect(escaped(base, [base, pr(2, "fix: b", 14, ["b.ts"])])).toBe(true);
  });

  it("ignores a fix after 14 days, before the merge, on other files, or not titled a fix", () => {
    expect(escaped(base, [base, pr(2, "fix: b", 14.01, ["b.ts"])])).toBe(false);
    expect(escaped(base, [base, pr(2, "fix: b", -1, ["b.ts"])])).toBe(false);
    expect(escaped(base, [base, pr(2, "fix: c", 1, ["c.ts"])])).toBe(false);
    expect(escaped(base, [base, pr(2, "feat: more b", 1, ["b.ts"])])).toBe(false);
  });

  it("never counts a fix PR against itself", () => {
    const fix = pr(1, "fix: a", 0, ["a.ts"]);
    expect(escaped(fix, [fix])).toBe(false);
  });
});

describe("fetchMergedPrs", () => {
  it("asks gh for PRs merged since the window's day and keeps those at or after the ms", () => {
    let seen: string[] = [];
    const prs = fetchMergedPrs("o/a", T0 + 12 * 60 * 60 * 1000, (args) => {
      if (args[0] === "repo") return "o/a\n";
      seen = args;
      return JSON.stringify([
        { number: 1, title: "early", mergedAt: "2026-09-01T06:00:00Z", files: [] },
        { number: 2, title: "late", mergedAt: "2026-09-01T18:00:00Z", files: [] },
      ]);
    });
    expect(seen).toContain("merged:>=2026-09-01");
    expect(seen.slice(0, 3)).toEqual(["pr", "list", "-R"]);
    expect(prs.map((p) => p.number)).toEqual([2]);
  });

  it("refuses a list that hit the limit, which may be cut short", () => {
    const many = Array.from({ length: PR_LIMIT }, (_, i) => ({ number: i, title: "t", mergedAt: "2026-09-02T00:00:00Z", files: [] }));
    expect(() => fetchMergedPrs("o/a", T0, (args) => (args[0] === "repo" ? "o/a" : JSON.stringify(many)))).toThrow(/cut short/);
  });

  // gh pr list answers [] with exit 0 for a slug it cannot resolve; only the repo view tells.
  it("throws for a slug gh cannot resolve instead of reading it as quiet", () => {
    const gh = (args: string[]) => {
      if (args[0] === "repo") throw new Error("Could not resolve to a Repository");
      return "[]";
    };
    expect(() => fetchMergedPrs("o/typo", T0, gh)).toThrow(/resolve/);
  });

  it("throws for a renamed slug, naming both", () => {
    const gh = (args: string[]) => (args[0] === "repo" ? "o/new-name\n" : "[]");
    expect(() => fetchMergedPrs("o/old-name", T0, gh)).toThrow(/o\/old-name.*o\/new-name/);
  });

  it("accepts a case-only difference in the resolved name", () => {
    const gh = (args: string[]) => (args[0] === "repo" ? "O/App\n" : "[]");
    expect(fetchMergedPrs("o/app", T0, gh)).toEqual([]);
  });
});

describe("escaped: last toucher only", () => {
  it("blames the latest earlier PR on the shared file, not every PR that touched it", () => {
    const a = pr(1, "feat: a", 0, ["svc.ts"]);
    const b = pr(2, "feat: b", 1, ["svc.ts"]);
    const fix = pr(3, "fix: svc", 2, ["svc.ts"]);
    expect(escaped(a, [a, b, fix])).toBe(false);
    expect(escaped(b, [a, b, fix])).toBe(true);
  });

  it("still blames an earlier PR through a file no later PR touched", () => {
    const a = pr(1, "feat: a", 0, ["svc.ts", "only-a.ts"]);
    const b = pr(2, "feat: b", 1, ["svc.ts"]);
    const fix = pr(3, "fix: both", 2, ["svc.ts", "only-a.ts"]);
    expect(escaped(a, [a, b, fix])).toBe(true);
  });

  it("ignores test files and snapshots, and treats an ignore entry ending in / as a prefix", () => {
    const base = pr(1, "feat: a", 0, ["src/__tests__/a.ts", "src/a.test.ts", "x/__snapshots__/a.snap", "plugins/p/bin/p.mjs"]);
    const fix = pr(2, "fix: a", 1, base.files);
    expect(escaped(base, [base, fix], ["plugins/p/bin/"])).toBe(false);
    expect(escaped(base, [base, fix])).toBe(true);
  });
});

describe("escaped: bookkeeping", () => {
  it("ignores docs, VERSION, manifests and lockfiles, plus the repo's own list", () => {
    const ship = ["VERSION", "CHANGELOG.md", "docs/a.md", "package.json", "package-lock.json", "web/yarn.lock", "REPO_MAP.yml"];
    const base = pr(1, "feat: a", 0, [...ship, "src/a.ts"]);
    expect(escaped(base, [base, pr(2, "fix: b", 1, [...ship, "src/b.ts"])], ["REPO_MAP.yml"])).toBe(false);
    expect(escaped(base, [base, pr(2, "fix: b", 1, ["REPO_MAP.yml"])])).toBe(true);
    expect(escaped(base, [base, pr(2, "fix: a", 1, ["src/a.ts"])], ["REPO_MAP.yml"])).toBe(true);
  });
});

describe("loadConfig escape_ignore", () => {
  it("defaults to empty and refuses a non-list", () => {
    const f = join(tmp, "c.json");
    writeFileSync(f, JSON.stringify({ repos: [{ slug: "o/a", path: "/a" }] }));
    expect(loadConfig(f).repos[0]!.escape_ignore).toEqual([]);
    writeFileSync(f, JSON.stringify({ repos: [{ slug: "o/a", path: "/a", escape_ignore: "X" }] }));
    expect(() => loadConfig(f)).toThrow(/escape_ignore/);
  });
});
