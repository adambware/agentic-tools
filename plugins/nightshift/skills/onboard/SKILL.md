---
name: onboard
description: Onboard a codebase to nightshift via an interactive interview — detect the repo's stack/scripts/CI, batch-confirm only the deltas, seed a reviewed vectors.yml by cloning the base security taxonomy, gate on a clean pack, and write the .nightshift/ pack. Use when someone says "onboard a repo to nightshift", "set up nightshift here", "add security review coverage to this project", or wants to stand up coverage-driven review. Produces a reviewed registry — it does NOT run reviews (that is /nightshift:security).
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(git *), Write, AskUserQuestion
model: sonnet
---

# nightshift — Onboard a Codebase (interview)

Onboard one codebase as a **pack**: a `.nightshift/` directory that travels with the
repo and holds its registries, fixtures, findings, metrics, and manifest. The engine is
built once and versioned in `${CLAUDE_PLUGIN_ROOT}`; onboarding makes it see *this* repo.

`AskUserQuestion` runs the interview in THIS top-level skill — never delegate it to a
subagent (subagents can't call it).

## The milestone — read this first

The milestone is **NOT** "the nightly run works." It is a **reviewed, complete-enough
`vectors.yml`** (weights + code mappings + owners) with a **low false-positive rate**
test-run against the code. A pack that runs nightly but fires on phantom surfaces is
worse than no pack. Seed fewer entries, mapped correctly, each owned by someone — every
entry is a standing promise to keep that surface fresh.

## Two-phase rollout (guardrail — do not light up a lane before its prerequisites)

1. **Security now** (default). The only lane the default path onboards. Seed `vectors.yml`,
   review with a human, get the false-positive rate low.
2. **Design when ready.** Only when the project has a **staging env** AND **seeded
   personas** in `.nightshift/fixtures/`. If the user selects Design at Card 1, run the
   design-lane branch; otherwise auto-defer with ONE line (`cadences.design: off`), never
   a question.

## Flow: DETECT → BATCH-CONFIRM → SEED → REVIEW → GATE → WRITE

Read `reference/onboard-mechanics.md` for the full detail at each step — do NOT preload
it; read it at the step that needs it.

0. **DETECT (mandatory preamble).** Glob `package.json`/`Gemfile`/`go.mod`/`pyproject`/
   `Cargo.toml` (+ their script fields), `.github/workflows/*.yml`, `Dockerfile`/compose,
   monorepo markers, and an existing `.nightshift/`. Render a "here's what I detected"
   summary; you will ask only deltas. *(Mechanics §A tree, §B manifest fields.)*
1. **BATCH-CONFIRM.** Ask the batched `AskUserQuestion` cards — ≤4 options each,
   Recommended-first, ≤12-char headers, provenance in every option description. Card 1's
   lead option = "Accept all detected defaults and seed the pack" (a confident standard
   repo finishes here in ONE interaction). *(Mechanics §D for the full card set + the
   plain-prompt fallback if runtime limits differ.)*
2. **SEED.** Clone `taxonomy/owasp-asvs.yml` into a DRAFT `vectors.yml` and remap each
   `area` glob from the detected tree (build the area→path map in-memory; there is no
   `REPO_MAP.yml`). *(Mechanics §C.)*
3. **REVIEW.** One multiSelect approval card: "which proposed vectors look real?" Drop
   the unchecked ones.
4. **GATE (deterministic).** Grep the rendered pack for all sentinels in
   **[reference/onboard-mechanics.md §E](reference/onboard-mechanics.md)** and
   REQUIRED-empty keys. Any survivor → a precise batched question. Onboarding is NOT
   "done" until clean. *(Mechanics §E for the full sentinel list.)*
5. **WRITE.** Final "Write pack" confirm card, then write the pack: `manifest.yml`,
   `registries/`, the seeded fixtures, `.gitattributes` (`metrics/**/*.jsonl merge=union`),
   the scaffolded `metrics/` dir (`runs/`, `findings/`, `daily.jsonl`), and `.pack-meta.yml`
   `{answers, engine_version, template_ref, pack_format}`. *(Mechanics §A, §F.)*
   Pack written. Run `/nightshift:security` now to validate the allowlist, area globs, and
   refuter gate before the first cadence run.

## Reconcile mode (re-run over an existing pack)

Re-running `/nightshift:onboard` over an existing pack is safe — it detects drift and asks only about changes. Hand-edit `manifest.yml` only for cosmetic values; re-run onboard to absorb stack changes without clobbering `(auto)` fields.

On re-run with an existing `.nightshift/`, re-detect, diff detected-vs-`.pack-meta.yml`,
and ask ONLY about drift. Never clobber `(auto)` fields (`last_reviewed`, `status`,
`linear`) or hand-tuned weights — merge, don't overwrite. *(Mechanics §F.)*

## Guardrails

- **Reviewed beats complete.** A short, fully-real registry beats an exhaustive one full
  of phantom surfaces.
- **Never auto-add registry entries.** The interview *proposes*; the human approves at
  the REVIEW card. Gardening over time is `/nightshift:garden`.
- **Auto-defer, don't ask, for unselected lanes.** One explanatory line, never a question.
- **Keep field names byte-exact** (`pack_format`, `window_budget_k`, `cadences.design`,
  `last_reviewed`, `interval_days`, `area`, `owner`, …) so the pack lines up with the
  schemas.
- This skill ends at a reviewed pack. Running reviews is `/nightshift:security` and
  `/nightshift:design`; keeping the registry honest is `/nightshift:garden`; the weekly
  signal is `/nightshift:digest`.
