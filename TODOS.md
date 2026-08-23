# TODOS

## Pending

- [ ] **`ns digest` spends real money and records no cost row** [P2 cost-accounting]
  - **What:** `cmd_digest` (`plugins/nightshift/bin/ns`) invokes `$CLAUDE_BIN -p` for a real model call but never calls `bin/record-cost.mjs` — the only two call sites are the run path and `ns cost add`. A live digest run on 2026-08-23 cost roughly $0.30-1 and left `costs.jsonl` at 5 rows, zero of them digest rows.
  - **Why:** Same class as the orphan-spend gap already known for runs, but worse: this spend is not merely unjoined to a run row, it is never written at all. `ns status` and the dashboard cost trend under-report every week the operator produces a digest.
  - **Context:** Found by the first live `ns digest` run during /ship of 3.0.0. Deliberately NOT fixed there because it needs a design call that should not be improvised at ship time: a digest is not a run, so what `run_id` and `lane` does its cost row carry, and does it belong in `costs.jsonl` at all or in a separate ledger? The sibling parser defect found by the same run WAS fixed in 3.0.0.
  - **Depends on / blocked by:** None. Touches A2 (`record-cost`) territory.

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
  - **Escalated 2026-08-23** (Codex outside-voice #10, /plan-eng-review of `local-first-v3-plan.md`): nightshift v3 changes schemas (`cost-record.yml`, `Surface.dispatch`), bin surface (+6 commands), workflow behavior, and pack projections (retires committed `dashboard.md`) while `pack_format` stays `1` and is still never read. An onboarded pack predating v3 can therefore fail silently under the new engine. v3 ships anyway per the operator's 2026-08-23 decision (only bearhost + NovuDesk exist, both updated in-repo), but this TODO is now a release blocker for the FIRST external adopter, not just a P4 nicety.
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

- [ ] **Refuters can mutate a candidate's severity/confidence/evidence** [P1 integrity]
  - **What:** `buildRunMeta` matches survivors to proposed candidates by canonical `dedupe_key` only (`src/lib/run-meta-build.ts:130`). Every other field — `severity`, `confidence`, `location`, `evidence`, `why_abusable_under_preconditions` — is unchecked, so a refuter can rewrite them and the altered values are what get durably logged. Fix: refuters emit keep/drop decisions keyed by candidate identity; `bin/` reassembles the durable record from the ORIGINAL proposed object, never from the refuter's rewrite.
  - **Why:** The survivor-identity check (added in v2.3.0) closed substitution but not mutation. It matters more after nightshift v3: `bin/tier2-gate` routes on the union predicate "critical/high severity OR low confidence", so a refuter editing `severity` now steers which findings get the expensive Tier-2 pass — and a refuter downgrading severity can route a real critical finding away from Tier-2 entirely.
  - **Context:** Codex outside-voice (#7) during /plan-eng-review of `plugins/nightshift/docs/local-first-v3-plan.md`, 2026-08-23. Verified by reading `src/lib/run-meta-build.ts:112-132` — the comment there explicitly reasons about substitution and count, never about field mutation. Pre-existing in v2.3.0; deliberately deferred out of v3 so A4 does not absorb a sixth concern. Start at `candidateKey()` and the `proposedKeys` multiset.
  - **Depends on / blocked by:** None. Cleanest as its own branch with its own tests.

- [ ] **Change detection uses a date, not the reviewed SHA** [P1 correctness]
  - **What:** `src/lib/git.ts:24` derives the diff baseline as `git rev-list -1 --before=<last_reviewed>T23:59:59 HEAD`. A commit landing the SAME DAY but AFTER a review is at-or-before that timestamp, so it becomes its own baseline and its changes never appear in the diff. Fix: store the exact reviewed HEAD sha on the registry entry at record time and diff from `<sha>..HEAD`.
  - **Why:** Those edits are invisible to `change_flag` until pure staleness eventually re-selects the surface — up to `interval_days` later (90 days for a low-weight vector). Worse for v3: WS8's sentinel is specified as due when "commits touching any registry area since last run", so the sentinel inherits this blind spot directly and a same-day hotfix to a critical surface would not trigger a run.
  - **Context:** Codex outside-voice (#11) during /plan-eng-review, 2026-08-23. Verified by reading `src/lib/git.ts:11-40`. `registry-entry.yml` already carries `last_reviewed` as `(auto)`; adding `last_reviewed_sha` alongside it is the natural shape. `bin/record` is where the stamp is written, `bin/select` is where the baseline is read.
  - **Depends on / blocked by:** None, but should land BEFORE WS8/A9 or the sentinel ships with the blind spot.

- [ ] **Multi-repo identity: config entries need a stable slug** [P2 scale]
  - **What:** `$OPS/config.yml` identifies repos by filesystem path only. `ns run <repo>`, `$OPS/digests/<repo>.md`, and `$OPS/evidence/<repo>/` all key off a name derived from that path, so two repos with the same basename collide. YAML `~` expansion is also unspecified. Fix: require an explicit unique `slug` per config entry plus a canonicalized absolute path, and key every generated artifact on the slug.
  - **Why:** WS6's dashboard is explicitly multi-repo ("covering **all** onboarded repos"), so identity collisions corrupt the one artifact the whole delivery revamp exists to produce. Silent, too: a colliding digest just overwrites.
  - **Context:** Codex outside-voice (#14) during /plan-eng-review, 2026-08-23. Harmless while bearhost is the only onboarded repo, which is why it is deferred. Becomes live the moment a second repo is added to `config.yml`.
  - **Update 2026-08-23 (v2.4.0):** `bin/dashboard` now derives a repo's display name from the path basename when `name` is absent, which fixes the "undefined" rendering but makes the collision this TODO describes MORE reachable, not less — two repos whose paths end in the same basename now share a name, a digest file, and an evidence directory. Still harmless with one onboarded repo; still must land before repo #2.
  - **Depends on / blocked by:** WS6/WS7 shipped. Do it before onboarding repo #2.

- [ ] **"No cloud anywhere" contradicts WS8's scheduler option** [P3 docs]
  - **What:** `local-first-v3-plan.md` §1 goal 1 states "No cloud sessions, no cloud routines, anywhere in the run path", but WS8 leaves the scheduler as "a local Claude Code routine (or a plain launchd/cron job — decided at implementation)". If local-only is locked, the decision is already made: launchd or cron. Delete the routine option.
  - **Why:** A stated non-negotiable and an open implementation choice that violates it cannot both be true. Whoever implements A9 will reasonably pick either one.
  - **Context:** Codex outside-voice (#15) during /plan-eng-review, 2026-08-23. One-line edit to WS8. Filed rather than fixed inline only because WS8 is the last workstream and gated on a two-week soak.
  - **Depends on / blocked by:** Nothing. Fix when A9 starts.

- [ ] **`validateCandidateFinding` never type-checks `evidence`** [P1 correctness]
  - **What:** `src/lib/validate.ts` validates a candidate finding without constraining `evidence` to a string. A model-emitted `evidence: []` (or a number, or an object) passes the gate and is persisted to `metrics/findings/`. `bin/dashboard` then hands that value straight to `isAbsolute()` in `src/lib/dashboard-cli.ts`, which throws on a non-string — so every subsequent dashboard rebuild dies until someone hand-edits the JSONL. Fix: require `evidence` to be a normalized relative `evidence/...` string, and reject URL schemes and `../` traversal while you are there.
  - **Why:** The value is model-controlled and it lands in durable state, so one bad emission is permanently wedged in the pack. Nightshift v3 A6 raises the cost: the dashboard is now THE living document regenerated on every `ns` exit path, so a crash there means the operator's only view of every repo goes stale with no visible reason.
  - **Context:** Codex adversarial pass during /ship of nightshift v3 lane B, 2026-08-23. Pre-existing in `validate.ts` (predates A6), but A6 added the crash surface, so it was deliberately kept out of lane B's diff rather than fixed inline. Start at `validateCandidateFinding` and the `evidence` field; `dashboard-cli.ts` `loadRepo()` is the consumer.
  - **Depends on / blocked by:** None. Own branch, own tests.

## Completed

- [x] **Per-run artifact isolation + record run-id cross-check** [P2 concurrency]
  - Done (v3.0.0): BOTH halves of the either/or landed. A1 restored per-run isolation (each run gets its own `.nightshift/.run/<run-id>/` dir, self-cleaning on success and retained on failure), and `runRecord` now opens with a provenance assert — `src/lib/record-run.ts:118-132` refuses the run unless `decisions.run_id`, `decisions.lane` and `decisions.date` all match run-meta, so a stale or forged `decisions.json` can never be replayed into another run's durable appends. Backed by run_id uniqueness across every month shard and the per-repo lock around the append.
  - **Completed:** v3.0.0 (2026-08-23)

- [x] **reviewed_ids must reflect surfaces ACTUALLY reviewed, not all selected** [P1 correctness]
  - Done (v2.3.0): the reviewer now writes `reviewed.json` (ids actually covered); `bin/run-meta` takes a required `--reviewed` flag, gates the file (each id a unique member of the selected surfaces, abort exit 2 otherwise), and threads it into `run.json.reviewed_ids` — so `bin/record` stamps `last_reviewed`/`status` only for actually-reviewed entries. `selected` and `reviewed` are now independent counts. Cross-module test proves a K=3/reviewed=1 run stamps exactly one registry entry.

- [x] **run-meta: verify survivors ⊆ proposed by identity, not just length** [P1 integrity]
  - Done (v2.3.0): `buildRunMeta` matches every survivor to a proposed candidate by canonical `dedupe_key` string (reuses `dedupeKeyString` — the same canonicalization `bin/dedupe` uses; that settles the canonicalization decision) with multiset semantics, so duplicated survivor keys can't outnumber their proposed occurrences and substitution aborts the run before any durable write.

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
