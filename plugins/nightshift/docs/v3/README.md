# Nightshift v3 — Implementation Guide (index)

**Status: APPROVED — ready to implement.** This directory is the implementation-facing
split of [../local-first-v3-plan.md](../local-first-v3-plan.md). The original plan is the
**decision record** (review reports, rationale, cross-model tensions) and is not required
reading for implementation. Every review amendment (§9 eng, §15 design) has been folded
into the session files below — where a session file contradicts the original plan's
workstream text, the session file is right (it carries the amendment).

**How to use this:** an implementation session reads this index plus its one session
file. Nothing else. Citations like "(plan §9.x)" point into the original plan for
rationale only.

## Goals (compressed)

1. **Local-first** — runs on the operator's machine against local clones; no cloud in the run path.
2. **Manual easy button first** — `ns run …`; the activity-gated sentinel is the last phase.
3. **One living document** — self-contained local HTML dashboard, regenerated every run, all repos.
4. **Self-cleaning** — a run leaves only metrics appends, registry stamps, the dashboard.
5. **Loosen the reviewer, keep the gate** — bigger models/turns for reviewers; Tier-1/Tier-2/validate/dedupe/severity gates unchanged.
6. **Explicit dispatch** — model + effort + turns stated per surface at dispatch, not implied by frontmatter.
7. **Cost visible** — every run's real cost recorded and trended.
8. **Operator runbook, uncommitted** — lives in the ops home.

## Decisions locked

| Question | Decision |
|---|---|
| Where runs execute | Operator's machine, local clones only |
| Trigger, phase 1 | Manual easy button (`ns run …`) |
| Trigger, final phase | Activity-gated sentinel + weekly floor, config-scoped repos |
| Scope | novudesk security lane, then novudesk design lane |
| Engine depth | Delivery revamp only; deterministic core untouched except listed changes |
| Model ceiling | **Opus 5** for judgment (reviewer, Tier-2, UX); **Haiku 4.5** for Tier-1 + plumbing; no Fable |
| Orchestration | Dynamic Workflow (`nightshift.workflow.js`), full-K dispatch |
| Living document | One local HTML file in the ops home, regenerated per run, all repos |
| Ops home | Fresh directory outside all repos, named **`agentic-nightshift`** (A7). `$OPS` stays the placeholder in prose — the absolute path is operator-specific and uncommitted |
| Runbook | `$OPS/runbook.md`, never committed |

## Target architecture

```
agentic-tools (repo, committed)          $OPS (operator machine, NOT a git repo)
  plugins/nightshift/                      config.yml        # repos considered, lanes, sentinel knobs
    bin/*.mjs        ← engine, tested      runbook.md        # how this runs for Adam
    bin/ns           ← the easy button     dashboard.html    # THE living document (generated)
    agents/*.md                            digests/<repo>.md # latest digest per repo (generated)
    nightshift.workflow.js  ← v2, full-K   evidence/<repo>/  # design-lane screenshots (pruned)
    schemas/ (+cost-record)                logs/             # launcher logs (pruned)
novudesk (repo, committed)
  .nightshift/       ← the pack
    manifest.yml     ← browser adapter, K bumps
    registries/{vectors,flows}.yml
    fixtures/personas.yml   ← seeded (design lane)
    metrics/*.jsonl  ← + costs.jsonl
    .run/<run_id>/   ← per-run scratch, deleted on success
```

Note: `ns` is **committed in the engine repo** and shellchecked in CI (plan §9.4); only
operator-specific files (config, runbook, generated artifacts) live in `$OPS`.

Run flow (`ns run novudesk security`):

```
ns run
  ├─ preflight: repo exists, pack present, engine bin/ present, (design: env-safety gate)
  ├─ export NIGHTSHIFT_RUN_ID + NIGHTSHIFT_LANE_RUN=1     # guard armed launcher-side
  ├─ node bin/select … --out .run/<id>/surfaces.json      # deterministic, pre-workflow
  ├─ claude -p … --output-format json                     # headless; invokes the Workflow
  │    └─ Workflow: pipeline(surfaces) → reviewer+refuter per surface (dynamic dispatch)
  │                 → merge → tier2-gate → tier2 refuters → run-meta → validate → dedupe
  │                 → record → rollup   (all bin/, chained, abort-on-validate-fail)
  ├─ node bin/record-cost …                  # ALWAYS — is_error gates status
  ├─ node bin/dashboard --config $OPS/config.yml --out $OPS/dashboard.html
  │                                          # ALWAYS — success or failure
  ├─ node bin/clean …                        # success only: delete .run/<id>/
  └─ open $OPS/dashboard.html                # unless --no-open
```

