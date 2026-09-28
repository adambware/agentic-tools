# loops

Measure how your engineering loops actually run, so loop rules are kept or dropped against
measured history instead of impressions.

Slice 1 ships one tool, `loop-metrics`: a deterministic script that reads Claude Code's local
session transcripts and Workflow run records and appends **one baseline row** to
`~/.claude/metrics/loops.jsonl`. It reads only numeric fields and ids; message text is never read.

## What a row holds

Every row carries two windows, `w7` and `w30` (`(now - N days, now]`), plus parse counters:

```json
{"schema":1,"version":"0.1.0","generated_at":"…","window_end":"…",
 "w7": {"workflows": {…}, "sessions": {…}}, "w30": {…},
 "parse":{"bad_lines":0,"bad_files":0,"bad_records":0,"dup_records":0}}
```

- `workflows` (from `~/.claude/projects/<project>/<session>/workflows/wf_*.json`): `runs`,
  `completed`, `killed`, `failed`, `other` (a run still in progress, or a status this version
  does not know), `phases_median`, `phases_max`, `tokens_sum`, `tokens_median`,
  `duration_ms_median`, `agents`, `agents_errored`, `agents_killed`, and `by_model`
  (`{<model>: {agents, tokens}}`, model strings as recorded).
- `sessions` (from top-level `~/.claude/projects/<project>/*.jsonl`; subagent transcripts are
  separate contexts and excluded): `n`, `with_usage`, `context_peak_median`, `context_peak_max`
  (context = input + cache-creation + cache-read tokens of one API call), `compactions_total`,
  `compacted` (sessions with >= 1), `compacted_10plus`.

Medians of an empty set are `null`, never 0. A session counts in a window if any of its records
falls in it, and its peak and compactions are counted per record, so a month-long session is not
charged to one week. The row records values and `n` only; there is no threshold or alert logic.

### Why the numbers differ from a naive count

Transcripts repeat themselves, and a naive count inflates both headline metrics:

- **Resumes replay records within a file and forks copy them across files.** Records are deduped
  by `uuid` across the whole run, first occurrence wins, with files read in order of their first
  record's timestamp so the original owns records shared with a fork.
- **One API message is written as one record per content block**, each with a new uuid and the
  same `usage`. Usage is deduped by `message.id` (fallback `requestId`, then `uuid`).

The `parse` counters are the tripwire for format drift: the transcript format is undocumented,
and a jump in `bad_*` means the parser needs a look. A missing field reads as 0 but still counts
in `bad_records`, so a renamed field shows up there instead of as a quiet week of zeros. The same
goes for a negative count, a timestamp that is not ISO-8601 with a zone and a real date, and a
metric record with no `uuid`; an unreadable directory counts in `bad_files`. A torn last line in a
transcript is a session still being written and is skipped without counting. A Workflow run copied
into another session's `workflows/` counts once (by `runId`), with the copy in `dup_records`.
`version` names the parser that wrote the row; it is bumped whenever a parser rule changes.

When a fork copies a session from its first record, the two files' first timestamps tie. The
original owns the shared records: the file whose first record names another session is the copy,
and failing that, the file created first is the original. Synthetic assistant records (API errors,
with all-zero usage) are not counted as API calls.

## Install

The bundle `bin/loop-metrics.mjs` is committed and self-contained (Node 18+, no install step).
Link it from a checkout of this repo, not from the versioned plugin cache, which moves on every
plugin update:

```bash
mkdir -p ~/bin && ln -sf "/path/to/agentic-tools/plugins/loops/bin/loop-metrics.mjs" ~/bin/loop-metrics
```

## Run

```bash
node ~/bin/loop-metrics --dry-run
```

```
loop-metrics [--projects-dir DIR] [--out FILE] [--now ISO] [--dry-run] [--session FILE]
```

- Default: append one row to `--out` (default `~/.claude/metrics/loops.jsonl`, directory created
  if needed) and print it. `--projects-dir` defaults to `~/.claude/projects`.
- `--dry-run` prints the row without appending. `--now` fixes the window end (for tests).
- `--session FILE` prints one transcript's deduped counts next to its naive ones.
- If `loops.jsonl` does not end in a newline (a torn write or a hand edit), the new row starts on a
  line of its own; a failed write is truncated back.
