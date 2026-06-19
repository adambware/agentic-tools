const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../../../..");

test("stage-skill copies the canonical onboardme skill into each fixture repo", () => {
  execFileSync("bash", ["evals/onboardme/scripts/stage-skill.sh"], {
    cwd: root,
    stdio: "pipe",
  });

  for (const caseName of ["http-simple", "stale-doc-clear", "ambiguous-owner"]) {
    const stagedRoot = path.join(root, "evals/onboardme/fixtures/repos", caseName, ".claude/skills/onboardme");
    assert.ok(fs.existsSync(path.join(stagedRoot, "SKILL.md")), `${caseName} SKILL.md staged`);
    assert.ok(fs.existsSync(path.join(stagedRoot, "reference/tracing.md")), `${caseName} tracing reference staged`);
    assert.ok(fs.existsSync(path.join(stagedRoot, "reference/output-template.md")), `${caseName} output template staged`);
  }
});
