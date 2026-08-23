# nightshift runbook — TEMPLATE

Copy this into your ops home as `runbook.md` and edit it in place. **Never commit the
copy** — it describes one machine and one operator. The engine ships this template so a
new operator starts from something real; everything below marked **TBD** is filled in
from your own first runs, not from a number someone guessed.

Everything here should get you from zero to a successful run **without reading engine
source**. If it doesn't, that is a bug in this file.

---

## 1. Install / update the engine

```
/plugin marketplace add adambware/agentic-tools
/plugin install nightshift@agentic-tools
```

Working on the engine itself:

```
cd <checkout>/plugins/nightshift
npm install
npm run check        # typecheck + vitest + build. Must be green before anything.
```

Put `bin/ns` on your PATH (symlink it; don't copy it — it must stay versioned with the
engine it launches):

```
ln -s <checkout>/plugins/nightshift/bin/ns ~/bin/ns
```

## 2. The ops home

The ops home is called **`agentic-nightshift`** (v3 plan, open question 1). Create it
**beside your repo checkouts, never inside one** — the name sorts immediately before
`agentic-tools`, so the ops home sits next to the engine it drives. Do not name it
`agentic-tools-something`: that prefix means "a git worktree of the engine", and this is
not a git repo at all. Never `git init` it.

```
export NIGHTSHIFT_OPS=<where you keep your repos>/agentic-nightshift   # shell profile
mkdir -p "$NIGHTSHIFT_OPS"
cp <engine>/templates/ops/config.yml "$NIGHTSHIFT_OPS/config.yml"
cp <engine>/templates/ops/runbook.md "$NIGHTSHIFT_OPS/runbook.md"
```

`ns` deliberately has **no default ops home**: the name is settled but the parent
directory is yours, and a guessed absolute path would silently create a second, empty
ops home rather than failing. Edit `config.yml` — the annotated reference is
`<engine>/schemas/ops-config.yml`. `ns` creates `logs/`, `evidence/` and `digests/`
itself.

Nothing in the ops home is committed. Nothing in the ops home is logic.

## 3. The easy button

```
ns run <repo> security          # one bounded run, zero to refreshed dashboard
ns run <repo> all               # both lanes, one pinned date, a fresh run id each
ns run --due                    # every repo/lane whose staleness or diff warrants it
ns status                       # what select WOULD pick. Read-only, no model calls.
ns dashboard                    # regenerate the living document on demand
ns digest <repo>                # regenerate $OPS/digests/<repo>.md
ns cost add <repo> <lane> <run_id> <usd>   # cost for an --interactive run
```

`ns run` regenerates the dashboard on **every** exit path, including failures and
refusals. If a run fails, the dashboard still refreshes and the verdict strip says so —
a dashboard that looks fresh after a failed run is the failure mode this system exists
to prevent.

## 4. Reading the dashboard

Open `$OPS/dashboard.html`. It covers every configured repo and answers four questions:
what's covered, what's rotting, what needs me, what did this cost.

> **Evidence links only work from `$OPS/`.** They are relative to the dashboard's own
> directory. Open the file from the ops home (or `ns dashboard`), not from a copy
> somewhere else, or every screenshot link will 404.

## 5. Triage

Findings are filed by severity gate (see the run-loop reference). File in Linear by
`dedupe_key` — never by title, or a recurring finding becomes a second ticket.

To suppress a finding, add it to `<repo>/.nightshift/findings/suppressions.yml` with a
`reason`, an `expires` date, and `approved_by`. Suppressions **auto-lift** on expiry;
that is the point. Do not set a far-future date to make something go away.

## 6. Design-lane prerequisites

`ns run <repo> design` refuses unless **all** of these hold:

