# `.nightshift/` — the Nightshift pack

This directory is a **pack**: the portable, per-repo half of Nightshift. It **travels
with the code** and is **versioned in this repo** alongside it, so the project's coverage
definition lives next to the code it protects and moves with it through branches, forks,
and history.

The **engine** itself (the run loop, the reviewer subagents, the base taxonomy, the
schemas) is built once and versioned elsewhere — referenced at run time as
`${CLAUDE_PLUGIN_ROOT}`. This pack only holds what is specific to THIS project.

## What's in here

```
.nightshift/
  manifest.yml          # portability layer: pack_format, stack adapter, allowlist,
                        #   Linear labels, cadences, per-lane window budgets
  registries/
    vectors.yml         # security coverage (kind: vector, owner: security) — security lane
    flows.yml           # design flows    (kind: flow,   owner: design)     — design lane
  fixtures/
    personas.example.yml# seeded test personas — design-lane prerequisite
  findings/
    log.jsonl           # append-only confirmed-findings log (one JSON object per line)
    suppressions.yml    # time-boxed dedupe_key suppressions
  metrics/              # durable day-over-day coverage tracking (the time-series of record)
    runs/<YYYY-MM>.jsonl    # append-only: one record per run, monthly partition
    daily.jsonl             # append-only daily rollups; reader takes the LAST line per (date,lane)
    findings/<YYYY-MM>.jsonl# append-only finding records, monthly partition
  dashboard.md          # DISPOSABLE projection — regenerated current-state coverage view
  trends.md             # DISPOSABLE projection — regenerated CHANGELOG-style delta lines
  .gitattributes        # sets `metrics/**/*.jsonl merge=union` so appends never conflict
```

Two lanes only: **security** (the `vectors.yml` spine, run via `/nightshift:qa`) and
**design** (`flows.yml`, run via `/nightshift:design`). Both are driven by the same
manifest cadences/budgets.

The durable truth is `metrics/runs/*.jsonl` + `metrics/daily.jsonl` + the git history of
the registries. `dashboard.md` and `trends.md` are **disposable** — the engine regenerates
them from those sources each run, so never hand-edit them and never treat them as the
source of record.

## How it relates to the engine

Each run the engine: loads these registries → computes `staleness*weight` and git
change flags → selects the top-K per `manifest.window_budget_k` → fans out the matching
reviewer subagent → dedupes against the findings log and honors suppressions → appends
confirmed findings, appends a run record to `metrics/runs/<YYYY-MM>.jsonl`, recomputes the
day's `metrics/daily.jsonl` rollup, updates the `(auto)` fields, and regenerates
`dashboard.md`/`trends.md`.

## Onboarding (how this got here)

Created by the `/nightshift:onboard` skill: copy this template, fill in `manifest.yml`,
clone `${CLAUDE_PLUGIN_ROOT}/taxonomy/owasp-asvs.yml` into `registries/vectors.yml` and
extend with project-specific surfaces, then run a **human-reviewed seed + garden pass**.

See `../../examples/novudesk/.nightshift/` for a fully-populated worked example of this pack.

**Design discipline:** optimize for coverage freshness, confidence, dedupe quality, and
digest usefulness — NOT number of findings. Human-seeded fields carry intent; `(auto)`
fields are engine-managed — never hand-edit them.
