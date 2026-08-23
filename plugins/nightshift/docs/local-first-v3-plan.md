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

---

## 9. Review amendments (/plan-eng-review, 2026-08-23)

Scope was reviewed and **accepted as-is**: all 8 workstreams, original A0–A9 sequencing.
The amendments below are corrections and additions within that scope, each decided
interactively. Outside voice: Codex (gpt-5, high reasoning, read-only).

### 9.1 Dispatch policy moves into the tested core (A1)

`bin/select` gains a per-surface `dispatch: {model, effort, maxTurns}` on `Surface`,
derived from `band` by a pure, vitest-covered function. WS4's workflow does
`agent(prompt, surface.dispatch)` with **no branch and no lookup table**.

Rationale: a band→compute map inside `nightshift.workflow.js` is decision logic, which
E4 forbids ("zero decision logic — no `if`, score, threshold, or selection"). The
Workflow sandbox has no filesystem and cannot import a module, so logic there is both
untestable by vitest and un-extractable (learning `workflow-sandbox-forces-thin-shell`).
`Surface.band` already exists and is documented in `src/lib/types.ts` as the
"compute-allocation key for the fan-out budget table" — this finishes that seam.

```
 bin/select (TESTED)                    ╔═ WORKFLOW SANDBOX (untestable) ═╗
   staleness → score → band             ║  pipeline(surfaces, s =>         ║
   band → dispatch{model,effort,turns}  ║    agent(prompt, s.dispatch))    ║
   ──────────────► surfaces.json ──────►║         ↑ no branch, no table    ║
                                        ╚══════════════════════════════════╝
```

### 9.2 Tier-2 is wired end to end, not just dispatched (A2)

WS4 turns Tier-2 on, so its accounting must move with it. Three changes:

- New artifact `candidates.tier2.json` (post-Tier-2 survivors), added to the CONTRACTS.md
  E2 table, mirroring the existing proposed/survivor split.
- `agents/security-refuter-2.md` gains `Write` (it has `Read, Grep, Glob` today and
  cannot produce an artifact; E2/E3 forbid returning finding data as text).
- `bin/run-meta` takes `--tier2` and computes a **real** `rejected_tier2`, applying the
  same canonical-`dedupe_key` identity gate it already applies to Tier-1 survivors.

Rationale: `src/lib/run-meta-build.ts:156` hardcodes `const rejected_tier2 = 0;`.
`src/lib/record-run.ts:71` computes `findings_created = confirmed + recurring +
rejected_tier1 + rejected_tier2` and `src/lib/rollup-run.ts:51` computes FPR from the
same sum. With the constant pinned at 0, every Tier-2 rejection is invisible — and
WS8's entry criterion is "acceptable FPR per the dashboard."

### 9.3 Design-lane tool grant uses `agentType`, the only real dispatch lever (A3)

`agents/ux-reviewer.md:25` promises "The orchestrator injects the concrete browser/MCP
tool at dispatch time." **No dispatch API accepts a tools list** — the Workflow's
`agent()` takes `label, phase, schema, model, effort, isolation, agentType`, and subagent
tools come from frontmatter only. Instead:

- Ship one concrete agent per browser adapter (e.g. `ux-reviewer-playwright.md` granting
  `Read, Grep, Glob, Write, mcp__playwright__*`); keep `ux-reviewer.md` as the
  stack-agnostic base spec.
- `ns` preflight reads `stack_adapter.browser.tool` from the manifest and passes the
  agent type through `args` (launcher-side data, consistent with §9.1).
- **`ux-reviewer` gains `Write` regardless of adapter** — it is the design lane's reviewer
  and must write `candidates.proposed.json` + `reviewed.json` per E3.

### 9.4 `ns` is committed and tested; only operator-specific files stay in `$OPS` (A4)

The launcher moves to `plugins/nightshift/bin/ns`, under CI (shellcheck) and versioned
with the engine. Its decision logic — due-detection, the cost-write predicate, retention —
moves into vitest-covered `bin/` commands, the same thin-shell discipline E4 applies to
the workflow. `$OPS` keeps `config.yml`, `runbook.md`, `dashboard.html`, `digests/`,
`evidence/`, `logs/` — all uncommitted, satisfying §6's "Nothing operator-specific is
committed." WS8's `bin/sentinel` then reuses `ns`'s tested due-detection instead of
reimplementing it.

### 9.5 The model pin lives on the dispatch channel, not frontmatter (C1)

