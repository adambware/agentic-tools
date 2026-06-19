# Onboardme Eval System With Promptfoo

## Summary
Use Promptfoo for v1, with local fixture scoring as the oracle. Your link changes the recommendation: Promptfoo now has first-class skill eval guidance, including `skill-used`, `not-skill-used`, Claude Agent SDK, Codex SDK, OpenCode SDK, working-directory fixtures, and side-by-side skill-version comparison.

The key move is: let Promptfoo orchestrate runs and comparisons, but keep `onboardme` scoring grounded in repo fixtures and deterministic assertions.

## Key Changes
- Add `evals/onboardme/promptfooconfig.yaml` with providers for saved-output first, then Claude/Codex adapters later.
- Add fixture repos under `evals/onboardme/fixtures/`, each containing:
  - a small realistic codebase.
  - the `onboardme` skill copied into `.claude/skills/onboardme/SKILL.md` and/or `.agents/skills/onboardme/SKILL.md`.
  - expected metadata for required facts and forbidden claims.
- Use Promptfoo assertions for:
  - `skill-used: onboardme` when running real Claude/Codex/OpenCode providers.
  - JavaScript assertions for exact five-heading structure, no citations, no recommendations, no TODOs, no risk language.
  - JavaScript scoring for required facts: traced operation, major components, stores, writers, and explicit `unclear` where appropriate.
  - optional cost/latency thresholds once live harness runs are enabled.
- Start with saved outputs by using Promptfoo as the scorer/report layer; add real provider runs after the rubric is stable.

## Harness Plan
- V1: saved outputs only, scored through Promptfoo.
- V1.5: Claude Agent SDK provider with `.claude/skills/onboardme/SKILL.md`, read-only tools, and `skill-used`.
- V2: Codex SDK provider with `.agents/skills/onboardme/SKILL.md`, `sandbox_mode: read-only`, `enable_streaming: true`, and trace checks that confirm `SKILL.md` was read.
- Future: Copilot remains a manual/imported-output lane unless its agent harness exposes stable CLI/provider hooks.

## Test Cases
- Happy path: simple HTTP or CLI repo produces the five-section one-pager.
- Stale-doc fixture: docs say one thing, runtime wiring says another; output must follow source and mark uncertainty.
- Near-miss routing: prompts for code review or test planning should not use `onboardme`.
- Negative output cases:
  - wrong headings.
  - extra appendix/citations.
  - recommendations or risk assessment.
  - misses a store or sole writer.
  - invents unverified facts instead of saying `unclear`.

## Assumptions
- Promptfoo becomes the eval runner for this skill suite.
- Local deterministic assertions remain the core quality signal.
- We defer live multi-harness execution until saved-output scoring catches the obvious failures.

Sources: Promptfoo’s skill eval guide recommends comparing skill versions by changing only `SKILL.md`, using `.claude/skills` or `.agents/skills`, `skill-used`, JavaScript assertions, Codex SDK tracing, repeats, JSON output, and bundle routing checks: https://www.promptfoo.dev/docs/guides/test-agent-skills/

---

## Review-locked architecture (decided during /plan-eng-review)

```
evals/onboardme/
  promptfooconfig.yaml
  asserts/
    spec.js          # SINGLE SOURCE: REQUIRED_HEADINGS + BANNED patterns
    spec.guard.test  # RED if a heading diverges from reference/output-template.md
    structure.js     # STRICT: 1 H1 + exactly 5 named H2 in order, no extra H2/Appendix/Sources
    banned.js        # forbidden content; tuned NOT to fire on "Cut here"/"Not here"/"slots in cleanly"
    facts.js         # identifier presence + store~writer co-occurrence + journey ORDER
    __tests__/       # full matrix: pass-golden / fail-own-defect / no-false-fire
  providers/
    saved-output.js  # V1: returns fixtures/outputs/<case>.md
    claude-agent.js  # V1.5
    codex.js         # V2 (blocked by distribution-contract TODO)
  scripts/
    stage-skill.sh   # copies canonical plugins/onboardme skill into each fixture at eval-time
  fixtures/
    repos/                       # live inputs (V1.5+)
      http-simple/        + expected.json + golden.md
      stale-doc-clear/    -> output follows SOURCE, does NOT hedge
      ambiguous-owner/    -> genuinely-unresolvable hop marked `unclear`
    outputs/adversarial/         # V1 deterministic scoring, handwritten single-defect files
package.json (+lockfile)         # pinned promptfoo; staged skill dirs gitignored

CI: deterministic lane = PR GATE (no secrets, fork-safe)
    live lane = workflow_dispatch + nightly (secrets, FIXED capable model, repeats=3, core subset, non-blocking)
```

