# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [3.0.0] - 2026-08-23

Nightshift v3. The loop now runs **local-first behind one easy button** — `ns run <repo>
security` takes you from nothing to a refreshed dashboard on your own machine, with no
cloud in the run path. This release cuts on a system that has completed a real run, which
is the point: the last five defects below were found by running it, not by reading it.

### Added

- **`bin/ns` — the easy button.** POSIX shell, committed, shellchecked in CI, versioned with the engine. `ns run`, `ns run --due`, `ns status`, `ns dashboard`, `ns digest`, `ns cost add`, `--interactive`. Every decision it looks like it makes is made in vitest-covered TypeScript and handed back as a flat value: `bin/ops-target`, `bin/due`, `bin/workflow-args`, `bin/retain`, `bin/run-outcome`. What is left in the shell is sequencing, environment, and exit paths.
- **The ops home.** `templates/ops/{config.yml,runbook.md}` plus `schemas/ops-config.yml`. The operator's config, runbook, dashboard, digests, evidence and logs live outside every repo and are never committed; nothing operator-specific ships in the engine.
- **`bin/run-outcome`** — the success predicate. A run succeeded iff `bin/record` left its run row, written under the per-repo lock after validate and dedupe. Not "the CLI exited 0", not "the workflow returned complete" — both of which were true of a run that reviewed nothing. A row with `reviewed: 0` against a non-zero `selected` is a failure too.
- **Dynamic Workflow v2** — full-K fan-out over the launcher's pre-chunked surfaces, reviewer + Tier-1 refuter per surface, deterministic merge, conditional Tier-2, then validate → dedupe → record → rollup. Zero conditionals in the workflow file, enforced by a scanner that fails the build if the file adopts a form it cannot see.
- **Per-run isolation** — `.run/<run_id>/` per attempt, a record lock with run_id uniqueness and a provenance assert, `bin/clean`, and one `prune()` for lifecycle retention.
- **The design lane, engine-side** — lane-parameterized workflow, one ux-reviewer per browser adapter, and a preflight that **refuses** a non-loopback `base_url` or a manifest that does not explicitly assert `environment: local|dev|test`. Staging and production are refused by name. Never warn-and-proceed.
- **`--plugin-dir "$ENGINE"` on every session `ns` starts**, so the bins, the agents the workflow dispatches to, and the PreToolUse guard all come from one tree instead of from whatever version happens to be installed.
- **`agent-budgets.test.ts`** — pins every agent's `maxTurns` by snapshot, and asserts no refuter is below 40, because nothing overrides a refuter's budget at dispatch.

### Changed

- **Agent types are plugin-qualified** (`nightshift:security-reviewer`). A plugin agent is addressable by its qualified name; the bare name resolved only if something else happened to provide one. **Breaking** for anything that pinned the bare strings.
- **Turn budgets raised** on evidence: `MODEL_BY_BAND` critical 40→80 and high 32→64; refuters Tier-1 10→40 and Tier-2 16→56. At the old numbers, reviewers on a real critical surface never reached the `Write` that produces their artifacts, and refuters never reached theirs — the chain completed correctly and reviewed nothing.
- **The headless prompt makes waiting the task.** The Workflow tool returns a task id, not a result, and the workflow is killed if the session ends first. `TaskOutput` is now in the default grant: `Workflow,TaskOutput,Read,Glob,Grep,Bash,Write,Agent`.
- `ns` exports `CLAUDE_PLUGIN_ROOT`, which is not set inside a Workflow subagent's Bash environment. The workflow interpolates that literal and relies on the shell to expand it; without the export every plumbing command ran as `node /bin/<name>.mjs`.
- Reviewer and refuter agents refreshed to the current model fleet, with the band→compute table pinned by snapshot so a tier change is a deliberate red-CI event.

### Fixed

