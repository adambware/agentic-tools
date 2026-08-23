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

**Ops home name — DECIDED (A7): `agentic-nightshift`.** Created beside the operator's
repo checkouts, never inside one. The name sorts immediately before `agentic-tools`, so
the ops home sits next to the engine it drives, and it deliberately does NOT start with
`agentic-tools-` — that prefix already means "a git worktree of the engine" in that
directory, and the ops home is not a git repo at all (never `git init` it). `ns` still
has no default: the name is settled but the parent directory is operator-specific, and a
guessed absolute path would silently create a second, empty ops home rather than failing.
Set `NIGHTSHIFT_OPS` in the shell profile, or pass `--ops`.

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

- [x] **T4 (P1)** — `bin/ns` — commit, shellcheck, extract logic
  - Landed: `bin/ns` (POSIX sh, committed 100755, shellcheck-clean under 0.11.0).
    Decision logic extracted to four new vitest-covered bins: `bin/ops-target`
    ($OPS/config.yml -> one resolved repo+lane, `--format sh` for the shell to *source*,
    never `eval`), `bin/due` (due-detection, the predicate A9's sentinel reuses),
    `bin/workflow-args` (T11), `bin/retain` (retention). New libs: `src/lib/ops-config.ts`,
    `due.ts`, `workflow-args.ts`, `retain.ts`. `schemas/ops-config.yml` documents the
    ops config; `templates/ops/{config.yml,runbook.md}` are what the operator copies.
  - CI: shellchecks `bin/ns` + `scripts/check-example-hygiene.sh`, and asserts `bin/ns`
    is committed mode 100755.
  - The three launcher obligations are covered by probes in `src/lib/ns-launcher.test.ts`
    (33 tests, real bins, stubbed `claude`): `--pack .nightshift` with cwd at the repo
    root (proven by the emitted registry being repo-root-relative), the guard armed
    launcher-side, one pinned `NIGHTSHIFT_TODAY` with a fresh run id per attempt.
- [x] **T8 (P1)** — preflight — loopback + non-prod assertion **(A8 unblocked)**
  - Landed in `src/lib/lane-plan.ts` (`isLoopbackHost`, `checkLoopbackBaseUrl`,
    `checkNonProductionAssertion`) rather than in `ns`, so the gate is the same tested
    binary the launcher already had to call and `ns` stays a thin shell. `schemas/manifest.yml`
    gains `stack_adapter.browser.environment` (`local|dev|test`); the template and the
    novudesk example now ship a loopback `base_url`.
  - Two INDEPENDENT gates, both mandatory, neither a warn-and-proceed. base_url is parsed
    with WHATWG `URL`, so `http://localhost@prod.example/` is refused on its real hostname.
    `staging` and `production` are refused BY NAME. Verified: non-loopback refuses;
    missing `environment` refuses even on loopback; each fires with the other half valid;
    the security lane is unaffected by an unsafe browser block.
- [x] **T11 (P2)** — `max_concurrent_reviewers` chunking
  - `bin/workflow-args` chunks the selected surfaces and emits exactly the five keys the
    workflow reads. K=6 at cap 3 -> two chunks (unit + launcher probe). The design plan's
    `browser`/`personas` are deliberately NOT spliced in — the workflow consumes neither,
    and shipping them invites a future `lane` branch.
  - Key parity is executable: `workflow-args.test.ts` scans `nightshift.workflow.js`'s
    own source (template-literal-aware) and asserts both directions — every key the
    workflow reads is emitted, and nothing emitted is dead payload.
- [x] **T22 (P2)** — regenerate the dashboard on every exit path
  - Done as an EXIT/INT/TERM trap, so it also covers the paths no `if` can enumerate.
    Order is load-bearing: cost row, then retention, then dashboard, then `clean`.
    `bin/record-cost` gained `--fallback-error-reason` (opt-in, default behaviour
    unchanged) so a headless run that wrote no envelope still leaves a `status:"error"`
    row — a crash with NO row renders as "no run happened" instead of "a run failed".
    A preflight refusal writes no cost row at all (a $0 error row would drag the cost
    trend toward zero for free) but still regenerates the dashboard.
- [x] **T15 (P3)** — runbook cost figure is a TBD filled from three real runs
  - Engine half: `templates/ops/runbook.md` ships with an explicit TBD table and the
    rule stated in place ("do not write an estimate here"), plus the note that a
    `status:"error"`/`usd:0` row is a floor, not a measurement, and must be excluded
    when averaging. The operator fills it in during Part 2.
- [ ] Local bring-up: `$OPS`, config, runbook, first real run, gate checklist above

## Engine-half outcome (this session)

`npm run check` green: **1240 tests / 38 files** (baseline at the A5 tip: 981 / 33).
`nightshift.workflow.js` is UNCHANGED — zero conditionals still holds. A1/A4/A5
invariants untouched; the only edits to shipped modules are additive
(`lane-plan.ts` gains the T8 gate, `record-cost` gains an opt-in flag).

### Adversarial round (three independent Opus refuters + a judge, real probe packs)

Every claim was attacked by a refuter that drove the real launcher against packs it
built itself. **Eight defects were found and fixed; each has a regression test named
after the failure, not after the fix.** The ones worth remembering:

| Found | Why it mattered |
|---|---|
| SIGINT/SIGTERM did not stop the run | A POSIX trap handler that merely RETURNS resumes the script. `ns` finalized, then went on to invoke the model anyway — spending money after `timeout`/Ctrl-C said stop, with the attempt already marked "no model invoked" so the cost row was never written, and exiting 0. The handler now ends in `exit`. |
| `ns run --due` fed its work list to the model on stdin | `claude -p` reads piped stdin, so the FIRST lane's session swallowed the rest of the sweep. The remaining pairs silently never ran and `ns` exited 0. The loop now reads on fd 3 and the headless call gets `</dev/null`. |
| Four target-less refusals never regenerated the dashboard | Unknown repo, disabled repo, lane not enabled, **pack removed** — the last is precisely the staleness the living document exists to surface, and it left yesterday's page looking fresh. |
| A refused run wrote into the operator's repo | The run dir was minted BEFORE preflight, so four refused design attempts left four untracked `.run/` dirs (kept, correctly, by clean's failure policy). Now minted after preflight; the pack template also ships a `.run/` gitignore. |
| A relative `--ops` broke everything after the `cd` | Log unwritable, retention and clean failing, no dashboard — every symptom pointing somewhere else. `resolve_ops` absolutizes. |
| `buildWorkflowArgs` validated the surfaces and NOTHING else | `undefined` does not survive `JSON.stringify`: an incomplete lane plan produced an args.json silently MISSING keys, and the workflow then ran `--registry undefined` and dispatched every reviewer to an agentType nobody has. Now `lane`, `registry` (shell-safe allow-list — the workflow interpolates it unquoted) and all three `agents.*` are checked. |
| A dispatch could hijack its own dispatch | The workflow spreads `...s.dispatch` LAST, so an extra `agentType` key would override the lane's reviewer. `checkDispatch` now rejects any key outside `{model, effort, maxTurns}`. |
| The key-parity scanner had blind spots | Destructuring, bracket access and block comments. The scan now fails the build if the workflow adopts a form it cannot see, and each tripwire has its own non-vacuity test. |

