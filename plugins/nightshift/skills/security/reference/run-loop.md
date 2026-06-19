# Per-Run Mechanics — the bounded workflow in detail

This is the **shared** mechanics reference for both nightshift review lanes:
`security` (via `/nightshift:security`) and `design` (via `/nightshift:design`). It expands the
six-step loop with the exact computations, record shapes, the **two-stage refuter
protocol**, the **fan-out budget table**, and the **metrics writer**. Read it when
executing a run; the SKILL.md holds the summary.

Lane values are `security | design`. All field names here are canonical — they match
`${CLAUDE_PLUGIN_ROOT}/schemas/` and the pack's `.nightshift/` registries and findings.
Do not rename them.

---

## Step 1 — Staleness and change-flag

For each entry in the lane's registry:

```
staleness = (today - last_reviewed) / interval_days
```

- `last_reviewed` is engine-managed `(auto)`. If it is unset/absent, treat the entry as
  **maximally stale** (it has never been reviewed) — staleness is effectively unbounded
  and the entry sorts to the top.
- `interval_days` comes from the entry (derived from `weight`: critical→7, high→14,
  medium→30, low→90, unless overridden).

**change_flag** — set when the entry's `area` globs changed in git since `last_reviewed`:

```
git diff --name-only <commit-at-or-near last_reviewed>..HEAD   # intersect with `area` globs
```

Any intersection ⇒ `change_flag = 1` (treat as fully due regardless of clock staleness).
Recently-touched code is the highest-yield place to review.

## Step 2 — Selection and the K budget

```
score = max(staleness, change_flag) * weight_multiplier
```

Use a monotonic `weight_multiplier` (critical > high > medium > low) so weight breaks
ties and amplifies priority. Sort descending; take the top **K**, where
`K = manifest.window_budget_k[<lane>]` (`window_budget_k.security` /
`window_budget_k.design`).

**K is a hard ceiling, sized to one usage window. Never raise K to clear backlog** — even
if many entries are overdue. Surplus overdue entries are a **digest signal** (overdue
registry areas) that routes to the digest/trend, not a reason to review more this run.

### Fan-out budget table (score band → compute allocation)

The selection `score = max(staleness, change_flag) * weight` doubles as a
compute-allocation key. Allocate per selected entry by band:

| Band | Reviewers | Reads | Refuter |
|---|---|---|---|
| **low / medium** | 1 | ~5–8 | Tier-1 only |
| **high** | 1 | ~8–10 | Tier-1 |
| **critical** (or `change_flag` on a critical/high entry) | 1 | ~10–12 | Tier-1 + conditional Tier-2 |

### Parallelism (inside K, never beyond it)

Parallelize reviewers **3–5 at a time** via parallel Agent dispatch. Get speed from
parallelism **inside** K — never by raising K. If the backlog exceeds K, the overdue
surplus routes to the digest/trend; it is not reviewed this run.

### Tuning cost

Three independent levers to reduce cost without touching the registry:

1. **K** = `manifest.window_budget_k[<lane>]` — the hard per-window ceiling. Lower K → fewer reviews per run. Never raise to clear backlog.
2. **`maxTurns`** per agent — set in each agent's frontmatter.
3. **`CLAUDE_CODE_SUBAGENT_MODEL` env var** — the highest-precedence override. Drops the entire fleet a model tier with a single env var (e.g. `CLAUDE_CODE_SUBAGENT_MODEL=haiku`). The most powerful zero-edit cost lever — set it before running `/nightshift:security` to cut cost immediately.

### Scoped tool grant (de-hardcoded, injected at dispatch)

The reviewer agents grant only `Read, Grep, Glob`. The orchestrator injects the
stack-specific grant at dispatch from the pack manifest:

- **security** → `manifest.stack_adapter.test`
- **design** → `manifest.stack_adapter.browser`

Do not hardcode a stack-specific tool grant in this loop; read it from the manifest so the
lane is not locked to one stack.

