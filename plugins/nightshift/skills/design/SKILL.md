---
name: design
description: Prerequisite-gated — refuses until the pack has a staging browser adapter + seeded personas. The nightshift design lane (ux-reviewer) — drives stale/changed flows through a staging browser against seeded personas, dedupes, logs anchored UX findings, and writes durable metrics. Use when someone says "/nightshift:design", "run the design review", "do the UX review", or wants one cadence-driven design review pass over a pack's .nightshift/ registry. Fails fast with a clear reason if the browser adapter or personas are missing.
allowed-tools: Read, Glob, Grep, Bash(git *), Write, Agent
model: sonnet
disable-model-invocation: true
---

# Nightshift Design — UX Review Run (Bounded Workflow)

Execute exactly **one** bounded design (UX) review run for `lane: design`. This is a thin
wrapper: it drives the design lane through the **shared mechanics** in
[../security/reference/run-loop.md](../security/reference/run-loop.md) — the same loop the security
lane uses. **Read the run-loop when you reach the loop; don't preload it.** This skill
only adds the design-lane **prerequisite gate** and the persona/browser specifics.

## Changed areas this run (pre-rendered)

Files touched in the working tree, injected at load so selection sees changed areas first:

```
!`git diff --name-only`
```

Intersect these paths with each flow's `area` globs to drive `change_flag` in step 1.

## Prerequisite gate (fail fast — no silent half-run)

Before doing **anything** else, verify the pack at `.nightshift/` satisfies BOTH:

1. `manifest.stack_adapter.browser.base_url` is set (a real staging browser adapter).
2. Seeded personas exist — `fixtures/personas.yml` (or the pack's configured fixtures)
   with at least one persona.

If **either** is absent, **STOP and refuse** with a clear, specific reason naming exactly
what is missing and how to fix it (run `/nightshift:onboard` and at Card 1 explicitly select the **Design** option — do **not** use the fast-path 'Accept all detected defaults', which seeds Security only). Do **not** start a
partial run, do not dispatch the reviewer, do not write metrics. The design lane is
default-off in v1; this gate is what keeps it honest rather than silently inert.

## The run (delegates to the shared loop)

Once the gate passes, run the six-step loop from [../security/reference/run-loop.md](../security/reference/run-loop.md) with `lane: design`. The loop is identical to the security lane with three design-specific deltas:

1. **Registry**: use `registries/flows.yml` (not `vectors.yml`). Selection uses `window_budget_k.design`.
2. **Reviewer**: dispatch `${CLAUDE_PLUGIN_ROOT}/agents/ux-reviewer.md`. The orchestrator injects `manifest.stack_adapter.browser` as the scoped tool grant at dispatch; drive each flow through the staging adapter against a seeded `fixtures/` persona.
3. **No refuter — anchor discipline instead**: the design lane has no two-stage refuter gate. The mandatory `anchor` field serves the same noise-control role: no `anchor`, no ticket.

## Severity gates (apply verbatim)

See **Step 6** of [../security/reference/run-loop.md](../security/reference/run-loop.md) for the single-source severity gate definitions. Apply them verbatim.

## Guardrails

- **No UX ticket without an `anchor`** (`friction_delta | broken_path | a11y | evidence |
  consistency`). Taste alone never files.
- **Stay within K**; never raise it to clear backlog.
- **Dedupe before you file, always.** Re-filing an open finding is the cardinal failure.