- **A run that reviewed nothing reported success**, wrote an `ok` cost row, deleted the run dir holding the only evidence, and refreshed the dashboard to say all was well. The outcome is now read from durable state.
- **`bin/ns` could not find its engine through the documented symlink install.** `dirname $0` of the link made the engine the PATH directory's parent, and because that directory exists the check passed and the error blamed the engine build. It now walks the symlink chain.
- The dashboard regenerates on **every** exit path — success, failure, crash, Ctrl-C, and preflight refusal — via an EXIT trap, after the cost row is written. A failed run that leaves yesterday's dashboard looking fresh is the silent staleness this system exists to prevent.
- SIGINT/SIGTERM now stop the run instead of finalizing and carrying on to invoke the model anyway.
- `ns run --due` no longer feeds its work list to the model on stdin, where the first session swallowed the rest of the sweep.
- A refused run no longer leaves scratch directories inside the operator's repository.

### Upgrading

`ns` has no default ops home — set `NIGHTSHIFT_OPS` or pass `--ops`. Symlink `bin/ns` onto
your PATH rather than copying it, so it stays versioned with the engine it launches. Packs
predating v3 should be re-checked against the current schemas: `pack_format` is still `1`
and is still never read, which is a known gap for the first external adopter.

## [2.4.0] - 2026-08-23

Nightshift v3 lane B: every run's real cost is now recorded and trended, and the
whole fleet is visible in one self-contained local HTML page you can open with no
network. (v3 sessions A2 + A6; the 3.0.0 release cuts after A7.)

### Added

- **`bin/record-cost`** — captures what a run actually cost into a new append-only `metrics/costs.jsonl` (new `cost-record` schema). Status is gated on `is_error` and nothing else: a failed headless run reports `subtype: "success"` right next to `is_error: true`, so keying on `subtype` would file every failure as a free success. A fixture of that exact envelope ships as a regression test. Interactive runs without JSON output can record a `source: "manual"` line instead, and a run with no cost line at all shows up as a visible gap rather than as $0.
- **Cost windows in the daily rollup** — `cost_usd_7d`, `cost_usd_30d`, and `cost_usd_avg_per_run_30d`. Failed runs count toward the totals (a partial burn is still real spend) but are excluded from the per-run average, so one crash cannot make the average look cheap. Additive fields, so `pack_format` stays `1`.
- **`bin/dashboard`** — one self-contained HTML page covering every onboarded repo, regenerated on each run. Opens with no network: no scripts, no remote fonts, no external images. Leads with a verdict strip answering "what needs me?" computed only from pack data, then decisions from the digest, per-repo coverage split into freshness and open findings, sparkline trends for freshness / false-positive rate / cost, and a hygiene strip for orphaned run dirs and missing evidence. Cost lives in the footer and never competes with the alarm.
- Accessibility is enforced, not aspirational: every foreground/background token pair clears WCAG AA 4.5:1 in both light and dark themes, and no state is signalled by colour alone.

### Changed

- The verdict strip now surfaces registry areas that are **due** (past their interval) alongside those that are **overdue**, at a distinct warn severity. A critical-weight area sitting exactly on its interval used to be invisible on the page whose only job is telling you what needs attention. When more items compete than fit, the four shown are the four most severe rather than the first four found.
- `$OPS/config.yml` accepts the documented shape — `lanes: [security, design]` with `enabled: true` and no `name` — and still accepts the older lane-map spelling. A repo with no `name` takes its directory name instead of rendering as "undefined".
- One unreadable repo no longer blanks the page: it is marked unreadable with the parse error, and every other repo still renders.
- Retired the committed `dashboard.md` projection from the pack template and the example pack. The generated HTML replaces it.

### Fixed

