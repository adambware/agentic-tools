# loops

Measure how your engineering loops actually run, so loop rules are kept or dropped against
measured history instead of impressions.

It ships one tool, `loop-metrics`: a deterministic script that reads Claude Code's local session
transcripts and Workflow run records, plus gstack's review logs, and appends **one baseline row**
to `~/.claude/metrics/loops.jsonl`. It reads only numeric fields, ids, lens names, severities and
actions; message and finding text is never read.

## What a row holds

Every row carries two windows, `w7` and `w30` (`(now - N days, now]`), plus parse counters:

```json
{"schema":1,"version":"0.2.1","generated_at":"…","window_end":"…",
 "w7": {"workflows": {…}, "sessions": {…}, "lenses": {…}}, "w30": {…},
 "parse":{"bad_lines":0,"bad_files":0,"bad_records":0,"dup_records":0},
 "parse_lenses":{"bad_lines":0,"bad_files":0,"bad_records":0,"dup_records":0}}
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

- `lenses` (from gstack's `~/.gstack/projects/<repo>/*-reviews.jsonl`, `skill: "review"` records
  only; `null` when gstack is not installed): `reviews`, `with_specialists` (a specialists block,
  possibly empty when the army dispatched nothing), `with_findings` (a `findings[]` list), and
  `by_lens` (`{<lens>: {…}}`). Each lens has two sets of counts:
  - from the specialists block: `dispatched`, `not_dispatched`, `reported` and
    `reported_critical` (the counts the lens reported);
  - from `findings[]`, attributed by the fingerprint's last `:` segment: `findings`, `fixed`,
    `auto_fixed`, `skipped`, `other_action` (deferred, asked, and the like), `critical`
    (severity CRITICAL or P1) and `critical_skipped`.

  Findings whose category is not one of gstack's lenses (`stale-comment`, `input-validation`), or
  that have no fingerprint, are counted in `other` with the same fields. Lens names are
  normalized (`red_team` -> `red-team`). A review counts in the window its `timestamp` falls in,
  and a re-review counts again what it finds again.

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
goes for a count that is not a non-negative safe integer, a timestamp that is not ISO-8601 with a
zone and a real date, a metric record with no `uuid`, a `message.id` that is empty or a non-null
non-string, and a Workflow progress entry of an unknown type; an empty id counts as a missing one,
never as a shared key. An unreadable directory counts in `bad_files`. A torn last line in a
transcript written to in the last hour is a session still being written and is skipped without
counting; in an older file, or one whose mtime is over a minute in the future, it counts in
`bad_lines`. A Workflow run copied into another session's `workflows/` counts once (by `runId`,
keeping the finished copy), with the copy in `dup_records`.
`version` names the parser that wrote the row; it is bumped whenever a parser rule changes.
`schema` is bumped only when a field changes meaning or goes away; new fields are additive.

Review logs have their own counters in `parse_lenses`, so drift can be traced to its source. A
line that is not a JSON object counts in `bad_lines` (a pretty-printed record counts once per
distinct line). A review with no zoned ISO `timestamp`, a non-object specialists block or entry, a
dispatched lens without a numeric `findings`, a negative or fractional count, a finding with
a missing or unknown `action`, and a `findings` value that is neither a list nor a count
all count in `bad_records`. An identical line seen twice counts once: a
record's copy goes in `dup_records`, and a malformed line is not counted again.

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
loop-metrics [--projects-dir DIR] [--gstack-dir DIR] [--out FILE] [--now ISO] [--dry-run] [--session FILE]
```

- Default: append one row to `--out` (default `~/.claude/metrics/loops.jsonl`, directory created
  if needed) and print it. `--projects-dir` defaults to `~/.claude/projects`, and `--gstack-dir`
  to `~/.gstack/projects`.
- `--dry-run` prints the row without appending. `--now` fixes the window end (for tests).
- `--session FILE` prints one transcript's deduped counts next to its naive ones.
- If `loops.jsonl` does not end in a newline (a torn write or a hand edit), the new row starts on a
  line of its own; a failed write is truncated back, and the row is fsynced before exit 0, along
  with the file's directory entry and those of any directories the run created. (On macOS, fsync
  hands the data to the drive, which may still cache it.) Not covered: directories an earlier,
  failed run created above the file's own, and the target directory of a symlinked `--out`.
  The truncate is skipped if another run appended in the meantime, so cutting back cannot take
  that row with it; the failed fragment then stays, glued to the front of the other run's row.
- Exits non-zero without writing a row when `--projects-dir` is missing or unreadable, `--out`
  is unwritable, or `--gstack-dir` is unreadable: a wrong path must not record a quiet week. The
  one exception is a missing default `~/.gstack/projects` (gstack is not installed), which gives
  `lenses: null`. An existing empty directory gives a valid zero row.
- The one non-zero exit that does write a row is `error: --out FILE: row written but may not be on
  disk`: the row was appended but syncing it failed. The row is still printed to stdout, so the log
  keeps a copy. Check the file's last line against it before running again, or the week is
  recorded twice. A filesystem that cannot sync directories at all (some network and FUSE mounts,
  an unlistable directory) is not an error: the directory sync is skipped there.

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

## Reading the lens numbers

The row records counts only; rates and thresholds belong to the weekly read. Per-lens rates over
the last 30 days, from the latest row:

```bash
tail -n 1 ~/.claude/metrics/loops.jsonl | jq -r '(.w30.lenses.by_lens // {}) | to_entries[] | select(.value.findings >= 5) | .value as $v | "\(.key)\tn=\($v.findings)\taddressed=\(100*($v.fixed+$v.auto_fixed)/$v.findings|floor)%\tskipped=\(100*$v.skipped/$v.findings|floor)%\tcrit_skipped=\($v.critical_skipped)/\($v.critical)"'
```

Starting points to calibrate against your own baseline: a skip rate above 60%, or more than 25%
of a lens's criticals skipped. `auto_fixed` inflates the addressed rate of lenses whose findings
are trivial cleanups, which is why it is kept apart from `fixed`. A delta under ~25% at n < 5 is
no decision.

## Roadmap

Later slices add per-repo metrics from a private config kept outside this repo: merged PRs,
revert/fix proxy, cost and sessions per merged PR, and session token totals.

See [`docs/wave0-plan.md`](docs/wave0-plan.md) for the reviewed Wave 0 design and its open items.
