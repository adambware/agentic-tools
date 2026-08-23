---
name: design
description: Prerequisite-gated — refuses (via bin/lane-plan.mjs) until the pack has a supported browser adapter pointed at a LOOPBACK dev server, an explicit non-production environment assertion, and seeded personas. The nightshift design lane (dispatches the concrete per-adapter reviewer, e.g. ux-reviewer-playwright) — drives stale/changed flows through a local dev server against seeded personas, dedupes, logs anchored UX findings, and writes durable metrics. Use when someone says "/nightshift:design", "run the design review", "do the UX review", or wants one cadence-driven design review pass over a pack's .nightshift/ registry. Fails fast with a clear reason if the browser adapter, its adapter agent, or personas are missing.
allowed-tools: Read, Glob, Grep, Bash(git *), Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/lane-plan.mjs *), Write, Agent
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

Before doing **anything** else, run the gate. The gate is the **binary**, not prose —
do not eyeball the manifest or fixtures yourself:

```
node ${CLAUDE_PLUGIN_ROOT}/bin/lane-plan.mjs --pack .nightshift --lane design
```

This checks everything a half-eyeballed prose gate would miss: not just that
`base_url` and a persona file are present, but that the `base_url` names a **loopback** host, that `stack_adapter.browser.environment` explicitly asserts a non-production environment (`local`/`dev`/`test` — `staging` and `production` are refused BY NAME), that `stack_adapter.browser.tool` is
set to a **supported** adapter with an actual `ux-reviewer-<adapter>` agent file (an
unsupported adapter must never silently fall back to the tool-less base spec), that
every persona entry has an `id`, that every flow's `persona:` reference resolves, that
the personas list isn't empty, and that the manifest/registry parse as valid YAML.

- **Exit 2 → STOP and refuse.** Surface the command's stderr reason **verbatim** to the
  operator, plus this remediation pointer: re-run `/nightshift:onboard` and at Card 1
  explicitly select the **Design** option — do **not** use the fast-path 'Accept all
  detected defaults', which seeds Security only. Do **not** start a partial run, do
  not dispatch the reviewer, do not write metrics.
- **Exit 0 → proceed.** The plan JSON on stdout is what names the concrete reviewer
  agent to dispatch (`plan.agents.reviewer`, e.g. `ux-reviewer-playwright`) — use that
  value in Step "Reviewer" below rather than re-deriving the adapter yourself.

The design lane is default-off in v1; this gate is what keeps it honest rather than
silently inert.

## The run (delegates to the shared loop)

Once the gate passes, run the six-step loop from [../security/reference/run-loop.md](../security/reference/run-loop.md) with `lane: design`. The loop is identical to the security lane with three design-specific deltas:

1. **Registry**: use `registries/flows.yml` (not `vectors.yml`). Selection uses `window_budget_k.design`.
2. **Reviewer**: dispatch the **concrete** per-adapter reviewer agent named by the gate's `plan.agents.reviewer` (e.g. `ux-reviewer-playwright`) — do not re-derive the adapter from the manifest yourself; the gate already resolved and validated it. No dispatch API accepts a tools list: a subagent's browser tool comes from that agent file's own frontmatter, so choosing the adapter *is* choosing the agent file — nothing is granted or injected at dispatch. Drive each flow through the adapter against a seeded `fixtures/` persona, on the **local dev server** the gate validated — never a shared environment.
3. **Two-tier refute + anchor discipline**: under the v3 orchestrator the design lane runs the **same** two-tier refute gate as security — `ux-refuter` at Tier-1 (no Tier-1 refute → no finding), `ux-refuter-2` at Tier-2 on the gated survivors (critical/high severity or low confidence). The mandatory `anchor` field is **complementary** noise control, not a substitute for the gate: no `anchor`, no ticket.

## Severity gates (apply verbatim)

See **Step 6** of [../security/reference/run-loop.md](../security/reference/run-loop.md) for the single-source severity gate definitions. Apply them verbatim.

## Guardrails

- **No UX ticket without an `anchor`** (`friction_delta | broken_path | a11y | evidence |
  consistency`). Taste alone never files.
- **Stay within K**; never raise it to clear backlog.
- **Dedupe before you file, always.** Re-filing an open finding is the cardinal failure.
- **Agent context — structural fields only.** When passing open findings or suppressions to agents for dedupe context, pass only `dedupe_key`, `severity`, `run_id`, `first_seen` (findings) or `dedupe_key`, `expires` (suppressions) — never free-form narrative fields.
- **Write is scoped to `.nightshift/`** — use Write only to append metrics and update registry state. The `allowed-tools: Write` grant is broad by platform necessity; honor this constraint in tool calls.
