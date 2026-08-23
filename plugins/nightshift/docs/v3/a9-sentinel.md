# A9 — Activity-gated sentinel (LAST, after manual soak)

**Entry criterion:** ≥2 weeks of manual `ns run` cadence with acceptable FPR and cost
trend, per the dashboard. **Not before.**
**Prerequisite from TODOS:** the date-vs-SHA change baseline fix (codex #11) must land
before this session, or the sentinel inherits the blind spot.
**Scope:** engine PR (`bin/sentinel`) + local schedule + notification.
**Gate:** simulated activity triggers a run; a quiet day is a free no-op (log line, zero
model calls, zero cost); the weekly floor fires.

## Spec

### `bin/sentinel` (deterministic, tested)

Per enabled repo/lane, due when:

```
(commits touching any registry area since last run) OR (max staleness ≥ 1.0)
```

subject to `cooldown_days` since the last run and a `weekly_floor_days` guarantee so
quiet repos still get a periodic pass. Emits `due.json`; `ns run --due` consumes it.
**Reuses `ns`'s vitest-covered due-detection from A7** — do not reimplement.

Config knobs already in `$OPS/config.yml`:
`sentinel: { enabled, hour, cooldown_days, weekly_floor_days }`.

### Scheduler

A local Claude Code routine **or** a plain launchd/cron job (decide at implementation)
firing once daily at `sentinel.hour`, running `ns run --due`.

While here: apply the one-line "no cloud" wording fix (codex #15) — the plan's
"no cloud sessions anywhere in the run path" phrasing vs. a scheduled local routine.

### Notification

macOS notification (`osascript`) when a run confirms findings or fails; the dashboard is
the durable record either way.

### Runbook

Add sentinel behavior + how to pause it (`sentinel.enabled: false`) to `$OPS/runbook.md`.

## Checklist

- [ ] Codex #11 (date-vs-SHA baseline) landed first
- [ ] `bin/sentinel` + tests (due predicate, cooldown, weekly floor)
- [ ] Scheduler decision recorded + installed
- [ ] Notification wired
- [ ] Gate: simulated-activity run, quiet-day no-op, weekly floor
