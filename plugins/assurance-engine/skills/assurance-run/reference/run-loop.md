# Per-Run Mechanics — the bounded workflow in detail

This is the detailed reference for `assurance-run`. It expands the six-step loop with
the exact computations, record shapes, the second-reviewer protocol, and the
`run_metrics` fields. Read it when executing a run; the SKILL.md holds the summary.

All field names here are canonical — they match `${CLAUDE_PLUGIN_ROOT}/schemas/` and the
pack's `.nightshift/` registries and findings. Do not rename them.

---

## Step 1 — Staleness and change-flag

For each entry in the lane's registry:

```
staleness = (today - last_reviewed) / interval_days
```

- `last_reviewed` is engine-managed `(auto)`. If it is unset/absent, treat the entry as
  **maximally stale** (it has never been reviewed) — i.e. staleness is effectively
  unbounded and the entry sorts to the top.
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
`K = manifest.window_budget_k[<lane>]`.

K is a hard ceiling, sized to one usage window. Do not exceed it even if many entries are
overdue — surplus overdue entries are a **digest signal** (overdue registry areas), not a
reason to review more this run.

## Step 3 — Fan-out per lane

### Security

Two agents per selected entry, in order:

1. **Reviewer** — `${CLAUDE_PLUGIN_ROOT}/agents/security-reviewer.md`. Reviews the
   mapped `area` defensively: *is this surface adequately protected?* Produces a candidate
   write-up with: `asvs_ref`, `location`, `why_abusable_under_preconditions`, and
   `preconditions: {required_role/session, tenant/account setup, affected path, impact,
   confidence}`.
2. **Refuter (MANDATORY)** — `${CLAUDE_PLUGIN_ROOT}/agents/security-refuter.md`, an
   independent second reviewer that must actively **refute** the candidate before it can
   be logged. If it cannot refute (the finding survives), the finding proceeds to dedupe.
   If it refutes, the candidate is dropped and counted in `rejected_by_2nd_reviewer`.
   **No refutation pass ⇒ no finding may be logged.**

critical/high security findings always get `needs_human_verification: true`. Reviews may
add a **failing test that demonstrates the violated authz/security invariant** — never
exploit payloads or offensive tooling. This is assurance, not a pentest.

### Designer

`${CLAUDE_PLUGIN_ROOT}/agents/ux-reviewer.md` drives each stale/changed flow through the
manifest's `stack_adapter.browser` adapter, against a seeded `fixtures/` persona
(`{account_type, plan, permissions, data_seed, feature_flags, credentials_ref,
success_criteria}`). Record steps-to-complete, backtracks, dead-ends, errors, >2s waits;
run an a11y check; screenshot key states. Separate the finding paths: flow-completion
failure | friction observation | a11y violation | visual recommendation. Every ticket
REQUIRES an objective `anchor` (see below).

## Step 4 — Dedupe and suppressions

### dedupe_key

A finding's identity is the composite:

```
dedupe_key = {surface, symptom, root_cause}
```

- **surface** — where it occurs (the entry/area or flow step).
- **symptom** — the observable problem.
- **root_cause** — the underlying mechanism.

A candidate whose `dedupe_key` matches any **open** finding is dropped (do not re-file).
This is the primary defense against nightly re-filing the same issue.

### Suppressions

Honor active suppression records, shape:

```
suppression = {dedupe_key, reason, expires, approved_by}
```

A candidate matching an unexpired suppression's `dedupe_key` is dropped silently (don't
file, don't escalate). A suppression past its `expires` date is inactive — ignore it.
Suppressions are small and on-demand; `approved_by` records the human who signed off.

## Step 5 — Log, update state, emit metrics

- Append each confirmed finding to the pack's append-only `findings/` log. Finding record
  (lean): `dedupe_key`, `severity` (critical|high|medium|low), `confidence`
  (low|medium|high), `needs_human_verification`, and `anchor` (UX only — REQUIRED there).
- Update each reviewed entry's `last_reviewed` to today and recompute `status`
  (green | stale | overdue | open-findings). Append any filed Linear ref to the entry's
  `linear` list `(auto on file)`.

### run_metrics (emit one per run)

| field                    | meaning                                                      |
|--------------------------|-------------------------------------------------------------|
| `selected`               | count of entries chosen in step 2 (≤ K)                      |
| `reviewed`               | count actually reviewed (reviewer fan-out completed)        |
| `findings_created`       | candidate findings produced                                 |
| `confirmed`              | findings that passed dedupe/suppression and were logged     |
| `rejected_by_2nd_reviewer` | candidates the security refuter knocked out               |
| `usage_spent`            | usage consumed this run (against the window budget)         |
| `elapsed`                | wall-clock duration of the run                              |

`run_metrics` feed the weekly digest — notably the **false-positive rate** (derived from
`rejected_by_2nd_reviewer` / `findings_created`).

## Step 6 — Severity gates

Apply verbatim (also in SKILL.md):

- **critical / high** → Linear issue immediately.
- **medium** → issue only if reproducible, recurring, or customer-facing.
- **low** → findings log; batch into weekly digest unless repeated.
- **taste / opinion** → never an issue unless tied to a measured `anchor`.

### anchor (UX gate)

A UX ticket is allowed only with an objective `anchor`, one of:
`friction_delta | broken_path | a11y | evidence | consistency`. No anchor ⇒ the
observation lives in the digest as taste, never as a ticket.