- Exits non-zero without writing a row when `--projects-dir` is missing or unreadable or `--out`
  is unwritable: a wrong path must not record a quiet week. An existing empty directory gives a
  valid zero row.

Claude Code may prune old transcripts, so `loops.jsonl` is the only history. Past windows cannot
be recomputed later, which is why the schedule below matters.

## Schedule (launchd, weekly)

Use launchd, not cron: cron skips a run the laptop slept through, while launchd's
`StartCalendarInterval` runs it on wake. launchd has no shell init, so version-manager shims
(asdf, nvm, mise) fail there; call node by its absolute path. Resolve it with one of:

```bash
asdf which node
```

```bash
node -p process.execPath
```

Both give a path pinned to one node version. If that version is uninstalled, launchd fails to
start the job every week and the only trace is in the log, so re-point the plist after a node
upgrade, or use a node that stays put (for example Homebrew's).

Save as `~/Library/LaunchAgents/com.example.loop-metrics.plist`, replacing `/ABSOLUTE/PATH/TO/node`
and `/Users/YOU`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.loop-metrics</string>
  <key>ProgramArguments</key>
  <array>
    <string>/ABSOLUTE/PATH/TO/node</string>
    <string>/Users/YOU/bin/loop-metrics</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/YOU/.claude/metrics/loop-metrics.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOU/.claude/metrics/loop-metrics.log</string>
</dict>
</plist>
```

Load it, then **kickstart it once as a proof run**. A silent failure loses weeks that pruned
transcripts cannot rebuild, so do not skip this:

```bash
mkdir -p ~/.claude/metrics && launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.example.loop-metrics.plist
```

```bash
launchctl kickstart -p "gui/$(id -u)/com.example.loop-metrics"
```

```bash
tail -n 3 ~/.claude/metrics/loop-metrics.log && tail -n 1 ~/.claude/metrics/loops.jsonl
```

The last line of `loops.jsonl` should be a row whose `generated_at` is a few seconds old.

## Validate against one real session

Do this once after install, and again whenever the `parse` counters jump. The output contains
local paths; never commit it.

1. List sessions with at least one compaction and some duplicate uuids (compactions, duplicates, file):

   ```bash
   for f in ~/.claude/projects/*/*.jsonl; do c=$(jq -r 'select(.subtype=="compact_boundary")|.uuid' "$f" | sort -u | wc -l); d=$(jq -r '.uuid // empty' "$f" | sort | uniq -d | wc -l); [ "$c" -ge 1 ] && [ "$d" -ge 1 ] && echo "$c $d $f"; done | sort -rn | head -5
   ```

2. Count one of them independently with `jq`: unique `compact_boundary` uuids, unique assistant
   message ids, and the max context sum:

   ```bash
   F=/path/to/session.jsonl
   jq -r 'select(.subtype=="compact_boundary")|.uuid' "$F" | sort -u | wc -l
   jq -r 'select(.type=="assistant" and (.message.usage|type)=="object" and .message.model!="<synthetic>" and .isApiErrorMessage!=true)|.message.id // .requestId // .uuid' "$F" | sort -u | wc -l
   jq -s '[.[]|select(.type=="assistant" and (.message.usage|type)=="object")|.message.usage|((.input_tokens//0)+(.cache_creation_input_tokens//0)+(.cache_read_input_tokens//0))]|max' "$F"
   ```

3. `node ~/bin/loop-metrics --session "$F"` must match all three in `deduped`
   (`compactions`, `messages`, `context_peak`), and its `naive` counts should show the inflation.
4. Spot-check one Workflow run's `totalTokens` and `status` against `/workflows`.

## Develop

Author TypeScript in `src/`; the build bundles `src/bin/*.ts` into the committed `bin/*.mjs`.
Run from this plugin directory, not the repo root:

```bash
cd plugins/loops && npm install && npm run check
```

`npm run check` is typecheck, vitest, and build. Tests use synthetic fixtures only; never commit
real transcripts. Commit the rebuilt `bin/` with its source: CI fails on a stale bundle.

## Roadmap

Slice 2 adds per-repo metrics from a private config kept outside this repo: lens noise from review
logs, merged PRs, revert/fix proxy, cost and sessions per merged PR, and session token totals.
