---
name: test-plan-explorer
description: Explore a region of under-tested or uncovered code and produce a risk-prioritized, reviewable test plan before any test code is written. Use this skill whenever the user wants to add test coverage, asks "what should I test here", points at a file/module/package with no or weak tests, says "this code is uncovered", "plan tests for X", "write tests for this legacy code", or is about to TDD against existing untested code. Also trigger when a coverage report shows gaps and the user wants to decide where to spend effort. Do NOT use this to grade tests inside a pull request — that is the pr-test-reviewer skill. This skill plans; it does not write the final test code (though it may write characterization probes to learn behavior).
---

# Test Plan Explorer

## Intent

Turn a region of untested or weakly-tested code into a **risk-prioritized test plan** that a human can review and approve before test code is written. The plan is the deliverable. Writing the actual tests is a separate, downstream step.

**Core mission**: Decide *what is worth testing and why*, *what each test asserts*, and *what minimal change (if any) makes the code testable* — without trying to test everything.

The single most common failure mode this skill prevents: mechanically chasing a coverage number by writing assertion-free or implementation-coupled tests across an entire file. Coverage is a diagnostic, not a target (Goodhart's law). A test plan that says "these 6 behaviors matter, these 4 do not, here is why" is worth more than 100% line coverage.

## Guiding principles

These shape every phase. Internalize them before starting.

1. **Test behavior, not implementation.** The unit under test is a *unit of behavior* reachable through a public contract, not a class or a private method. A plan that targets internal structure produces tests that break on every refactor. Plan tests at the seam a real consumer uses.
2. **Characterize before you specify.** For untested code you often do not know what it is *supposed* to do — only what it *does*. Be explicit, per target, about which one you are doing. (See Phase 1.)
3. **Triage, never carpet-bomb.** You will not test all uncovered code and should not try. Rank by risk and say out loud what you are choosing *not* to cover.
4. **One test, one reason to fail.** Each planned test asserts a single outcome at a single layer. If a test would fail for two unrelated reasons, it is two tests.
5. **Hard-to-test is a design signal.** If a target needs ten mocks to reach, the finding is "this unit has ten responsibilities," not "write ten mocks." Surface it.
6. **Determinism is non-negotiable.** A flaky test is worse than no test — it trains the team to ignore red. Any plan item with a time, ordering, network, or randomness dependency must name how it will be controlled.

## Inputs

1. **Target region** — a file, module, package, or directory. If the user is vague ("add some tests"), ask them to name a region; a whole repo is not a valid scope for one plan.
2. **Mode hint** (optional) — does the user want to *lock down current behavior* (characterization) or *test against intended behavior* (specification)? If unknown, Phase 1 decides per-target.
3. **Coverage data** (optional) — an existing coverage report narrows the region fast. If absent, do not block; infer from reading the code and the test directory.
4. **Stack** — language(s) and test framework. Drives seam techniques and tooling. See `reference/language-tooling.md`.
5. **Human availability** for ≤7 clarifying questions.

## Outputs

A single `TEST_PLAN.md` written to the working directory, following the template at the end of this file. It contains:

1. **Scope & Mode** — what is in/out of scope, and the characterize-vs-specify decision per target.
2. **Risk Triage Table** — every target ranked, including an explicit *won't-cover* list with rationale.
3. **Seam Survey** — for each prioritized target, how a test reaches it, and any minimal refactor required first.
4. **Planned Tests** — the core deliverable: each test named by scenario+outcome, with layer, the single outcome it asserts, mode tag, and fixture needs.
5. **Testability Recommendations** — design changes that would materially improve testability, separated into "do first" vs "nice to have."
6. **Open Questions** — anything that blocks turning the plan into code.

---

## Workflow

The agent adopts five roles in sequence. Do not skip ahead — each phase feeds the next.

### Phase 1 — Scope & Mode (the Surveyor)

Read the target region and its existing tests. Establish boundaries and, for each meaningful target (a function, a behavior cluster, a class with a real contract), decide the **mode**:

- **Characterization** — the code's intended behavior is unknown or undocumented. The test will assert *what the code does today*, so the region can be refactored safely. Characterization tests are not correctness claims; label them so no one mistakes a pinned bug for a spec.
- **Specification** — the intended behavior is known (from a ticket, a domain expert, an obvious contract). The test asserts *what the code should do*; a failure is a real bug.

Mixing these silently is a classic mistake — a characterization test that pins a bug looks identical to a spec test that's broken. Tag every target.

To learn behavior in characterization mode, it is allowed (and encouraged) to write small throwaway **probes** — call the code with sample inputs, observe outputs, and record them. Probes inform the plan; they are not the final tests.

**Stop-the-line if:** the region is too large to triage meaningfully (e.g., a 30-file package) — ask the user to narrow it, or propose a sub-region to start with. Do not produce a shallow plan over a huge scope.

### Phase 2 — Risk Triage (the Prioritizer)

Rank every target. The goal is a defensible ordering, not a complete one.

Score each target on two axes:

- **Blast radius** — how bad is a silent failure here? Money, data integrity, security, and auth changes are high; a display formatter is low. Apply the **Beyoncé rule**: *if you'd be upset when it breaks silently, it needs a test.*
- **Fragility** — how likely is it to break? Proxy this with **complexity × change-frequency** (Tornhill's behavioral code analysis). High cyclomatic complexity in a file that changes every sprint is where bugs are born; gnarly code nobody touches is low priority. Use `git log` on the file to gauge churn if no other signal exists.

Produce the **Risk Triage Table** with a tier per target: **P0 / P1 / P2 / Won't-cover**. The *won't-cover* list is mandatory and must have rationale — trivial getters, generated code, thin delegators, and dead code belong here. Stating what you skip is what makes the plan honest.

### Phase 3 — Seam Survey (the Locksmith)

For each P0/P1 target, determine how a test gets *in*. A **seam** is a place where behavior can be substituted without editing the code at that point — a constructor parameter, an interface, an injectable clock, a function argument.

For each target, record one of:

- **Reachable as-is** — there is already a clean seam (public function, injected dependency). Note it.
- **Reachable after a minimal refactor** — name the *smallest* change that creates a seam: extract a parameter, introduce an interface, inject a clock instead of calling `now()` inline. Smallest, not best — large refactors before tests exist are unsafe (no net).
- **Not safely reachable** — flag it. This is design feedback, and it routes into Testability Recommendations (Phase 5).

Prefer **fakes** (in-memory implementations you can assert state against) over **mocks** (which assert interactions and couple the test to *how* the code calls collaborators). Plan mocks only for true boundaries you don't own — third-party APIs, the system clock, the network.

See `reference/language-tooling.md` for seam techniques per language.

### Phase 4 — Case Enumeration (the Adversary)

For each P0/P1 target, derive concrete test cases. Do not improvise — apply technique systematically. See `reference/test-design-techniques.md` for the full catalog. The core four:

- **Equivalence partitioning** — group inputs into classes that should behave alike; one case per class.
- **Boundary-value analysis** — for every boundary, test at it, just below, just above. Off-by-one bugs live here. This is usually the highest-yield technique.
- **Branch enumeration** — every decision point needs a case for each outcome, including the implicit `else`.
- **Property-based candidates** — if the target has a stateable invariant (round-trips, idempotence, ordering, conservation), flag it for property-based testing rather than enumerating examples by hand.

Also enumerate the **unhappy paths**: nulls/empties, error returns, exceptions, and — for any past bug in this code — a regression case (every bug fix ships with the test that would have caught it).

### Phase 5 — Plan Assembly (the Author)

Write `TEST_PLAN.md` using the template below. For every planned test, specify:

- **Name** — states *scenario + expected outcome* in plain language, not a method name. `returns_zero_discount_when_cart_is_empty`, not `testCalculateDiscount`.
- **Layer** — unit / integration / e2e. Each layer answers a different question: unit = "is this logic correct," integration = "do these pieces agree," e2e = "does the critical path work at all." Push toward the lowest layer that gives real confidence; reserve e2e for a few critical paths only — they are slow, flaky, and bad at localizing failure. Do not plan the same behavior at three layers.
- **Asserts** — the *single* outcome. If you write "and," split it.
- **Mode** — characterization or specification (from Phase 1).
- **Fixtures / control** — what setup is needed, and how non-determinism is controlled (injected clock, seeded RNG, fixed fixture).

Then write the **Testability Recommendations**, split into:
- **Do first** — changes required before the P0 tests can be written at all (the minimal seams from Phase 3).
- **Nice to have** — design improvements that would make the suite cleaner but aren't blocking.

### Phase 6 — Rubric Pass (the Critic)

Before finalizing, review the assembled plan against the quality rubric in `reference/grading-rubric.md`. Every planned test should plausibly satisfy all properties once written. Flag any test that can't — usually it means the target needs a Phase 3 refactor, or the test is doing too much and should be split. Revise the plan, don't just note the problem.

---

## TEST_PLAN.md template

ALWAYS use this exact structure:

```markdown
# Test Plan: <region>

## 1. Scope & Mode
- In scope: <files/modules>
- Out of scope: <what and why>
- Mode summary: <N targets to characterize, M to specify>

## 2. Risk Triage
| Target | Blast radius | Fragility (cx×churn) | Tier | Mode | Notes |
|--------|-------------|----------------------|------|------|-------|
| ...    | High/Med/Low| High/Med/Low         | P0/P1/P2 | char/spec | ... |

### Won't-cover (deliberate)
- <target> — <reason>

## 3. Seam Survey
For each P0/P1 target:
- **<target>** — Reachable: as-is / after-refactor / not-safely.
  Seam: <description>. Refactor needed: <smallest change, or "none">.

## 4. Planned Tests
For each P0/P1 target, a subsection:

### <target>
| Test name (scenario → outcome) | Layer | Asserts (single outcome) | Mode | Fixtures / control |
|--------------------------------|-------|--------------------------|------|--------------------|
| ...                            | unit  | ...                      | spec | ... |

## 5. Testability Recommendations
### Do first (blocks P0 tests)
- <change> — enables <which tests>
### Nice to have
- <change> — <benefit>

## 6. Open Questions
- <question that blocks converting plan → code>
```

## Reference files

- `reference/test-design-techniques.md` — full catalog of case-derivation techniques (partitioning, boundary analysis, decision tables, state-transition testing, property-based testing). Read in Phase 4.
- `reference/language-tooling.md` — seam-creation patterns and test/coverage/mutation tooling per language (Go, TypeScript/Vue, PHP/Laravel, Python). Read in Phase 3.
- `reference/grading-rubric.md` — the test quality rubric. Read in Phase 6.

## A note on scope discipline

If at any point the plan is ballooning past ~15-20 planned tests for a region, that is a signal — either the region is too big (return to Phase 1 and narrow), or the triage was too generous (return to Phase 2 and be harsher about P2/Won't-cover). A reviewable plan beats an exhaustive one.
