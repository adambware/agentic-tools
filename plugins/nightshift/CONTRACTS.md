# Engine contracts — the seams the build must honor

The nightshift engine is a three-part split: **deterministic core** (`bin/*.mjs`,
free via Bash, vitest-covered), **orchestration** (`nightshift.workflow.js`,
subscription, no disk), and **judgment** (reviewer/refuter agents, subscription).
These are the load-bearing contracts between them. Each is enforced in code, not
prose (D1).

## E2 — Files-not-text

`bin/` scripts read inputs from / write outputs to disk. A **plumbing** `agent()`
call only *invokes* a script and returns its **exit code + stderr tail** — artifact
data never passes through the model's text channel. `bin/validate` gates each
plumbing turn (fail loud, abort).

Run working dir: `<repo>/.nightshift/.run/<run_id>/` (per-run, A1 layout).

| File | Producer | Consumer | Schema |
|---|---|---|---|
| `surfaces.json` | `bin/select` | reviewer agent (by index) | `surface` |
| `surfaces/<sid>/reviewed.json` | reviewer agent (per surface) | `bin/merge-candidates` | string[] |
| `surfaces/<sid>/candidates.proposed.json` | reviewer agent (per surface) | Tier-1 refuter → `bin/merge-candidates` | `candidate-finding` |
| `surfaces/<sid>/candidates.json` | Tier-1 refuter (per surface, survivors) | `bin/merge-candidates` | `candidate-finding` |
| `reviewed.json` | `bin/merge-candidates` (deterministic union of per-surface dirs that produced complete artifacts) | `bin/run-meta` | string[] of surface ids actually reviewed (⊆ `surfaces.json` ids, unique) |
| `candidates.proposed.json` | `bin/merge-candidates` | `bin/validate` → `bin/run-meta` | `candidate-finding` |
| `candidates.json` | `bin/merge-candidates` | `bin/validate` → `bin/tier2-gate` (both modes) → `bin/run-meta` | `candidate-finding` |
| `tier2.json` | `bin/tier2-gate` | workflow; cross-checked (never trusted) by `--assemble` | string[] (control-plane gated surface ids) |
| `tier2.pass.json` | `bin/tier2-gate` | none — diagnostic only (`--assemble` recomputes the split) | `candidate-finding` |
| `surfaces/<sid>/tier2.pending.json` | `bin/tier2-gate` | Tier-2 refuter agent (prompt input only; `--assemble` recomputes) | `candidate-finding` |
| `surfaces/<sid>/tier2.survivors.json` | Tier-2 refuter agent | `bin/tier2-gate --assemble` | `candidate-finding` |
| `candidates.tier2.json` | `bin/tier2-gate --assemble` | `bin/validate` → `bin/run-meta` (`--tier2`) → `bin/dedupe` | `candidate-finding` (post-Tier-2 survivor set the stateful path consumes) |
| `run.json` | `bin/run-meta` | `bin/record` | run metadata (`RunMeta`) |
| `decisions.json` | `bin/dedupe` | `bin/record` | (internal) |
| `metrics/runs/<YYYY-MM>.jsonl` | `bin/record` | `bin/rollup`, digest | `run-metrics` |
| `metrics/findings/<YYYY-MM>.jsonl` | `bin/record` | dedupe, digest | `finding` |
| `metrics/daily.jsonl` | `bin/rollup` | trends | `daily-metrics` |
| `metrics/costs.jsonl` | `bin/record-cost` | `bin/rollup`, dashboard | `cost-record` |

Control-plane id lists (surface ids, run ids) MAY ride the model's structured-output
channel — that is how the workflow learns which Tier-2 refuters to dispatch — but
finding DATA never does; candidates move only via schema'd files gated by
`bin/validate`. E2/E3 remain intact.

## E3 — Judgment-agent artifact contract

