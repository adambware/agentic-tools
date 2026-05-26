# PR Test Reviewer Plugin

Test-focused PR review — grades the tests present, flags testability changes worth making, and suggests the highest-value missing tests for the touched code. Answers three questions scoped to the diff: are the tests here good, is anything hard to test in a way worth fixing now, and what few additional tests would most reduce risk?

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add adambware/agentic-tools

# Install this plugin
/plugin install pr-test-reviewer@agentic-tools
```

## Usage

Invoke via the `/pr-test-reviewer` skill, or ask "are the tests on this PR any good", "did I test this enough", "what tests am I missing", or "review my diff for test coverage".

## How It Works

Five phases in order:

1. **Establish Scope & Classify** — classifies every changed unit by change type (new behavior, behavior change, bug fix, pure refactor, non-behavioral) and sets the testing bar accordingly.
2. **Map Tests to Changes** — locates tests covering each changed unit, identifies untested changed behavior, and audits deleted tests.
3. **Grade the Tests Present** — applies the rubric to tests added or modified in the PR, assigning Blocker / Concern / Nit severity to each finding.
4. **Testability Assessment** — inspects changed code for design-level testability problems; only surfaces fixes genuinely worth making before merge.
5. **High-Value Missing Tests** — derives ranked, specific test suggestions from untested behavior; capped and filtered by the Beyoncé rule.

## Output

A single review report (markdown) with: Verdict, Change Inventory, Graded Findings, Testability Recommendations, High-Value Missing Tests, and Out of Scope notes.

## Structure

```
pr-test-reviewer/
├── .claude-plugin/plugin.json
├── skills/pr-test-reviewer/
│   ├── SKILL.md
│   └── reference/
│       ├── grading-rubric.md          # Test quality rubric — used in Phase 3
│       ├── test-design-techniques.md  # Case-derivation techniques — used in Phase 5
│       └── language-tooling.md        # Seam patterns per language — used in Phase 4
└── README.md
```

> Note: `grading-rubric.md`, `test-design-techniques.md`, and `language-tooling.md` are kept in sync with the `test-plan-explorer` plugin.
