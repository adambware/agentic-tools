# Nightshift v3 — Local-First Plan

**Status: APPROVED DIRECTION — implementation sequenced below.**
Successor to the v2.x spike arc. Decisions in this doc were made interactively with the
operator (Adam) on 2026-08-23; open items are listed at the bottom.

## 1. Goals

1. **Local-first.** Runs execute on the operator's machine against local clones. No cloud
   sessions, no cloud routines, anywhere in the run path.
2. **Manual "easy button" first, automation later.** One command starts a run. The
   activity-gated sentinel (runs only when a repo earned one) is the *last* phase, added
   only after manual cadence proves cost and false-positive rate.
3. **One living document.** A single self-contained local HTML dashboard, regenerated at
   the end of every run, covering **all** onboarded repos: coverage, open findings,
   decisions needed, trends, cost. Never committed.
4. **Self-cleaning.** A run leaves behind exactly: metrics appends, registry stamps, the
   refreshed dashboard. Nothing else. Fixes the shared-run-dir concurrency TODO (P2) in
   the same move.
5. **Loosen the reviewer, keep the gate.** Bigger models, more turns, wider reads for the
   *reviewer*. The quality controls — Tier-1-always refuter, conditional Tier-2, schema
   validate, dedupe, severity gates — stay exactly as they are.
6. **Current models, explicit dispatch.** Opus 5 ceiling. Model + effort + turn budget are
   stated explicitly at dispatch per surface (via the Workflow orchestrator), not implied
   by stale frontmatter.
7. **Cost visible.** Budgets are not the constraint anymore, but every run's real cost is
   recorded and trended. Raising model tiers without cost telemetry is how surprises happen.
8. **Operator runbook, uncommitted.** A "how this runs on my machine" doc that lives in
   the ops home, not in any repo.

**Non-goals (this plan):** the stateful backlog (P3), the lane-agnostic core (P3b), the
opportunities lane (P4), and the full engine/pack versioning contract (P1) — deferred,
unchanged in TODOS.md. Scope here is the **delivery revamp only**, on **novudesk**, with
**both lanes** (security now, design once its prerequisites are seeded).

## 2. Decisions locked

| Question | Decision |
|---|---|
| Where runs execute | Operator's machine, local clones only |
| Trigger, phase 1 | Manual easy button (`ns run …`) |
| Trigger, final phase | Activity-gated sentinel + weekly floor, config-scoped repos |
| Scope | novudesk security lane, then novudesk design lane (local dev server exists) |
| Engine depth | Delivery revamp only; deterministic core untouched except listed changes |
| Model ceiling | **Opus 5** for judgment (reviewer, Tier-2, UX); **Haiku 4.5** for Tier-1 + plumbing; no Fable |
| Orchestration | Claude Code **dynamic Workflows** (`nightshift.workflow.js`), upgraded from spike shell to full-K dynamic dispatch |
| Living document | One local HTML file in the ops home, regenerated per run, all repos |
| Ops home | Fresh directory outside all repos (name open — see §8), referred to as `$OPS` below |
| Runbook | `$OPS/runbook.md`, never committed |

## 3. Target architecture

```
agentic-tools (repo, committed)          $OPS (operator machine, NOT a git repo)
  plugins/nightshift/                      config.yml        # repos considered, lanes, sentinel knobs
    bin/*.mjs        ← engine, tested        bin/ns            # the easy button
    agents/*.md      ← Opus 5 / Haiku 4.5    runbook.md        # how this runs for Adam
    nightshift.workflow.js  ← v2, full-K     dashboard.html    # THE living document (generated)
    schemas/ (+cost-record)                  digests/<repo>.md # latest digest per repo (generated)
                                             evidence/<repo>/  # design-lane screenshots (pruned)
novudesk (repo, committed)                   logs/             # launcher logs (pruned)
  .nightshift/       ← the pack
    manifest.yml     ← browser adapter, K bumps
    registries/{vectors,flows}.yml
    fixtures/personas.yml   ← seeded (design lane)
    metrics/*.jsonl  ← + costs.jsonl
    .run/<run_id>/   ← per-run scratch, deleted on success
```

Run flow (`ns run novudesk security`):

