# Per-Run Mechanics — the bounded workflow in detail

This is the **shared** mechanics reference for both nightshift review lanes:
`security` (via `/nightshift:security`) and `design` (via `/nightshift:design`). It expands the
six-step loop with the exact computations, record shapes, the **two-stage refuter
protocol**, the **fan-out budget table**, and the **metrics writer**. Read it when
executing a run; the SKILL.md holds the summary.

Lane values are `security | design`. All field names here are canonical — they match
`${CLAUDE_PLUGIN_ROOT}/schemas/` and the pack's `.nightshift/` registries and findings.
Do not rename them.

> **Determinism boundary (D1/E7).** Every *checkable* computation below — staleness,
> score, selection, `dedupe_key`, suppression match, the metrics writer, the daily
> rollup — is **owned by a `bin/` script** (TypeScript, vitest-covered) and is invoked
> by the orchestrator, never re-derived by the model. Those steps are now **one-line
> pointers** to the owning command + schema (single source of truth: the code + its
> tests). Only the **judgment protocol** — the two-stage refuter, anchor discipline,
> the design walkthrough — stays prose here, because that is the agent spec. See
> [`CONTRACTS.md`](../../../CONTRACTS.md) for the files-not-text + artifact seams.

---

## Step 1 — Staleness and change-flag → `bin/select`

**Owned by code.** `${CLAUDE_PLUGIN_ROOT}/bin/select.mjs` computes, per entry:
`staleness = (today - last_reviewed) / interval_days` (unset `last_reviewed` ⇒
maximally stale, sorts to the top; `interval_days` derived from `weight`
critical→7/high→14/medium→30/low→90 unless overridden), and `change_flag` from
`git diff --name-only <commit-at-or-near last_reviewed>..HEAD` intersected with the
entry's `area` globs. Source: `src/lib/staleness.ts`; tests: `src/lib/staleness.test.ts`.

## Step 2 — Selection and the K budget → `bin/select`

**Owned by code.** `bin/select` sorts by `score = max(staleness, change_flag) *
weight_multiplier` (monotonic critical > high > medium > low; ties broken by weight then
id) and takes the top **K = `manifest.window_budget_k[<lane>]`**, writing `surfaces.json`.

**K is a hard ceiling, sized to one usage window. Never raise K to clear backlog** — even
if many entries are overdue. Surplus overdue entries are a **digest signal** (overdue
registry areas) that routes to the digest/trend, not a reason to review more this run.

K sizing is **pack-side**: a pack that wants a bigger window raises its own
`window_budget_k` in its `.nightshift/manifest.yml`; the engine's default pack template
stays modest. (Sizing K to the repo is legitimate; raising it mid-backlog is not.)

### Fan-out budget table (score band → compute allocation)

The selection `score = max(staleness, change_flag) * weight` doubles as a
compute-allocation key. Allocate per selected entry by band:

| Band | Reviewers | Reads | Refuter |
|---|---|---|---|
| **low / medium** | 1 | ~10–15 | Tier-1 only |
| **high** | 1 | ~15–20 | Tier-1 |
| **critical** (or `change_flag` on a critical/high entry) | 1 | ~20–30 | Tier-1 + conditional Tier-2 |

**v3 model refresh — loosen the reviewer, keep the gate.** The reviewers and the Tier-2
refuter run on **Opus 5** with roughly doubled read budgets (the table above); Tier-1
stays cheap on **Haiku 4.5**. Everything gate-shaped is **unchanged**: Tier-1 runs on
every candidate, the Tier-2 union predicate, no-refute-no-log, `bin/validate` on every
model-written artifact, dedupe + suppressions, the severity gates — and
`CLAUDE_CODE_SUBAGENT_MODEL` remains the global downshift lever.

### Parallelism (inside K, never beyond it)

Parallelize reviewers **3–5 at a time** via parallel Agent dispatch. Get speed from
parallelism **inside** K — never by raising K. If the backlog exceeds K, the overdue
surplus routes to the digest/trend; it is not reviewed this run.

### Tuning cost

Three independent levers to reduce cost without touching the registry:

1. **K** = `manifest.window_budget_k[<lane>]` — the hard per-window ceiling. Lower K → fewer reviews per run. Never raise to clear backlog.
2. **`maxTurns`** per agent — set in each agent's frontmatter.
3. **`CLAUDE_CODE_SUBAGENT_MODEL` env var** — the highest-precedence override. Drops the entire fleet a model tier with a single env var (e.g. `CLAUDE_CODE_SUBAGENT_MODEL=haiku`). The most powerful zero-edit cost lever — set it before running `/nightshift:security` to cut cost immediately.

