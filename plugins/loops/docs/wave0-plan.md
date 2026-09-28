# plugins/loops — Wave 0, slice 1 implementation plan

## Appetite

- Implementation: about 1 day.
- Plan length: about 150 lines or less.
- Review: at most 2 rounds (round 2 only on a high/P1 finding or a weighted score >= 5: 3 per medium, 1 per low).

## Goal and exit test

Ship `loop-metrics`, a deterministic script that reads Claude Code's local session transcripts and
Workflow run records and appends **one baseline row** to `~/.claude/metrics/loops.jsonl`, so later
loop rules are kept or dropped against measured history.

**Done when:** `npm run check` is green; a local run appends a row; manual validation matches known
counts on one real session; the launchd job's kickstart run appends a row.

## Scope

**In (slice 1):** workflow-run metrics (phase count, tokens, duration, killed/errored dispatches,
per-agent model) and session metrics (context peak, compactions), with a parser that fixes the
known double-count bugs.

**Not in scope (slice 2 and later, listed so nothing is lost):** lens noise from gstack
`*-reviews.jsonl`; merged PRs, revert/fix proxy, cost and sessions per merged PR, session token
totals (need `gh` slugs, so they arrive with the private config); hook blocks, unrouted-spawn share,
MISSING evidence, CI rounds, accepted findings per $; any threshold or alert logic (the row records
values and `n`; the weekly human read applies the noise floor: a delta under ~25% at n<5 is
no-decision).

## Data sources (field names verified on disk)

**Workflow run records:** `~/.claude/projects/<project>/<session>/workflows/wf_*.json`, one per run (169 today).

| Field | Use |
|---|---|
| `startTime` (epoch ms), `durationMs`, `status` (`completed`/`killed`/`failed`) | window attribution, duration, outcome |
| `phases[]` | phase count (matched the `workflow_phase` entries in `workflowProgress` in 169/169) |
| `totalTokens` | run tokens (equals the sum of per-agent `tokens` in 169/169) |
| `workflowProgress[]`, `type == "workflow_agent"`: `model`, `tokens`, `state` (`done`/`error`/`progress`/`start`) | per-agent model; errored = `state == "error"`; killed = `progress`/`start` inside a `killed` run |

**Session transcripts:** top-level `~/.claude/projects/<project>/*.jsonl` only (440 today);
`<session>/subagents/` transcripts are separate contexts, excluded.

| Field | Use |
|---|---|
| `uuid` | record identity; dedupe key |
| `timestamp` (ISO) | window attribution, per record |
| `type == "assistant"`: `message.id`, `message.usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens}` | context size per API call |
| `type == "system"`, `subtype == "compact_boundary"` | one compaction |

## Parser rules (the bugs this parser must not repeat)

1. **Dedupe records by `uuid` across the whole run**, first occurrence wins, files in order of their
   first record's timestamp so the original owns shared records. Resumes replay records within a file
   (7 files, ~9k dups, incl. `compact_boundary`: the known compaction double count); forks copy them
   across files (1,396 records in 3 files; `sessionId` does not identify the owner).
2. **Dedupe usage by `message.id`** run-wide (fallback `requestId`, then `uuid`). One message is one
   record per content block, each with a new uuid and the **same** `usage` (9,359 of 13,540 sampled),
   so uuid dedupe alone still double- or triple-counts.
3. **No truncation.** Only numeric fields and ids are read; message text is never read.
4. **Tolerate malformed input, never fatal.** Bad JSON line -> `bad_lines`; unreadable file, or a
   workflow record with bad JSON or a non-numeric `startTime` -> `bad_files`; a used record with a
   missing/invalid `timestamp` is skipped and a non-numeric token count is read as 0, both -> `bad_records`.
5. **Windows are per record.** In a window, a session counts in `n` if any of its records falls in
   it; its context peak = max over its in-window unique messages of
   `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; a compaction counts in
   the window its `compact_boundary` timestamp falls in. A month-long session is not charged to one week.
6. Stream files line by line; skip files whose mtime is older than the widest window (cheap prefilter).
   Split on `\n` only: `node:readline` also breaks on U+2028/U+2029, which JSON allows unescaped
   in strings (found in implementation: 2 real records became 4 `bad_lines`).

## Decisions

- **D1 Row scope: one global row per run (chosen) vs one row per configured repo.** The slice 1
  metrics (phases/tokens per run, context peak, compactions) describe how the loops run, not a repo.
  Per-repo rows need a private repo list and gh slugs, which only slice 2 uses. So slice 1 has **no
  config file**: CLI flags with defaults (`--projects-dir ~/.claude/projects`,
  `--out ~/.claude/metrics/loops.jsonl`). The private config file lands with slice 2.
- **D2 Windows: every row carries `w7` and `w30` (chosen) vs 7d only.** 30-day decisions read one
  row instead of re-aggregating weekly rows that don't tile 30 days; duplicate rows are harmless.
- **D3 Schedule: a launchd agent (chosen) vs cron.** On a laptop, cron skips a run the machine
  slept through, while launchd's `StartCalendarInterval` runs it on wake. The README plist (placeholder
  paths) calls an absolute node path (launchd has no shell init, and version-manager shims fail
  there) on a `~/bin/loop-metrics` symlink into a checkout (not the versioned plugin cache), and logs
  stdout/stderr to `~/.claude/metrics/loop-metrics.log`. Install ends with `launchctl kickstart` as
  a proof run: a silent failure loses weeks that pruned transcripts cannot rebuild.

## Row shape (`schema: 1`)

```json
{"schema":1,"generated_at":"<ISO>","window_end":"<ISO>",
 "w7": {<window>}, "w30": {<window>},
 "parse":{"bad_lines":0,"bad_files":0,"bad_records":0,"dup_records":0}}