```
ns run
  ├─ preflight: repo exists, pack present, engine bin/ present, (design: dev server reachable)
  ├─ export NIGHTSHIFT_RUN_ID + NIGHTSHIFT_LANE_RUN=1     # guard armed launcher-side
  ├─ node bin/select … --out .run/<id>/surfaces.json      # deterministic, pre-workflow
  ├─ claude -p … --output-format json                     # headless; invokes the Workflow
  │    └─ Workflow: pipeline(surfaces) → reviewer+refuter per surface (dynamic dispatch)
  │                 → merge → tier2-gate → tier2 refuters → run-meta → validate → dedupe
  │                 → record → rollup   (all bin/, chained, abort-on-validate-fail)
  ├─ node bin/record-cost …                               # parse CLI JSON → costs.jsonl
  ├─ node bin/dashboard --config $OPS/config.yml --out $OPS/dashboard.html
  ├─ node bin/clean …                                     # delete .run/<id>/ on success
  └─ open $OPS/dashboard.html                             # unless --no-open
```

## 4. Workstreams (technical detail)

### WS1 — Per-run isolation + self-cleaning (closes TODOS "P2 concurrency")

- Run scratch moves from shared `.nightshift/.run/` to **`.nightshift/.run/<run_id>/`**.
  All `bin/` commands already take explicit paths; the launcher + workflow compose them
  from the run dir. No bin signature changes needed beyond path values.
- **`bin/record` provenance assert:** before any durable append, assert
  `decisions.run_id === runMeta.run_id` (and lane + date). Mismatch → exit 2, nothing
  written. This is the cheap cross-check the P2 TODO asked for; per-run dirs make the
  collision unlikely and the assert makes it impossible to corrupt silently.
- **New `bin/clean`:** on success deletes `.run/<run_id>/`; keeps failed-run dirs for
  diagnosis but prunes to the 5 most recent and anything older than 7 days. Vitest-covered
  like every other bin (fake fs timestamps injected).
- Launcher (`ns`) also prunes `$OPS/logs/` and `$OPS/evidence/` with the same policy.
- Acceptance: two interleaved simulated runs on a fixture pack cannot cross-contaminate;
  a forged `decisions.json` with the wrong run_id aborts before any append.

### WS2 — Cost reporting

- **New append-only `metrics/costs.jsonl`** (one line per run), new `schemas/cost-record.yml`:
  `{run_id, lane, date, ts, usd, input_tokens, output_tokens, cache_read_tokens,
  cache_creation_tokens, source}`. Kept **separate** from `runs/<YYYY-MM>.jsonl` so the
  deterministic record path stays untouched and append-only semantics are preserved;
  readers join on `run_id`.
- **Capture:** headless `claude -p --output-format json` reports the session's total cost
  and token usage; `ns` parses that and calls **new `bin/record-cost`** (validate + atomic
  append). `source: "cli-json"`. Interactive/debug runs without JSON output append a
  `source: "manual"` line via `ns cost add` or skip (dashboard shows the gap honestly).
- **`bin/rollup` extension (additive):** `cost_usd_7d`, `cost_usd_30d`,
  `cost_usd_avg_per_run_30d` in the daily rollup. Additive schema fields → `pack_format`
  stays `1`.
- Example pack (NovuDesk) gains synthetic cost lines so tests and dashboard render real shapes.
- Rough expectations for the runbook (Opus 5 at $5 in / $25 out per MTok; Haiku 4.5 at
  $1/$5): a K=6 security run with Opus reviewers + Haiku Tier-1 + occasional Opus Tier-2
  should land in the low single-digit dollars; the trend line is what makes drift visible.

### WS3 — Model + power refresh ("loosen the reviewer, keep the gate")

Pin **exact model IDs** in agent frontmatter — alias drift ("sonnet", "haiku") is how the
fleet got stale invisibly. A quarterly "check the fleet" line goes in the runbook.

| Agent | Was | Becomes | maxTurns | Dispatch effort |
|---|---|---|---|---|
| `security-reviewer` | (default) | `claude-opus-5` | 8 → **24** | `high`; `xhigh` on critical band |
| `security-refuter` (T1) | haiku | `claude-haiku-4-5` | 8 → 10 | `low` |
| `security-refuter-2` (T2) | sonnet/high | `claude-opus-5` | 12 → 16 | `high`; `xhigh` for critical/high survivors |
| `ux-reviewer` | (default) | `claude-opus-5` | → 24 | `high` |
| plumbing (bin runners) | — | `claude-haiku-4-5` | 2 | `low` |