Three further fixes came from the judge's triage: `ns digest` ran with the full review
grant (now `Read,Glob,Grep,Write`, and it verifies the file was actually written);
`--interactive` recorded every session as a success, so `clean` deleted the very run dir
the operator opened it to inspect; and the configured `dashboard.out` is now honoured on
the target-less path instead of a hardcoded default quietly maintaining a second file.

Refuted-and-rejected, for the record: no base_url spelling was found that
`isLoopbackHost` accepts but a browser would drive elsewhere — a 50-case table covering
userinfo, IPv4 shorthand/hex/octal/decimal, IPv6 spellings, trailing dots, IDN
homographs, percent-encoding and suffix confusion was run through the real
`bin/lane-plan.mjs`, and every one refused.

### Carried into A8

- **The evidence copy relocates BYTES, not the POINTER.** `bin/retain` copies evidence
  cited by open findings out of the run dir into `$OPS/evidence/<repo>/`
  (content-addressed, sha256-16) and lifecycle-prunes it via A1's `prune()` — but
  `finding.evidence` still holds the run-dir path `bin/record` wrote, so the dashboard
  resolves it against `$OPS`, misses, and renders A6's "evidence no longer on disk"
  state. Closing it needs a decision this session had no business taking alone: either
  the workflow instructs the reviewer to write a stable path, or the recorded pointer is
  rewritten after `record` under A1's per-repo lock. Both touch durable state owned by
  A1/A4, and A8's first real design run is where the choice can actually be observed.
- **`--allowedTools` is provisional.** `bin/ns` defaults to
  `Workflow,Read,Glob,Grep,Bash,Write,Agent`, overridable via
  `NIGHTSHIFT_ALLOWED_TOOLS`, and the runbook carries it as a TBD. Scoped grants, not
  the fail-open guard, are the real perimeter — the working set is Part 2's to establish.
- **NOT DONE: the launcher-held per-repo lock.** §"Launcher responsibilities wired here"
  lists "per-repo lock (A1's helper) held for the whole durable phase; stale-lock path",
  and it is deliberately not in this commit. It is not one of A7's tasks (T4/T8/T11/T22/T15)
  and the correctness-critical lock is already in place: `bin/record` takes A1's per-repo
  lock around the durable write and enforces run_id uniqueness, so two concurrent runs
  cannot interleave stateful writes today. What a launcher-held lock would add is
  *economic* (two concurrent runs of the same repo+lane both pay for the same review) and
  *cosmetic* (two finalizers racing on one dashboard file — an atomic write, so the loser
  is simply overwritten, never spliced). Doing it properly needs a design decision this
  session should not take alone: A1's lock identifies its holder by a LIVE pid, so a
  shell-held lock needs a companion holder process that outlives each `bin/` invocation
  and survives an hours-long headless run — i.e. a new `bin/lock --hold` command with its
  own stale policy. Decide it with the first real concurrent run in front of you.
- **Evidence prune is per-repo, never store-wide.** The retain set can only be built from
  a repo's OWN metrics dir; pruning all of `$OPS/evidence/` from one repo's findings
  would delete every other repo's evidence, silently, on the night a second clone
  happened to be unavailable.
