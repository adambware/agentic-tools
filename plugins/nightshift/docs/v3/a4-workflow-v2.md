# A4 — Workflow v2: dynamic full-K orchestration

**Scope:** `nightshift.workflow.js`, `src/lib/` (select-run, run-meta-build, validate,
new merge-candidates + tier2-gate), `CONTRACTS.md`. **Depends on:** A1. **Blocks:** A5.
The long pole.
**Gate:** new bins full-branch tested; workflow holds the thin-shell rule (**zero
conditionals** — the E4 invariant, replacing the dead LOC ceiling); dry chain on fixture
artifacts; partial-fan-out test green.

The spike workflow reviews only `surfaces[0]`. v2 makes the Workflow do what it's for.

## Spec

### Select is launcher-side; dispatch is computed in the tested core (plan §9.1)

- `ns` runs `bin/select` **before** invoking Claude, then passes the selected surfaces
  (ids, bands, areas — control-plane only) into the Workflow as `args`. The sandbox has
  no fs access; `args` is the sanctioned channel for the dispatch list.
- `bin/select` gains a per-surface **`dispatch: {model, effort, maxTurns}`** on
  `Surface`, derived from `band` by a pure, vitest-covered function backed by a typed
  **`MODEL_BY_BAND`** const with a snapshot test (CI fails on an unintended tier change).
- The workflow does `agent(prompt, surface.dispatch)` with **no branch and no lookup
  table**. A band→compute map inside the sandbox would be decision logic (E4 forbids
  it) and is untestable there. `Surface.band` already exists as the documented
  "compute-allocation key" — this finishes that seam.

```
 bin/select (TESTED)                    ╔═ WORKFLOW SANDBOX (untestable) ═╗
   staleness → score → band             ║  pipeline(surfaces, s =>         ║
   band → dispatch{model,effort,turns}  ║    agent(prompt, s.dispatch))    ║
   ──────────────► surfaces.json ──────►║         ↑ no branch, no table    ║
                                        ╚══════════════════════════════════╝
```

### Full-K fan-out

- `pipeline(args.surfaces, reviewSurface, refuteSurface)` — each surface gets its own
  reviewer agent with an explicit per-surface prompt (id, area globs, ASVS ref, band)
  and its `dispatch` opts, then its own Tier-1 refuter as the pipeline's second stage.
- Per-surface artifacts:
  `.run/<id>/surfaces/<sid>/{reviewed.json, candidates.proposed.json, candidates.json}`.
- **Concurrency** (plan §9.9): the real Workflow cap is `min(16, CPUs-2)` — all K=6 Opus
  reviewers would dispatch at once. The intended discipline (3–5 at a time) is made real
  launcher-side: `max_concurrent_reviewers` in `$OPS/config.yml`, `ns` chunks the
  surfaces list before passing it as `args`, and the workflow pipelines over chunks.
  Chunking is launcher-side data shaping, so E4 is untouched. (`ns` side is A7 / T11;
  the workflow just consumes chunked args.)

### `bin/merge-candidates` (new)

Deterministically folds per-surface artifacts into the run-level `reviewed.json` /
`candidates.proposed.json` / `candidates.json` the existing record chain expects. Zero
decision logic stays in the workflow. Three hard rules:

