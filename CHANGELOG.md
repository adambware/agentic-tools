# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [2.0.0] - 2026-06-18

### Added

- **nightshift plugin** — two-lane, budget-aware assurance loop that keeps security surfaces and user flows continuously covered, refuted, and visible without manual scheduling.
  - `/nightshift:security` — select the stalest/changed registry vectors within a hard K-window budget, fan out the security-reviewer subagent, run the mandatory two-stage refuter gate (Tier-1 haiku always + Tier-2 sonnet on critical/high or low-confidence), dedupe against open findings, log confirmed findings, update registry state, and write durable per-run and daily-rollup metrics.
  - `/nightshift:design` — prerequisite-gated UX review lane; refuses until the pack has a staging browser adapter and seeded `fixtures/personas.yml`. Drives stale/changed flows against staging personas, anchors findings, and shares the run-loop mechanics with the security lane.
  - `/nightshift:onboard` — interactive DETECT → BATCH-CONFIRM → SEED → REVIEW → GATE → WRITE flow; detects the stack, seeds a draft `vectors.yml` from the OWASP ASVS base taxonomy, and reconciles on re-runs without clobbering hand-tuned config.
  - `/nightshift:digest` — weekly management signal: new critical/high findings, repeated themes, overdue surfaces, false-positive rate, and the top 3 human decisions needed. Read-only.
  - `/nightshift:garden` — weekly registry gardening: proposes new entries for code changed since last review, flags orphaned entries and stale area mappings.
  - Two-stage refuter gate with split `rejected_tier1` / `rejected_tier2` counters so false-positive rate is attributable by tier and the "retire Tier-2 if it trends to ~0" decision is measurable.
  - Durable metrics: append-only `metrics/runs/<YYYY-MM>.jsonl` (per-run) and `metrics/daily.jsonl` (day-over-day trend). `merge=union` in `.gitattributes` makes concurrent-branch appends conflict-free; readers use max-ts per `(date, lane)` to handle out-of-order union-merge lines.
  - `pack_format` integer in `manifest.yml` gates future migrations: the engine detects the version and either auto-migrates or fails loudly before writing.
  - NovuDesk worked example — a fully fictional B2B helpdesk pack with seeded vectors, flows, personas, realistic findings, a suppression, and metrics showing both security and design lanes running.
  - CI: `nightshift-ci.yml` — positive example-hygiene gate (reserved-TLD check, no-sentinel check, YAML render-smoke) replacing the old denylist grep.

### Changed

- Plugin renamed from `assurance-engine` to `nightshift`; skill commands are colon-namespaced (`/nightshift:security`, `/nightshift:design`, etc.).
- Example pack genericized from the private BearHost project to the fully fictional NovuDesk.
- Two-stage refuter replaces the single second-reviewer pass; `rejected_by_2nd_reviewer` field retired in favour of split `rejected_tier1` / `rejected_tier2`.
- `design` lane cadence default changed from `weekly` to `off` in the template manifest; design requires explicit opt-in during onboarding.

### Fixed

- `_HYGIENE_TMP` variable was assigned inside the for-loop body but expanded as the loop redirect target — caused `unbound variable` crash under `set -u`, silently voiding the TLD gate. Fixed by initialising before the loop.
- `last_seen` was never bumped when a recurring finding was dropped at dedupe. Dedupe step now updates `last_seen` and `run_id` on the existing open finding so motionless-finding detection stays accurate.
- `daily.jsonl` reader used physical last-line semantics, which break after concurrent branch merges via `merge=union`. All readers updated to use max-ts per `(date, lane)`.
- Dead `| grep -v 'nightshift-ci.yml'` filter in the CI workflow (the file is outside the scan root and was a no-op).
- `security-refuter.md` documentation claimed "context-asymmetric (claim + location only)" but the agent receives the full proposed finding. Docs updated to say "independent re-read, instructed not to rely on the reviewer's narrative."
- `findings_created` in example JSONL was less than `rejected_tier1` alone (impossible values). Fixed to `confirmed + rejected_tier1 + rejected_tier2`; schema clarified that `suppressed` is excluded from this count and tracked separately.
- Prompt-injection guardrails added to security and design SKILL.md: agents now receive only structural dedupe fields from open findings/suppressions (no free-form narrative).
- `/nightshift:security` and `/nightshift:design` SKILL.md listed `findings/` as the open-findings path; correct path is `metrics/findings/<YYYY-MM>.jsonl` (`findings/` holds suppressions only).
- Root README and marketplace description referenced a dead `/nightshift:qa` command; corrected to `/nightshift:security`.
- NovuDesk example missing `fixtures/personas.yml` (design gate prerequisite); file added so the example is internally consistent with its design-lane metrics.