- A successful run whose `total_cost_usd` was missing or mistyped was silently recorded as costing $0. It is now refused, the same way a missing `is_error` already was.
- A retried `record-cost` wrote a second row for the same run, double-counting that run's spend in every cost window and in the dashboard footer. Repeated rows are now reduced to the most recent per run.
- A malformed line in `costs.jsonl` produced `NaN` cost totals that landed in `daily.jsonl` as `null` and silently flatlined the cost trend. Cost rows are now validated on read, naming the offending file and line, and the rollup is validated before it is written.
- Cost validation now rejects negative spend, fractional or negative token counts, and impossible calendar dates like `2026-99-99` — which previously passed and then fell outside every date window.
- Trends collapsed two repositories' same-day rows for a lane into one, so a single repo's numbers stood in for all of them. Rows are now reduced per repository before being averaged.
- Suppressions past their expiry date were still displayed as active accepted-risk, contradicting the auto-lift the dedupe engine already applies.
- A failed run kept raising the alarm after a later successful run had already fixed it, when that re-run recorded no cost line.
- Finding anchors used only the surface id, so two repositories sharing a taxonomy id produced duplicate DOM ids and every link jumped to the first repository's card.
- Scanning the evidence store followed directory symlinks, so a symlink cycle could hang the rebuild and a link outward could bill someone else's bytes to the store.

## [2.3.0] - 2026-08-15

### Added

- **`reviewed.json`** — new review-phase artifact: the reviewer records the surface ids it *actually* reviewed, and `bin/run-meta` (new required `--reviewed` flag) gates it deterministically — every id must be a unique member of the selected surfaces, abort (exit 2) otherwise — before copying it into `run.json` as `reviewed_ids`. `selected` and `reviewed` in the per-run metrics are now genuinely independent counts.
- `bin/run-meta` survivor **identity** check: every Tier-1 survivor must match a proposed candidate by canonical `dedupe_key` (multiset subset, the same canonicalization `bin/dedupe` uses). The refuter may remove candidates but can no longer *substitute* different same-count findings that would pass schema validation and keep `rejected_tier1` (the FPR denominator) falsely low.

### Fixed

- With `window_budget_k > 1`, surfaces that were selected but never reviewed were stamped `last_reviewed`/`status: green` as if freshly reviewed (`reviewed_ids` assumed all-selected while the workflow reviews only index 0) — silent registry-freshness corruption that hid un-reviewed vectors. Registry stamping now covers only the ids in `reviewed.json`; unreviewed surfaces keep their state, stay stale, and re-select next run.

## [2.2.0] - 2026-06-22

### Added

- **`bin/run-meta`** — new deterministic engine step that assembles `run.json` (the per-run `RunMeta`) from `surfaces.json`, `candidates.proposed.json` (pre-refute), and `candidates.json` (Tier-1 survivors). Runs first in the record phase so `bin/record` has `run.json` to consume. Computes `rejected_tier1 = proposed_count − survivors_count` and the `reviewed_ids` set; authored as a thin argv shell over `lib/run-meta-build` (zero decision logic). Full-branch vitest coverage (validation throws, no-git fallback, injected date/ts, empty surfaces, blank-run_id guard, survivors-exceed-proposed guard).
- Two-file refute convention wired through the security workflow: the reviewer writes `candidates.proposed.json`, the Tier-1 refuter overwrites `candidates.json` with survivors, and `run-meta` reads both so the pre-refute count is preserved for the false-positive-rate denominator.
- `bin/validate` now gates **both** model-written candidate artifacts (`candidates.proposed.json` and `candidates.json`) before the stateful path, restoring the "validate gates every model-written artifact" invariant.

### Changed

- `findings_created` is now **derived inside `bin/record`** (`confirmed + recurring + rejected_tier1 + rejected_tier2`, i.e. `proposed_count − suppressed`) instead of being injected. `run-meta` cannot compute it because it runs before dedupe and so cannot know how many survivors will be suppressed. A new cross-module test proves the identity end-to-end (run-meta → record).
- The `RunMeta` interface is centralized in `lib/types.ts`; the duplicate inline definition in `bin/record.ts` was removed.

### Fixed

- `run-meta` now aborts (exit 2) on a blank `run_id` (e.g. an empty `run-id.txt` on resume) and when survivors exceed proposed candidates, instead of silently writing a corrupt run record or a negative `rejected_tier1`.

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