1. **Partial fan-out failure (plan §9.16 — CRITICAL, mandatory, no opt-out).** A
   pipeline stage that throws drops that item to `null`, so a reviewer dying on surface
   3 of 6 leaves that surface with no artifacts. Union `reviewed.json` **only from
   surface directories that actually produced one**. Test: a K=6 run with surface 3
   crashed stamps **exactly 5** registry entries; surface 3 stays stale for
   re-selection. (This re-breaks the exact invariant v2.3.0 fixed — "silently marks
   unreviewed vectors as covered" — through a new door.)
2. **Candidate-to-surface binding (plan §9.15).** Assert every candidate in
   `.run/<id>/surfaces/<sid>/` carries `dedupe_key.surface === <sid>`; abort otherwise.
   At K=6 nothing else stops reviewer 3's output from claiming surface 1 and stamping
   the wrong registry entry green.
3. **Path containment (plan §9.12).** `sid` is a human-seeded registry id and today
   validates as any non-empty string, so `../../..` escapes the pack. Constrain ids to
   `^[A-Za-z0-9_.-]+$` in `src/lib/validate.ts`, and resolve + assert every surface path
   is inside the run dir.

### `bin/tier2-gate` (new)

Applies the union predicate (critical/high OR low confidence) to Tier-1 survivors,
writes `tier2.json` (surface/candidate ids). A plumbing agent runs it and returns the
**id list** via structured output; the workflow maps conditional Tier-2 refuter agents
over it. **CONTRACTS.md amendment:** control-plane id lists may ride the
structured-output channel; finding *data* never does (E2/E3 intact).

### Tier-2 wired end to end (plan §9.2)

Turning Tier-2 on means its accounting must move with it — today
`run-meta-build.ts:156` hardcodes `rejected_tier2 = 0`, which silently corrupts
`findings_created` and FPR (and WS8's entry criterion is "acceptable FPR"). Three changes:

- New artifact `candidates.tier2.json` (post-Tier-2 survivors), added to the
  CONTRACTS.md E2 table, mirroring the proposed/survivor split.
- `agents/security-refuter-2.md` gains `Write` (it cannot produce an artifact today,
  and E2/E3 forbid returning finding data as text).
- `bin/run-meta` takes `--tier2` and computes a **real** `rejected_tier2`, applying the
  same canonical-`dedupe_key` identity gate it already applies to Tier-1 survivors.

### Record phase + lane parameterization

- Record chain unchanged: run-meta → validate(both artifacts) → dedupe → record →
  rollup, `&&`-chained, abort on failure — now inside the per-run dir.
- One workflow file; `args.lane` selects reviewer agentType, registry file, and
  browser-vs-test adapter grant (the agentType value is launcher-supplied data — see
  A5). The design lane's prerequisite gate is enforced launcher-side in `ns` preflight.
- Runtime spike questions (Workflow billing on subscription, guard firing inside
  `agent()`, per-agent context cost) are answered **empirically at A7** and recorded in
  the runbook.

## Failure modes to cover

| Codepath | Failure | Handling |
|---|---|---|
| `bin/merge-candidates` | reviewer dies on surface 3/6 | union only real dirs; surface stays stale |
| `bin/merge-candidates` | candidate claims wrong surface | assert + abort, exit 2 |
| `bin/merge-candidates` | `sid` contains `../` | regex + containment, exit 2 |
| `bin/tier2-gate` | empty survivor set | empty `tier2.json`; `rejected_tier2: 0` |
| `bin/select` dispatch | bad alias in `MODEL_BY_BAND` | snapshot → red CI |
| Workflow v2 | args truncated, K reduced | *untestable (sandbox)*; run-meta gates reviewed ⊆ selected → degrades safely (stays stale); verified empirically at A7 |

## Tasks

- [x] **T1 (P1)** — `bin/select` — emit per-surface `dispatch`
  - Files: `src/lib/types.ts`, `src/lib/select-run.ts`, `src/lib/select-run.test.ts`, `schemas/`
  - Verify: `npm run check`; snapshot asserts all 4 bands
- [x] **T12 (P2)** — `MODEL_BY_BAND` — pinned const + snapshot
  - Files: `src/lib/` const + snapshot test
  - Verify: changing a tier fails the snapshot
- [x] **T2 (P1)** — Tier-2 — wire accounting end to end
  - Files: `src/lib/run-meta-build.ts`, `src/bin/run-meta.ts`, `agents/security-refuter-2.md`, `CONTRACTS.md`
  - Verify: a Tier-2 rejection increments `rejected_tier2` and moves FPR in `bin/rollup`
- [x] **T6 (P0)** — `validate` — sanitize registry ids, assert containment
  - Files: `src/lib/validate.ts`, `src/lib/merge-candidates-run.ts`
  - Verify: `id: "../../x"` rejected; resolved surface paths asserted inside the run dir
- [x] **T9 (P1)** — `merge-candidates` — surface binding + partial-failure union
  - Files: new `src/lib/merge-candidates-run.ts` + tests
  - Verify: K=6 with surface 3 crashed stamps exactly 5; mismatched surface id aborts
- [x] Workflow v2 itself + `bin/tier2-gate` + CONTRACTS amendments (spec above)

## Reuse

Staleness/score/K-selection: `bin/select` + `src/lib/staleness.ts` (18 tests) — only add
`dispatch`. Survivor identity: `run-meta-build.ts` canonical `dedupe_key` multiset —
reuse for Tier-2. Schema gating: `bin/validate` (9 tests) — extend per T6. Atomic io:
`src/lib/io.ts`.
