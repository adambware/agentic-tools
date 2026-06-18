---
name: digest
description: Produce the weekly nightshift digest — the management signal a human actually reads. Folds over metrics/daily.jsonl for the 7/30-day false-positive rate and coverage freshness, surfaces new critical/high findings and repeated themes, overdue registry areas and motionless findings, proposed new registry entries awaiting approval, and the top 3 human decisions needed. Use when someone says "weekly nightshift digest", "summarize the week's review findings", or wants the across-lane signal from a .nightshift/ pack. Read-only — it does not run reviews.
allowed-tools: Read, Glob, Grep
model: haiku
---

# nightshift — Weekly Digest

Produce the **one thing a human reads** each week: a tight, across-lane summary of what
nightshift found, what's drifting, and what decisions are waiting on a person. The digest
is the management signal — every lane is "done" only when its slice of this digest is
something you'd **act on**, not when it merely runs.

Optimize for **usefulness and decidability** — NOT length or finding count. A digest that
surfaces three real decisions beats one that lists fifty findings. This is the **one**
read-only, model-invocable skill — `/nightshift:digest` reads the pack and never mutates.

## What the digest reads from

Reads the pack only; never runs reviews or edits the registry. Sources in `.nightshift/`:

- **`metrics/daily.jsonl`** — the append-only day-over-day rollup. **Reader takes the LAST
  line per `(date, lane)`.** Source for `coverage_freshness_pct`, `fpr_7d`, `fpr_30d`,
  and the surface counts. Do NOT look for a `run_metrics` blob — it doesn't exist.
- **`metrics/findings/<YYYY-MM>.jsonl`** — the append-only findings log; use `first_seen`/
  `last_seen` to find motionless findings, and severities/`dedupe_key` for themes.
- **registry status** — each entry's `(auto)` `status`/`last_reviewed`
  (`green | stale | overdue | open-findings`), for current overdue areas.
- the latest `/nightshift:garden` output — proposed new entries awaiting approval.

## Sections (assemble all four)

Summarize **across both lanes (security and design)**:

1. **Top 3 human decisions needed.** The crux. Exactly the few decisions only a person can
   make — approve a proposed entry, triage an overdue critical area, accept/reject a
   borderline finding, raise a suppression. Three, ranked. Not a backlog.
   If there are no pending decisions, render: **'No decisions pending. Freshness X%, FPR_7d Y%.'**
   A quiet digest is a success signal, not an empty section.
2. **New critical / high + repeated themes.** This week's new critical/high findings, and
   any theme recurring across findings or runs (same `root_cause` or `surface` recurring
   via `dedupe_key`). Themes matter more than individual lines.
3. **Overdue registry areas + motionless findings.** Entries with `status: overdue` (well
   past `interval_days`), and open findings whose `first_seen`/`last_seen` show no movement
   — the coverage that is silently rotting.
4. **False-positive rate + proposed new entries awaiting approval.** Read `fpr_7d`/`fpr_30d`
   from the latest `daily.jsonl` rollup (computed from the split
   `rejected_tier1`/`rejected_tier2` over `findings_created`); a rising rate means the
   registry needs tuning. List the gardening proposals waiting on a human.

## Workflow

1. Fold over `metrics/daily.jsonl` (last line per `(date, lane)`) to get current
   `coverage_freshness_pct`, `fpr_7d`, `fpr_30d`, and surface counts per lane.
   Note: `fpr_7d` and `fpr_30d` are 0–100 percentage values — render them with a '%' suffix
   (e.g. 'FPR_7d 24%', not '0.24%').
2. Read `metrics/findings/<YYYY-MM>.jsonl` and roll up by `dedupe_key` to detect repeated
   themes; use `first_seen`/`last_seen` for motionless findings. Read registry `status`
   for current overdue areas.
3. Render deltas as CHANGELOG lines — today's rollup vs the previous committed rollup,
   e.g. `2026-06-18 · security · freshness 83%→79% (-4) · 2 overdue · FPR_7d 24%`.
4. Distill the **top 3 decisions** — the only mandatory output, and emit them first. If you
   can't name three real decisions, name fewer; never invent decisions to fill the slot.
5. Emit the digest as your reply in section order (decisions → critical/high → overdue →
   FPR/proposals). Do not write a file unless asked.

## Guardrails

- **Decidable over comprehensive.** If a human can't act on a line, cut it.
- **Themes over volume.** Roll duplicates up by `dedupe_key`; never paste the raw log.
- **Honest about drift.** Overdue areas and motionless findings are the most important
  thing to surface — they're invisible everywhere else.
- **Read-only.** This skill summarizes; it never files issues, edits the registry, or runs
  reviews. Those are `/nightshift:security`, `/nightshift:design`, and `/nightshift:garden`.
- Keep field names exact (`coverage_freshness_pct`, `fpr_7d`, `fpr_30d`, `rejected_tier1`,
  `rejected_tier2`, `findings_created`, `dedupe_key`, `first_seen`, `last_seen`, `status`,
  `last_reviewed`) so the digest lines up with the pack data.