### Stack adaptation (agent choice, never a dispatch-time grant)

The reviewer agents grant `Read, Grep, Glob`, plus `Write` for run artifacts under
`.nightshift/.run` (the read-only guard denies writes outside the pack). **No dispatch
API accepts a tools list** — every subagent's tools come from its own frontmatter, so
nothing is granted, scoped, or added at dispatch (CONTRACTS.md E5). Stack adaptation is
therefore expressed two different ways:

- **security** → `manifest.stack_adapter.test` is **prompt data**. The reviewer holds no
  execution tool; it names that command in the proposed finding as the way a human runs
  the failing invariant test.
- **design** → `manifest.stack_adapter.browser.tool` selects a **concrete agent file**
  (`agents/ux-reviewer-<adapter>.md`, resolved launcher-side by `bin/lane-plan`), whose
  own frontmatter carries the browser grant.

Do not hardcode a stack-specific tool or command in this loop; read it from the manifest
so the lane is not locked to one stack.

### Launcher preflight — the lane plan (v3, before any fan-out)

**Owned by code.** Before a single reviewer is dispatched, the launcher (`ns`) runs, from the
repo root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/bin/lane-plan.mjs --pack .nightshift --lane <security|design>
```

This is the **fail-fast lane gate**. On **exit 2** the launcher **refuses the run** and reports
the stderr reason verbatim (`lane-plan: <reason>`) — nothing is dispatched, no run id is burned,
no metrics are stamped, and stdout is deliberately empty so a caller capturing it can never get a
partial plan. The design-lane refusals are the prerequisite checks: missing
`stack_adapter.browser`, an unsupported `browser.tool`, a missing `browser.base_url`, missing or
empty `fixtures/personas.yml`, or a flow whose `persona:` is not seeded.

On **exit 0** the plan is JSON on stdout. The launcher splices it into the Workflow's `args`
alongside the run id and the surfaces `bin/select` chose:

```json
{
  "run_id": "<fresh per attempt, retries included>",
  "lane": "security | design",
  "surface_chunks": [[ "<Surface objects from bin/select, pre-chunked>" ]],
  "registry": "<the plan's registry field, i.e. join(--pack, registries/{vectors,flows}.yml)>",
  "agents": { "reviewer": "…", "refuter_tier1": "…", "refuter_tier2": "…" }
}
```

`registry` and `agents` are the plan's fields verbatim: the workflow shell interpolates them and
never picks a registry file or an agent type itself (E4). Pass `--pack .nightshift` rather than an
absolute path — `registry` is emitted as `join(--pack, …)`, and the workflow's other paths
(`.nightshift`, `.nightshift/.run/<run_id>`) are repo-root-relative literals in the same commands.
Source: `src/bin/lane-plan.ts` + `src/lib/lane-plan.ts`; tests: `src/lib/lane-plan.test.ts`.

## Step 3 — Fan-out per lane

### Security

Per selected vector, dispatch the reviewer then run the **two-stage refuter gate**:

1. **Reviewer** — `${CLAUDE_PLUGIN_ROOT}/agents/security-reviewer.md`
   (**Opus 5, `maxTurns: 24`**; dispatch effort `high`, `xhigh` on the critical band). Reviews the
   mapped `area` defensively: *is this surface adequately protected?* Produces a candidate
   write-up with: `asvs_ref`, `location`, `why_abusable_under_preconditions`, and
   `preconditions: {required_role/session, tenant/account setup, affected path, impact,
   confidence}`.

2. **Tier-1 refuter (ALWAYS)** — `${CLAUDE_PLUGIN_ROOT}/agents/security-refuter.md`
   (**Haiku 4.5, `maxTurns: 10`, dispatch effort `low`**). An independent second reviewer given the full
   proposed finding, but instructed to ignore the reviewer's narrative and re-read the
   source code itself. Must actively **refute** the candidate. Runs on **every** candidate. If it cannot refute (the finding
   survives), the candidate advances to the Tier-2 predicate. If it refutes, the candidate
   is dropped and counted in `rejected_tier1`.
   **No Tier-1 refute ⇒ no finding may be logged.**

3. **Tier-2 refuter (CONDITIONAL)** — `${CLAUDE_PLUGIN_ROOT}/agents/security-refuter-2.md`
   (**Opus 5, `maxTurns: 16`**; dispatch effort `high`, `xhigh` for critical/high
   survivors). Runs **only** on a Tier-1 survivor that is
   **critical/high severity OR `confidence == low`** (union predicate). It re-reads
   independently; if it refutes, the candidate is dropped and counted in `rejected_tier2`.
   A Tier-1 survivor that does not meet the predicate skips Tier-2 and proceeds to dedupe.

critical/high security findings always get `needs_human_verification: true`. Reviews may
add a **failing test that demonstrates the violated authz/security invariant** — never
exploit payloads or offensive tooling. This is assurance, not a pentest.

### Design

Per selected flow, dispatch the reviewer then run the **same two-stage refuter gate** as
security — the design lane is not exempt from it:

1. **Reviewer** — the **concrete** per-adapter build
   `${CLAUDE_PLUGIN_ROOT}/agents/ux-reviewer-<adapter>.md`, resolved by `bin/lane-plan` from
   `manifest.stack_adapter.browser.tool` (e.g. `ux-reviewer-playwright`);
   `agents/ux-reviewer.md` is the base spec and is never dispatched
   (**Opus 5, `maxTurns: 24`**, dispatch effort `high`). Drives each
   stale/changed flow through the browser tool in its own frontmatter (see step 2),
   against a seeded `fixtures/` persona (`{account_type, plan, permissions, data_seed,
   feature_flags, credentials_ref, success_criteria}`). Record steps-to-complete,
   backtracks, dead-ends, errors, >2s waits; run an a11y check; screenshot key states.
   Separate the finding paths: flow-completion failure | friction observation | a11y
   violation | visual recommendation.

2. **Tier-1 refuter (ALWAYS)** — `${CLAUDE_PLUGIN_ROOT}/agents/ux-refuter.md`
   (**Haiku 4.5, `maxTurns: 10`, dispatch effort `low`**). Runs on **every** candidate,
   re-deriving it from the flow itself rather than trusting the reviewer's narrative. If it
   refutes, the candidate is dropped and counted in `rejected_tier1`; if it cannot, the
   candidate advances to the Tier-2 predicate.
   **No Tier-1 refute ⇒ no finding may be logged** — the guarantee is identical to security's.

3. **Tier-2 refuter (CONDITIONAL)** — `${CLAUDE_PLUGIN_ROOT}/agents/ux-refuter-2.md`
   (**Opus 5, `maxTurns: 16`**, dispatch effort `high`). Runs **only** on a Tier-1 survivor
   that is **critical/high severity OR `confidence == low`** — the same union predicate,
   applied by the same `bin/tier2-gate`. A refutation drops the candidate and counts in
   `rejected_tier2`; a survivor that does not meet the predicate skips Tier-2 and proceeds
   to dedupe.

Every ticket REQUIRES an objective `anchor` (see below). Anchor discipline is
**complementary** to the refuter gate, never a substitute for it: an anchored candidate still
dies at Tier-1 if it cannot survive independent refutation, and a refute-surviving candidate
with no anchor still never becomes a ticket. Both gates must pass.

## Step 4 — Dedupe and suppressions → `bin/dedupe` (+ `bin/record`)

**Owned by code.** A finding's identity is the composite `dedupe_key = {surface, symptom,
root_cause}` (surface = where it occurs; symptom = the observable problem; root_cause =
the underlying mechanism) — the reviewer proposes one per candidate; `bin/dedupe` decides
its fate. `${CLAUDE_PLUGIN_ROOT}/bin/dedupe.mjs` partitions validated candidates into
**new / recurring / suppressed**:

- a candidate matching any **open** finding's `dedupe_key` → *recurring*: not re-filed;
  `bin/record` bumps the existing finding's `last_seen`/`run_id` (carrying `first_seen`),
  which keeps motionless-finding detection accurate.
- a candidate matching an **unexpired** suppression (`{dedupe_key, reason, expires,
  approved_by}`) → *suppressed*: dropped silently, counted in `suppressed`. A suppression
  past `expires` is inactive.
- otherwise → *new*: logged by `bin/record`.

Within-lane dedupe is the primary defense against nightly re-filing. Source:
`src/lib/dedupe-run.ts` / `src/lib/dedupekey.ts`; tests: `src/lib/dedupe-run.test.ts`.

## Step 5 — Log, update state, write durable metrics → `bin/run-meta` → `bin/record` + `bin/rollup`

**Owned by code.** First, `${CLAUDE_PLUGIN_ROOT}/bin/run-meta.mjs` assembles `run.json`
(the `RunMeta`) from `surfaces.json`, `reviewed.json` (the surface ids the review phase
**actually** covered — never assumed to be all-selected), `candidates.proposed.json`
(the reviewer's pre-refute set) and `candidates.json` (the Tier-1 survivors): it carries
run metadata + `reviewed_ids` and derives `rejected_tier1 = proposed_count −
survivors_count` — the false-positive-rate denominator that would otherwise be lost once
the refuter overwrites the candidate set. It runs **before** record so `run.json` exists
when record reads it, and aborts (exit 2) on a blank `run_id`, if survivors exceed
proposed, if any survivor's canonical `dedupe_key` matches no proposed candidate (the
refuter may remove, never substitute), or if `reviewed.json` lists a duplicate or
non-selected id. Source: `src/lib/run-meta-build.ts`; tests:
`src/lib/run-meta-build.test.ts`.

Then the orchestrator hands `bin/record` the deduped `decisions.json` + that
`run.json` (run metadata + refuter-derived counts + reviewed ids); `bin/record` appends
the per-run record (`run-metrics` schema), appends finding lines (new + recurring
`last_seen` bumps, `finding` schema), and updates each **actually-reviewed** entry's
`last_reviewed`/`status` (comments preserved) — selected-but-unreviewed entries keep
their state, stay stale, and re-select next run. `bin/rollup` then recomputes and appends the day's rollup
(`daily-metrics` schema: `coverage_freshness_pct`, `median_staleness_ratio`,
`fpr_7d`/`fpr_30d`). The exact field semantics live **once** in
`${CLAUDE_PLUGIN_ROOT}/schemas/{run-metrics,finding,daily-metrics}.yml`; the math lives
in `src/lib/{record-run,rollup-run}.ts` (tests alongside). Do not re-derive any of it by
hand. The remainder of this section is the durable-storage **layout** (reference only).

All metrics live under `<repo>/.nightshift/metrics/` (committed text — **never** under
`CLAUDE_PLUGIN_ROOT`). Layout:

| File | Mutability | Role |
|---|---|---|
| `metrics/runs/<YYYY-MM>.jsonl` | append-only | one per-run NDJSON object |
| `metrics/findings/<YYYY-MM>.jsonl` | append-only | date-partitioned findings log |
| `metrics/daily.jsonl` | append-only (last line wins per `date+lane`) | the day-over-day trend |
| *(no committed projections)* | the local HTML dashboard (`bin/dashboard`, ops home) is regenerated per run | current-state view |

`.nightshift/.gitattributes` sets `metrics/**/*.jsonl merge=union` so concurrent branches
just append and the reader dedupes on read.

- **(a) per-run record** → `bin/record` appends one NDJSON object to
  `metrics/runs/<YYYY-MM>.jsonl`; fields + meanings in `schemas/run-metrics.yml` (the
  split `rejected_tier1` + `rejected_tier2` makes FPR attributable by stage). `bin/record`
  **derives** `findings_created = confirmed + recurring + rejected_tier1 + rejected_tier2`
  (= `proposed_count − suppressed`); `run-meta` cannot, since it runs before dedupe and so
  cannot know how many survivors will be suppressed.
- **(b) confirmed findings** → `bin/record` appends to `metrics/findings/<YYYY-MM>.jsonl`
  (`schemas/finding.yml`), setting `first_seen`/`last_seen`/`run_id`, bumping `last_seen`
  (carrying `first_seen`) on recurrence, and updating each reviewed entry's
  `last_reviewed`/`status` (green | stale | overdue | open-findings).
- **(c) daily rollup** → `bin/rollup` appends a fresh line to `metrics/daily.jsonl`; the
  reader takes the **greatest-`ts` line per `(date, lane)`** (union-merge-safe). Record
  shape + the freshness / median-staleness / FPR formulas: `schemas/daily-metrics.yml`
  and `src/lib/rollup-run.ts`.

Projections are never committed to the pack: the operator's local HTML dashboard
(`bin/dashboard`) is a disposable view regenerated from the JSONL truth — never the
source of record.

## Step 6 — Severity gates (single source)

Apply verbatim (this is the single canonical source; the SKILL.md files point here):

- **critical / high** → surface finding for human Linear filing (the skill has no Linear tool — use the finding's `dedupe_key` as the issue title).
- **medium** → issue only if reproducible, recurring, or customer-facing.
- **low** → findings log; batch into weekly digest unless repeated.
- **taste / opinion** → never an issue unless tied to a measured `anchor`.

### anchor (UX gate)

A UX ticket is allowed only with an objective `anchor`, one of:
`friction_delta | broken_path | a11y | evidence | consistency`. No anchor ⇒ the
observation lives in the digest as taste, never as a ticket.
