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

Run working dir: `<repo>/.nightshift/.run/`.

| File | Producer | Consumer | Schema |
|---|---|---|---|
| `surfaces.json` | `bin/select` | reviewer agent (by index) | `surface` |
| `candidates.proposed.json` | reviewer agent | `bin/validate` → refuter → `bin/run-meta` | `candidate-finding` |
| `candidates.json` | refuter agent (survivors) | `bin/validate` → `bin/run-meta` → `bin/dedupe` | `candidate-finding` |
| `reviewed.json` | reviewer agent | `bin/run-meta` | string[] of surface ids actually reviewed (⊆ `surfaces.json` ids, unique) |
| `run.json` | `bin/run-meta` | `bin/record` | run metadata (`RunMeta`) |
| `decisions.json` | `bin/dedupe` | `bin/record` | (internal) |
| `metrics/runs/<YYYY-MM>.jsonl` | `bin/record` | `bin/rollup`, digest | `run-metrics` |
| `metrics/findings/<YYYY-MM>.jsonl` | `bin/record` | dedupe, digest | `finding` |
| `metrics/daily.jsonl` | `bin/rollup` | trends | `daily-metrics` |

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
`candidates.json` (the survivors).

The reviewer also writes `reviewed.json` — the surface ids it **actually** reviewed,
never all-selected. `bin/run-meta` gates it (every id unique and ⊆ the selected
surfaces, abort otherwise) and copies it into `run.json` as `reviewed_ids`;
`bin/record` stamps `last_reviewed`/`status` for those ids **only**, so a
selected-but-unreviewed surface (K > 1) stays stale and is re-selected next run
instead of being silently marked fresh.

## E4 — Thin-shell rule

`nightshift.workflow.js` carries **zero** decision logic — no `if`, score,
threshold, or selection. Every such branch lives in a vitest-covered `bin/` command.
The Workflow sandbox has no FS/Node, so logic there is both untestable and
un-extractable. Any new conditional becomes a `bin/` command with a test.

## E6 — Atomic writes + abort-on-validate-failure

All `bin/` writes are atomic (temp + fsync + rename, `src/lib/io.ts#atomicWrite`) or
a single whole-line jsonl append (`appendJsonl`). `bin/run-meta` runs first (it only
writes the disposable `run.json` under `.run/`), then the record step is chained
`validate(proposed) && validate(survivors) && dedupe && record && rollup` so any
`bin/validate` failure short-circuits **before** durable state is touched. State stays
at last-good; resume picks up there.

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

The model never executes deterministic logic. It calls scripts and reviews code.
