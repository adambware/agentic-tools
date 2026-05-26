---
name: pr-test-reviewer
description: Review the testing of a pull request — grade the tests that are present, flag testability changes that are strongly worth making, and suggest the highest-value tests still missing for the touched code. Use this skill whenever the user asks to review a PR's tests, says "are the tests on this PR any good", "did I test this enough", "what tests am I missing here", "review my diff for test coverage", asks for a test-focused code review, or pastes/points at a diff or branch and wants the testing assessed. Scope is strictly the PR's changed code plus tests directly exercising it — not the whole repository. Do NOT use this to plan tests for untested legacy code from scratch — that is the test-plan-explorer skill. This skill produces a review report; it does not write the tests.
---

# PR Test Reviewer

## Intent

Given the scope of a pull request, produce a **test-focused review**: grade the tests that exist, name the testability changes worth making, and suggest the missing tests that would add the most value — ranked, not exhaustive.

**Core mission**: Answer three questions for the reviewer, scoped to *this diff only*:
1. Are the tests that are here **good**?
2. Is anything in the changed code **hard to test in a way that should be fixed now**?
3. What **few additional tests** would most reduce risk?

This is a review, not a rewrite. The output is a report a human reads alongside the diff. It does not write test code.

## Guiding principles

1. **Match expectations to change type.** New behavior must be tested. A behavior change must have its tests updated to match. A pure refactor should *not* need new tests — but it does need existing tests around it to be the kind that survive a refactor. Judge each changed file by what its change type actually demands.
2. **Grade behavior-coverage, not line-coverage.** A diff can be 100% line-covered and untested in any meaningful sense. Ask whether a planted bug in the new code would be caught.
3. **Be proportionate and ranked.** Do not list every conceivable missing test. Surface the few highest-value gaps and say so. A 40-item wishlist gets ignored; three sharp suggestions get acted on.
4. **Testability findings are design feedback.** "This needed eight mocks to test" is a finding about the code's responsibilities, not a complaint about the test. Frame it that way, and only escalate the ones genuinely worth fixing before merge.
5. **Severity must be honest.** Distinguish what should block merge from what is a nit. Over-flagging trains the author to ignore the review.
6. **Stay in scope.** Review the diff and the tests that exercise the diff. Pre-existing debt outside the PR is out of scope — note it in one line at most, do not audit it.

## Inputs