```

`<window>` (medians of an empty set are `null`, never 0):
- `workflows`: `runs`, `completed`, `killed`, `failed`, `phases_median`, `phases_max`, `tokens_sum`,
  `tokens_median`, `duration_ms_median`, `agents`, `agents_errored`, `agents_killed`,
  `by_model: {<model>: {agents, tokens}}` (model strings as recorded).
- `sessions`: `n`, `with_usage`, `context_peak_median`, `context_peak_max`, `compactions_total`,
  `compacted` (>= 1), `compacted_10plus` (the A9 trigger).

## Layout (mirrors plugins/nightshift's toolchain)

```
plugins/loops/
  .claude-plugin/plugin.json README.md   version 0.1.0; README: install, run, schedule, validation
  package.json tsconfig.json vitest.config.ts scripts/build.mjs   copied from nightshift, no yaml dep
  src/lib/session.ts              collectSessions(dir, sinceMs): file order + run-wide dedupe sets
                                  -> per session: [ts, ctx] per unique message, compaction ts list
  src/lib/workflow.ts             parseWorkflow(json) -> RunStats
  src/lib/row.ts                  buildRow(sessions, runs, now) -> Row (pure; windows, medians)
  src/bin/loop-metrics.ts         thin CLI; parseArgs/appendJsonl copied from nightshift (~25 lines)
  bin/loop-metrics.mjs            committed bundle
  src/lib/*.test.ts fixtures/     vitest; synthetic JSONL/JSON only
```

Repo root: `.claude-plugin/marketplace.json` entry (`source: "./plugins/loops"`), a README Available
Plugins row, and `.github/workflows/loops-ci.yml` (copy of the `nightshift-engine` job: install,
typecheck, test, build, stale-bundle diff; paths `plugins/loops/**` and the marketplace file).

## CLI

`loop-metrics [--projects-dir DIR] [--out FILE] [--now ISO] [--dry-run] [--session FILE]`

- Default: append one row to `--out` (creating `~/.claude/metrics/` if needed) and print it.
- `--dry-run` prints without appending; `--now` fixes the windows and `generated_at` (tests).
- Window N = `(now - N days, now]`: session records by `timestamp`, runs by `startTime`.
- `--session FILE`: run `collectSessions` on that one file; print its stats plus naive (undeduped) counts.
- Non-zero exit, no row, on an unwritable `--out` or a missing/unreadable `--projects-dir` (a wrong
  path must not record a quiet week). An existing empty dir gives a valid zero row. Parse problems go in the row.

## Tests (synthetic fixtures only; no real transcripts)

| Fixture | Asserts |
|---|---|
| assistant message split into 3 records, same `message.id` and `usage` | usage counted once; context peak correct |
| replayed block: same uuids appear twice, including one `compact_boundary` | compactions = 1, `dup_records` counted |
| malformed session line, empty file; workflow file with bad JSON | `bad_lines` = 1, rest counted; `bad_files` = 1 |
| session with no usage; empty projects dir | in `n` not `with_usage`, peak `null`; zero counts, `null` medians |
| workflow runs: completed, killed (agents in `progress`), agent with `state: error` and no `tokens` | status counts, `agents_killed`, `agents_errored`, tokens default 0 |
| same records in two files (fork), via `collectSessions` on a temp dir | counted once, owned by the file with the earlier first timestamp |
| one session with messages and compactions 3 and 20 days old | peak and compactions split correctly between `w7` and `w30` |
| valid JSON: missing `timestamp`, string `input_tokens`, string `startTime` | skipped / 0 / `bad_files`; `bad_records` = 2 |
| workflow record missing `phases` | phases 0, run still counted |
| session record and run exactly at `now - 7d` and 1 ms after, fixed `--now` | excluded / included |
| CLI `--dry-run` on the fixtures dir | stdout row matches snapshot, no file written |
| CLI append: missing out dir, run twice; unwritable `--out`; missing `--projects-dir` | dir created, 2 lines; non-zero, no row; non-zero, no row |
| CLI `--session` on the split+replay fixture | naive counts > deduped counts |

## Manual validation (README step; output never committed)

1. Pick one real session with >= 1 compaction and duplicate uuids (a README `jq` one-liner lists them).
2. Count independently with `jq`: unique `compact_boundary` uuids, unique assistant `message.id`s,
   max context sum over unique ids. `loop-metrics --session <file>` must match them, and its naive
   counts must show the inflation. Spot-check one run's `totalTokens`/status against `/workflows`.

## Checklist

- [x] Scaffold, toolchain, marketplace entry, README row, loops-ci
- [x] session.ts, workflow.ts, row.ts test-first; CLI; `npm run check` green; bundle committed
- [x] README: install, build with cwd = plugin dir (not repo root), `~/bin` symlink, launchd, validation
- [x] Local run, manual validation, pre-commit private-name grep clean
- [ ] launchd install + kickstart run (none committed)

## Risks and deferrals

- Claude Code may prune old transcripts, so history lives only in `loops.jsonl`; never plan to
  recompute past windows.
- The transcript format is undocumented. The `parse` counters in every row are the tripwire.
- No open verification in the research plan touches this slice.
