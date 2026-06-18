---
name: assurance-digest
description: Produce the weekly assurance digest — the management signal a human actually reads. Summarizes new critical/high findings and repeated themes, overdue registry areas and stale findings with no movement, the false-positive rate from run_metrics, proposed new registry entries awaiting approval, and the top 3 human decisions needed. Use when someone says "weekly assurance digest", "summarize the week's review findings", or wants the across-lane signal from a .nightshift/ pack. Reads from the pack — it does not run reviews.
---

# Assurance Engine — Weekly Digest

Produce the **one thing a human reads** each week: a tight, across-lane summary of what
the assurance engine found, what's drifting, and what decisions are waiting on a person.
The digest is the management signal — every phase is "done" only when its slice of this
digest is something you'd **act on**, not when it's merely running.

Optimize for **usefulness and decidability** — NOT length or finding count. A digest
that surfaces three real decisions beats one that lists fifty findings.

## What the digest reads from

This skill reads the pack; it never runs reviews or edits the registry. Sources in
`.nightshift/`:

- **`findings/`** — the append-only findings log (severities, dedupe_keys, ages, status).
- **`run_metrics`** — per-run metrics emitted by `assurance-run` (for the false-positive
  rate and throughput).
- **registry status** — each entry's `(auto)` `status` and `last_reviewed`
  (`green | stale | overdue | open-findings`), for overdue areas.
- the latest `assurance-garden` output — proposed new entries awaiting approval.

## Sections (assemble all five)

Summarize **across all lanes** (security, designer, and pm if active):

1. **New critical / high + repeated themes.** This week's new critical/high findings, and
   any theme recurring across findings or runs (same `root_cause` or `surface` appearing
   repeatedly via `dedupe_key`). Themes matter more than individual lines.
2. **Overdue registry areas + stale findings with no movement.** Entries with `status:
   overdue` (well past `interval_days`), and open findings that have sat with no status
   change — the coverage that is silently rotting.
3. **False-positive rate + proposed new entries awaiting approval.** Compute the
   false-positive rate from `run_metrics` (`rejected_by_2nd_reviewer / findings_created`
   across the week) — a rising rate means the registry needs tuning. List the gardening
   proposals waiting on a human.
4. **Top 3 human decisions needed.** The crux. Exactly the few decisions only a person can
   make — approve a proposed entry, triage an overdue critical area, accept/reject a
   borderline finding, raise a suppression. Three, ranked. Not a backlog.

## Workflow

1. Read `findings/`, the week's `run_metrics`, registry `status`/`last_reviewed`, and the
   latest gardening output from the pack.
2. Roll findings up by `dedupe_key` to detect repeated themes rather than listing
   duplicates.
3. Compute the false-positive rate and pull overdue/stale items.
4. Distill the **top 3 decisions** — the only mandatory output. If you can't name three
   real decisions, name fewer; never invent decisions to fill the slot.
5. Emit the digest as your reply (do not write a file unless asked).

## Guardrails

- **Decidable over comprehensive.** If a human can't act on a line, cut it.
- **Themes over volume.** Roll duplicates up by `dedupe_key`; never paste the raw log.
- **Honest about drift.** Overdue areas and motionless findings are the most important
  thing to surface — they're invisible everywhere else.
- **Read-only.** This skill summarizes; it never files issues, edits the registry, or
  runs reviews. Those are `assurance-run` and `assurance-garden`.
- Keep field names exact (`run_metrics`, `rejected_by_2nd_reviewer`, `findings_created`,
  `dedupe_key`, `status`, `last_reviewed`) so the digest lines up with the pack data.
