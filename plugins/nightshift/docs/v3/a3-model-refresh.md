# A3 — Model + power refresh ("loosen the reviewer, keep the gate")

**Scope:** `agents/`, `skills/`, docs only — **no engine code change**. Can share a
session with A2. **Depends on:** A0.
**Gate:** docs consistent; no claim contradicts code.

## Spec

### Agent refresh table (edit checklist)

"Was" column corrected against actual frontmatter (plan §9.6.1 — the original plan's
table was wrong on 2 of 5 rows):

| Agent | Was (actual frontmatter) | Becomes | maxTurns | Dispatch effort |
|---|---|---|---|---|
| `security-reviewer` | `sonnet`, 15 | Opus 5 | **24** | `high`; `xhigh` on critical band |
| `security-refuter` (T1) | `haiku`, 8 | Haiku 4.5 | 10 | `low` |
| `security-refuter-2` (T2) | `sonnet`/high, 12 | Opus 5 | 16 | `high`; `xhigh` for critical/high survivors |
| `ux-reviewer` | `sonnet`, 15 | Opus 5 | 24 | `high` |
| plumbing (bin runners) | — | Haiku 4.5 | 2 | `low` |

### Where the pin actually lives (plan §9.5)

The dispatch channel (Workflow `agent()` opts) takes model **aliases**, and A4 makes
`surface.dispatch` authoritative at dispatch — so a dated-id pin in frontmatter would be
overridden every run (decorative, worse than absent). Therefore:

- The authoritative pin is a typed `MODEL_BY_BAND` const in `src/lib/` with a vitest
  snapshot asserting exact values per band — **implemented in A4 (task T12)**, not here.
- Frontmatter here keeps a **sane default for out-of-workflow invocation** only.
- The runbook's quarterly fleet check becomes "run `npm test`, read the snapshot."

### Fan-out budget + K

- Update the fan-out budget table in `run-loop.md`: reads per surface roughly double
  (low/med ~10–15, high ~15–20, critical ~20–30).
- K bumps are **pack-side** (novudesk manifest; proposal security 6, design 4) — the
  engine default template stays modest.

### Unchanged (state this explicitly in the docs)

Tier-1 on every candidate, Tier-2 union predicate, no-refute-no-log, validate gates
every model-written artifact, dedupe + suppressions, severity gates,
`CLAUDE_CODE_SUBAGENT_MODEL` as the global downshift lever.

## Tasks

- [ ] **T13 (P2)** — three plan-vs-code corrections (plan §9.6)
  1. WS3 "Was" column — fixed in the table above; make agents/docs match it.
  2. `src/lib/guard.ts:20` is stale — it says "the workflow self-arms it", which
     `nightshift.workflow.js:43` documents as a crash (`process` is undefined in the
     sandbox). Guard-arming is launcher-side; fix the comment to say so.
  3. CONTRACTS.md E4 "LOC ceiling ~60" is dead (workflow is 119 lines and A4 triples its
     job). Replace the line count with the invariant it proxied: **zero conditionals**.
  - Files: `agents/*.md`, `src/lib/guard.ts` (comment only), `nightshift.workflow.js`
    (comment only), `CONTRACTS.md`, `skills/*/run-loop.md`, README
  - Verify: read-through; no claim contradicts code
- [ ] Frontmatter + run-loop/README updates per the table above

## Cross-references

- `MODEL_BY_BAND` const + snapshot → **A4 / T12**.
- Per-adapter `ux-reviewer` split + `Write` grant → **A5 / T3** (this session only
  refreshes its model default).