§9.1 makes `surface.dispatch` authoritative at dispatch, and that channel takes model
**aliases**, not dated ids. A `claude-opus-5` pin in frontmatter would therefore be
overridden every run — decorative, which is worse than absent. So:

- The pin is a typed `MODEL_BY_BAND` const in `src/lib/`, with a vitest snapshot
  asserting exact expected values per band. CI fails on an unintended tier change.
- Frontmatter keeps a sane default for out-of-workflow invocation.
- The runbook's quarterly fleet check becomes "run `npm test`, read the snapshot."

### 9.6 Three plan-vs-code corrections (C2)

1. **WS3's "Was" column is wrong on 2 of 5 rows.** `agents/security-reviewer.md:5-6` is
   `model: sonnet`, `maxTurns: 15` (not "(default)" / 8). `agents/ux-reviewer.md:5-6` is
   `model: sonnet`, `maxTurns: 15` (not "(default)"). That table is A3's edit checklist.
2. **`src/lib/guard.ts:20` is stale** — it says "the workflow self-arms it", which
   `nightshift.workflow.js:43` documents as a crash ("`process` is undefined in the
   sandbox"). WS7 moves guard-arming to the launcher; fix it there.
3. **E4's "LOC ceiling ~60" is dead** — `nightshift.workflow.js` is 119 lines today and
   WS4 triples its job. Replace the line count with the invariant it proxied:
   **zero conditionals**.

### 9.7 Cost capture gates on `is_error`, never `subtype` (C3)

Verified against a live headless envelope. Every field WS2 wants is present
(`total_cost_usd`, `usage.{input_tokens, output_tokens, cache_creation_input_tokens,
cache_read_input_tokens}`, `modelUsage`, `duration_ms`). **But a failed run returns:**

```json
{"is_error":true, "total_cost_usd":0, "subtype":"success", "terminal_reason":"api_error"}
```

`subtype:"success"` sits next to `is_error:true`. `bin/record-cost` therefore requires
`is_error === false` for a normal record and writes `status: "error"` plus
`terminal_reason` otherwise; `bin/rollup` excludes error rows from
`cost_usd_avg_per_run_30d`. WS6's hygiene strip renders them. A fixture of this exact
envelope becomes a regression test.

### 9.8 One retention mechanism, two policies (C4 + O3)

A single vitest-covered `prune()` in `src/lib/`, called from three sites — but evidence
gets a **different rule** than time:

| Directory | Policy |
|---|---|
| `.nightshift/.run/` | keep 5 most recent, drop >7 days (time-based) |
| `$OPS/logs/` | same time-based rule |
| `$OPS/evidence/` | **lifecycle**: retain while any referencing finding is unresolved; prune once `resolved_at` is set. Content-addressed filenames so a recurring finding reuses one file. |

Rationale: WS5 copies evidence to `$OPS` precisely so WS6 can render evidence links on
open findings. A time-based rule guarantees dead links on the oldest open findings —
exactly the ones most in need of justification. Design anchors (`friction_delta`,
`a11y`, `evidence`) depend on the screenshot as the objective anchor.

### 9.9 Concurrency is a setting, not an assumption (P1)

§WS4's "cap 3–5 via slot behavior" is incorrect — the documented workflow concurrency cap
is `min(16, CPUs - 2)`, so all K=6 Opus reviewers dispatch at once. `run-loop.md:56`
states the intended discipline ("Parallelize reviewers 3–5 at a time"), so make it real:
`max_concurrent_reviewers` in `$OPS/config.yml`, `ns` chunks the surfaces list before
passing it as `args`, and the workflow pipelines over chunks. Chunking is launcher-side
data shaping, so E4 is untouched.

### 9.10 No printed cost estimate until A7 measures one (P2)

WS2 ships whole. The runbook's "low single-digit dollars" line is **removed** and replaced
with a TBD that A7 fills from the first three real runs. At the plan's own quoted rates
($5 in / $25 out per MTok), a 24-turn Opus reviewer re-sending accumulating context across
6 surfaces plus Tier-1 and Tier-2 plausibly lands 5–10× that figure, and the true number
depends heavily on cache hit rate. A wrong baseline is worse than none: it turns every
reading into a false alarm or a missed one.

### 9.11 Durable-state concurrency + retry idempotency (O1) — closes P2 for real

Per-run scratch dirs isolate scratch, **not durable state**. `src/lib/record-run.ts`
appends N finding lines, appends a run line, then rewrites the whole registry — atomic
per write, not per run (E6 only promises the former). Two changes:

- **Per-repo lockfile**, taken by `ns` for the whole durable phase (with a stale-lock path).
- **`bin/record` refuses a `run_id` already present in `metrics/runs/`.**

The second also makes **retry safe**, which is the far more common failure: §3's flow runs
record → record-cost → dashboard → clean, and a failure after `record` invites a re-run
that would double-append findings and inflate the FPR denominator.

### 9.12 Registry id sanitization + honest guard framing (O2)

- **Sanitize ids.** WS4 introduces `.run/<id>/surfaces/<sid>/` where `sid` is a registry
  id. `src/lib/validate.ts:73` requires only a non-empty string and
  `schemas/registry-entry.yml:17` calls it "human-seeded", so `../../..` escapes the pack.
  Constrain to `^[A-Za-z0-9_.-]+$` in `validate.ts`, and have `bin/merge-candidates`
  resolve every surface path and assert containment within the run dir. Lands in A4.
- **Restate the guard.** §WS7's "The guard is the enforcement layer" is not accurate:
  `src/lib/guard.ts:276` returns `allow: true` for unknown tools and `:273` returns
  `allow: true` for any unrecognized Bash command, so `node -e`, python, and rsync pass.
  That fail-open posture is deliberate and documented at `guard.ts:25` as
  defense-in-depth. **Scoped tool grants, not the guard, are the real perimeter** — WS7's
  `--allowedTools` decision at A7 must be made on that basis.

### 9.13 Release 3.0.0 after A7, not after A6 (O4)

The `Release: nightshift 3.0.0` row in §5 moves **below A7**. No workstream moves; no
scope changes. A7's gates are feasibility (Workflow billing on subscription, guard
propagation inside `agent()`, permission flag set, cost capture, dispatch), not polish.
Cut the tag once, on a system that has completed a real run.

