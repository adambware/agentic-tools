# TODOS

## Pending

- [ ] **Define the Codex distribution contract before building the V2 eval lane**
  - **What:** Decide whether/how `onboardme` ships to Codex and what install path it lands at, before wiring the V2 Codex SDK provider.
  - **Why:** This repo ships `plugins/<name>/skills/...`. The eval plan's V2 lane assumes `.agents/skills/onboardme/SKILL.md`, which is unverified against how Codex actually discovers skills — V2 would otherwise test a hypothetical install shape.
  - **Context:** Surfaced by Codex outside-voice during /plan-eng-review of `onboardme-eval-system-promptfoo.md`. V1 (saved outputs) and V1.5 (Claude Agent SDK, `.claude/skills`) are unaffected. Start by confirming Codex's skill-install convention and whether Codex support is strategic for this marketplace at all.
  - **Depends on / blocked by:** Blocks the V2 provider lane only.

- [ ] **Non-gating LLM-judge relational signal for the onboardme eval**
  - **What:** A separate Promptfoo `llm-rubric` run that grades deeper relational/semantic correctness (full sole-writer ownership, paraphrased facts) beyond the deterministic asserts — reported, never blocking.
  - **Why:** The deterministic presence + relation checks have a ceiling: the hardest "sole writer / no other writer" cases and legitimate paraphrase can't be settled by token/co-occurrence checks alone.
  - **Context:** Surfaced during /plan-eng-review. Keep the gate deterministic for now; add the judge as an advisory layer once the deterministic gate is stable so a flaky judge never blocks a PR.
  - **Depends on / blocked by:** Stable deterministic gate (V1) first.

- [x] **Add `ts` field to `daily-metrics.yml` for merge-safe last-line-wins semantics**
  - Done: added `ts` to `schemas/daily-metrics.yml`, `run-loop.md` daily rollup spec, NovuDesk `daily.jsonl` example records, and NovuDesk `runs/2026-06.jsonl`.

- [x] **Add design lane metrics to NovuDesk example pack**
  - Done: added 2 synthetic design run records to `examples/novudesk/.nightshift/metrics/runs/2026-06.jsonl` and 2 design lane daily records to `metrics/daily.jsonl`.

## Completed
