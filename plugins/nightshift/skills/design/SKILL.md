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
[../qa/reference/run-loop.md](../qa/reference/run-loop.md) — the same loop the security
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
what is missing and how to fix it (run `/nightshift:onboard` and select the Design lane to
seed `personas.yml` + capture `stack_adapter.browser.base_url`). Do **not** start a
partial run, do not dispatch the reviewer, do not write metrics. The design lane is
default-off in v1; this gate is what keeps it honest rather than silently inert.

## The run (delegates to the shared loop)

Once the gate passes, run the standard six-step loop from
[../qa/reference/run-loop.md](../qa/reference/run-loop.md) with `lane: design`:

1. **Compute staleness + `change_flag`** over `registries/flows.yml`, intersecting `area`
   globs with the changed files above.
2. **Select top-K** by `score = max(staleness, change_flag) * weight`, where
   `K = manifest.window_budget_k.design`. Never raise K to clear backlog; overdue surplus
   routes to the digest/trend. Parallelize 3–5 at a time inside K.
3. **Fan out the ux-reviewer** — dispatch `${CLAUDE_PLUGIN_ROOT}/agents/ux-reviewer.md`
   per selected flow, scoped to its `area`. The orchestrator injects
   `manifest.stack_adapter.browser` as the scoped tool grant at dispatch (the agent itself
   grants only `Read, Grep, Glob`). Drive each flow through the staging browser adapter
   against a seeded `fixtures/` persona; record steps-to-complete, backtracks, dead-ends,
   errors, >2s waits; run an a11y check; screenshot key states.
4. **Dedupe + suppress** on `dedupe_key` against open findings.
5. **Log + update state + write durable metrics** — append the per-run record, the
   confirmed findings (with `first_seen`/`last_seen`/`run_id`), and the recomputed daily
   rollup, exactly as run-loop.md step 5 specifies.
6. **Apply severity gates** (below).

The design lane has **no refuter** — that two-stage gate is security-only. The UX
discipline here is the mandatory `anchor` instead.

## Severity gates (noise control) — apply verbatim

- **critical / high** → file a Linear issue immediately.
- **medium** → file an issue **only if** reproducible, recurring, or customer-facing.
- **low** → write to the findings log; batch into the weekly digest **unless** repeated.
- **taste / opinion** → **never** an issue unless tied to a measured `anchor`.

## Guardrails

- **No UX ticket without an `anchor`** (`friction_delta | broken_path | a11y | evidence |
  consistency`). Taste alone never files.
- **Stay within K**; never raise it to clear backlog.
- **Dedupe before you file, always.** Re-filing an open finding is the cardinal failure.
- Keep field names exact (`dedupe_key`, `last_reviewed`, `window_budget_k`, `anchor`,
  `status`) to stay aligned with the engine schemas.