### 9.14 Design-lane environment safety (O5 / codex #12) — blocks A8

A curl reachability check proves something answers, not that it is a seeded local
environment. The `ux-reviewer` drives real flows as a persona (submitting forms, changing
state), and **browser actions never touch the filesystem guard**. `ns` design preflight
must therefore:

- Require a **loopback host** in `stack_adapter.browser.base_url`.
- Require the manifest to **explicitly assert a non-production environment**.
- **Refuse the run** if either is absent — do not warn and proceed.

This is the only finding in this review that can cause something irreversible.

### 9.15 Candidate-to-surface binding (O5 / codex #8)

`bin/merge-candidates` asserts that every candidate in `.run/<id>/surfaces/<sid>/`
carries `dedupe_key.surface === <sid>`. Harmless at K=1; at K=6 nothing otherwise stops
reviewer 3's output from claiming surface 1 and stamping the wrong registry entry green.
Lands inside `bin/merge-candidates`, which A4 writes from scratch.

### 9.16 CRITICAL regression guard: partial fan-out failure (T2)

**Mandatory, no opt-out.** A Workflow `pipeline` stage that throws drops that item to
`null` and skips its remaining stages, so a reviewer dying on surface 3 of 6 leaves that
surface with no artifacts. `bin/merge-candidates` **must** union `reviewed.json` only from
surface directories that actually produced one.

Test: a K=6 run with surface 3 crashed stamps **exactly 5** registry entries, and surface 3
stays stale for re-selection. This re-breaks the exact invariant v2.3.0 fixed
(TODOS.md: *"silently marks unreviewed vectors as covered"*) through a new door.

### 9.17 Non-gating planted-vuln eval (T1)

WS3 moves the reviewer from sonnet/15-turns to Opus-5/24-turns and WS4 introduces a new
per-surface prompt. FPR measures **false positives only**, so a prompt change that makes
the reviewer miss real issues would look like an improving FPR. Extend the NovuDesk
example pack with planted, unambiguous vulnerabilities mapped to real vectors plus clean
control surfaces; report caught/total and false-positives-on-clean. **Report only, never
blocking** — same precedent already set in TODOS.md for the onboardme LLM-judge lane.

---

## 10. What already exists (reuse check)