Key decisions: Promptfoo from V1 with asserts as importable JS modules (zero throwaway) · skill staged
from the canonical path, never copied · fixtures split repos/ vs outputs/ · fact oracle = presence +
relation checks (not presence-only) · two-tier CI · single shared rubric spec + drift guard · stale-doc
split into clear-contradiction vs genuinely-ambiguous · live tier pins a FIXED capable model (cost bounded
via fixture subset + repeats, not by downgrading the model) · adversarial files handwritten now, mutator
extracted when a 2nd skill adopts the pattern · strict Markdown grammar.

## What already exists
- **`tests/dev-doctor-test.sh`** + **`.github/workflows/test.yml`** — the repo's only test harness (bash+jq) and CI lane. The new deterministic eval lane runs alongside it; the live lane is a separate workflow. Reused, not rebuilt.
- **`plugins/onboardme/skills/onboardme/`** (SKILL.md + reference/tracing.md + reference/output-template.md) — the canonical skill and its rubric. The eval *stages from* and *derives its rubric spec from* these rather than duplicating them.
- **No existing eval system** — this is net-new; no regression surface to protect, hence no regression tests required.

## NOT in scope (deferred, with rationale)
- **V2 Codex `.agents/skills` lane** — blocked until the Codex distribution contract is defined (TODOS.md). Building it now tests a hypothetical install shape.
- **LLM-judge relational/semantic grader** — deferred non-gating layer (TODOS.md); deterministic gate must stabilize first.
- **Mutation generator for adversarial fixtures** — handwritten now; extract when a second skill adopts the pattern (YAGNI).
- **Future Copilot lane** — manual/imported-output only until its harness exposes stable provider hooks (per plan).
- **Side-by-side skill-version comparison** — Promptfoo supports it, but onboardme has one version; revisit when a v1.1 lands.

## Failure modes (new codepaths)
| Codepath | Realistic prod failure | Test? | Error handling? | Visible? |
|---|---|---|---|---|
| `stage-skill.sh` | canonical skill path moved → stages nothing → live runs score an empty skill | T9 staging test | **must add `set -euo pipefail` + assert source exists (fold into T6)** | Loud (red) once guarded |
| `saved-output.js` | requested fixture file missing → undefined output → assert crash | T9 edge | provider throws a clear "fixture not found" | Loud |
| `facts.js` ordering | identifiers absent → ordering check passes vacuously | T9 matrix | check presence *before* ordering | Loud |
| `banned.js` | false-fires on legitimate "The seams" language | T9 pass-golden fails immediately | n/a (caught by matrix) | Loud |
| live provider | no API key on fork PR | n/a | live lane skips, deterministic gate stays green | Lane skipped, not failed |

**Critical gaps: 0.** The one watch item is `stage-skill.sh` failing silently if the canonical path moves — addressed by guarding the script (folded into T6); the staging meta-test in T9 catches it regardless.

## Worktree parallelization strategy
| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 toolchain scaffold | package.json, evals/onboardme config (root) | — |
| T2 spec.js + guard | asserts/ | T1 |
| T3/T4/T5 asserts | asserts/ | T2 |
| T6 stage-skill.sh | scripts/ | T1 |
| T7 fixtures | fixtures/ | T1 |
| T8 saved-output provider | providers/ | T1, T7 |
| T9 meta-tests | asserts/__tests__/ | T2–T5, T7 |
| T10 CI | .github/ | T8, T9 |
| T11 V1.5 provider | providers/ | T1, T7, asserts |

- **Lane A (asserts):** T2 → T3/T4/T5 (same `asserts/` dir — sequential or careful parallel by file).
- **Lane B (fixtures):** T7 — independent of asserts, parallel after T1.
- **Lane C (harness):** T6 staging — independent, parallel after T1.
- **Execution:** T1 first (root). Then launch A + B + C in parallel worktrees. Merge. Then T8 + T9 (need asserts + fixtures), then T10 + T11.
- **Conflict flag:** Lane A files all live in `asserts/`; if T3/T4/T5 run in separate worktrees they touch the same dir — split by file or run sequentially.