Two files split the pre- and post-refute candidate sets (both `candidate-finding`
schema). The reviewer writes its proposed finding(s) to `candidates.proposed.json`;
the Tier-1 refuter re-reads each candidate and overwrites `candidates.json` with only
the survivors (empty array ⇒ nothing logged — "no Tier-1 refute → no finding"). The
reviewer never logs anything itself. `bin/validate --schema candidate-finding` MUST
pass on **both** files before the stateful path consumes them — a malformed candidate
in either fails validation and **aborts** the run. `bin/run-meta` reads both so the
pre-refute count survives the refute step: `rejected_tier1 = proposed_count −
survivors_count`, the false-positive-rate denominator — and additionally enforces
**survivor identity**: every survivor must match a proposed candidate by canonical
`dedupe_key` (multiset ⊆), so a refuter can remove candidates but never substitute
different ones at the same count. `bin/dedupe`/`bin/record` then consume only
`candidates.tier2.json` (the post-Tier-2 survivor set) — rewiring them back to
`candidates.json` would silently disable the Tier-2 gate, so the workflow's record
chain is part of this contract.

The reviewer also writes `reviewed.json` — the surface ids it **actually** reviewed,
never all-selected. `bin/run-meta` gates it (every id unique and ⊆ the selected
surfaces, abort otherwise) and copies it into `run.json` as `reviewed_ids`;
`bin/record` stamps `last_reviewed`/`status` for those ids **only**, so a
selected-but-unreviewed surface (K > 1) stays stale and is re-selected next run
instead of being silently marked fresh.

The Tier-1 guarantee above is unchanged: no Tier-1 refute → no log. `bin/tier2-gate`
applies the deterministic union predicate (`critical`/`high` severity OR
`confidence == low`) to Tier-1 survivors; gated candidates get an independent Tier-2
re-read. The Tier-2 refuter may only **remove**, never substitute — same canonical
`dedupe_key` multiset gate, enforced by `bin/tier2-gate --assemble` and again by
`bin/run-meta --tier2`, which computes the real `rejected_tier2` (the second FPR
numerator term). `--assemble` trusts nothing it did not recompute: the gate split is
re-derived from `candidates.json` and `tier2.json` is only cross-checked against it,
so a control-plane list altered between gate and assemble aborts. A missing
per-surface `tier2.survivors.json` aborts the run before `run-meta`, so a crashed
Tier-2 refuter can never stamp or corrupt accounting. Surface-dir and artifact-file
containment is **physical** (lstat + realpath, `src/lib/contain.ts`), not just
lexical: a symlink anywhere under `surfaces/` aborts rather than routing reads or
writes outside the run dir.

**Known limitation (accepted, documented):** artifact immutability *between* chain
stages is not enforced. Judgment agents hold `Write` scoped only by the read-only
guard (anything under `.nightshift/`), so a misbehaving agent could rewrite an
EARLIER stage's artifact consistently (e.g. shrink `candidates.proposed.json` and
`candidates.json` together) and shift counts without tripping any gate; likewise the
engine cannot distinguish WHICH agent wrote a surface dir, only that its content is
bound to that surface. The mitigations are the agent prompts, the guard, and Tier-1's
equal exposure (this predates Tier-2); cryptographic stage-hashing is deferred.

## E4 — Thin-shell rule

`nightshift.workflow.js` carries **zero** decision logic — no `if`, score,
threshold, or selection. Every such branch lives in a vitest-covered `bin/` command.
The Workflow sandbox has no FS/Node, so logic there is both untestable and
un-extractable. Any new conditional becomes a `bin/` command with a test. The fan-out
merge (partial-failure union), the Tier-2 predicate, and Tier-2 assembly are all
`bin/` commands for exactly this reason; per-surface dispatch (`model`, `effort`,
`maxTurns`) is computed by `bin/select` (`MODEL_BY_BAND`) and passed through the
workflow verbatim as data.

**Lane parameterization is data, not a branch.** The registry path and the three
judgment `agentType`s (reviewer, Tier-1 refuter, Tier-2 refuter) are likewise computed
launcher-side by a vitest-covered command — `bin/lane-plan` (tables `REGISTRY_BY_LANE`,
`AGENTS_BY_LANE`, `UX_REVIEWER_BY_ADAPTER`) — and arrive as `args.registry` /
`args.agents.*`, exactly like `MODEL_BY_BAND`. There is no lane lookup table and no
lane conditional in the sandbox: the workflow reads those members and interpolates
`args.lane` into prompts, nothing more. `bin/lane-plan` doubles as the fail-fast lane
gate (design refuses without a browser adapter, a **loopback** `base_url`, an explicit
non-production `browser.environment`, and seeded personas), so a misconfigured — or unsafe
to drive — pack never reaches Claude.