| Sub-problem | Already solved by | Verdict |
|---|---|---|
| Staleness, score, K-selection | `bin/select` + `src/lib/staleness.ts` (18 tests) | **Reuse.** WS4 only adds `dispatch`. |
| Compute-allocation key | `Surface.band`, already computed, consumed by nothing | **Reuse.** §9.1 finishes the seam. |
| Atomic writes, jsonl append | `src/lib/io.ts#atomicWrite` / `appendJsonl` (7 tests) | **Reuse** for all 6 new bins. |
| Schema gating of model artifacts | `bin/validate` + `src/lib/validate.ts` (9 tests) | **Reuse**; extend per §9.12/§9.15. |
| Survivor identity (anti-substitution) | `run-meta-build.ts` canonical `dedupe_key` multiset | **Reuse** for Tier-2 (§9.2). |
| FPR / freshness / median-staleness math | `bin/rollup` (25 tests) | **Reuse**; WS2 extends additively. |
| Read-only perimeter | `hooks/guard` (59 tests) | **Reuse**, with framing corrected (§9.12). |
| Monthly finding shards, `ts`-max daily fold | `metrics/` layout + `daily-metrics.yml` | **Reuse.** WS6 correctly applies max-ts. |
| Example pack for snapshot tests | `examples/novudesk/` + `check-example-hygiene.sh` | **Reuse** for WS2 cost lines + §9.17 eval. |
| Due-detection logic | *(new in `ns`, §9.4)* | **Build once**, WS8's sentinel reuses it. |

Nothing in the plan rebuilds an existing capability. The engine's 203 tests all carry over.

## 11. NOT in scope (considered, explicitly deferred)

