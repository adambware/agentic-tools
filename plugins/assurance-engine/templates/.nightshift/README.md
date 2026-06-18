# `.nightshift/` — the Assurance Engine pack

This directory is a **pack**: the portable, per-repo half of the Agentic Assurance
Engine. It **travels with the code** and is **versioned in this repo** alongside it, so
the project's coverage definition lives next to the code it protects and moves with it
through branches, forks, and history.

The **engine** itself (the run loop, the reviewer subagents, the base taxonomy, the
schemas) is built once and versioned elsewhere — referenced at run time as
`${CLAUDE_PLUGIN_ROOT}`. This pack only holds what is specific to THIS project.

## What's in here

```
.nightshift/
  manifest.yml          # portability layer: stack adapter, allowlist, evidence sources,
                        #   Linear labels, cadences, per-lane window budgets
  registries/
    vectors.yml         # security coverage (kind: vector, owner: security) — Phase 1
    flows.yml           # designer flows  (kind: flow,   owner: design)   — Phase 2
    problems.yml        # PM problems      (kind: problem,owner: product)  — Phase 3 (deferred)
  fixtures/
    personas.example.yml# seeded test personas — Designer-lane prerequisite
  findings/
    log.jsonl           # append-only confirmed-findings log (one JSON object per line)
    suppressions.yml    # time-boxed dedupe_key suppressions
  dashboard.md          # ENGINE-GENERATED coverage view (do not hand-edit)
```

## How it relates to the engine

Each run the engine: loads these registries → computes `staleness*weight` and git
change flags → selects the top-K per `manifest.window_budget_k` → fans out the matching
reviewer subagent → dedupes against the findings log and honors suppressions → appends
confirmed findings, updates the `(auto)` fields, and regenerates `dashboard.md`.

## Onboarding (how this got here)

Created by the `assurance-onboard` skill: copy this template, fill in `manifest.yml`,
clone `${CLAUDE_PLUGIN_ROOT}/taxonomy/owasp-asvs.yml` into `registries/vectors.yml` and
extend with project-specific surfaces, then run a **human-reviewed seed + garden pass**.

**Design discipline:** optimize for coverage freshness, confidence, dedupe quality, and
digest usefulness — NOT number of findings. Human-seeded fields carry intent; `(auto)`
fields are engine-managed — never hand-edit them.
