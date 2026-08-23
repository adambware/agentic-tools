# A7 — Ops home, easy button, runbook + first real run

**Depends on:** A1–A4, A6. **Blocks:** release 3.0.0 (plan §9.13: cut the tag once, on a
system that has completed a real run), then A8.

Two halves. **Part 1 (repo sessions, normal CI):** the launcher is engine code —
committed, shellchecked, its logic vitest-covered (plan §9.4). **Part 2 (LOCAL, operator
machine):** create `$OPS`, write the runbook, run the first real
`ns run novudesk security`.

**Gate (end-to-end, on the real run):** cost line captured; dashboard regenerated +
opens; run dir cleaned; only reviewed ids stamped; guard verified inside the Workflow;
permission flag set recorded in the runbook.

## Part 1 — Launcher engineering (repo)

### `bin/ns` is committed and tested (plan §9.4)

`plugins/nightshift/bin/ns` (POSIX shell, repo conventions), under CI (shellcheck),
versioned with the engine. Its **decision logic — due-detection, the cost-write
predicate, retention — moves into vitest-covered `bin/` commands** (same thin-shell
discipline as the workflow). `$OPS` keeps only `config.yml`, `runbook.md`,
`dashboard.html`, `digests/`, `evidence/`, `logs/` — all uncommitted. A9's sentinel
reuses `ns`'s tested due-detection instead of reimplementing it.

Subcommands:

- `ns run <repo> [security|design|all]` — the easy button; the index's run flow.
- `ns status` — per repo/lane: what `bin/select` *would* pick, staleness summary, last
  run + cost. Read-only, no model calls.
- `ns run --due` — run every enabled repo/lane whose staleness/change flags warrant it
  (the same deterministic logic the sentinel reuses; manual until A9).
- `ns digest <repo>`, `ns dashboard` — regenerate artifacts on demand.
- `ns run --interactive` — debug mode: same env + workflow in a foreground session.
- `ns cost add` — manual cost line for non-JSON debug runs.

### Launcher responsibilities wired here

- **Select launcher-side:** run `bin/select`, chunk surfaces by
  `max_concurrent_reviewers` (T11), pass as Workflow `args` along with lane + agentType.
- **Guard arming:** export `NIGHTSHIFT_RUN_ID` + `NIGHTSHIFT_LANE_RUN=1` before the
  headless call (the workflow sandbox cannot self-arm — `process` is undefined there).
- **Per-repo lock** (A1's helper) held for the whole durable phase; stale-lock path.
- **Cost capture:** parse the headless JSON envelope → `bin/record-cost` (A2 semantics).
- **Dashboard on every exit path (T22, plan §15.8):** `ns run` regenerates the dashboard
  **unconditionally**, after `record-cost` has written its `status:"error"` row on
  failure — otherwise a failed run leaves a recent-looking stale dashboard, the exact
  silent staleness this system exists to prevent. `bin/clean` stays success-only.
- **Retention:** prune `$OPS/logs/` (time-based) and `$OPS/evidence/` (lifecycle) via
  A1's `prune()`; copy evidence referenced by confirmed findings into
  `$OPS/evidence/<repo>/` (content-addressed).
- **Design preflight (T8, plan §9.14 — blocks A8):** a curl reachability check proves
  something answers, not that it's safe to drive. The ux-reviewer submits forms and
  changes state, and browser actions never touch the filesystem guard. Preflight must:
  require a **loopback host** in `stack_adapter.browser.base_url`; require the manifest
  to **explicitly assert a non-production environment**; **refuse the run** if either is
  absent — never warn-and-proceed. Also: refuse when personas are missing or the dev
  server is down ("start the dev server first").

### `$OPS/config.yml`

```yaml
repos:
  - path: ~/code/novudesk
    lanes: [security, design]
    enabled: true
dashboard: { out: dashboard.html, open_after_run: true }
sentinel: { enabled: false, hour: 7, cooldown_days: 2, weekly_floor_days: 7 }
max_concurrent_reviewers: 3
```

## Part 2 — Local bring-up (operator machine)

### Headless permissions decision

Headless runs launch with the armed `NIGHTSHIFT_LANE_RUN=1` PreToolUse guard plus a
scoped `--allowedTools` grant; the exact flag set is validated here and recorded in the
runbook. **Framing (plan §9.12): the guard is fail-open by design** — it allows unknown
tools and unrecognized Bash commands (`node -e`, python, rsync pass), documented as
defense-in-depth. **Scoped tool grants, not the guard, are the real perimeter** — decide
the flag set on that basis.

### Empirical questions to answer and record in the runbook

1. Workflow billing on subscription (headless).
2. Guard firing inside Workflow `agent()` subagents.
3. Per-agent context cost.
4. The exact `--allowedTools` set that works.
5. **Real cost per run (T15):** the runbook ships with a TBD instead of an estimate —
   fill it from the first three real runs. Never print a guessed figure.

### `$OPS/runbook.md` contents (never committed)

Engine install/update (`/plugin marketplace add`, `/plugin install
nightshift@agentic-tools`, dev loop `npm run check`) · config.yml reference ·
easy-button usage · reading the dashboard (incl. "evidence links only work from `$OPS/`")
· triage flow per severity gate (Linear filing by `dedupe_key`) · suppression how-to ·
design-lane prerequisites (dev server up, personas current) · measured cost + the
quarterly model-fleet check ("run `npm test`, read the `MODEL_BY_BAND` snapshot") ·
troubleshooting (validate aborts, guard denials, cost-capture gaps) · (after A9)
sentinel behavior and how to pause it.

## Failure modes to cover

| Codepath | Failure | Handling |
|---|---|---|
| `ns run` | run fails before the record chain | dashboard regenerates anyway; failure in verdict strip |
| `ns` preflight | dev server up but is **staging** | loopback + non-prod assertion → refuses |
| `ns` preflight | personas absent | refuses with reason |

## Tasks

- [ ] **T4 (P1)** — `bin/ns` — commit, shellcheck, extract logic
  - Files: new `plugins/nightshift/bin/ns`, CI workflow, `src/lib/` due-detection
  - Verify: shellcheck clean; due-detection covered by vitest
- [ ] **T8 (P1)** — preflight — loopback + non-prod assertion
  - Files: `plugins/nightshift/bin/ns`, `schemas/manifest.yml`
  - Verify: non-loopback base_url refuses; missing environment assertion refuses
- [ ] **T11 (P2)** — `max_concurrent_reviewers` chunking
  - Files: config schema, `plugins/nightshift/bin/ns`
  - Verify: K=6 with cap 3 dispatches two chunks
- [ ] **T22 (P2)** — regenerate the dashboard on every exit path
  - Verify: a forced-failure run leaves a dashboard whose strip names the failure
- [ ] **T15 (P3)** — runbook cost figure is a TBD filled from three real runs
- [ ] Local bring-up: `$OPS`, config, runbook, first real run, gate checklist above
