---
name: qa
description: Security/assurance review run for one pack — the nightshift security lane. Selects the stalest/changed registry vectors within the manifest budget, fans out the security-reviewer subagent, runs the two-stage refuter gate (Tier-1 always, Tier-2 conditional), dedupes against open findings, logs confirmed findings, updates registry state, writes durable metrics, and applies severity gates. Use when someone says "/nightshift:qa", "run the security review", "do the nightly assurance review", "review stale coverage", or wants one cadence-driven security review pass over a pack's .nightshift/ registry.
allowed-tools: Read, Glob, Grep, Bash(git *), Write, Agent
model: sonnet
disable-model-invocation: true
---

# Nightshift QA — Security Review Run (Bounded Workflow)

Execute exactly **one** bounded security review run. This skill IS the security lane:
no lane parameter, no design/pm branching. (The design lane is the sibling
`/nightshift:design`; both share the mechanics in
[reference/run-loop.md](reference/run-loop.md).)

The loop is deliberately bounded so a run fits in a single usage window and never
re-files yesterday's findings.

Optimize for **coverage freshness, confidence, and dedupe quality** — NOT the number of
findings. A run that reviews the right K vectors, refutes hard, and files nothing is a
**good** run.

## Changed areas this run (pre-rendered)

Files touched in the working tree, injected at load so selection sees changed areas first:

```
!`git diff --name-only`
```

Intersect these paths with each vector's `area` globs to drive `change_flag` in step 1.

## Inputs

- The pack at `.nightshift/` in the target repo: `manifest.yml`, the security registry
  `registries/vectors.yml`, `findings/` (open findings + suppressions).
- **No lane parameter.** This run is `lane: security` by construction. Internal
  identifiers and schema keys stay `security`.

## The loop (six steps)

1. **Compute staleness.** For each vector, `staleness = (today - last_reviewed) / interval_days`.
   **Force-flag** (`change_flag`) any vector whose `area` globs intersect the changed
   files above.
2. **Select top-K.** Sort by `score = max(staleness, change_flag) * weight`; take the top
   **K = `manifest.window_budget_k.security`**. K is the budget — never exceed it, never
   raise it to clear backlog. Overdue surplus is a digest signal.
3. **Fan out the security reviewer + the two-stage refuter gate** per selected vector,
   scoped to that vector's `area` (parallelize reviewers 3–5 at a time inside K):
   - **Reviewer** — dispatch `${CLAUDE_PLUGIN_ROOT}/agents/security-reviewer.md`.
   - **Tier-1 refuter (ALWAYS)** — dispatch
     `${CLAUDE_PLUGIN_ROOT}/agents/security-refuter.md` (haiku, `maxTurns: 8`, low effort)
     on **every** candidate. It must actively refute; a survivor proceeds, a refuted
     candidate is dropped and counted in `rejected_tier1`.
     **No Tier-1 refute → no log.**
   - **Tier-2 refuter (CONDITIONAL)** — dispatch
     `${CLAUDE_PLUGIN_ROOT}/agents/security-refuter-2.md` (sonnet/high, `maxTurns: 12`)
     **only** when a Tier-1 survivor is **critical/high severity OR `confidence == low`**
     (union predicate). A Tier-2 refutation drops the candidate and counts in
     `rejected_tier2`. critical/high survivors get `needs_human_verification: true`.
4. **Dedupe + suppress.** Drop any candidate whose `dedupe_key` matches an open finding,
   and honor active suppressions. This is what stops nightly re-filing.
5. **Log + update state + write metrics.** Append confirmed findings to `findings/`;
   update each reviewed vector's `last_reviewed` and `status`; write the durable per-run,
   finding-lifecycle, and daily-rollup metrics records (see run-loop.md step 5).
6. **Apply severity gates** to decide Linear issue vs digest-only (below).

Full mechanics — staleness/change-flag detail, the `dedupe_key` composition, suppression
record shape, the **two-stage refuter protocol**, the metrics writer, and the exact
record fields — are in [reference/run-loop.md](reference/run-loop.md). **Read it when you
reach step 1; don't preload it.**

## Severity gates (noise control) — apply verbatim

- **critical / high** → file a Linear issue immediately.
- **medium** → file an issue **only if** reproducible, recurring, or customer-facing.
- **low** → write to the findings log; batch into the weekly digest **unless** repeated.
- **taste / opinion** → **never** an issue unless tied to a measured `anchor`.

These gates are the difference between a signal and a spam generator. When in doubt, log
to digest, not Linear.

## Guardrails

- **Stay within K.** The budget exists so the run fits one usage window. If everything
  looks stale, that's a digest signal (overdue areas), not a license to review more, and
  never a reason to raise K.
- **Security never logs an unrefuted finding. No Tier-1 refute → no log.** The Tier-1
  refuter is mandatory on every candidate; Tier-2 adds an expensive second pass only for
  critical/high or low-confidence survivors.
- **Assurance, not a pentest.** Security reviews may add a failing test that demonstrates
  a violated authz/security invariant — never exploit payloads or offensive tooling.
- **Dedupe before you file, always.** Re-filing an open finding is the cardinal failure.
- Keep field names exact (`dedupe_key`, `last_reviewed`, `window_budget_k`, `anchor`,
  `needs_human_verification`, `status`, `asvs_ref`) to stay aligned with the engine
  schemas.
