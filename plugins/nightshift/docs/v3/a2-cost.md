# A2 — Cost reporting

**Scope:** `schemas/`, `src/lib/`, `examples/`. **Depends on:** A0. **Blocks:** A6 (lane B).
Can share a session with A3 (disjoint files).
**Gate:** vitest green; round-trip on a NovuDesk copy including the cost join.

## Spec

### `metrics/costs.jsonl` + schema

- **New append-only `metrics/costs.jsonl`** (one line per run), new
  `schemas/cost-record.yml`: `{run_id, lane, date, ts, usd, input_tokens, output_tokens,
  cache_read_tokens, cache_creation_tokens, source}`.
- Kept **separate** from `runs/<YYYY-MM>.jsonl` so the deterministic record path stays
  untouched and append-only semantics are preserved; readers join on `run_id`.

### Capture: `bin/record-cost` gates on `is_error`, never `subtype` (plan §9.7)

Headless `claude -p --output-format json` reports total cost and token usage
(`total_cost_usd`, `usage.{input_tokens, output_tokens, cache_creation_input_tokens,
cache_read_input_tokens}`, `modelUsage`, `duration_ms`). `ns` parses that and calls
**new `bin/record-cost`** (validate + atomic append), `source: "cli-json"`.

**A failed run returns** (verified against a live envelope):

```json
{"is_error":true, "total_cost_usd":0, "subtype":"success", "terminal_reason":"api_error"}
```

`subtype:"success"` sits next to `is_error:true`. Therefore:

- `bin/record-cost` requires `is_error === false` for a normal record; otherwise it
  writes `status: "error"` plus `terminal_reason`.
- `bin/rollup` excludes error rows from `cost_usd_avg_per_run_30d`.
- The dashboard's hygiene strip renders error rows (A6).
- **A fixture of this exact envelope becomes a regression test.**

Interactive/debug runs without JSON output append a `source: "manual"` line via
`ns cost add`, or skip — the dashboard shows the gap honestly.

### `bin/rollup` extension (additive)

`cost_usd_7d`, `cost_usd_30d`, `cost_usd_avg_per_run_30d` in the daily rollup. Additive
schema fields → `pack_format` stays `1`.

### Example pack

NovuDesk gains synthetic cost lines so tests and the dashboard render real shapes.

### No cost estimate anywhere (plan §9.10)

Do **not** print or document a cost expectation. The runbook gets a TBD that A7 fills
from the first three real runs (task T15, session A7). A wrong baseline is worse than
none: it turns every reading into a false alarm or a missed one.

## Failure modes to cover

| Codepath | Failure | Handling |
|---|---|---|
| `bin/record-cost` | run failed, `total_cost_usd: 0` | gate on `is_error`; `status:"error"` row; visible in hygiene strip |

## Tasks

- [x] **T7 (P1)** — `bin/record-cost` — gate on `is_error`
  - Files: new `src/lib/record-cost-run.ts`, `schemas/cost-record.yml`, `src/lib/rollup-run.ts`
  - Verify: error-envelope fixture writes `status:"error"`, excluded from the 30d average
- [x] costs.jsonl schema + rollup extension + NovuDesk cost lines (WS2 core, above)

## Reuse

FPR / freshness / median-staleness math: `bin/rollup` (25 tests) — extend additively.
Example-pack hygiene: `examples/novudesk/` + `check-example-hygiene.sh`. This lane (B)
adds the cost-record type to `src/lib/types.ts` — expect a small merge with lane A if A1
hasn't landed first.
