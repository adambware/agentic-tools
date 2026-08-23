# A1 — Per-run isolation, self-cleaning, durable-state safety

**Scope:** `src/lib/`, `src/bin/`, tests. Closes the TODOS "P2 concurrency" item.
**Depends on:** A0. **Blocks:** A4 (lane A).
**Gate:** vitest green; interleaved-run fixture proves isolation; a forged
`decisions.json` with the wrong run_id aborts before any append; duplicate run_id exits 2.

## Spec

### Per-run scratch dirs

- Run scratch moves from shared `.nightshift/.run/` to **`.nightshift/.run/<run_id>/`**.
  All `bin/` commands already take explicit paths; the launcher + workflow compose them
  from the run dir. No bin signature changes beyond path values.

### `bin/record` provenance assert + idempotency (plan §9.11)

- Before any durable append, assert `decisions.run_id === runMeta.run_id` (and lane +
  date). Mismatch → exit 2, nothing written.
- **`bin/record` refuses a `run_id` already present in `metrics/runs/`** (exit 2). This
  makes retry safe: the §3 flow runs record → record-cost → dashboard → clean, and a
  failure after `record` invites a re-run that would otherwise double-append findings and
  inflate the FPR denominator.

### Per-repo lockfile (plan §9.11)

Per-run dirs isolate *scratch*, not durable state: `src/lib/record-run.ts` appends N
finding lines, appends a run line, then rewrites the whole registry — atomic per write,
not per run. So:

- A **per-repo lockfile**, held for the whole durable phase, with a stale-lock recovery
  path. The lock helper lives in `src/lib/` (tested here); `ns` takes the lock at A7.

### `bin/clean` + one `prune()` mechanism, two policies (plan §9.8)

- **New `bin/clean`:** on success deletes `.run/<run_id>/`; keeps failed-run dirs for
  diagnosis. Vitest-covered with injected fake fs timestamps.
- **One vitest-covered `prune()` in `src/lib/`**, called from three sites (`bin/clean`,
  and `ns` for logs + evidence at A7):

| Directory | Policy |
|---|---|
| `.nightshift/.run/` | keep 5 most recent, drop >7 days (time-based) |
| `$OPS/logs/` | same time-based rule |
| `$OPS/evidence/` | **lifecycle**: retain while any referencing finding is unresolved; prune once `resolved_at` is set. Content-addressed filenames so a recurring finding reuses one file. |

Why evidence differs: the dashboard renders evidence links on *open* findings; a
time-based rule guarantees dead links on exactly the oldest open findings. Design
anchors (`friction_delta`, `a11y`, `evidence`) depend on the screenshot surviving.

## Failure modes to cover

| Codepath | Failure | Handling |
|---|---|---|
| `bin/record` | retry after partial success | run_id uniqueness → exit 2 |
| `bin/record` | two concurrent runs | per-repo lock → blocks, then proceeds |
| `bin/clean` / `prune()` | prune deletes needed evidence | lifecycle rule prevents it |

## Tasks

- [ ] **T5 (P0)** — `bin/record` — per-repo lock + run_id uniqueness
  - Files: `src/lib/record-run.ts` (+ lock helper in `src/lib/`); `ns` wiring lands at A7
  - Verify: duplicate run_id exits 2; interleaved-run fixture proves no cross-contamination
- [ ] **T10 (P2)** — `prune()` — one mechanism, lifecycle rule for evidence
  - Files: new `src/lib/prune.ts` + tests, `bin/clean` (`ns` call sites at A7)
  - Verify: open finding retains evidence past 7 days; resolved finding's evidence prunes
- [ ] Per-run dirs + provenance assert (WS1 core, above)

## Reuse

Atomic writes and jsonl append: `src/lib/io.ts#atomicWrite` / `appendJsonl` (7 tests) —
use for everything new here. **Land the `src/lib/types.ts` change from this lane first**
(A4 adds `Surface.dispatch`; A2/A6's lane adds the cost-record type) to avoid a merge
conflict.
