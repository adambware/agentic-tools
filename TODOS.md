# TODOS

## Pending

- [ ] **reviewed_ids must reflect surfaces ACTUALLY reviewed, not all selected** [P1 correctness]
  - **What:** `run-meta` sets `reviewed_ids = surfaces.map(s => s.id)` (every selected surface) and `bin/record` then stamps each reviewed_id `last_reviewed=today` / `status=green` in the registry. But the security workflow's review phase only reviews `surface at index 0`. When `manifest.window_budget_k.security > 1`, the unreviewed surfaces (indices 1..K-1) are silently marked freshly-reviewed/green — staleness corruption that hides un-reviewed vectors.
  - **Why:** Consistent only while K=1 (the spike). The `// same in current scope (all selected = dispatched)` comment in `run-meta-build.ts` documents the simplification, but nothing enforces K=1, so raising the manifest budget silently breaks registry freshness. Fix: fan out one reviewer per selected surface, OR have the review phase emit the set of actually-reviewed ids and thread that into run-meta/record instead of assuming all-selected.
  - **Context:** Surfaced cross-model by Codex adversarial + Claude red-team during /ship of `nightshift-run-meta`. Touches `nightshift.workflow.js` (review fan-out), `run-meta-build.ts:reviewed_ids`, `record-run.ts:99`.
  - **Depends on / blocked by:** None — live the moment K>1. Not triggered in the K=1 spike.

- [ ] **run-meta: verify survivors ⊆ proposed by identity, not just length** [P1 integrity]
  - **What:** `buildRunMeta` now throws if `survivors.length > proposed.length`, but a buggy/hostile Tier-1 refuter could replace proposed candidates with *different* valid findings at the same count — passing the now-mandatory schema validation, getting logged by dedupe/record, and keeping `rejected_tier1` (the FPR denominator) falsely low. Add a dedupe_key-identity subset check: every survivor's `dedupe_key` must exist in the proposed set.
  - **Why:** `rejected_tier1`/`findings_created` are durable FPR metrics; a silent swap corrupts them with valid-looking data. The length guard catches inflation but not substitution.
  - **Context:** Cross-model (Codex P1 + red-team) during /ship of `nightshift-run-meta`. Contained to `run-meta-build.ts`; needs a decision on dedupe_key uniqueness/canonicalization before implementing.
  - **Depends on / blocked by:** None.

- [ ] **Per-run artifact isolation + record run-id cross-check** [P2 concurrency]
  - **What:** All run artifacts share `.nightshift/.run` (`run-id.txt`, `candidates*.json`, `run.json`, `decisions.json`), so two overlapping runs can mix proposed/survivor/decision files. `bin/record` never checks `decisions.run_id/lane/date` against `run.json` before appending durable metrics. Either restore a per-run_id subdir, or have record assert `decisions.run_id === runMeta.run_id` (and lane/date) before writing.
  - **Why:** Concurrent or resumed runs append cleanly to metrics with mismatched provenance — silent corruption that no validate gate catches.
  - **Context:** Codex adversarial during /ship of `nightshift-run-meta`. Pre-existing (run dir was always shared); run-meta makes the cross-check cheap since run.json now carries run_id.
  - **Depends on / blocked by:** None.