1. **The PR** — accept any of: a unified diff, a branch name to diff against base, a PR number/URL (use `gh` if available), or an explicit list of changed files. If none is obvious, ask.
2. **Base ref** — what to diff against (defaults to the repo's main branch).
3. **Stack** — language(s) and test framework; inferred from the repo if not given. See `reference/language-tooling.md`.
4. **Intent of the PR** — if a description/ticket exists, read it: it reveals whether a change is meant as new behavior, a fix, or a refactor, which the diff alone can be ambiguous about.

## Outputs

A single review report (markdown, structured like a thorough PR review comment), following the template at the end of this file:

1. **Verdict** — one of the four verdicts below, with a one-line justification:

| Verdict | Trigger |
|---------|---------|
| Tests look solid | No Blockers, ≤1 trivial Nit |
| Approve with minor suggestions | No Blockers; Concerns the author can address post-merge |
| Approve with test work needed | No Blockers; material Concerns that should be addressed before merge |
| Testing needs work before merge | Any Blocker present |
2. **Change Inventory** — each changed unit, classified by change type, with its test status.
3. **Graded Findings** — assessment of the tests present, each with a severity (Blocker / Concern / Nit).
4. **Testability Recommendations** — strongly-suggested design changes for testability, with rationale.
5. **High-Value Missing Tests** — ranked suggestions for the touched code, each with what it would catch.
6. **Out of Scope (noted, not actioned)** — at most a couple of lines on pre-existing issues spotted in passing.

---

## Workflow

Five phases, in order.

### Phase 1 — Establish Scope & Classify (the Cartographer)

Obtain the diff. For every changed unit (function, method, class, component), classify the **change type** — this sets the bar for everything after:

- **New behavior** — new code path a consumer can observe. *Must* have tests in the PR.
- **Behavior change** — existing behavior altered. Existing tests *must* be updated to match the new behavior; an unchanged test passing against changed behavior is suspicious (either the behavior wasn't really tested, or the test is too loose).
- **Bug fix** — a defect corrected. *Must* ship with a regression test that fails on the old code and passes on the new.
- **Pure refactor** — structure changed, behavior identical. Needs *no new tests*, but the surrounding tests should be behavior-level (so they stayed green for the right reason). If they had to change, the change is itself a finding — the tests were implementation-coupled.
- **Non-behavioral** — config, docs, formatting, dependency bumps. No test expectation; skip.

Also note **deleted tests** — a removed test needs a reason. Removing a test to make a diff green is a Blocker-class finding unless the behavior it covered is genuinely gone.

Cross-check each classification against the PR description and linked ticket. A change labeled "refactor" in the description that introduces observable new behavior is itself a finding — the intent claimed and the diff diverge.

**Stop-the-line if:** the diff exceeds ~500 changed lines (excluding generated/vendor files), touches more than ~15 distinct files with mixed change types (e.g. refactor + new feature + unrelated fixes), or has 10+ changed units with unclear intent. State this as the top finding — a tangled PR is itself the problem; it cannot be cleanly reviewed for testing.

### Phase 2 — Map Tests to Changes (the Auditor)

For each changed unit, locate the tests that exercise it — both tests added in the PR and pre-existing tests that cover it. Build the mapping:

- Changed unit → has new/updated tests in the PR? → has pre-existing coverage?
- Identify **untested changed behavior**: new or changed behavior with no test reaching it. These feed Phase 5.
- For bug fixes, confirm a regression test exists and would actually have failed before the fix.
- Sanity-check: would a plausible bug in this changed code be caught by the tests as written? If you can imagine an easy mutation that stays green, the behavior is effectively untested even if the line is "covered."

**Deleted-test audit:** list every test file and test function removed in the PR. Each requires one of: (a) the behavior it covered is provably gone from the diff, (b) a replacement test in the PR covers the same scenario, or (c) an explicit Blocker finding in Phase 3. There is no fourth option.

### Phase 3 — Grade the Tests Present (the Critic)

Before grading: infer the primary language from the diff's file extensions and imports. Then read only the matching language section of `reference/language-tooling.md` — skip all other sections. If the stack mixes two languages, read those two sections only.

Apply the rubric in `reference/grading-rubric.md` to the tests added or modified in the PR. For each finding, assign a **severity**:

- **Blocker** — should be fixed before merge. Examples: new behavior with no test; a bug fix with no regression test; an assertion-free test; a test that passes regardless of the behavior (tautological); a test deleted to hide a failure; non-determinism that will cause flakes.
- **Concern** — should probably be addressed, author's call with reviewer push-back. Examples: implementation-coupled / mock-heavy tests of the author's own code; multiple unrelated assertions in one test; logic in a test; a snapshot standing in for real assertions; tests at the wrong layer (slow e2e for what a unit test would prove).
- **Nit** — worth mentioning, non-blocking. Examples: a test name that states a method instead of a behavior; DRY-over-DAMP fixtures that hurt readability; minor naming/structure.

Be concrete: cite the test by name and say what's wrong and what better looks like. Vague findings ("improve test quality") are not actionable.

Also note what is **done well** — a review that only lists faults is less useful and less likely to be heeded.

### Phase 4 — Testability Assessment (the Designer)

Before grading: infer the primary language from the diff's file extensions and imports. Then read only the matching language section of `reference/language-tooling.md` — skip all other sections. If the stack mixes two languages, read those two sections only.

Inspect the *changed code* for testability problems. Hard-to-test code is a design signal — surface the cause, not just the symptom. But be selective: only raise changes that are **genuinely worth making now**, i.e. they would materially improve the suite or unblock a Blocker/Concern from Phase 3. Common ones:

- A new function reaches a hard dependency directly (clock, network, global) with no seam → suggest the minimal seam (inject the dependency). See `reference/language-tooling.md`.
- A unit needs many mocks to test → it likely has too many responsibilities; suggest the extraction.
- Logic newly buried inside a controller / UI component / framework class → suggest extracting it to a plain testable function.
- A new public surface that is awkward to call in isolation → the contract may be wrong.

For each: state the problem, the design cause, and the *smallest* change that fixes it. Do not propose large refactors as merge-blockers — note big ones as follow-ups.

Raise at most 3 testability findings per review. If more exist, choose the ones that directly unblock Blocker or Concern findings from Phase 3. The remainder belong in a tech-debt ticket, not a PR review.

### Phase 5 — High-Value Missing Tests (the Adversary)

From the untested changed behavior found in Phase 2, derive specific suggested tests — but **rank and cap**. Use the techniques in `reference/test-design-techniques.md` (boundary analysis and error-path enumeration are usually the highest-yield). For each suggested test, give:

- **Name** — scenario → expected outcome.
- **Layer** — unit / integration / e2e (prefer the lowest that gives real confidence).
- **What it catches** — the concrete bug or regression it would prevent. If you can't name what it catches, don't suggest it.
- **Priority** — P0 (a real risk in this diff) / P1 (worth adding) / P2 (optional).

Apply the **Beyoncé rule** as the filter: suggest a test only if a silent break of that behavior would genuinely matter. Lead with P0s; keep the whole list short enough to act on (a handful, not dozens). If the honest answer is "the tests here are sufficient," say that — do not invent gaps.

---

## Review report template

ALWAYS use this exact structure:

```markdown
# Test Review: <PR title / branch>

## Verdict
**<Tests look solid | Approve with minor suggestions | Approve with test work needed | Testing needs work before merge>**
<one-line justification>

## Change Inventory
| Changed unit | Change type | Tests in PR? | Pre-existing coverage? |
|--------------|-------------|--------------|------------------------|
| ...          | new / change / fix / refactor / non-behavioral | yes/no | yes/no/partial |

## Graded Findings
### What's done well
- <specific positive>

### Blockers
- **<test/file>** — <problem> → <what better looks like>

### Concerns
- **<test/file>** — <problem> → <suggestion>

### Nits
- <test/file> — <minor point>

## Testability Recommendations
- **<changed code>** — Problem: <symptom>. Cause: <design issue>. Smallest fix: <minimal change>.

## High-Value Missing Tests
| Priority | Test name (scenario → outcome) | Layer | What it catches |
|----------|--------------------------------|-------|-----------------|
| P0       | ...                            | unit  | ... |

## Out of Scope (noted, not actioned)
- <≤2 lines on pre-existing issues, if any>
```

## Reference files

- `reference/grading-rubric.md` — the test quality rubric and severity-relevant anti-patterns. Core to Phase 3.
- `reference/test-design-techniques.md` — case-derivation techniques. Used in Phase 5 to make missing-test suggestions concrete.
- `reference/language-tooling.md` — seam patterns and tooling per language. Used in Phase 4 to make testability fixes concrete.

## Calibration notes

- A clean PR with good tests should get a short report and a *Tests look solid* verdict. Do not manufacture findings to look thorough — proportionality is the point.
- The verdict should follow the findings: any Blocker → *Testing needs work before merge*; Concerns only → verdict depends on severity: minor Concerns → *Approve with minor suggestions*; material Concerns → *Approve with test work needed*; neither → *Tests look solid*.
- If the PR is a pure refactor with green behavior-level tests, that is a *good* outcome — do not flag "no new tests."
