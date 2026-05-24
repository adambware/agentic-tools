# Tracing Reference

How to gather source-grounded truth without drowning in it. The goal is a confident
mental picture of one real journey — not a complete map of the codebase.

## Repo-shape guidance

Size the repo cheaply before committing to a path. A directory listing, a file count,
and a glance at the dependency manifest(s) are usually enough.

- **Single app / small repo** — read narrowly yourself. Open the entrypoint wiring and
  follow imports along the one path you're tracing. Capture the picture incrementally.
- **Monorepo / multiple apps** — first identify which app owns the operation worth
  tracing; ignore the rest. Don't try to characterize every package.
- **Large repo (single app)** — avoid loading broad swaths of source into your own
  context. Find the entrypoint registration, then jump directly along the call path
  rather than reading whole directories.

In the large/monorepo cases, prefer delegated discovery if the host supports it (see
"Optional delegation" below). Inline work is always a valid fallback under the same rules.

## What to read first (and what to skip)

Read, in rough priority order:

- Runtime wiring and dependency injection / app bootstrap
- Route, command, consumer, and cron **registration** (where handlers are bound)
- Queue / topic / channel configuration
- Schema, migrations, and the adapters that read/write each store
- One or two representative tests of the path you're tracing — they encode intended behavior

Skip unless it defines runtime behavior: generated code, vendored dependencies, fixtures,
sample/example apps, and build output.

## Evidence budget

Spend evidence on the one journey, not on coverage. A practical budget:

- **Entrypoints:** confirm the real one for your chosen operation. You don't need to
  read every route — just the one you trace plus enough to know the shape.
- **The traced path:** read each hop you actually narrate. This is where the budget goes.
- **Stores:** confirm the writer of each system of record that appears in the journey.
- **Stop when** the path reaches durable state or an external handoff and you can name
  every hop with confidence. Widening past that buys narrative, not comprehension.

If a hop is ambiguous after a reasonable look, mark it `unclear` and keep moving. A marked
gap is honest; a confident wrong picture is the failure mode this skill exists to prevent.

## Context-rot rules

The codebase lies in predictable ways. Defend against it:

- **Treat docs as hypotheses, not truth.** READMEs, comments, and design docs describe
  intent or a past state. Confirm every load-bearing claim against runtime wiring.
- **Prefer ground truth:** route/command registration, queue/topic config, schema,
  adapters, and representative tests over prose.
- **Mark, don't smooth.** Flag stale docs, dead code, conflicting paths, missing
  ownership, and unverified claims as `unclear`. Do not reconcile a conflict by picking
  the tidier story.
- **Don't trust names alone.** A folder named `services` may not hold the service; a
  function named `validate` may also write. Confirm behavior, not labels.

## Optional delegation (accelerator, not dependency)

If the host environment supports read-only/explorer subagents or delegated analysis, you
may offload focused discovery so the orchestrator's context stays clear — especially in
large repos or monorepos. This is generic across hosts (Claude Code, opencode, Codex,
GitHub Copilot-style tools map this to their explorer/read-only role). If no such
capability exists, do the same work inline; the rules above are identical either way.

Delegate **narrow, bounded** questions ("trace the order-placement path from the route
to durable state and report each hop"), not "understand the codebase." Each delegated
task must return a compact structured packet — not a transcript:

```
CANDIDATE WORDING
  <draft one-pager lines for the relevant section(s), in the artifact's voice>

SOURCE ANCHORS (internal only — never appears in the final one-pager)
  <file:line or symbol references that back each claim>

UNCERTAINTY / CONFLICTS
  <what couldn't be confirmed, stale docs, conflicting paths, missing ownership>

STOP CONDITION REACHED
  <why the task ended: hit durable state / external handoff / budget / blocked>
```

Fold the candidate wording into your working draft, keep the anchors internal for your
own verification, and surface uncertainties as `unclear` in the artifact. Never let
source anchors, packets, or delegation mechanics leak into the final one-pager.