- Fan-out budget table in `run-loop.md` updated: reads per surface roughly double
  (low/med ~10–15, high ~15–20, critical ~20–30). K bumps are **pack-side** (novudesk
  manifest; suggest security 6, design 4) — the engine default template stays modest.
- **Unchanged:** Tier-1 on every candidate, Tier-2 union predicate, no-refute-no-log,
  validate gates every model-written artifact, dedupe + suppressions, severity gates,
  `CLAUDE_CODE_SUBAGENT_MODEL` as the global downshift lever.

### WS4 — Workflow v2: dynamic full-K orchestration

The spike workflow reviews only `surfaces[0]`. v2 makes the Workflow do what it's for.

- **Select moves launcher-side.** `ns` runs `bin/select` before invoking Claude, then
  passes the selected surfaces (ids, bands, areas — control-plane only) into the Workflow
  as `args`. The Workflow sandbox has no fs access; args is the sanctioned channel for
  the dispatch list.
- **Full-K fan-out:** `pipeline(args.surfaces, reviewSurface, refuteSurface)` — each
  surface gets its own reviewer agent with an explicit per-surface prompt (id, area globs,
  ASVS ref, band) and band-scaled `{model, effort, maxTurns}` opts, then its own Tier-1
  refuter as the pipeline's second stage. Per-surface artifacts:
  `.run/<id>/surfaces/<sid>/{reviewed.json, candidates.proposed.json, candidates.json}`.
  Concurrency inside K comes free from pipeline scheduling (cap 3–5 via slot behavior).
- **New `bin/merge-candidates`:** deterministically folds per-surface artifacts into the
  run-level `reviewed.json` / `candidates.proposed.json` / `candidates.json` the existing
  record chain expects. Zero decision logic stays in the workflow (thin-shell rule holds).
- **New `bin/tier2-gate`:** applies the union predicate (critical/high OR low confidence)
  to Tier-1 survivors, writes `tier2.json` (surface/candidate ids). A plumbing agent runs
  it and returns the **id list** via structured output; the workflow maps conditional
  Tier-2 refuter agents over it. **CONTRACTS.md amendment:** control-plane id lists may
  ride the structured-output channel; finding *data* never does (E2/E3 intact).
- Record phase unchanged: run-meta → validate(both artifacts) → dedupe → record → rollup,
  `&&`-chained, abort on failure — now inside the per-run dir.
- **Lane-parameterized:** one workflow file; `args.lane` selects reviewer agentType,
  registry file, and browser-vs-test adapter grant. The design lane's prerequisite gate
  (base_url + personas present) is enforced launcher-side in `ns` preflight — fail fast
  with the reason, never half-run.
- Runtime spike questions from TODOS (Workflow billing on subscription, guard firing
  inside Workflow `agent()`, per-agent context cost) get answered **empirically at gate
  A7** — the first real local run — and recorded in the runbook.

### WS5 — Design lane enablement (novudesk)

- novudesk pack via `/nightshift:onboard` reconcile: set
  `stack_adapter.browser.base_url` to the **local dev server** URL, seed
  `fixtures/personas.yml` (account types, plans, permissions, data seeds, success
  criteria; credentials referenced not stored), flip design cadence on, `window_budget_k.design: 4`.
- `ux-reviewer` refresh (WS3 models) + drives flows via the manifest browser adapter
  (Playwright against the local URL). `ns` preflight curl-checks the base_url and refuses
  with "start the dev server first" when down.
- Anchor discipline unchanged: no objective anchor → digest, never a ticket.
- Evidence: screenshots land in the run dir; screenshots referenced by **confirmed**
  findings are copied to `$OPS/evidence/novudesk/` (pruned with WS1 policy) so the
  dashboard can show them after the run dir is cleaned.

### WS6 — The living document: `bin/dashboard`

- **New `bin/dashboard --config $OPS/config.yml --out $OPS/dashboard.html`** — a
  deterministic, vitest-covered engine command like every other bin (pure render function
  in `src/lib/dashboard-run.ts`, snapshot tests against the NovuDesk fixture plus a
  synthetic second pack to prove multi-repo).
- Reads every configured repo's pack: registries (status/last_reviewed), findings +
  suppressions, `daily.jsonl` (max-ts per date+lane), `costs.jsonl`, latest
  `$OPS/digests/<repo>.md` if present.
