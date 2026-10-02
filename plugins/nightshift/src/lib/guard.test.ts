import { describe, it, expect } from "vitest";
import { guardDecision, isGuardActive, LANE_RUN_ENV } from "./guard.js";
import type { GuardInput } from "./guard.js";

function inp(
  tool_name: string,
  tool_input: Record<string, unknown> = {},
  cwd?: string,
): GuardInput {
  return { tool_name, tool_input, cwd };
}

// ---------------------------------------------------------------------------
// Read-only tools
// ---------------------------------------------------------------------------
describe("read-only tools", () => {
  it("Read → allow", () => {
    const d = guardDecision(inp("Read", { file_path: "app/models/user.rb" }));
    expect(d.allow).toBe(true);
  });

  it("Grep → allow", () => {
    expect(guardDecision(inp("Grep", { pattern: "foo" })).allow).toBe(true);
  });

  it("Glob → allow", () => {
    expect(guardDecision(inp("Glob", { pattern: "**/*.ts" })).allow).toBe(true);
  });

  it("LS → allow", () => {
    expect(guardDecision(inp("LS", {})).allow).toBe(true);
  });

  it("WebFetch → allow", () => {
    expect(guardDecision(inp("WebFetch", { url: "https://example.com" })).allow).toBe(true);
  });

  it("Task → allow", () => {
    expect(guardDecision(inp("Task", {})).allow).toBe(true);
  });

  it("TodoWrite → allow", () => {
    expect(guardDecision(inp("TodoWrite", {})).allow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Write tool
// ---------------------------------------------------------------------------
describe("Write tool", () => {
  it("Write to app/models/user.rb → DENY", () => {
    const d = guardDecision(inp("Write", { file_path: "app/models/user.rb" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("app/models/user.rb");
  });

  it("Write to .nightshift/metrics/runs/2026-06.jsonl → ALLOW", () => {
    const d = guardDecision(inp("Write", { file_path: ".nightshift/metrics/runs/2026-06.jsonl" }));
    expect(d.allow).toBe(true);
  });

  it("Write to repo/.nightshift/findings/x.jsonl (nested) → ALLOW", () => {
    const d = guardDecision(inp("Write", { file_path: "repo/.nightshift/findings/x.jsonl" }));
    expect(d.allow).toBe(true);
  });

  it("Write with no file_path → DENY", () => {
    const d = guardDecision(inp("Write", {}));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("no file_path");
  });
});

// ---------------------------------------------------------------------------
// Edit tool
// ---------------------------------------------------------------------------
describe("Edit tool", () => {
  it("Edit outside .nightshift/ → DENY", () => {
    const d = guardDecision(inp("Edit", { file_path: "src/lib/something.ts" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("src/lib/something.ts");
  });

  it("Edit inside .nightshift/ → ALLOW", () => {
    const d = guardDecision(inp("Edit", { file_path: ".nightshift/registry.yml" }));
    expect(d.allow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bash — git read-only
// ---------------------------------------------------------------------------
describe("Bash — git read-only", () => {
  it("git diff --name-only → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git diff --name-only" }));
    expect(d.allow).toBe(true);
  });

  it("git status → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git status" }));
    expect(d.allow).toBe(true);
  });

  it("git rev-list -1 HEAD → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git rev-list -1 HEAD" }));
    expect(d.allow).toBe(true);
  });

  it("git log --oneline -10 → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git log --oneline -10" }));
    expect(d.allow).toBe(true);
  });

  it("git show HEAD:file.ts → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git show HEAD:file.ts" }));
    expect(d.allow).toBe(true);
  });

  it("git rev-parse HEAD → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git rev-parse HEAD" }));
    expect(d.allow).toBe(true);
  });

  it("git ls-files → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git ls-files" }));
    expect(d.allow).toBe(true);
  });

  it("git blame README.md → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git blame README.md" }));
    expect(d.allow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bash — git mutating (DENY)
// ---------------------------------------------------------------------------
describe("Bash — git mutating", () => {
  it("git commit -m x → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git commit -m x" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("commit");
  });

  it("git push → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git push" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("push");
  });

  it("git add . → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git add ." }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("add");
  });

  it("git checkout main → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git checkout main" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("checkout");
  });

  it("git reset --hard → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git reset --hard" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("reset");
  });

  it("git merge feature → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git merge feature" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("merge");
  });

  it("git rebase main → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git rebase main" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("rebase");
  });

  it("git stash → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git stash" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("stash");
  });

  it("git rm file.rb → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git rm file.rb" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("rm");
  });

  it("git restore . → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git restore ." }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("restore");
  });

  it("git branch -D old-branch → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git branch -D old-branch" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("branch");
  });

  it("git branch -d old-branch → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git branch -d old-branch" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("branch");
  });

  it("git branch -m old new → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git branch -m old new" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("branch");
  });

  it("git cherry-pick abc123 → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git cherry-pick abc123" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("cherry-pick");
  });

  it("git clean -fd → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git clean -fd" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("clean");
  });
});