- `manifest.stack_adapter.browser.tool` names a supported adapter,
- `…browser.base_url` is a **loopback** host (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`),
- `…browser.environment` explicitly says `local`, `dev` or `test`,
- `fixtures/personas.yml` exists and every flow's `persona:` resolves to a seeded id,
- **the dev server is actually running** at that base_url.

Staging is refused by name. The design reviewer submits forms and changes state as a
seeded persona, and browser actions never touch the read-only filesystem guard — so
"the server answered" is not the same claim as "this data is safe to mutate". Only you
can make the second claim, which is what `environment:` is for.

Start the dev server before the run. `ns` gives you the specific reason it refused; act
on that line rather than guessing.

## 7. Cost

**Measured cost per run: TBD.** Fill this in from your first three real runs — read the
last rows of `<repo>/.nightshift/metrics/costs.jsonl`, or the cost panel on the
dashboard. **Do not write an estimate here.** A guessed figure that turns out low is
worse than no figure: it sets a budget expectation the system then quietly breaks.

| Repo | Lane | Run 1 | Run 2 | Run 3 | Working figure |
|---|---|---|---|---|---|
| _(repo)_ | security | TBD | TBD | TBD | **TBD** |
| _(repo)_ | design | TBD | TBD | TBD | **TBD** |

A cost row with `status: error` and `usd: 0` is a **floor, not a measurement** — the
envelope that would have carried the real figure is the thing that went missing.
Exclude those rows when you average.

And the converse trap: `status: ok` means **the envelope was fine**, never that the run did
its job. A run can spend real money, exit cleanly, and review nothing. The signals for that
are a cost row whose `run_id` has no matching row in `metrics/runs/`, or a run row with
`reviewed: 0` against a non-zero `selected`. `ns` refuses to call either a success, but when
you are reading `costs.jsonl` by hand, join it to `runs/` before you trust a row.

Note also that `clean` deletes the run dir on success, and the CLI envelope
(`result.json`) lives there — so a successful run leaves the cost row as the only record of
its own cost.

Quarterly model-fleet check: run `npm test` in the engine and read the `MODEL_BY_BAND`
snapshot. If the fleet has moved on, that snapshot is where you update it.

## 8. Headless permissions

Headless runs launch with the armed `NIGHTSHIFT_LANE_RUN=1` PreToolUse guard **plus** a
scoped `--allowedTools` grant.

**The guard is fail-open by design** — it allows unknown tools and unrecognized Bash
commands (`node -e`, python, rsync all pass) and is documented as defense in depth.
**The scoped tool grant, not the guard, is the real perimeter.** Decide the flag set on
that basis.

- Current default: `Workflow,TaskOutput,Read,Glob,Grep,Bash,Write,Agent`
- Override: `export NIGHTSHIFT_ALLOWED_TOOLS=...`

`TaskOutput` is the one that is easy to leave out and must not be. The Workflow tool
returns a **task id, not a result**, and the workflow is **killed if the session ends
before it finishes** — so without a way to block, a session can answer as soon as it has
the id and cut off its own review mid-flight. `bin/ns`'s prompt makes the wait the task and
names the blocking call.

This is the **session's** grant. It is not what the subagents get: subagent tools come from
agent-file frontmatter only, and no dispatch API accepts a tools list.

**The guard fires inside Workflow `agent()` subagents — confirmed on real runs.** The armed
`NIGHTSHIFT_LANE_RUN=1` reaches subagent Bash calls. Two things to expect: it reads
`2>/dev/null` and `2>&1` as writes outside the pack and blocks them (harmless, but it costs
turns), and it does not stop reads at all — a confused subagent can read anything the user
can, secrets included. For reads the perimeter is the scoped grant and the prompt.

Questions to answer on YOUR first runs and record here:

1. Workflow billing on subscription (headless) — the envelope's `total_cost_usd` includes
   the workflow's subagents; confirm on your plan.
2. Per-agent context cost for your repo — TBD
3. Does the `mcp__playwright__*` frontmatter wildcard resolve at runtime? — TBD
   (unanswered: the design lane has not been run yet. Do not assume it resolves.)

## 9. Troubleshooting

| Symptom | What it means | What to do |
|---|---|---|
| `PREFLIGHT REFUSED` | `bin/lane-plan` exited 2 | The reason under it is actionable; fix the pack. Nothing ran, nothing was spent. |
| `nothing to review` | select picked 0 surfaces | A quiet night. Not a failure. The dashboard still refreshed. |
| A run dir left in `.nightshift/.run/` | the run failed | Exactly one is kept for diagnosis; it is auto-pruned later. The log is `$OPS/logs/<run_id>.log`. |
| `validate` aborts mid-run | a model-written artifact broke schema | The run aborted **before** durable state was touched, by design. Re-run. |
| Guard denials in the log | the guard blocked a write outside `.nightshift/` | Expected. If it blocked something legitimate, the agent's frontmatter is wrong, not the guard. |
| A cost row with `status: error`, `usd: 0` | the headless envelope never arrived | The run failed; the row is a marker, not a measurement. |
| `dashboard regeneration FAILED` | the living document is now stale | This is the one message that must never be ignored. Check the log. |
| `exited 0 but left NO run row` | the session finished without completing the record chain | The run is a FAILURE and the run dir was kept. Read it. A clean CLI exit is not a completed run. |
| `reviewed 0 of N selected` | every reviewer was cut off before writing | Raise the band's `maxTurns` (`src/lib/dispatch.ts`) or the refuter's (agent frontmatter), or narrow the surface's `area`. |
| `missing bin/lane-plan.mjs (run npm run build)` from a working checkout | suspect the `ns` symlink, not the build | `ns` resolves its engine by following the link. |

## 10. Sentinel

Not enabled yet (A9). `sentinel.enabled: false` in `config.yml`. `ns run --due` is the
manual form of exactly the same predicate, so anything you learn from it now carries
over. Fill in this section when A9 lands: how it fires, and how to pause it.