- [ ] **queue.jsonl scaling + last-write-wins correctness** [P3 prerequisite]
  - **What:** Before P3 builds the stateful backlog, decide queue.jsonl's growth + concurrency story — monthly sharding OR a `bin/rollup` compaction step (fold to one live record per `dedupe_key`) — and add a `ts` tiebreaker so "last-write-wins per `dedupe_key`" is well-defined after a branch merge.
  - **Why:** Append-only + LWW-per-key means superseded records accrete forever, and rendering `backlog.md` folds the whole file every triage (the review's `scale-1` concern, now on the product's most-read+written file). Without a `ts` tiebreaker, "last write" is line-order-dependent post-merge = nondeterministic triage state.
  - **Context:** Surfaced by /plan-eng-review (perf) + Codex outside-voice (#9). queue.jsonl is introduced in D5/P3 of `nightshift-vision.md`. Reuse the `daily.jsonl` ts-max-wins pattern + monthly-shard convention already in `run-loop.md` (the same `ts` fix is recorded as completed for daily.jsonl below).
  - **Depends on / blocked by:** P3 (backlog). Not in the spike's path.

- [ ] **Lane-polymorphic backlog data model** [P3b design gate]
  - **What:** Before the lane-agnostic core (P3b) + opportunities lane (P4), design how ONE backlog substrate holds heterogeneous lanes. Four specifics: (a) simplify the state machine — `new | accepted | deferred_until | dismissed` (drop redundant `triaged`, which is both a state and a transition); (b) split `candidate / verified / accepted` instead of one `confirmed` (means survived-refutation for security, subjective for design, ~nothing for opportunities); (c) lane-normalize scoring — RICE fits roadmap bets, not security defects; (d) dismissal expiry / content-or-version binding so a substantially-changed surface resurfaces instead of being suppressed forever by `dedupe_key`.
  - **Why:** D6 claims "adding a lane = agent + manifest + verify policy, never engine surgery." That holds only if the backlog record is generic enough for these differences up front. Designing it after security+design are wired risks the exact engine surgery D6 promises to avoid.
  - **Context:** Surfaced by Codex outside-voice (#8/#10/#11/#12) during /plan-eng-review. Touches D5/D6, `schemas/finding.yml`, the queue.jsonl record shape. The spike doesn't need it (security-only).
  - **Depends on / blocked by:** P3 (backlog substrate) done; informs P3b/P4.

- [ ] **Engine install/update/versioning contract** [P1 packaging → P4]
  - **What:** Define how the engine's parts version + update together — the compiled `bin/*.mjs` build artifact (per the Issue-3 decision to author TS, ship node-runnable JS), the per-repo `.nightshift/` pack, the workflow file, command wiring, hooks, and schemas. Specify where the build artifact lives, how a pack detects it's behind the engine (wire the existing-but-unread `pack_format` read-and-branch), and the update path for an onboarded repo.
  - **Why:** Without this, "one public engine" is just local convention — an adopter pulling a new engine version with an old pack (or stale compiled bin/) gets silent incompatibility. Closes the review's `scale-2` (pack_format unread) gap, now larger because compiled JS + a workflow file multiply the compatibility surface.
  - **Context:** Surfaced by /plan-eng-review (distribution check) + Codex outside-voice (#16). Builds on the Issue-3 build step; the build step is the natural place to also stamp the artifact version + compatibility check. Not needed for the spike.
  - **Depends on / blocked by:** Issue-3 build step decided; informs P1 packaging + P4.

- [ ] **Define the Codex distribution contract before building the V2 eval lane**
  - **What:** Decide whether/how `onboardme` ships to Codex and what install path it lands at, before wiring the V2 Codex SDK provider.
  - **Why:** This repo ships `plugins/<name>/skills/...`. The eval plan's V2 lane assumes `.agents/skills/onboardme/SKILL.md`, which is unverified against how Codex actually discovers skills — V2 would otherwise test a hypothetical install shape.
  - **Context:** Surfaced by Codex outside-voice during /plan-eng-review of `onboardme-eval-system-promptfoo.md`. V1 (saved outputs) and V1.5 (Claude Agent SDK, `.claude/skills`) are unaffected. Start by confirming Codex's skill-install convention and whether Codex support is strategic for this marketplace at all.
  - **Depends on / blocked by:** Blocks the V2 provider lane only.

- [ ] **Delete nightshift planning artifacts from repo root** [P1]
  - **What:** Delete `assurance-engine-review-plan.md` and `nightshift-review.md` from the repo root. Also make an explicit git-history decision (accept history vs `git filter-repo`).
  - **Why:** Plan §7 required this one-time cleanup before shipping nightshift 2.0.0. Deferred via /ship.
  - **Context:** Files are currently untracked (not committed). Clean up on the next commit.

- [ ] **Non-gating LLM-judge relational signal for the onboardme eval**
  - **What:** A separate Promptfoo `llm-rubric` run that grades deeper relational/semantic correctness (full sole-writer ownership, paraphrased facts) beyond the deterministic asserts — reported, never blocking.
  - **Why:** The deterministic presence + relation checks have a ceiling: the hardest "sole writer / no other writer" cases and legitimate paraphrase can't be settled by token/co-occurrence checks alone.
  - **Context:** Surfaced during /plan-eng-review. Keep the gate deterministic for now; add the judge as an advisory layer once the deterministic gate is stable so a flaky judge never blocks a PR.
  - **Depends on / blocked by:** Stable deterministic gate (V1) first.

## Completed

- [x] **P1 spike — deterministic core (nightshift-vision §12 T1–T7)**
  - Done: built the TypeScript core under `plugins/nightshift/src/` shipped as bundled, node-runnable, zero-install `bin/*.mjs` + `hooks/guard.mjs` (E5 build step via esbuild; `scripts/build.mjs`).
    - **T1/E7** `bin/select` with full-branch vitest (empty/malformed/missing registry, unset `last_reviewed`→max-stale, interval-from-weight, no-git, glob hit/miss, K=0, K>size, score ties→weight, atomic write); `today`/git injected for determinism.
    - **T3/E6** real `bin/dedupe` + `bin/record` + `bin/validate` (+ `bin/rollup`): atomic writes (temp+fsync+rename / whole-line jsonl), validate-gate aborts the run before durable state is touched.
    - **T2/E2/E3** files-not-text + judgment-artifact contracts in `CONTRACTS.md` + `schemas/candidate-finding.yml`; `bin/validate` enforces the machine validators (`src/lib/validate.ts`).
    - **T4/E5** plugin build step → committed compiled artifacts; CI (`nightshift-ci.yml` `nightshift-engine` job) runs typecheck+vitest+build and fails on stale artifacts.
    - **T5/E4** thin `nightshift.workflow.js` (zero decision logic; sequences plumbing + judgment).
    - **T7** `skills/security/reference/run-loop.md` split along the determinism boundary — deterministic formulas now point to the owning `bin/` script + schema; judgment protocol (two-tier refuter, anchor) stays prose.
  - Verified: 146 vitest tests green; full deterministic pipeline round-trips on a NovuDesk copy (select→validate→dedupe→record→rollup, registry state + metrics jsonl); guard blocks out-of-bounds writes + git mutation and allows `.nightshift/` writes + read-only git; malformed candidate → validate exit 1 → abort.
  - **Remaining spike go/no-go (runtime, your plan):** #1 billing (Workflow + `agent()` bill to subscription, not the non-interactive pool) and #7 full per-agent context cost — both require an actual `/nightshift:security` workflow run against a real repo on your plan; the deterministic core is independent of the outcome. Guard-in-workflow (#3) is proven against the hook directly; confirm it also fires *inside* a Workflow `agent()` during that run.

- [x] **Fix reconcile mode visibility (onboarding-4)**
  - Done: added reconcile-mode paragraph to README "Onboarding a codebase" section; added (auto)-field warning + reconcile-mode comment block to template `manifest.yml`.

- [x] **Add `ts` field to `daily-metrics.yml` for merge-safe last-line-wins semantics**
  - Done: added `ts` to `schemas/daily-metrics.yml`, `run-loop.md` daily rollup spec, NovuDesk `daily.jsonl` example records, and NovuDesk `runs/2026-06.jsonl`.

- [x] **Add design lane metrics to NovuDesk example pack**
  - Done: added 2 synthetic design run records to `examples/novudesk/.nightshift/metrics/runs/2026-06.jsonl` and 2 design lane daily records to `metrics/daily.jsonl`.
