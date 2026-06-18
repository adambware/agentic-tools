---
name: assurance-onboard
description: Onboard a codebase to the Agentic Assurance Engine by dropping a .nightshift/ pack, cloning and extending the base security taxonomy into a reviewed vectors.yml, and running a human-reviewed seed + garden pass. Use when someone says "onboard a repo to the assurance engine", "set up nightshift", "add security review coverage to this project", or wants to stand up coverage-driven review for a new codebase. This produces a reviewed registry — it does NOT run nightly reviews (that is assurance-run).
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(git *), Write
model: sonnet
---

# Assurance Engine — Onboard a Codebase (Pack Setup)

Onboard one codebase as a **pack**: a `.nightshift/` directory that travels with the
repo and holds its registries, fixtures, findings, and manifest. The engine is built
once and versioned elsewhere (`${CLAUDE_PLUGIN_ROOT}`); onboarding is what makes the
engine see *this* codebase.

## The milestone — read this first

The Phase-1 milestone is **NOT** "the nightly run works." It is:

> a **reviewed, complete-enough `vectors.yml`** with weights + code mappings + owners,
> and a **low false-positive rate** when test-run against the code.

A pack that runs nightly but fires on phantom surfaces is worse than no pack. Optimize
for coverage freshness, confidence, and dedupe quality — never for number of entries or
findings. Every entry you seed is a standing promise to keep that surface fresh; seed
fewer, mapped correctly, owned by someone.

## Phased rollout (do not skip ahead)

Onboard one lane at a time. Each phase is "done" only when its slice of the weekly
digest is something a human would **act on** — not when it merely runs.

1. **Security first.** The only lane you onboard in the initial pass. Seed `vectors.yml`,
   review it with a human, get the false-positive rate low. This is the whole of Phase 1.
2. **Designer second — deferred until prerequisites exist.** Do NOT seed `flows.yml`
   until the project has a **staging environment** AND **seeded test personas** written
   to `.nightshift/fixtures/`. Without seeded personas the reviewer confuses environment
   drift with real friction. Note the prerequisite and stop.
3. **PM last — deferred.** Leave `cadences.pm: off` and `evidence_sources: []`. Do not
   create `problems.yml`. Standing the PM lane up before real support/churn/review signal
   exists produces invented problems. Onboard it only once `evidence_sources` are wired.

## Workflow

### 1. Drop the pack

Create `.nightshift/` at the repo root by copying the template structure from
`${CLAUDE_PLUGIN_ROOT}/templates/.nightshift/`:

```
.nightshift/
  manifest.yml          # from template — then fill in for this project
  registries/           # vectors.yml (this pass); flows.yml / problems.yml deferred
  fixtures/             # empty until the Designer phase
  findings/             # append-only log + suppressions; starts empty
  dashboard.md          # generated later by runs
```

Fill in `manifest.yml` for this project. The fields that matter on day one:

- `project`, `repos` (path + stack per repo).
- `stack_adapter`: `test`, `build`, and (Designer-phase) `browser` commands the engine
  will actually run for this codebase.
- `allowlist`: the exact tools the engine may use — keep it tight (Read/Grep/Glob, the
  test command, WebFetch, browser/MCP only when needed).
- `evidence_sources: []` — leave empty (PM deferred).
- `linear`: project + per-lane labels.
- `cadences`: `security: nightly`, `designer: weekly`, `pm: off`.
- `window_budget_k`: the top-K entries reviewed per run, sized to one usage window
  (e.g. `security: 6`). This becomes the run's selection budget.

Match every field name to the manifest schema and `${CLAUDE_PLUGIN_ROOT}/schemas/`.

### 2. Clone and extend the base taxonomy

Copy the base library `${CLAUDE_PLUGIN_ROOT}/taxonomy/owasp-asvs.yml` into
`.nightshift/registries/vectors.yml`. This gives you the generic ASVS spine (authn,
session, injection, secrets, deps, rate-limiting, …) as registry entries conforming to
`${CLAUDE_PLUGIN_ROOT}/schemas/registry-entry.yml`.

Then make it this project's registry:

- **Remap `area` globs** from the repo's `REPO_MAP.yml`. Base-taxonomy entries ship
  generic placeholder globs; replace each with the real path globs for this codebase so
  the engine can detect git changes and scope reviewers correctly. An entry with wrong
  `area` is a silent blind spot.
- **Extend with project-specific surfaces** — the vectors the base taxonomy can't know.
  For each, set `id` (project-prefixed, e.g. `ND-SEC-05`), `title`, `kind: vector`,
  `area`, `weight`, `interval_days` (derive from weight), and `owner: security`.
- Leave `last_reviewed`, `status`, and `linear` unset — those are engine-managed `(auto)`.

### 3. Human-reviewed seed + garden pass

This is the gate, not a formality. With a human in the loop:

- Walk every seeded entry: is the surface real in this code? Is `area` correct? Is
  `weight` honest? Is there an `owner`? Delete entries that don't map to anything real.
- Run a **garden pass** (see the `assurance-garden` skill): scan the code for surfaces
  that have **no** entry, and propose them for human approval — never auto-add.
- Test-run a small selection against the code and check the false-positive rate. If
  reviewers fire on non-issues, fix the `area` mappings and weights before going nightly.

Only once the registry is reviewed, complete-enough, and low-false-positive do you turn
on the nightly cadence (diff-triggered) and the weekly digest.

## Guardrails

- **Reviewed beats complete.** A short registry every entry of which is real and mapped
  beats an exhaustive one full of phantom surfaces.
- **Never auto-add registry entries.** Gardening *proposes*; humans approve.
- **One lane per onboarding pass.** Security now; Designer and PM only when their
  prerequisites (staging + seeded fixtures; real evidence_sources) exist.
- **Keep field names exact** (`last_reviewed`, `window_budget_k`, `interval_days`,
  `area`, `owner`, …) so the pack lines up with the engine schemas.
- **Allow a scoped test command in the manifest.** The manifest `allowlist` must include
  a scoped Bash test entry (e.g. `Bash(bin/rails test:*)`) so the security reviewer can
  run a failing-invariant test at runtime.
- This skill ends at a reviewed pack. Running reviews is `assurance-run`; keeping the
  registry honest over time is `assurance-garden`; the management signal is
  `assurance-digest`.
