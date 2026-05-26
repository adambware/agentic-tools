# Test Plan Explorer Plugin

Risk-prioritized test plan for untested or weakly-tested code — decides what is worth testing and why, and produces a reviewable plan before any test code is written. The plan is the deliverable; writing the actual tests is a separate downstream step.

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add adambware/agentic-tools

# Install this plugin
/plugin install test-plan-explorer@agentic-tools
```

## Usage

Invoke via the `/test-plan-explorer` skill, or ask "what should I test here", "plan tests for X", "this code is uncovered", or "write tests for this legacy code". Also triggers when a coverage report shows gaps and you want to decide where to spend effort.

## How It Works

Six phases in order:

1. **Scope & Mode** — establishes boundaries and tags each target as characterization (lock down current behavior) or specification (test against intended behavior).
2. **Risk Triage** — ranks every target by blast radius × fragility; produces a P0/P1/P2/Won't-cover table with mandatory rationale for skipped targets. **Pauses here for user confirmation before proceeding.**
3. **Seam Survey** — for each P0/P1 target, determines how a test gets in (as-is, after minimal refactor, or not safely reachable).
4. **Case Enumeration** — derives concrete test cases systematically using equivalence partitioning, boundary analysis, branch enumeration, and error-path enumeration.
5. **Plan Assembly** — writes `TEST_PLAN.md` with every planned test named by scenario+outcome, layer, single assertion, mode tag, and fixture needs.
6. **Rubric Pass** — reviews the assembled plan against the quality rubric; revises rather than just noting problems.

## Output

A `TEST_PLAN.md` written to the working directory with six sections: Scope & Mode, Risk Triage, Seam Survey, Planned Tests, Testability Recommendations, and Open Questions.

## Structure

```
test-plan-explorer/
├── .claude-plugin/plugin.json
├── skills/test-plan-explorer/
│   ├── SKILL.md
│   └── reference/
│       ├── grading-rubric.md          # Test quality rubric — used in Phase 6
│       ├── test-design-techniques.md  # Case-derivation techniques — used in Phase 4
│       └── language-tooling.md        # Seam patterns per language — used in Phase 3
└── README.md
```

> Note: `grading-rubric.md`, `test-design-techniques.md`, and `language-tooling.md` are kept in sync with the `pr-test-reviewer` plugin.
