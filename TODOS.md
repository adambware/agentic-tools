# TODOS

## Pending

- [ ] **loops `e.project`: one worktree's broken Compose file withholds the name in every other worktree** [P2 policy]
  - **What:** Under check 2 (D14), a failing probe of a peer worktree withholds the name everywhere else: `--compose-project` exits 1 and `ENV_CHECK_PROJECT` is empty. A failure of a worktree's own files only keeps the name. So a fresh worktree without its untracked `.env` (its file uses `${VAR:?}`) still gets its own name with a FAIL, while every healthy worktree is refused theirs until someone repairs or removes the broken one.
  - **Why:** The broken worktree is flagged correctly in its own run. The question is whether it should also block everyone else's `docker compose -p`. Developers and agents in the healthy worktrees cannot fix it from where they are, and fresh worktrees without `.env` are the common case.
  - **Context:** Raised by the missed-regression lens during the 0.5.0 /ship (PR #24, 2026-11-02). It is the D14 rule as decided, so it shipped as is. The case for withholding: loops probes the peer without its owner's shell, so a variable they export could put their run on this worktree's name. The case for keeping: the peer's derived name is held without any probe, and a stack the peer has started shows up in check 5 through its container labels. The candidate change: a peer probe failure becomes FAIL keep (the name is handed out, with the FAIL pointing at the peer's file to fix), plus a corpus row for it.
  - **Update 2026-11-04:** A second pilot hit it with the real 0.7.0 engine (Compose 5.5.0, `[compose] mode = "test"`, `derive = "dirname"`). With the overlay its main checkout runs, `--compose-project` exited 1 with empty stdout and `e.project` FAILed 12 times (the running worktree and 11 peers), each `configured run: docker compose config exited 1`. The cause was one `${VAR:?}` in the overlay that the worktrees' `.env` files lack; 3 of the peers had no `.env` at all. That is the same withholding the first pilot hit, so "fresh worktrees lack `.env`" is the common case on two repos.
  - **Depends on / blocked by:** The pilot evidence is in (above). What is left is the policy decision itself: keep D14 withholding, or make a peer probe failure FAIL keep.

- [ ] **`lock.stress.test.ts` fails CI at random — the substitution bound assumes injections are serialized with recovery** [P2 test-robustness]
  - **What:** `never lets two processes into the critical section` asserts `total.substitutions <= injected` (`src/lib/lock.stress.test.ts:207`) after injecting 25 abandoned locks into a live 8-child contention run. It intermittently observes 26. Reproduced locally 1-in-3 on 96a9b1c and 2-in-4 on cf5c7bc, and it reddened `nightshift-engine` on PR #13 with the identical `expected 26 to be less than or equal to 25`.
  - **Why:** It is a false alarm on a load-bearing safety test, which is the worst kind: the assertion that actually proves mutual exclusion — `total.violations === 0` — passes every time, including on the failing runs. A test that cries wolf on the recovery mutex trains everyone to re-run CI, which is exactly how a real de-serialized-recovery regression would get waved through.
  - **Context:** Pre-existing, untouched since `d55fc59` (A1). Surfaced during the PR #13 second review round, 2026-08-23, and confirmed NOT caused by that round — the round touches no lock code, and the failure reproduces on the parent commit. The likely mechanism is that the injector is not synchronized with the recovery mutex it is probing: `injectAbandonedLock` overwrites the lockfile on a fixed 60ms cadence, so an injection landing between a recoverer's stale-check and its write yields a second legitimate substitution for one injection. That is a harness race, not a lock defect.
  - **Depends on / blocked by:** None. The fix must keep the signal the bound exists for — the file header puts a de-serialized recovery at roughly 7x the injected count, so a tolerance well below that still detects it while surviving one straggler. Do not simply delete the bound.

- [ ] **`dedupe` reads before `record` locks — concurrent runs can both log a finding as new** [P1 correctness]
  - **What:** The workflow's stateful chain is `validate && dedupe && record && rollup`, four separate processes. `bin/dedupe` reads the current findings store to classify each candidate `new` / `recurring` / `suppressed` and writes `decisions.json`; only `bin/record`, a process later, takes A1's per-repo lock. Two concurrent runs of the same repo+lane can therefore both read the store before either writes, both classify the same candidate as `new`, and then serialize only the appends — producing two `new` decisions for one `dedupe_key`.
  - **Why:** The findings store folds last-write-wins per `dedupe_key`, so the FINDING list stays correct; the corruption is in the counts. Both runs stamp `confirmed` in their own run rows and both feed the FPR denominator, so the one number the digest and the dashboard exist to report drifts, silently and unrepeatably. Read-classify-write is a wider window than the interleaved-writes case `a7-ops-launcher.md` already reasons about: `bin/record`'s lock closes the write race, not this one.
  - **Context:** Raised against `nightshift.workflow.js:244` during the PR #13 review, 2026-08-23. `docs/v3/a1-run-isolation.md:31-32` does specify a per-repo lockfile "held for the whole durable phase", which is exactly what this is missing. Verified by reading the chain: `dedupe.mjs` has no lock acquisition at all and `record-run.ts:143` is where the lock is first taken. NOT fixed in PR #13 because the fix is the launcher-held lock that `a7-ops-launcher.md:343-356` deliberately defers, for a reason that still stands: A1's lock identifies its holder by a LIVE pid, so holding one across four `bin/` invocations and an hours-long headless run needs a companion holder process — a new `bin/lock --hold` with its own stale policy. Precondition is two concurrent runs of the same repo+lane, which `ns run --due` cannot produce (it is sequential) — it takes two operators, or two terminals.
  - **Depends on / blocked by:** None, but it IS the launcher-held-lock decision. Decide it with the first real concurrent run in front of you, as A7 says.

- [ ] **The dashboard verdict strip still derives failed runs from cost rows alone** [P2 correctness]
  - **What:** `latestFailedRuns` (`src/lib/dashboard-run.ts:340-364`) and `computeHygiene` (`:853`) decide what "needs you" by looking only for cost rows with `status: "error"`. A run row with `reviewed: 0` — which `runRowShortfall` now correctly renders as FAILED on the repo header — is invisible to them, so it counts as a *recovery* that clears an older cost-error alarm.
  - **Why:** The strip is the first thing on the living document and the only part most mornings get read at all. A repo whose one problem is a reviewed-nothing run can show "Nothing needs you" while the repo line directly beneath it says FAILED — the page contradicting itself, in the direction of false calm.
  - **Context:** Surfaced while fixing the lane status line during the PR #13 review, 2026-08-23. Same class of bug, one level up: two surfaces deciding "did this run succeed" independently. The fix is to feed `runRowShortfall` into the verdict/hygiene inputs the same way the lane line now does. Deliberately not done in that pass because the finding scoped to the status line, and changing `latestFailedRuns` alters four dashboard fixture snapshots plus the `failed-run verdict is cleared by a later successful run` suite — real work that deserves its own diff.
  - **Depends on / blocked by:** None.

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

- [ ] **Registry `status` enum conflates freshness with finding state** [P2 model]
  - **What:** `schemas/registry-entry.yml` carries `open-findings` inside a status enum whose other three values (`green | stale | overdue`) all describe *when the area was last reviewed*. Split it: `status` becomes freshness-only, and finding state is derived by joining the findings log on `dedupe_key.surface`.
  - **Why:** One field encodes two orthogonal axes, so an area that is both 57 days overdue **and** carrying an open critical can only be stamped as one of them — the operator loses whichever fact the engine happened to write last. Every consumer (`select`, `record`, `rollup`, the digest skill) has to know that one of the four values means something different in kind from the other three.
  - **Context:** Surfaced by `/plan-design-review` of `local-first-v3-plan.md` (§15.3), 2026-08-23. The operator-visible half is already fixed dashboard-side: WS6 renders two columns and derives freshness from `last_reviewed` + `interval_days`, so nothing is blocked. This TODO is the source-side cleanup. Deferred deliberately — it is a schema change rippling through 4 consumers plus the NovuDesk example pack, outside WS6's scope, and §13's worktree lanes were drawn assuming A1/A2/A6 touch disjoint files.
  - **Depends on / blocked by:** Nothing. Cleanest after nightshift 3.0.0 ships and the two-axis model has proven itself on the dashboard.

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

- [ ] **loops: a failed truncate after a short write leaves the fragment and reports only `short write`** [P3 correctness]
  - **What:** In `appendRow` (`plugins/loops/src/lib/cli.ts`), when a write comes up short and the rollback `fstatSync`/`ftruncateSync` itself fails, the catch swallows it and the error reads only `short write`. The fragment stays in `loops.jsonl` and every later row is appended after it, so one line of history is corrupt with no message saying so.
  - **Why:** It needs a short write (full disk) plus a failed truncate, so it is rare, but the result is silent: the user is told to rerun, not to repair the file.
  - **Context:** Pre-existing since loops 0.1.0; raised by the Codex adversarial pass during the loops 0.2.1 ship (2026-10-03). Fix: when the rollback fails, report that the file needs repair (name the byte offset) instead of a plain short write.
  - **Depends on / blocked by:** None.

- [ ] **loops: sums of safe-integer token counts can still lose precision** [P3 correctness]
  - **What:** 0.2.1 requires each token count and `durationMs` to be a safe integer, but `session.ts` (context sums), `workflow.ts` (token sums) and `row.ts` (aggregates) add them without checking that the total stays safe. Two `MAX_SAFE_INTEGER` values give a silently rounded total with `bad_records` at 0.
  - **Why:** Not reachable with real data (counts are around 1e6), but it is the same class of drift the safe-integer rule was added to catch.
  - **Context:** Raised by the Codex adversarial pass during the loops 0.2.1 ship (2026-10-03). Fix: check `Number.isSafeInteger` on each running sum and count a record bad when it would push the total past it.
  - **Depends on / blocked by:** None.

- [ ] **loops: a symlinked `--out` syncs the link's directory, not the target's** [P3 correctness]
  - **What:** `appendRow` (`plugins/loops/src/lib/cli.ts`) opens `--out` through the symlink but syncs `dirname(out)`, the link's directory. When the target file is new, its directory entry is never synced, so a crash after exit 0 can lose the row.
  - **Why:** `loops.jsonl` is the only history, and this is the one way a run that exited 0 can still lose its row. The default path is not a symlink, so the installed launchd job is not affected; the README lists it under "Not covered".
  - **Context:** Raised by the Codex adversarial pass (labeled P1) during the third loops 0.2.1 ship (2026-10-03); the user chose to defer it. Fix: after the open, also sync `dirname(realpathSync(out))` when it differs from `dirname(out)`, inside `durably`, and drop the README caveat.
  - **Depends on / blocked by:** None.

- [ ] **loops: `syncDir`'s directory close can replace the fsync error or turn a best-effort skip into "not durable"** [P3 correctness]
  - **What:** In `syncDir` (`plugins/loops/src/lib/cli.ts`), `closeSync(dirFd)` runs in a bare `finally`. If `fsyncSync` throws EIO and the close also throws, the close error is reported instead. If the fsync fails with a best-effort code (ENOTSUP) and the close throws, the skip becomes `row written but may not be on disk`.
  - **Why:** Rare (it needs a failing close), but it misreports the cause, or fails a run that should be best effort.
  - **Context:** Raised by the Claude adversarial pass during the third loops 0.2.1 ship (2026-10-03); the user chose to defer it. Fix: guard the close the way `appendRow` does, rethrowing a close error only when the fsync succeeded, and add a mocked-`closeSync` test.
  - **Depends on / blocked by:** None.

- [ ] **loops: parse Agent-tool subagent transcripts into `session_tokens`** [P2 correctness]
  - **What:** `session_tokens` (`plugins/loops/src/lib/session.ts`, `row.ts`) reads main-thread transcripts only; read `<session>/subagents/*.jsonl` too, crediting the parent session's project.
  - **Why:** `tokens_per_merged_pr` understates subagent-heavy work. 0.3.0 documents the gap in the README, the CHANGELOG and the `RepoWindow` comment but does not close it.
  - **Context:** Workflow agents already count in `workflow_tokens`, so the new reader must not double-count them (they are not Agent-tool subagents). Check the transcript layout against real data first. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** M
  - **Depends on / blocked by:** None.

- [ ] **loops: bound the `gh` search to the window and the run's day** [P3 correctness]
  - **What:** In `fetchMergedPrs` (`plugins/loops/src/lib/repos.ts`) query `merged:<since-1d>..<now day>` instead of `merged:>=<since day>`.
  - **Why:** The search is by UTC day, so a PR merged just before `since` on the same day is fetched and filtered, and a PR near the day boundary can be missed. A rerun with an earlier `--now` also over-fetches everything after it, and can hit the `PR_LIMIT` refusal for no reason.
  - **Context:** Filtering to the millisecond already happens after the fetch; this only narrows what `gh` returns. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: `FIX_TITLE` misses "Fixes ..." and "Fixed ..." titles** [P3 correctness]
  - **What:** `FIX_TITLE` in `plugins/loops/src/lib/repos.ts` matches `fix` with a word boundary, so "Fixes ..." and "Fixed ..." are not counted as fix PRs.
  - **Why:** `fix_prs` and the escape proxy undercount for repos that use those verb forms.
  - **Context:** Extend the pattern to `fix(es|ed)?` and add title cases to `repos.test.ts`. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: show `gh` stderr in the failure warning; correct the stale one-call and worst-case notes** [P3 diagnostics]
  - **What:** The catch in `plugins/loops/src/lib/cli.ts` prints only the first line (`Command failed: <cmd>`) of the error. Print the stderr instead, and fix the comment "One gh call per repo" (now two: `repo view`, then `pr list`); state the stalled-repo worst case (about 10 minutes: two 5-minute calls) in the README's timeout sentence.
  - **Why:** The warning names the command but not why it failed (no auth, rate limit, not found), so the operator has to rerun by hand to find out.
  - **Context:** Keep the warning to one line per repo; truncate the stderr. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: `runGh` should append to `PATH`, not prepend** [P3 safety]
  - **What:** `runGh` (`plugins/loops/src/lib/repos.ts`) puts `/opt/homebrew/bin:/usr/local/bin` ahead of the inherited `PATH`. Append them instead.
  - **Why:** launchd's `PATH` has no `gh`, so the extra dirs are a fallback; prepending lets a binary in those dirs shadow the one the user's own `PATH` selects.
  - **Context:** Appending still finds `gh` under launchd. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: warn when a configured repo path is not an existing directory** [P3 correctness]
  - **What:** `loadConfig` / `ownsProject` (`plugins/loops/src/lib/repos.ts`) accept any `path`. Warn when it is not an existing directory, and consider `realpath` so case and symlink differences still match.
  - **Why:** A mistyped or moved path makes the repo read as zero sessions, so `tokens_per_merged_pr` is `null` with no hint why.
  - **Context:** The path is compared with the encoded project dir names, so the check needs to run on the config path, not the transcripts. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: escape-proxy file classification gaps** [P3 correctness]
  - **What:** In the ignore rules of `plugins/loops/src/lib/repos.ts`: stop counting every `.txt` as docs (`CMakeLists.txt` and `requirements.txt` are build inputs); add the Go and Python test patterns (`_test.go`, `test_*.py`, `*_test.py`) and `fixtures/` directories; exclude non-npm manifests (`go.mod`, `Cargo.toml`, `pyproject.toml`, `setup.cfg`, `Gemfile`, `*.gemspec`, `build.gradle`, `pom.xml`, `composer.json`).
  - **Why:** Files every PR touches, or files that are not production code, make PRs look like they caused later fixes. This is the failure the 0.3.0 rules were added for, for repos that are not npm projects.
  - **Context:** `escape_ignore` in the config works around it per repo until this lands. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: `gh pr list` counts PRs merged into any base branch and bot PRs** [P3 correctness]
  - **What:** `fetchMergedPrs` (`plugins/loops/src/lib/repos.ts`) lists every merged PR. Consider `--base <default branch>` and excluding `[bot]` authors.
  - **Why:** A PR merged into a feature branch, or a dependency bot's PR, counts as a merged PR and a candidate for blame, which changes the denominators of the per-PR ratios.
  - **Context:** Decide whether stacked-branch PRs count before changing it. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: stricter config validation** [P3 correctness]
  - **What:** In `loadConfig` (`plugins/loops/src/lib/repos.ts`): reject unknown keys; reject `escape_ignore` entries starting with `/` or `./` (they never match); make the duplicate-slug check case-insensitive; stop `SLUG` allowing a leading `-` segment.
  - **Why:** A typo'd key (`escape_ignored`) or an entry that cannot match is silently ignored, and the numbers are wrong with no signal.
  - **Context:** Refuse the config with a message naming the entry, as the other validation errors do. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: `escaped()` blames PRs with identical `mergedAt` both ways** [P3 correctness]
  - **What:** `escaped` (`plugins/loops/src/lib/repos.ts`) compares `mergedAt` only. Two PRs merged in the same millisecond are both blamed, and a fix with the same timestamp as its target never matches. Break ties by PR number and add a test.
  - **Why:** Rare with real data, but the result depends on array order, so a rerun can differ.
  - **Context:** PR numbers are monotonic in merge order on one repo. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: attribute sessions to a repo by the transcript's recorded `cwd`, not the encoded dir name** [P3 correctness]
  - **What:** `ownsProject` (`plugins/loops/src/lib/repos.ts`) matches the encoded project dir name. Its `--claude-worktrees-` prefix also matches `<repo>/.claude/worktrees-foo` siblings, `/r/a-b` and `/r/a/b` encode to the same name, and Claude Code truncates names over 200 characters with a hash. Read the `cwd` each transcript records instead.
  - **Why:** The encoding is lossy, so a session can be credited to the wrong repo or to none.
  - **Context:** Needs `cwd` kept on the session and run records (`session.ts`, `workflow.ts`); the Workflow run records its own project. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** M
  - **Depends on / blocked by:** None.

- [ ] **loops: kill a hung `gh` with `SIGKILL`** [P3 reliability]
  - **What:** `runGh` (`plugins/loops/src/lib/repos.ts`) passes `timeout` to `execFileSync`, which sends `SIGTERM`. Pass `killSignal: "SIGKILL"`.
  - **Why:** A `gh` that ignores `SIGTERM` can still block the weekly job past the timeout.
  - **Context:** One option on the call; no test is practical beyond a fake runner. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: a rename or access loss between `gh repo view` and `gh pr list` can still read as quiet** [P4 correctness]
  - **What:** `fetchMergedPrs` makes two `gh` calls. If the slug stops resolving between them, `pr list` answers `[]` with exit 0. A single GraphQL query would close it.
  - **Why:** Theoretical: the window is seconds wide.
  - **Context:** Not worth a rewrite unless it is seen. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** M
  - **Depends on / blocked by:** None.

- [ ] **loops: a Workflow run copied into another project's dir takes the project of whichever copy wins the tie** [P3 correctness]
  - **What:** In `plugins/loops/src/lib/workflow.ts`, a run copied into another project's directory is deduped to one record, and the winner (by the tie-break) sets the project. Keep the origin's project.
  - **Why:** Per-repo workflow runs and tokens are credited to the wrong repo.
  - **Context:** The origin is the project dir of the run's own `cwd`, once that is read. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: a session record with a bad context and a bad `output_tokens` counts twice in `bad_records`** [P4 correctness]
  - **What:** In `plugins/loops/src/lib/session.ts`, one record with both an invalid context field and an invalid `output_tokens` adds 2 to `bad_records`.
  - **Why:** Cosmetic: `bad_records` is a drift signal, and an overcount only makes it louder.
  - **Context:** Count once per record. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops: test gaps from the 0.3.0 review** [P3 test-coverage]
  - **What:** Add tests for: `local = sessions || runs` with only one of the two present (only both-or-neither is tested); per-message session tokens when a session straddles the window; the `isBookkeeping` alternatives and a bare `~` path; the `resolves it to nothing` error arm in `repos.test.ts`.
  - **Why:** These branches shipped with no test that fails when they are broken.
  - **Context:** `row.test.ts`, `repos.test.ts`, `session.test.ts`. Deferred from: loops 0.3.0 ship review (2026-10-13).
  - **Effort:** S
  - **Depends on / blocked by:** None.

- [ ] **loops 0.8.0 backlog: features the 0.7.1 pilots asked for** [P2 features]
  - **What:** Eight items cut from 0.7.1 as features: opt-in `a.range` (compare ranges, not only exact pins); optional pin sources (`.nvmrc` and `.tool-versions`, "if present"); a built-in npm `node_modules`-vs-lockfile check; detect a workflow that runs Go with no `setup-go`; a "skip when absent" level for local checks; a compose test mode with `${VAR:?}` interpolation; split the pin check's local severity by major versus minor/patch; run `[[local]]` checks in parallel.
  - **Why:** Each was asked for by one of the four pilot repos during the 0.7.1 review and cut as a feature, not a fix. Without this entry the list lives only in a session note.
  - **Context:** 0.7.1 is fixes-only. Start from the 0.7.1 plan's out-of-scope list. Also open from the 0.7.1 review: a `[[local]]` child that leaves the check's group with `setsid` escapes both the timeout and the interrupt group kill (needs process-tree tracking); if the supervisor is SIGKILLed or its 10 s backstop fires, the local's group is orphaned because the engine does not know the check's pid; on an interrupt the supervisor sends SIGKILL at once instead of forwarding SIGINT with a grace period; CI still runs Node 20 with no `engines` field in `package.json`.
  - **Effort:** L
  - **Depends on / blocked by:** loops 0.7.1 merged.

- [ ] **loops 0.8.0: gaps a later pilot found migrating a Compose + Go repo to env-check (B1-B10)** [P2 features]
  - **What:** Found on 2026-11-04 by moving a pilot repo's own env-check script onto loops 0.7.0. None is patched in the engine; the repo covers them with `[[local]]` checks for now. Each was re-checked against the merged 0.7.1 code.
    - B1: a peer worktree's failing Compose model withholds `e.project` everywhere. Recorded on the D14 entry above as its second data point.
    - B2 (config key): Compose test mode cannot see a main-checkout `-p` name held outside Compose (a project name in the repo's own wrapper env file). The main checkout resolves the dirname and PASSes, `b.containers` SKIPs "stack down" while the real stack runs, and `ENV_CHECK_PROJECT` is wrong for locals. Ask: a `[compose] main_project` key, or treat the main checkout's name as unknown when no running labeled stack has it.
    - B3: `[compose] files` is one set for every checkout, but the main checkout runs base + a non-prod overlay and worktrees run base + `docker-compose.override.yml`.
    - B4: the `dockerfile` pin kind ignores image ARGs. `ARG NODE_IMAGE=node:24-alpine` then `FROM ${NODE_IMAGE}` yields neither a pin nor a range. Ask: resolve `FROM ${ARG}` through the ARG's default.
    - B5: `engines` is never compared against the major pins; a second consumer for `a.range`.
    - B6 (config key): `a.local.<tool>` has no per-pin directory and forces `GOTOOLCHAIN=local` (`env-checks.ts:135`). For a Go module in a subdirectory it reports the installed go, not what `go` there would select, and misses the "will download" case.
    - B7: `d.entrypoints` cannot be "auto" plus an extra list, and does not read pre-commit `language: script` entries.
    - B8 (template): `templates/env-check` hard-codes "see CONTRIBUTING.md" in its not-installed hint (`templates/env-check:25`), which a repo without that file has to add. Also: the wrapper needs a runnable `node` on the host even for repos that run all Node work in containers. The pilot saw its 0.7.0 copy report the engine as not installed (exit 3); the 0.7.1 template instead FAILs `d.tools  node not runnable here` (exit 1), which is clearer but still requires host `node`.
    - B9: there are no row dependencies, so every Docker-dependent local re-probes the daemon and SKIP chains are kept by convention. Ask: a shared daemon probe, or a way for one row to depend on another. (Long locals carrying their own watchdog against timeout orphaning is already on the 0.8.0 backlog above.)
    - B10: when a tool's pins disagree, the pin branch `continue`s (`env-checks.ts:127-130`) before the `a.local.<tool>` probe, so the local row vanishes. No FAIL or WARN is lost, but the installed version goes unreported. Also cosmetic: `redactHome` rewrites `$HOME` to `~` inside fix commands (they still work in a shell).
  - **Why:** These came from a real migration, not a review. Without this entry they live only in a session note.
  - **Context:** Several are config keys (B2, B6), which the 0.7.1 fixes-only rule kept out. B4, B8 and B10 were tagged "0.7.1 fix or 0.8.0" and are still open at 0.7.1.
  - **Effort:** M
  - **Depends on / blocked by:** None. Scope 0.8.0 alongside the backlog entry above.

- [ ] **loops 0.7.2 review-notes backlog: fix the ones a pilot hits** [P3 correctness]
  - **What:** INFORMATIONAL notes below the blocking floor in the 0.7.1 (PR #27) and 0.6.0 (PR #25) reviews, not fixed in either PR. Fix one when a pilot hits it; leave the rest. Line numbers are as reviewed.
    - From PR #27: `pins.ts:328` the go.mod guard is lexical, so a committed symlink (folder or go.mod) still reads outside the checkout, as does every pin source; `pins.ts:305` a SHA or branch ref reads as the current release for every DEFAULTS rule (asserted on purpose in `pins.test.ts`); `env-checks.ts:691` `[[local]]` checks and `a.local` probes still get raw inherited `GIT_*` vars, while env-check's own git uses `gitEnv`; `proc.ts:166` `redactHome` no longer redacts a home glued to a flag or token (`-I/Users/x/inc`, `pkg@/Users/x`), which 0.7.0 did; `env-check.ts:136` a tab in a `[[local]]` message or fix now prints as a literal `\t`, undocumented; `proc.ts:69` `detached: true` gives `[[local]]` checks a new session with no controlling terminal (`/dev/tty` ENXIO), where the docs say only "own process group"; the CHANGELOG's 0.7.1 entry is labeled fixes-only but adds implicit pin sources, the mise fallback and the process-group supervisor; `env-checks.ts:230` the mise fallback ignores PATH order (mise shims, then an unresolved asdf shim, then a system copy PASSes, though mise's fallback reaches the failing asdf shim); `env-checks.ts:223` the inactive-state regex matches anywhere in stderr, so a config path containing that phrase enables the fallback; `pins.ts:394` `install-mode: ""` is read as non-binary, a false FAIL; `env-check.ts:75` a worktree path containing a newline reads as moved, a false FAIL; `pins.ts:330` a versionless golangci-lint-action step with `install-mode: none` FAILs with no hint about install-mode; `pins.test.ts:855` a "Value" header sits above the wrong test.
    - From PR #25, still open after 0.7.1 (which fixed its later notes 1, 2, 4 and 8; line numbers here are not given, since `pins.ts` has moved since): in `compose-config.ts` a Docker-compatible shim without Compose (podman-docker, exit 125) FAILs `e.project` instead of SKIP, with fix text that cannot clear it; in `pins.ts`, for a workflow block-scalar input the unsupported-form line is the scalar's start line; the README's `b.containers` wording merges failed and non-numeric `git log` output, which the code distinguishes; the `readSource` prefix repeats the file the message already names; the Dockerfile directive scan continues past unknown `# name=value` lines and treats an empty `# escape=` as a change (a false FAIL; a non-default escape is already rejected); setup-python's free-threaded `3.13t` is an unsupported FAIL; the `b.containers` FAIL for a failed or garbled `git log` has no fix text; a setup-* range input is an INFO row until `a.range` lands (by design); `pins-matrix.test.ts` checks kind names and files, not the pin, range and "anything else" columns the docs imply; a tracked `[compose]` input missing on disk (sparse checkout) is a FAIL that cannot be cleared from inside that state.
  - **Why:** None blocks a release, and most are narrow or a false FAIL. They live only in two PR bodies, so 0.8.0 scoping would not see them.
  - **Context:** Recorded in the "Review notes" sections of PR #27 and PR #25. Check that a note still reproduces before fixing it.
  - **Effort:** S each
  - **Depends on / blocked by:** None.

- [ ] **loops `zone`: subdirectory `--paths`, hardcoded L0/L7 wording, and the all-SKIP exit code** [P3 correctness]
  - **What:** (1) `zone --paths` run from a subdirectory classifies the paths as given, without rebasing them onto the repo root (`zone-cli.ts:124`), so `cd src && loops zone --paths foo.ts` matches `foo.ts`, not `src/foo.ts`. (2) The `l7: required` line and the "judgment left to L0" lines are hardcoded (`zone-cli.ts:60,76`) instead of read from `risk-zones.md`, so a repo that words its levels differently gets the engine's wording. (3) Open decision: 0.7.1 made an all-SKIP env-check run print `WARN x.none` but kept exit 0. Decide whether a run where nothing was checked should exit nonzero, at least under `--static` or CI.
  - **Why:** (1) gives a wrong zone with no error; (2) lets the output drift from the repo's own policy file; (3) a CI run that verified nothing still reads green to anything that checks only the exit code.
  - **Context:** Found in the 2026-11-04 audit of the loops project. For (1), resolve each path against the cwd, then make it relative to the repo root, and refuse one outside the repo. For (3), a nonzero exit is a behavior change for every consumer; check the pilots' CI first.
  - **Effort:** S
  - **Depends on / blocked by:** None.

## Completed

- [x] **Change detection uses a date, not the reviewed SHA** [P1 correctness]
  - Done: registry entries now carry `last_reviewed_sha` (`schemas/registry-entry.yml`, `RegistryEntry.last_reviewed_sha`) alongside `last_reviewed`. `bin/record` stamps it from the reviewed repo's HEAD sha (`run.json.pack_sha`, itself `git rev-parse HEAD` against `--pack`, which lives inside the reviewed repo) for every actually-reviewed entry, leaving it untouched when git was unavailable (`pack_sha === "no-git"`) rather than stamping a bogus baseline. `src/lib/git.ts`'s `GitRunner.changedFilesSince` now takes `{ sha, date }`: it diffs `<sha>..HEAD` directly when a sha is present, and falls back to the old date-derived `--before=<date>T23:59:59` baseline only when no sha is recorded yet or the sha fails to resolve (shallow clone, rewritten history) — closing the same-day-commit blind spot the TODO described. Both selection call sites (`bin/select` / `src/lib/select-run.ts` and `bin/due` / `src/lib/due.ts`) pass both fields. A non-hex sha (a `--option` or a ref name planted in the reviewed repo's registry) is never handed to git: the runner treats it as unresolvable and `validate` rejects it. Covered by `src/lib/git.test.ts` (new) plus updated `src/lib/record-run.test.ts` and `src/lib/select-run.test.ts` assertions.
  - **Completed:** unreleased (2026-09-26)

- [x] **loops 0.7.1: re-copy `templates/env-check` into the pilot repos** [P1 follow-up]
  - Done: the wrapper went to five repos, not the four named (job-hunter was added). Each got the template byte-for-byte (`git hash-object` a88ab6e4), and each wrapper exited 2 for `LOOPS_BIN=/nonexistent`, 2 for a dangling `LOOPS_BIN` symlink, and 1 with no `node` on PATH. rolodex PR #43 (e5adddb0; also bumped Go to 1.26.10 past a stale golangci-lint v2.1.6), descry PR #48 (5dc6cfa4), bear-euchre PR #39 (v3.0.11, 959b9a84), bearhost PR #610 (v0.11.45.76, da08ec4b; also aligned checkrunner Go pins on 1.27.3 and added a CI pin guard), job-hunter pushed straight to `adam/main` (1785af7). The same pass applied each repo's risk-zones re-zone from research commit 12f0f7f.
  - **Completed:** 2026-11-09

- [x] **loops env-check: `d.tracked` FAILs a deletion being committed in a `git commit -a` pre-commit hook** [P2 correctness]
  - Done: owner decision D-IDX (contract-4). `gitEnv` keeps `GIT_INDEX_FILE` when it names a file directly in this checkout's own git-dir; git-dir discovery runs without it. A real-hook test runs `commit -a` with a deletion in the main checkout and a linked worktree.
  - **Completed:** 2026-11-04 (loops 0.7.1)

- [x] **loops env-check: `safe.directory` passed through env makes env-check exit 2 "not a git repository"** [P2 correctness]
  - Done: owner decision D-CFG (regressions-1). `gitEnv` keeps `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` (with its `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`) and drops `GIT_CONFIG`, as git's `prepare_other_repo_env` does.
  - **Completed:** 2026-11-04 (loops 0.7.1)

- [x] **loops: install the weekly launchd job and run the kickstart proof** [P1 ops]
  - Done: `~/bin/loop-metrics` links into a persistent `main` worktree; the plist runs Mondays 09:00 with an absolute node path. The kickstart exited 0 and wrote a fresh row, and a jq recount of `w7.workflows` matched it exactly. The stable checkout was fast-forwarded to 0.2.1 after PR #18.
  - **Completed:** 2026-10-01 (installed), 2026-10-06 (on 0.2.1)

- [x] **Delete nightshift planning artifacts from repo root** [P1]
  - Done: the seven root planning files were never committed, so there is no git history to rewrite. They were moved to a private archive outside the repo.
  - **Completed:** 2026-10-06

- [x] **loops: parser hardening from the final adversarial round** [P2 correctness]
  - Done (loops 0.2.1): an empty `uuid` or `message.id` is absent (an empty `message.id` falls back and counts bad); token counts must be non-negative safe integers; a future mtime is not live; unknown or non-object `workflowProgress` entries count as drift; the history file's dir (and any dirs made for it) is fsynced every run, best effort where directories cannot be synced; a failed sync says "row written but may not be on disk" and still prints the row. Tests added for `better()`'s path tie-break and, via a mocked `node:fs`, the short-write truncate and both sync-failure paths.
  - **Completed:** loops 0.2.1 (2026-10-03)

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