## Session map

One workstream per session. A1–A6 + the engine half of A7 are repo sessions with normal
CI; the local half of A7, plus A8–A9, run on the operator's machine. Release 3.0.0 cuts
**after A7**, not A6 (plan §9.13).

| # | Session file | Scope | Depends on | Gate (must pass before next) |
|---|---|---|---|---|
| A0 | — | Plan committed, operator sign-off + open-question answers | — | done 2026-08-23 |
| A1 | [a1-run-isolation.md](a1-run-isolation.md) | Per-run dirs, record assert + idempotency, lock, `bin/clean`, `prune()` | A0 | vitest green; interleaved-run isolation; wrong-run_id forgery aborts |
| A2 | [a2-cost.md](a2-cost.md) | Cost schema, `bin/record-cost`, rollup ext, NovuDesk lines | A0 | vitest green; round-trip on NovuDesk copy incl. cost join |
| A3 | [a3-model-refresh.md](a3-model-refresh.md) | Agent frontmatter + run-loop/README/CONTRACTS doc updates | A0 | Docs consistent; no engine code change (can share A2's session) |
| A4 | [a4-workflow-v2.md](a4-workflow-v2.md) | Workflow v2, dispatch on select, Tier-2 end-to-end, `merge-candidates`, `tier2-gate` | A1 | New bins full-branch tested; thin-shell holds (zero conditionals); dry chain on fixtures; partial-fan-out test green |
| A5 | [a5-design-lane-engine.md](a5-design-lane-engine.md) | Lane-parameterized workflow, per-adapter ux-reviewer, onboard design branch | A4 | Lane gating refuses correctly on a pack missing browser/personas |
| A6 | [a6-dashboard.md](a6-dashboard.md) | `bin/dashboard` + render lib + 4 fixture snapshots; retire pack dashboard.md | A2 | 4 snapshots green; all token pairs ≥4.5:1 both themes; non-colour channel everywhere; no-network open passes |
| A7 | [a7-ops-launcher.md](a7-ops-launcher.md) | Engine half: committed `ns`, preflight, chunking, exit-path dashboard. Local half: `$OPS`, runbook, **first real run** | A1–A4, A6 | End-to-end real run: cost captured, dashboard regenerated, run dir cleaned, only reviewed ids stamped, guard + permission flags verified & recorded |
| — | **Release nightshift 3.0.0** | CHANGELOG, marketplace bump | A7 | CI green on main |
| A8 | [a8-design-lane-pack.md](a8-design-lane-pack.md) | **LOCAL** novudesk pack: onboard reconcile, personas, base_url; first design run | A5, A7 | Design run against local dev server; findings anchored or clean; evidence copied + pruned |
| A9 | [a9-sentinel.md](a9-sentinel.md) | **LOCAL** `bin/sentinel` + schedule + notification | ≥2-week soak of A7/A8 | Simulated activity triggers a run; quiet day free no-op; weekly floor fires |
| — | [eval-planted-vuln.md](eval-planted-vuln.md) | Non-gating planted-vuln eval (report-only) | A4 | Reports caught/total + FP-on-clean; never blocks CI |

**Worktree parallelism** (plan §13):

```
Lane A: A1 → A4 → A5        (sequential; all touch src/lib/ + workflow)
Lane B: A2 → A6             (sequential; shared rollup-run + schemas)
Lane C: A3                  (independent; agents/ + docs only)
```

Conflict flag: `src/lib/types.ts` is touched by both lanes — A adds `Surface.dispatch`,
B adds the cost-record type. Land A1's `types.ts` change first, or expect one small
merge conflict.

## Task index (T1–T23)

Tasks live in their session files with files-to-touch and verify steps. The session
files are the tracker; the checklist in the original plan §14 is frozen.

| Task | What | Session |
|---|---|---|
| T1 | `bin/select` emits per-surface `dispatch` | A4 |
| T2 | Tier-2 accounting wired end to end | A4 |
| T3 | Per-adapter ux-reviewer + `Write` grant | A5 |
| T4 | `ns` committed, shellchecked, logic extracted | A7 |
| T5 | `bin/record` per-repo lock + run_id uniqueness | A1 |
| T6 | Registry id sanitization + path containment | A4 |
| T7 | `bin/record-cost` gates on `is_error` | A2 |
| T8 | Design preflight: loopback + non-prod assertion | A7 (blocks A8) |
| T9 | `merge-candidates` surface binding + partial-failure union | A4 |
| T10 | One `prune()`, lifecycle rule for evidence | A1 |
| T11 | `max_concurrent_reviewers` chunking | A7 |
| T12 | `MODEL_BY_BAND` pinned const + snapshot | A4 |
| T13 | Three plan-vs-code doc corrections | A3 |
| T14 | Planted-vuln eval (non-gating) | eval file |
| T15 | Runbook cost estimate → TBD, filled by A7 | A7 |
| T16–T21, T23 | Dashboard: verdict strip, computed sources, two axes, sparkline contract, 13 states, a11y contract, evidence states | A6 |
| T22 | Dashboard regenerates on every `ns` exit path | A7 |

## Acceptance criteria (the operator experience — the whole plan's definition of done)

- One command (`ns run novudesk security`) from zero to refreshed dashboard, no cloud.
- One browser tab (`$OPS/dashboard.html`) answers: what's covered, what's rotting, what
  needs me, what did this cost — across every onboarded repo.
- A finished run leaves no scratch files anywhere; failures leave exactly one
  diagnosable run dir, auto-pruned.
- Reviews run on Opus 5 with real turn budgets; every finding still survived Tier-1
  refutation; FPR and cost are on the dashboard within a day of drifting.
- Both lanes live on novudesk; the design lane refuses loudly when the dev server is down.
- `runbook.md` gets a new operator from zero to a successful run without reading engine
  source. Nothing operator-specific is committed.

## Open questions for the operator

1. ~~**Ops home name**~~ — **DECIDED (A7): `agentic-nightshift`**, created alongside the
   operator's repo checkouts rather than inside any of them. The name sorts immediately
   before `agentic-tools`, so the ops home sits next to the engine it drives; it
   deliberately does NOT start with `agentic-tools-`, because that prefix already means
   "a git worktree of the engine" and the ops home is not a git repo at all. `$OPS` stays
   the placeholder in prose — the absolute path is operator-specific and uncommitted.
2. **K budgets for novudesk** — proposal: security 6, design 4 (pack manifest, adjustable anytime).
3. **Dashboard auto-open** — `open_after_run: true` default, or rely on `ns dashboard`?
4. **Digest cadence** — manual (`ns digest`) in phase 1, or auto-refresh each run? The
   dashboard design works either way (digest items are stamped + run-distance-banned; see A6).

## Deferred (not in this plan)

Stateful backlog + queue.jsonl scaling (P3) · lane-polymorphic backlog (P3b) ·
opportunities lane (P4) · engine/pack versioning contract (P1 — blocker for first
*external* adopter only) · Codex distribution contract · onboardme LLM-judge lane ·
refuter field mutation (codex #7, own branch) · date-vs-SHA change baseline (codex #11 —
**must land before A9**) · multi-repo slug identity (codex #14) · "no cloud" vs WS8
routine wording (codex #15, one-liner at A9) · deny-by-default guard rewrite ·
pre-flight cost ceiling (impossible: cost is only known post-run).

## Provenance

Full rationale, review reports (eng, design, codex), cross-model tension resolutions,
and the reuse audit: [../local-first-v3-plan.md](../local-first-v3-plan.md).
Design reference prototype (4 artboards, fixture data, both themes + greyscale):
`~/.gstack/projects/adambware-agentic-tools/designs/nightshift-dashboard-20260823/dashboard-proto.html`.