// ---------------------------------------------------------------------------
// Bash — shell write primitives
// ---------------------------------------------------------------------------
describe("Bash — shell write primitives", () => {
  it("echo hi > app/x.rb → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "echo hi > app/x.rb" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("app/x.rb");
  });

  it("echo hi > .nightshift/x → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "echo hi > .nightshift/x" }));
    expect(d.allow).toBe(true);
  });

  it("sed -i s/a/b/ app/x.rb → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "sed -i s/a/b/ app/x.rb" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("app/x.rb");
  });

  it("rm app/x.rb → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "rm app/x.rb" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("app/x.rb");
  });

  it("mv app/x.rb app/y.rb → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "mv app/x.rb app/y.rb" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("app/x.rb");
  });
});

// ---------------------------------------------------------------------------
// Bash — pure read commands
// ---------------------------------------------------------------------------
describe("Bash — pure read commands", () => {
  it("node bin/select.mjs --out .nightshift/x.json → ALLOW", () => {
    const d = guardDecision(
      inp("Bash", { command: "node bin/select.mjs --out .nightshift/x.json" }),
    );
    expect(d.allow).toBe(true);
  });

  it("ls -la → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "ls -la" }));
    expect(d.allow).toBe(true);
  });

  it("cat README.md → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "cat README.md" }));
    expect(d.allow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bash — chained commands
// ---------------------------------------------------------------------------
describe("Bash — chained commands", () => {
  it("git diff && git push → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "git diff && git push" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("push");
  });

  it("git status && git log → ALLOW", () => {
    const d = guardDecision(inp("Bash", { command: "git status && git log" }));
    expect(d.allow).toBe(true);
  });

  it("ls; git commit -m msg → DENY", () => {
    const d = guardDecision(inp("Bash", { command: "ls; git commit -m msg" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("commit");
  });
});

// ---------------------------------------------------------------------------
// Unknown tool
// ---------------------------------------------------------------------------
describe("unknown tool", () => {
  it("SomeUnknownTool → allow (fail-open)", () => {
    const d = guardDecision(inp("SomeUnknownTool", {}));
    expect(d.allow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MultiEdit / NotebookEdit
// ---------------------------------------------------------------------------
describe("MultiEdit / NotebookEdit", () => {
  it("MultiEdit outside .nightshift/ → DENY", () => {
    const d = guardDecision(inp("MultiEdit", { file_path: "src/index.ts" }));
    expect(d.allow).toBe(false);
  });

  it("MultiEdit inside .nightshift/ → ALLOW", () => {
    const d = guardDecision(inp("MultiEdit", { file_path: ".nightshift/state.json" }));
    expect(d.allow).toBe(true);
  });

  it("NotebookEdit with notebook_path outside .nightshift/ → DENY", () => {
    const d = guardDecision(inp("NotebookEdit", { notebook_path: "notebooks/analysis.ipynb" }));
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("notebooks/analysis.ipynb");
  });

  it("NotebookEdit with notebook_path inside .nightshift/ → ALLOW", () => {
    const d = guardDecision(inp("NotebookEdit", { notebook_path: ".nightshift/nb.ipynb" }));
    expect(d.allow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Custom packDir
// ---------------------------------------------------------------------------
describe("custom packDir", () => {
  it("Write to .review/x.json ALLOW when packDir=.review", () => {
    const d = guardDecision(inp("Write", { file_path: ".review/x.json" }), ".review");
    expect(d.allow).toBe(true);
  });

  it("Write to .nightshift/x.json DENY when packDir=.review", () => {
    const d = guardDecision(inp("Write", { file_path: ".nightshift/x.json" }), ".review");
    expect(d.allow).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isGuardActive — env gate (guard inert outside a lane run)
// ---------------------------------------------------------------------------
describe("isGuardActive", () => {
  it("env absent → inert (false)", () => {
    expect(isGuardActive({})).toBe(false);
  });

  it('"1" → active', () => {
    expect(isGuardActive({ [LANE_RUN_ENV]: "1" })).toBe(true);
  });

  it("any non-empty value → active", () => {
    expect(isGuardActive({ [LANE_RUN_ENV]: "wf_abc123" })).toBe(true);
  });

  it('empty string → inert', () => {
    expect(isGuardActive({ [LANE_RUN_ENV]: "" })).toBe(false);
  });

  it('"0" and "false" → inert (explicit off)', () => {
    expect(isGuardActive({ [LANE_RUN_ENV]: "0" })).toBe(false);
    expect(isGuardActive({ [LANE_RUN_ENV]: "false" })).toBe(false);
    expect(isGuardActive({ [LANE_RUN_ENV]: " FALSE " })).toBe(false);
  });
});