**The launcher carries three obligations the sandbox cannot meet (A7).** The Workflow
sandbox has no `process` and no fs, so `bin/ns` — and any future launcher — MUST:

1. invoke `bin/lane-plan` as `--pack .nightshift` **with cwd at the repo root**.
   `bin/lane-plan` carries `--pack` through verbatim (absolute in, absolute out) while
   the workflow's `PACK`/`RUN` are hardcoded repo-root-relative literals interpolated
   into the SAME `record` and `rollup` command lines — so any other `--pack` silently
   pairs one pack's registry with a different pack's metrics dir;
2. **arm the read-only guard** by exporting `NIGHTSHIFT_LANE_RUN=1` and
   `NIGHTSHIFT_RUN_ID` — the guard cannot self-arm from inside the run;
3. export one `NIGHTSHIFT_TODAY` for the whole run (`run-meta` and `dedupe` resolve
   "today" in separate agent turns, and a run straddling UTC midnight would abort at
   `record`'s provenance date assert) and mint a **fresh run id per attempt, retries
   included** (`merge-candidates` has no notion of artifact freshness, so a reused run
   dir would resurrect a prior aborted attempt's artifacts as this run's coverage).

The workflow's own ARGS CONTRACT header states all three, and
`src/lib/ns-launcher.test.ts` probes each against the real launcher.

**Load-bearing constraint:** *no* dispatch API accepts a tools list. A subagent's tools
come from its agent-file frontmatter and nowhere else. A per-adapter tool grant is
therefore expressed as a per-adapter **concrete agent file** (`agents/ux-reviewer-<adapter>.md`,
selected by `bin/lane-plan` from `manifest.stack_adapter.browser.tool`) — never as a
grant made at dispatch. Any wording anywhere in this repo that says the orchestrator
injects, scopes, or grants a tool at dispatch describes a capability that does not
exist and is a bug to be fixed.

## E6 — Atomic writes + abort-on-validate-failure

All `bin/` writes are atomic (temp + fsync + rename, `src/lib/io.ts#atomicWrite`) or
a single whole-line jsonl append (`appendJsonl`). The merge phase chains
`merge-candidates && validate(proposed) && validate(survivors)`; `bin/run-meta` runs
first in the record phase (it only writes the disposable `run.json` under `.run/`),
then `validate(candidates.tier2.json) && dedupe && record && rollup` — every
model-written candidate set is validated before the stateful path, and any failure
short-circuits **before** durable state is touched. State stays at last-good. A crash
*after* `bin/record`'s claim marker exists is deliberately NOT resumable by rerunning:
the claim (plus the per-repo lock and provenance assert, A1/T5) makes partial state
diagnosable and refuses a naive retry loudly instead of double-appending the FPR
denominator — a retry needs a fresh run_id and run dir.

## Determinism boundary (D1)

| Owned by CODE (`bin/`, tested, free) | Owned by the MODEL (subscription) |
|---|---|
| select stalest/changed within K (`bin/select`) | read code → propose candidate |
| assemble `run.json` + `rejected_tier1` count (`bin/run-meta`) | attempt to refute a candidate |
| compute `dedupe_key`, collision/suppression drop (`bin/dedupe`) | judge UX against anchors (design) |
| write per-run + findings + registry state (`bin/record`) | |
| FPR / freshness / median-staleness math (`bin/rollup`) | |
| schema validation of every artifact (`bin/validate`) | |
| read-only guard, source + git (`hooks/guard`) | |
| union per-surface artifacts, bind candidates to surfaces (`bin/merge-candidates`) | Tier-2 deeper re-read of a gated survivor |
| Tier-2 union predicate + assembly (`bin/tier2-gate`) | |
| band → dispatch `{model, effort, maxTurns}` (`bin/select`, `MODEL_BY_BAND`) | |
| lane → registry + judgment agentTypes, design-lane prerequisite gate (`bin/lane-plan`) | |

The model never executes deterministic logic. It calls scripts and reviews code.