| Deferred | Why |
|---|---|
| Stateful backlog + `queue.jsonl` scaling (P3) | Unchanged from §7; no consumer until the backlog exists. |
| Lane-polymorphic backlog model (P3b) | Gated on P3. |
| Opportunities lane (P4) | Gated on P3b. |
| Engine/pack versioning contract (P1) | Escalated in TODOS.md — now a blocker for the **first external adopter**, not for novudesk + NovuDesk. |
| Codex distribution contract | Unrelated to nightshift delivery. |
| onboardme LLM-judge lane | Different plugin. |
| **Refuter field mutation (codex #7)** | Pre-existing in v2.3.0; own branch, own tests. TODOS.md. |
| **Date-vs-SHA change baseline (codex #11)** | Pre-existing; must land before A9 or the sentinel inherits the blind spot. TODOS.md. |
| **Multi-repo slug identity (codex #14)** | Latent until repo #2 is onboarded. TODOS.md. |
| **"No cloud" vs WS8 routine wording (codex #15)** | One-line fix at A9. TODOS.md. |
| Deny-by-default guard rewrite | Behavior change of its own size; deserves its own branch and soak. |
| Pre-flight cost ceiling that aborts | Cost is only known post-run; a true pre-flight abort is not possible. |

## 12. Failure modes (new codepaths)

| # | Codepath | Realistic production failure | Test? | Error handling? | Visible to operator? |
|---|---|---|---|---|---|
| 1 | `bin/merge-candidates` | reviewer dies on surface 3/6 | **§9.16 CRITICAL** | union only real dirs | stays stale, re-selected |
| 2 | `bin/merge-candidates` | candidate claims wrong surface | §9.15 | assert + abort | exit 2, run aborts |
| 3 | `bin/merge-candidates` | `sid` contains `../` | §9.12 | regex + containment | exit 2 |
| 4 | `bin/record` | retry after partial success | §9.11 | run_id uniqueness | exit 2 |
| 5 | `bin/record` | two concurrent runs | §9.11 | per-repo lock | blocks, then proceeds |
| 6 | `bin/record-cost` | run failed, `total_cost_usd:0` | §9.7 | gate on `is_error` | hygiene strip |
| 7 | `bin/tier2-gate` | empty survivor set | WS4 tests | empty `tier2.json` | `rejected_tier2: 0` |
| 8 | `bin/dashboard` | a configured pack is missing | WS6 tests | render gap row | visible gap |
| 9 | `bin/dashboard` | fewer than 2 trend points | WS6 tests | omit sparkline | no chart |
| 10 | `bin/clean` | prune deletes needed evidence | §9.8 | lifecycle rule | n/a, prevented |
| 11 | `ns` preflight | dev server up but is **staging** | §9.14 | loopback + assert | **refuses** |
| 12 | `ns` preflight | personas absent | WS5 | refuse | refuses with reason |
| 13 | `bin/select` dispatch | bad model alias in `MODEL_BY_BAND` | §9.5 snapshot | CI fails | red CI |
| 14 | Workflow v2 | args truncated, K surfaces reduced | *not testable* | run-meta gates reviewed ⊆ selected | degrades safely (stays stale) |

**Critical gaps (no test AND no handling AND silent): 0.** #14 is untestable by design
(sandbox) but degrades safely and is covered empirically at A7.

## 13. Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| A1 WS1 | `src/lib/` (record-run, io, new clean/prune), `src/bin/` | — |
| A2 WS2 | `schemas/`, `src/lib/` (rollup-run, new record-cost), `examples/` | — |
| A3 WS3 | `agents/`, `skills/`, docs | — |
| A4 WS4 | `nightshift.workflow.js`, `src/lib/` (select-run, run-meta-build, validate, new merge/tier2), `CONTRACTS.md` | A1 |
| A5 WS5 | `nightshift.workflow.js`, `agents/`, `skills/onboard/` | A4 |
| A6 WS6 | `src/lib/dashboard-run`, `src/bin/`, `templates/` | A2 |

```
Lane A: A1 → A4 → A5        (sequential; all three touch src/lib/ + workflow)
Lane B: A2 → A6             (sequential; shared src/lib/rollup-run + schemas)
Lane C: A3                  (independent; agents/ + docs only)

Execution: launch A, B, C in parallel worktrees. C merges first (docs, no conflict).
           Merge B. Then A5 completes. Then A7 (LOCAL). Then release 3.0.0. Then A8, A9.
```

**Conflict flag:** Lanes A and B both touch `src/lib/`, though disjoint files (A: record-run,
clean, prune, select-run, run-meta-build, validate, merge-candidates, tier2-gate. B:
rollup-run, record-cost, dashboard-run). `src/lib/types.ts` is touched by **both** — A adds
`Surface.dispatch`, B adds the cost-record type. Land A1's `types.ts` change first, or
expect one small merge conflict there.

## 14. Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — `bin/select` — emit per-surface `dispatch`
  - Surfaced by: Architecture A1 — E4 forbids a band→opts table in the workflow sandbox
  - Files: `src/lib/types.ts`, `src/lib/select-run.ts`, `src/lib/select-run.test.ts`, `schemas/`
  - Verify: `npm run check`; snapshot asserts all 4 bands
- [ ] **T2 (P1, human: ~3h / CC: ~25min)** — Tier-2 — wire accounting end to end
  - Surfaced by: Architecture A2 + codex #1 — `run-meta-build.ts:156` hardcodes `rejected_tier2 = 0`
  - Files: `src/lib/run-meta-build.ts`, `src/bin/run-meta.ts`, `agents/security-refuter-2.md`, `CONTRACTS.md`
  - Verify: a Tier-2 rejection increments `rejected_tier2` and moves FPR in `bin/rollup`
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — `agents/` — per-adapter ux-reviewer + `Write`
  - Surfaced by: Architecture A3 — no dispatch API accepts a tools list
  - Files: `agents/ux-reviewer.md`, new `agents/ux-reviewer-playwright.md`
  - Verify: design dispatch resolves a browser tool; ux-reviewer can write its artifacts
- [ ] **T4 (P1, human: ~3h / CC: ~20min)** — `bin/ns` — commit, shellcheck, extract logic
  - Surfaced by: Architecture A4 + codex #6 — sole untested, unversioned component
  - Files: new `plugins/nightshift/bin/ns`, CI workflow, `src/lib/` due-detection
  - Verify: shellcheck clean; due-detection covered by vitest
- [ ] **T5 (P0, human: ~4h / CC: ~30min)** — `bin/record` — per-repo lock + run_id uniqueness
  - Surfaced by: Outside voice O1 (codex #2/#3) — `record-run.ts` multi-append with no lock
  - Files: `src/lib/record-run.ts`, `plugins/nightshift/bin/ns`
  - Verify: duplicate run_id exits 2; interleaved-run fixture proves no cross-contamination
- [ ] **T6 (P0, human: ~2h / CC: ~15min)** — `validate` — sanitize registry ids, assert containment
  - Surfaced by: Outside voice O2 (codex #4) — `validate.ts:73` allows `../..` as an id
  - Files: `src/lib/validate.ts`, `src/lib/merge-candidates-run.ts`
  - Verify: `id: "../../x"` rejected; resolved surface paths asserted inside the run dir
- [ ] **T7 (P1, human: ~1.5h / CC: ~10min)** — `bin/record-cost` — gate on `is_error`
  - Surfaced by: Code quality C3 — live probe returned `is_error:true` with `subtype:"success"`
  - Files: new `src/lib/record-cost-run.ts`, `schemas/cost-record.yml`, `src/lib/rollup-run.ts`
  - Verify: error-envelope fixture writes `status:"error"`, excluded from the 30d average
- [ ] **T8 (P1, human: ~3h / CC: ~20min)** — `ns` preflight — loopback + non-prod assertion
  - Surfaced by: Outside voice O5 (codex #12) — curl proves reachability, not safety
  - Files: `plugins/nightshift/bin/ns`, `schemas/manifest.yml`
  - Verify: non-loopback base_url refuses; missing environment assertion refuses
- [ ] **T9 (P1, human: ~2h / CC: ~15min)** — `bin/merge-candidates` — surface binding + partial-failure union
  - Surfaced by: Test review T2 (CRITICAL regression) + O5 (codex #8)
  - Files: new `src/lib/merge-candidates-run.ts` + tests
  - Verify: K=6 with surface 3 crashed stamps exactly 5; mismatched surface id aborts
- [ ] **T10 (P2, human: ~2h / CC: ~15min)** — `prune()` — one mechanism, lifecycle rule for evidence
  - Surfaced by: Code quality C4 + outside voice O3 (codex #13)
  - Files: new `src/lib/prune.ts` + tests, `bin/clean`, `bin/ns`
  - Verify: open finding retains evidence past 7 days; resolved finding's evidence prunes
- [ ] **T11 (P2, human: ~2h / CC: ~15min)** — `ns` — `max_concurrent_reviewers` chunking
  - Surfaced by: Performance P1 — real cap is `min(16, CPUs-2)`, not 3–5
  - Files: `$OPS/config.yml` schema, `plugins/nightshift/bin/ns`
  - Verify: K=6 with cap 3 dispatches two chunks
- [ ] **T12 (P2, human: ~1h / CC: ~10min)** — `MODEL_BY_BAND` — pinned const + snapshot
  - Surfaced by: Code quality C1 — dispatch channel is alias-only, frontmatter pin is decorative
  - Files: `src/lib/` const + snapshot test, `$OPS/runbook.md`
  - Verify: changing a tier fails the snapshot
- [ ] **T13 (P2, human: ~45min / CC: ~10min)** — docs — three plan-vs-code corrections
  - Surfaced by: Code quality C2 — WS3 "Was" column, `guard.ts:20`, E4 LOC ceiling
  - Files: this plan §WS3, `src/lib/guard.ts`, `nightshift.workflow.js`, `CONTRACTS.md`
  - Verify: read-through; no claim contradicts code
- [ ] **T14 (P3, human: ~1 day / CC: ~45min)** — `examples/novudesk` — planted-vuln eval
  - Surfaced by: Test review T1 — FPR is blind to false negatives
  - Files: `examples/novudesk/`, new eval runner
  - Verify: reports caught/total + FP-on-clean; never blocks CI
- [ ] **T15 (P3, human: ~15min / CC: ~5min)** — `$OPS/runbook.md` — remove the cost estimate
  - Surfaced by: Performance P2 — printed figure likely off 5–10×
  - Files: this plan §WS2, runbook template
  - Verify: TBD placeholder, filled by A7 from three real runs

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 15 findings, 11 folded / 4 filed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 22 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** 15 findings at high reasoning, read-only. 4 P0s, all folded (§9.2, §9.11,
  §9.12). Independently confirmed three eng-review findings without shared context:
  Tier-2 undesigned, thin-shell contradiction, `ns` must be committed and tested.
- **CROSS-MODEL:** 3 tension points, all resolved in the operator's favor.
  (1) Evidence retention — codex accepted over the eng review's uniform prune (§9.8).
  (2) `ns` implementation — eng review's committed POSIX shell kept over codex's Node
  rewrite; the "drop the Workflow entirely" claim depends on A7's billing answer.
  (3) Release sequencing — codex's narrower fix accepted (move the tag, not the
  workstreams), after the operator declined the broader Step 0 re-sequence.
- **VERDICT:** ENG CLEARED — ready to implement. Scope accepted as-is (all 8 workstreams,
  A0–A9 order preserved); 15 implementation tasks in §14; 4 findings filed to TODOS.md
  with full context. Recommend `/plan-design-review` before A8, since WS5/WS6 introduce
  a user-facing dashboard and a driven-flow lane.

NO UNRESOLVED DECISIONS
