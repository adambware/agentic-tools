---
name: assurance-run
description: Execute ONE bounded assurance review run for a single lane (security | designer | pm). Selects the stalest/changed registry entries within the manifest budget, fans out the domain reviewer subagent (security requires a mandatory second refuter agent), dedupes against open findings, logs confirmed findings, updates registry state, emits run_metrics, and applies severity gates. Use when someone says "run the assurance review", "do the nightly security review", "review stale coverage", or wants one cadence-driven review pass over a pack's .nightshift/ registry.
allowed-tools: Read, Glob, Grep, Bash(git *), Write, Agent
model: sonnet
---

# Assurance Engine — Per-Run (Bounded Workflow)

Execute exactly **one** bounded review run for one lane. The loop is deliberately
bounded so a run fits in a single usage window and never re-files yesterday's findings.

Optimize for **coverage freshness, confidence, and dedupe quality** — NOT the number of
findings. A run that reviews the right K entries, refutes hard, and files nothing is a
good run.

## Inputs

- **Lane** — `security` | `designer` | `pm`. (PM is deferred for most packs; only run it
  if the pack's `manifest.yml` has `cadences.pm` on and `evidence_sources` wired.)
- The pack at `.nightshift/` in the target repo: `manifest.yml`, the lane's registry
  (`registries/vectors.yml` for security, `flows.yml` for designer), `findings/` (open
  findings + suppressions), and `fixtures/` (designer personas).

## The loop (six steps)

1. **Compute staleness.** For each entry in the lane's registry,
   `staleness = (today - last_reviewed) / interval_days`. **Force-flag** (`change_flag`)
   any entry whose `area` globs changed in git since `last_reviewed`.
2. **Select top-K.** Sort by `max(staleness, change_flag) * weight`; take the top **K**,
   where K is `manifest.window_budget_k` for this lane. K is the budget — do not exceed it.
3. **Fan out the reviewer subagent** per selected entry, scoped to that entry's `area`:
   - **security** → dispatch `${CLAUDE_PLUGIN_ROOT}/agents/security-reviewer.md`, then a
     **mandatory** second `${CLAUDE_PLUGIN_ROOT}/agents/security-refuter.md` that must
     **refute** the finding before it is allowed to be logged. No refutation pass → no
     finding. critical/high findings get `needs_human_verification: true`.
   - **designer** → dispatch `${CLAUDE_PLUGIN_ROOT}/agents/ux-reviewer.md`, driving each
     stale/changed flow through the manifest's browser adapter against seeded
     `fixtures/` personas. Every UX ticket REQUIRES an objective `anchor`.
4. **Dedupe + suppress.** Drop any candidate finding whose `dedupe_key` matches an open
   finding, and honor active suppressions. This is what stops nightly re-filing.
5. **Log + update state.** Append confirmed findings to `findings/`; update each reviewed
   entry's `last_reviewed` and `status`; emit `run_metrics` for the run.
6. **Apply severity gates** to decide Linear issue vs digest-only (below).

Full mechanics — staleness/change-flag detail, the dedupe_key composition, suppression
record shape, the second-reviewer protocol, and the exact `run_metrics` fields — are in
[reference/run-loop.md](reference/run-loop.md). Read it when you reach step 1; don't
preload it.

## Severity gates (noise control) — apply verbatim

- **critical / high** → file a Linear issue immediately.
- **medium** → file an issue **only if** reproducible, recurring, or customer-facing.
- **low** → write to the findings log; batch into the weekly digest **unless** repeated.
- **taste / opinion** → **never** an issue unless tied to a measured `anchor`.

These gates are the difference between a signal and a spam generator. When in doubt, log
to digest, not Linear.

## Guardrails

- **Stay within K.** The budget exists so the run fits one usage window. If everything
  looks stale, that's a digest signal (overdue areas), not a license to review more.
- **Security never logs an unrefuted finding.** The second refuter agent is mandatory;
  a finding it rejects is counted in `rejected_by_2nd_reviewer`, not filed.
- **Assurance, not a pentest.** Security reviews may add a failing test that demonstrates
  a violated authz/security invariant — never exploit payloads or offensive tooling.
- **No UX ticket without an `anchor`** (`friction_delta | broken_path | a11y | evidence |
  consistency`). Taste alone never files.
- **Dedupe before you file, always.** Re-filing an open finding is the cardinal failure.
- Keep field names exact (`dedupe_key`, `last_reviewed`, `window_budget_k`, `run_metrics`,
  `anchor`, `needs_human_verification`, `status`) to stay aligned with the engine schemas.