- One **self-contained** HTML file (inline CSS/SVG, no external assets, light/dark via
  `prefers-color-scheme`):
  1. **Header:** last-updated, per-repo last-run + result, 7d/30d cost.
  2. **Decisions needed** (from the latest digest per repo — the human queue, at the top).
  3. **Per repo, per lane:** coverage table (green/stale/overdue/open-findings, color-coded),
     open findings (severity, age, `needs_human_verification`, evidence links).
  4. **Trends:** inline-SVG sparklines — coverage freshness, FPR 7d/30d, cost per run.
  5. **Hygiene strip:** orphaned run dirs, failed runs kept for diagnosis, gaps in cost
     capture — the "junk detector" that keeps the system honest about itself.
- The digest skill gains one convention: `ns digest <repo>` runs `/nightshift:digest`
  headless and writes the output to `$OPS/digests/<repo>.md` (the skill itself stays
  read-only over the pack; writing the file is the launcher's doing).
- Committed `dashboard.md` in packs: **retired** (template + docs updated). The pack keeps
  durable truth (JSONL + registries); projection now lives in the ops home only.

### WS7 — Ops home, easy button, runbook (operator machine)

- **`$OPS/config.yml`** (single source for "repos even considered"):

  ```yaml
  repos:
    - path: ~/code/novudesk
      lanes: [security, design]
      enabled: true
  dashboard: { out: dashboard.html, open_after_run: true }
  sentinel: { enabled: false, hour: 7, cooldown_days: 2, weekly_floor_days: 7 }
  ```

- **`$OPS/bin/ns`** (POSIX shell, matching repo conventions):
  - `ns run <repo> [security|design|all]` — the easy button; the §3 flow.
  - `ns status` — per repo/lane: what `bin/select` *would* pick, staleness summary, last
    run + cost. Read-only, no model calls.
  - `ns run --due` — run every enabled repo/lane whose staleness/change flags warrant it
    (same deterministic logic the sentinel will reuse; manual until WS8 flips it on).
  - `ns digest <repo>`, `ns dashboard` — regenerate artifacts on demand.
  - `ns run --interactive` — debug mode: same env + workflow in a foreground session.
- **Headless permissions decision:** headless runs launch with the armed
  `NIGHTSHIFT_LANE_RUN=1` PreToolUse guard (denies writes outside `.nightshift/` and git
  mutation) plus a scoped `--allowedTools` grant; the exact flag set is validated at gate
  A7 and recorded in the runbook. The guard is the enforcement layer; flags are convenience.
- **`$OPS/runbook.md`** — "how this runs locally for Adam" (never committed): engine
  install/update (`/plugin marketplace add`, `/plugin install nightshift@agentic-tools`,
  dev loop `npm run check`), config.yml reference, easy-button usage, reading the
  dashboard, triage flow per severity gate (Linear filing by `dedupe_key`), suppression
  how-to, design-lane prerequisites (dev server up, personas current), cost expectations
  + the quarterly model-fleet check, troubleshooting (validate aborts, guard denials,
  cost-capture gaps), and — once WS8 lands — sentinel behavior and how to pause it.

### WS8 — Activity-gated sentinel (LAST, after manual soak)

- **New `bin/sentinel`** (deterministic, tested): per enabled repo/lane, due when
  `(commits touching any registry area since last run) OR (max staleness ≥ 1.0)`, subject
  to `cooldown_days` since the last run and a `weekly_floor_days` guarantee so quiet repos
  still get a periodic pass. Emits `due.json`; `ns run --due` consumes it.
- **Scheduler:** a local Claude Code routine (or a plain launchd/cron job — decided at
  implementation) firing once daily at `sentinel.hour`, running `ns run --due`. Quiet day
  = log line, zero model calls, zero cost.
- **Notification:** macOS notification (`osascript`) when a run confirms findings or
  fails; the dashboard is the durable record either way.
- **Entry criterion:** ≥2 weeks of manual `ns run` cadence with acceptable FPR and cost
  trend, per the dashboard. Not before.

## 5. Agent implementation sequencing

Engine work (A1–A6) happens in this repo on normal dev branches with the existing CI
(`npm run check` + example hygiene). A7–A9 **must run on the operator's machine** (local
Claude Code session in the ops home / novudesk) — they touch `$OPS`, novudesk's pack, and
real runs. One workstream per session keeps review clean; A4 is the only long pole.