## Step 3 — Fan-out per lane

### Security

Per selected vector, dispatch the reviewer then run the **two-stage refuter gate**:

1. **Reviewer** — `${CLAUDE_PLUGIN_ROOT}/agents/security-reviewer.md`. Reviews the
   mapped `area` defensively: *is this surface adequately protected?* Produces a candidate
   write-up with: `asvs_ref`, `location`, `why_abusable_under_preconditions`, and
   `preconditions: {required_role/session, tenant/account setup, affected path, impact,
   confidence}`.

2. **Tier-1 refuter (ALWAYS)** — `${CLAUDE_PLUGIN_ROOT}/agents/security-refuter.md`
   (**haiku, `maxTurns: 8`, low effort**). An independent second reviewer given the full
   proposed finding, but instructed to ignore the reviewer's narrative and re-read the
   source code itself. Must actively **refute** the candidate. Runs on **every** candidate. If it cannot refute (the finding
   survives), the candidate advances to the Tier-2 predicate. If it refutes, the candidate
   is dropped and counted in `rejected_tier1`.
   **No Tier-1 refute ⇒ no finding may be logged.**

3. **Tier-2 refuter (CONDITIONAL)** — `${CLAUDE_PLUGIN_ROOT}/agents/security-refuter-2.md`
   (**sonnet/high, `maxTurns: 12`**). Runs **only** on a Tier-1 survivor that is
   **critical/high severity OR `confidence == low`** (union predicate). It re-reads
   independently; if it refutes, the candidate is dropped and counted in `rejected_tier2`.
   A Tier-1 survivor that does not meet the predicate skips Tier-2 and proceeds to dedupe.

critical/high security findings always get `needs_human_verification: true`. Reviews may
add a **failing test that demonstrates the violated authz/security invariant** — never
exploit payloads or offensive tooling. This is assurance, not a pentest.

### Design

`${CLAUDE_PLUGIN_ROOT}/agents/ux-reviewer.md` drives each stale/changed flow through the
manifest's `stack_adapter.browser` adapter (injected as the scoped grant — see step 2),
against a seeded `fixtures/` persona (`{account_type, plan, permissions, data_seed,
feature_flags, credentials_ref, success_criteria}`). Record steps-to-complete,
backtracks, dead-ends, errors, >2s waits; run an a11y check; screenshot key states.
Separate the finding paths: flow-completion failure | friction observation | a11y
violation | visual recommendation. Every ticket REQUIRES an objective `anchor` (see
below).

## Step 4 — Dedupe and suppressions

### dedupe_key

A finding's identity is the composite:

```
dedupe_key = {surface, symptom, root_cause}
```

- **surface** — where it occurs (the entry/area or flow step).
- **symptom** — the observable problem.
- **root_cause** — the underlying mechanism.

A candidate whose `dedupe_key` matches any **open** finding is dropped (do not re-file a new record). **However: when dropping due to a dedupe match, update the EXISTING finding's `last_seen` to today and `run_id` to this run's id in `metrics/findings/`.** This is what keeps motionless-finding detection accurate — an issue that re-appears each run stays "active", not "stale".

This is the primary defense against nightly re-filing the same issue.

### Suppressions

Honor active suppression records, shape:

```
suppression = {dedupe_key, reason, expires, approved_by}
```

A candidate matching an unexpired suppression's `dedupe_key` is dropped silently (don't
file, don't escalate) and counted in `suppressed`. A suppression past its `expires` date
is inactive — ignore it. Suppressions are small and on-demand; `approved_by` records the
human who signed off.

## Step 5 — Log, update state, write durable metrics

All metrics live under `<repo>/.nightshift/metrics/` (committed text — **never** under
`CLAUDE_PLUGIN_ROOT`). Layout:

| File | Mutability | Role |
|---|---|---|
| `metrics/runs/<YYYY-MM>.jsonl` | append-only | one per-run NDJSON object |
| `metrics/findings/<YYYY-MM>.jsonl` | append-only | date-partitioned findings log |
| `metrics/daily.jsonl` | append-only (last line wins per `date+lane`) | the day-over-day trend |
| `dashboard.md` / `trends.md` | **disposable** regenerated projections | current-state / delta views |

`.nightshift/.gitattributes` sets `metrics/**/*.jsonl merge=union` so concurrent branches
just append and the reader dedupes on read.

### (a) Append the per-run record

Write one NDJSON object to `metrics/runs/<YYYY-MM>.jsonl`:

| field | meaning |
|---|---|
| `run_id` | unique id for this run |
| `ts` | ISO-8601 timestamp |
| `date` | `YYYY-MM-DD` |
| `lane` | `security` \| `design` |
| `pack_sha` | sha of the pack/config at run time |
| `selected` | count chosen in step 2 (≤ K) |
| `reviewed` | count actually reviewed (reviewer fan-out completed) |
| `findings_created` | candidate findings produced |
| `confirmed` | findings that passed dedupe/suppression and were logged |
| `rejected_tier1` | candidates the Tier-1 refuter knocked out |
| `rejected_tier2` | candidates the Tier-2 refuter knocked out |
| `suppressed` | count dropped by active suppressions |
| `usage_by_model` | object — usage broken down per model tier |
| `usage_spent` | usage consumed this run (against the window budget) |
| `elapsed` | wall-clock duration of the run |

(The old single `rejected_by_2nd_reviewer` is **replaced** by the split
`rejected_tier1` + `rejected_tier2`, so FPR is splittable by stage and the "retire Tier-2
if it trends to ~0" decision is measurable.)

### (b) Append confirmed findings

Append each confirmed finding to `metrics/findings/<YYYY-MM>.jsonl`. Finding record
(lean) plus lifecycle fields: `dedupe_key`, `severity` (critical|high|medium|low),
`confidence` (low|medium|high), `needs_human_verification`, `anchor` (UX only —
REQUIRED there), and lifecycle `first_seen`, `last_seen`, `resolved_at` (optional),
`run_id`. **Bump `last_seen` to this run when an existing `dedupe_key` recurs** (and
carry `first_seen` forward); set both to now for a newly-seen `dedupe_key`.

Also update each reviewed entry's `last_reviewed` to today and recompute `status`
(green | stale | overdue | open-findings). Append any filed Linear ref to the entry's
`linear` list `(auto on file)`.

### (c) Recompute and append the daily rollup

Recompute the affected day's rollup and **append a fresh line** to `metrics/daily.jsonl`
(the reader takes the **line with the greatest `ts`** per `(date, lane)` — append-only +
max-ts dedup is union-merge-safe regardless of line ordering after a branch merge). Daily rollup record:

`{date, lane, ts, runs, surfaces_total, surfaces_green, surfaces_stale, surfaces_overdue,
open_findings, coverage_freshness_pct, median_staleness_ratio, fpr_7d, fpr_30d}`

- `ts` — ISO-8601 timestamp of when this rollup was computed; enables max-ts last-wins resolution when multiple branches write the same (date, lane).
- `coverage_freshness_pct` — share of in-scope surfaces with staleness ratio ≤ 1.0. The
  **denominator scopes to lanes whose `cadence != off`**, so deferred lanes don't make
  freshness look artificially terrible.
- `median_staleness_ratio` — median of `staleness` across in-scope surfaces.
- `fpr_7d` / `fpr_30d` — false-positive rate over the trailing 7/30 days, derived from the
  split tier counters: `(rejected_tier1 + rejected_tier2) / findings_created` aggregated
  over the window. Multiply by 100 to get a 0-100 percentage value (consistent with `coverage_freshness_pct`).
  When `findings_created == 0` over the window (clean run), omit `fpr_7d`/`fpr_30d` or set to `null` — division by zero is undefined.

`dashboard.md` and `trends.md` are **disposable** projections regenerated from the JSONL
truth — never the source of record.

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
