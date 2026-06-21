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
| `candidates.json` | reviewer + refuter agents | `bin/validate` → `bin/dedupe` | `candidate-finding` |
| `decisions.json` | `bin/dedupe` | `bin/record` | (internal) |
| `run.json` | orchestrator plumbing | `bin/record` | run metadata |
| `metrics/runs/<YYYY-MM>.jsonl` | `bin/record` | `bin/rollup`, digest | `run-metrics` |
| `metrics/findings/<YYYY-MM>.jsonl` | `bin/record` | dedupe, digest | `finding` |
| `metrics/daily.jsonl` | `bin/rollup` | trends | `daily-metrics` |

## E3 — Judgment-agent artifact contract

Reviewer/refuter agents write their candidate finding to `candidates.json`
(`candidate-finding` schema). `bin/validate --schema candidate-finding` MUST pass
before `bin/dedupe`/`bin/record` consume it. A malformed candidate fails validation
and **aborts** the run. The reviewer never logs anything itself; the refuter
overwrites `candidates.json` with only the survivors (empty array ⇒ nothing logged —
"no Tier-1 refute → no finding").

## E4 — Thin-shell rule

`nightshift.workflow.js` carries **zero** decision logic — no `if`, score,
threshold, or selection. Every such branch lives in a vitest-covered `bin/` command.
The Workflow sandbox has no FS/Node, so logic there is both untestable and
un-extractable. Any new conditional becomes a `bin/` command with a test.

## E6 — Atomic writes + abort-on-validate-failure

All `bin/` writes are atomic (temp + fsync + rename, `src/lib/io.ts#atomicWrite`) or
a single whole-line jsonl append (`appendJsonl`). The record step is chained
`validate && dedupe && record && rollup` so any `bin/validate` failure short-circuits
**before** durable state is touched. State stays at last-good; resume picks up there.

## Determinism boundary (D1)

| Owned by CODE (`bin/`, tested, free) | Owned by the MODEL (subscription) |
|---|---|
| select stalest/changed within K (`bin/select`) | read code → propose candidate |
| compute `dedupe_key`, collision/suppression drop (`bin/dedupe`) | attempt to refute a candidate |
| write per-run + findings + registry state (`bin/record`) | judge UX against anchors (design) |
| FPR / freshness / median-staleness math (`bin/rollup`) | |
| schema validation of every artifact (`bin/validate`) | |
| read-only guard, source + git (`hooks/guard`) | |

The model never executes deterministic logic. It calls scripts and reviews code.