## Implementation Tasks
Synthesized from this review's findings. Run with Claude Code or Codex; checkbox as you ship.
P1 = core V1/V1.5 · P2 = CI + live lane · P3 = follow-up.

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — toolchain — Scaffold `evals/onboardme` + pin Node/Promptfoo (package.json + lockfile, `eval:det`/`eval:live` scripts)
  - Surfaced by: Step 0 + Codex — Promptfoo is a repo-policy change; no version pinning/install plan
  - Files: `package.json`, lockfile, `evals/onboardme/promptfooconfig.yaml` · Verify: `npm ci && npx promptfoo --version`
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — asserts — `asserts/spec.js` single source + drift-guard test vs `output-template.md`
  - Surfaced by: Issue 5 (rubric in 4 places) · Verify: rename a heading in template → guard test goes RED
- [ ] **T3 (P1, human: ~1.5h / CC: ~15min)** — asserts — `structure.js` STRICT grammar (1 H1 + exactly 5 H2 in order, reject extra)
  - Surfaced by: Codex — "exact five-heading" ambiguous re H1 + appendices · Verify: matrix tests
- [ ] **T4 (P1, human: ~2h / CC: ~20min)** — asserts — `banned.js` tuned to NOT false-fire on "The seams" language
  - Surfaced by: Codex — dumb detector punishes the template · Verify: golden.md passes banned.js
- [ ] **T5 (P1, human: ~3h / CC: ~30min)** — asserts — `facts.js` presence + store~writer co-occurrence + journey ordering; `expected.json` schema
  - Surfaced by: Issue 3 + Codex — presence-only is a weak oracle · Verify: reordered-journey fixture fails
- [ ] **T6 (P1, human: ~1.5h / CC: ~15min)** — harness — `stage-skill.sh` (stage canonical skill at eval-time, guard missing source, gitignore staged, idempotent)
  - Surfaced by: Issue 1 (skill-copy drift) · Verify: staging meta-test finds SKILL.md + both reference files
- [ ] **T7 (P1, human: ~4h / CC: ~40min)** — fixtures — `repos/{http-simple,stale-doc-clear,ambiguous-owner}` + `outputs/adversarial/`
  - Surfaced by: Issue 2 + stale-doc split + hybrid adversarial · Verify: golden.md scores 100%
- [ ] **T8 (P1, human: ~1h / CC: ~10min)** — harness — V1 saved-output JS provider
  - Surfaced by: arch note (Promptfoo calls providers) · Verify: provider returns the right file per case
- [ ] **T9 (P1, human: ~2h / CC: ~20min)** — tests — Assert meta-tests: full pass/fail/no-false-fire matrix
  - Surfaced by: Test review · Verify: each assert green on golden, red on its defect, green on others
- [ ] **T10 (P2, human: ~2h / CC: ~20min)** — ci — Two-tier CI (deterministic gate on PR; live lane nightly/dispatch, non-blocking)
  - Surfaced by: Issue 4 · Verify: fork PR stays green with no secrets
- [ ] **T11 (P2, human: ~4h / CC: ~45min)** — providers — V1.5 Claude Agent SDK (skill-used + not-skill-used; FIXED capable model; repeats=3; core subset)
  - Surfaced by: Issue 4 + cross-model model decision · Verify: skill-used on happy path, not-skill-used on near-miss
- [ ] **T12 (P3, human: ~3h / CC: ~30min)** — providers — V2 Codex SDK lane (BLOCKED by distribution-contract TODO)
  - Surfaced by: Codex — `.agents/skills` may not match what ships · Verify: deferred

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 16 raised; 5 changed decisions, 2 → TODOs |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 13 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** Outside voice changed 5 decisions (fixed capable model; presence→relation oracle; stale-doc split; strict MD grammar; mutator→hybrid) and added 2 TODOs (Codex distribution contract, non-gating LLM-judge).
- **CROSS-MODEL:** Codex agreed with Step 0 (Node = repo-policy change), V1-tests-rubric-not-skill, sole-writer hardness, near-miss-is-live-only. Disagreements were all resolved in your favor via AskUserQuestion.
- **UNRESOLVED:** 0.
- **VERDICT:** ENG CLEARED — ready to implement. CEO + Design reviews not run (optional for an internal eval-harness change).
