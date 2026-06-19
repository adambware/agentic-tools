# Future PM lane — design note (DEFERRED, not implemented)

**Status: DEFERRED. This is a design note, not shipped code.** Nightshift core is
deliberately **two lanes only** — security and design. There is no PM lane, no
`pm-reviewer`, no `problems.yml`, no `evidence_sources`, and no PM keys in the manifest.
This file exists so that a *future* revival starts from the thinking rather than from
scratch. Nothing here is wired into the engine today.

## Why it was dropped

The PM lane delivered **zero value today**: it was `off` everywhere and refused to run
without connected `evidence_sources`. Worse, a PM lane that runs **dry** (without real
support/churn/review/analytics signal) **invents problems** — it manufactures roadmap
gaps that don't exist, which is actively harmful. The capability also dragged PM-specific
surface through core schemas, prose, and grants for something nobody was using. Removing
it shrinks the core and removes "deferred" vocabulary implying a lane that never arrives.

## The genuinely-good ideas worth preserving

### 1. Signal discipline: OBSERVED / ESTIMATED / STRATEGIC

Every PM signal would have carried an explicit class so humans could trust its provenance:

- **OBSERVED** — grounded in real evidence the pack can point at (a support ticket
  cluster, a churn cohort, a review theme, an analytics drop). Highest trust.
- **ESTIMATED** — an inference or projection from observed data, clearly marked as such
  so it is never mistaken for fact.
- **STRATEGIC** — a hypothesis or opinion about direction, explicitly subjective.

The point: a PM lane that can't distinguish "users are hitting this" from "I think users
might want this" is noise. The class is the discipline that keeps it honest, and it is the
single most reusable idea here.

### 2. Briefs only — humans keep roadmap authority

The lane would **never** decide the roadmap. It produces **briefs** (a framed problem with
its evidence and signal class) and stops. Prioritization, sequencing, and the decision to
build remain entirely with humans. The lane informs; it does not author the roadmap.

### 3. The unmet requirement: scope WebFetch to the manifest's evidence_sources

A revived PM lane that pulls external signal needs `WebFetch` (or equivalent) restricted
to **exactly** the URLs/domains declared in the manifest's `evidence_sources` — and no
others. The intended mechanism is a **`PreToolUse` hook shipped in the consumer pack** that
inspects each `WebFetch` call and **denies any target not in `evidence_sources`**. This was
never built. Without it, a PM lane with web access is an unbounded-egress surface, which is
why the lane could not safely ship even in `off` state with the grant present.

## Reviving it means shipping its own pieces — no cross-plugin runtime reuse

If a future `nightshift-pm` is built, it must **ship its own schema and dedupe pieces**.
`plugin.json` `dependencies` are enforced only at install/enable time; they are **not** a
runtime schema-sharing mechanism. A PM plugin may declare a dependency on core `nightshift`,
but it cannot reuse the core's finding/registry schemas at runtime — it must carry its own:

- a `problems.yml` registry schema (`kind: problem`, `owner: product`) and its area mapping,
- a PM-specific finding/brief schema with its own dedupe key,
- the `evidence_sources` manifest block **and** the `PreToolUse` egress-scoping hook above,
- its own cadence/budget keys, kept out of core's two-lane manifest.

Until all of that is designed and the dry-run "invents problems" failure mode is solved,
the PM lane stays deferred.