| # | Session / agent task | Scope | Depends on | Gate (must pass before next) |
|---|---|---|---|---|
| A0 | This plan committed; branch reviewed | docs only | — | Operator sign-off on plan + §8 answers |
| A1 | WS1: per-run dirs, `bin/record` assert, `bin/clean` | src/lib, bins, tests | A0 | vitest green; interleaved-run fixture proves isolation; wrong-run_id forgery aborts |
| A2 | WS2: cost-record schema, `bin/record-cost`, rollup ext, NovuDesk lines | src/lib, schemas, example | A0 | vitest green; round-trip on NovuDesk copy incl. cost join |
| A3 | WS3: agent frontmatter + run-loop/README updates | agents/, docs | A0 | Docs consistent; no engine code change (can share A2's session) |
| A4 | WS4: workflow v2, `bin/merge-candidates`, `bin/tier2-gate`, CONTRACTS amendment | workflow, bins, tests | A1 | New bins full-branch tested; workflow reviewed against thin-shell rule; dry chain on fixture artifacts |
| A5 | WS5 engine side: lane-parameterized workflow, ux-reviewer refresh, onboard design branch | workflow, agents, skills | A4 | Lane gating refuses correctly on a pack missing browser/personas |
| A6 | WS6: `bin/dashboard` + `src/lib/dashboard-run` + snapshot tests; retire pack dashboard.md | src/lib, bins, templates | A2 | Renders NovuDesk + synthetic second pack; self-contained file passes a no-network open |
| — | **Release: nightshift 3.0.0** (CHANGELOG, marketplace bump) | repo | A1–A6 | CI green on main |
| A7 | **LOCAL** WS7: create `$OPS`, `ns`, config, runbook; first real `ns run novudesk security` | operator machine | A1–A4, A6 | End-to-end: cost line captured, dashboard regenerated + opens, run dir cleaned, only reviewed ids stamped, guard verified inside Workflow, permission flag set recorded in runbook |
| A8 | **LOCAL** WS5 pack side: novudesk onboard reconcile, personas, base_url; first design run | operator machine + novudesk pack | A5, A7 | Design run completes against local dev server; findings anchored or clean pass; evidence copied + pruned |
| A9 | **LOCAL** WS8: `bin/sentinel` (engine PR) + local schedule + notification | engine + operator machine | ≥2-week soak of A7/A8 | Simulated activity triggers a run; quiet day is a free no-op; weekly floor fires |

Parallelism: A2+A3 can share a session; A4 and A6 can run in parallel sessions once A1/A2
land. Everything else is sequential on its dependency.

## 6. Acceptance criteria (the operator experience)

- One command (`ns run novudesk security`) from zero to refreshed dashboard, no cloud.
- One browser tab (`$OPS/dashboard.html`) answers: what's covered, what's rotting, what
  needs me, what did this cost — across every onboarded repo.
- A finished run leaves no scratch files anywhere; failures leave exactly one diagnosable
  run dir, auto-pruned.
- Reviews run on Opus 5 with real turn budgets; every finding still survived Tier-1
  refutation; FPR and cost are on the dashboard within a day of drifting.
- Both lanes live on novudesk; the design lane refuses loudly when the dev server is down.
- `runbook.md` gets a new operator from zero to a successful run without reading engine
  source. Nothing operator-specific is committed.

## 7. Explicitly deferred (unchanged in TODOS.md)

Stateful backlog + queue.jsonl scaling (P3), lane-polymorphic backlog model (P3b),
opportunities lane (P4), full engine/pack versioning contract (P1 — `pack_format`
read-and-branch still pending), Codex distribution contract, onboardme LLM-judge lane.

## 8. Open questions for the operator

1. **Ops home name.** Recommendation: `~/code/nightshift-ops` — short, pairs with
   `agentic-tools`, and generic enough to hold ops for future plugins, not just
   nightshift. Alternatives: `~/code/_nightshift-ops` (underscore-prefix sorts beside
   `_vendor`), or your original `~/code/nightshift-ops` (most explicit,
   longest). Placeholder `$OPS` everywhere until chosen.
2. **K budgets for novudesk** — proposal: security 6, design 4. Adjustable in the pack
   manifest at any time.
3. **Dashboard auto-open** — `open_after_run: true` default, or leave the tab alone and
   rely on `ns dashboard`?
4. **Digest cadence** — keep digest manual (`ns digest`) in phase 1, or have every
   `ns run` refresh it automatically? (Auto adds one cheap Haiku-tier call per run.)
