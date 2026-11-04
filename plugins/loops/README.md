# loops

Measure how your engineering loops actually run, so loop rules are kept or dropped against
measured history instead of impressions.

It ships two tools. The `loops` CLI (`zone` and `env-check`, see [The loops CLI](#the-loops-cli))
triages a change by risk and checks a checkout's environment. `loop-metrics` is a deterministic
script that reads Claude Code's local session transcripts and Workflow run records, plus gstack's
review logs, and appends **one baseline row** to `~/.claude/metrics/loops.jsonl`. It reads only
numeric fields, ids, lens names, severities and actions; message and finding text is never read.
With a private repo config (see [Per-repo metrics](#per-repo-metrics)) it also reads merged PRs
from GitHub via `gh`; without one, everything stays local.

## What a row holds

Every row carries two windows, `w7` and `w30` (`(now - N days, now]`), plus parse counters:

```json
{"schema":1,"version":"0.7.0","generated_at":"…","window_end":"…",
 "w7": {"workflows": {…}, "sessions": {…}, "lenses": {…}, "repos": {…}}, "w30": {…},
 "parse":{"bad_lines":0,"bad_files":0,"bad_records":0,"dup_records":0},
 "parse_lenses":{"bad_lines":0,"bad_files":0,"bad_records":0,"dup_records":0},
 "repo_errors":[]}
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

- `repos` (`null` without a config; see [Per-repo metrics](#per-repo-metrics)):
  `{<owner/name>: {…}}`, one entry per configured repo: `merged_prs`, `fix_prs`, `escaped`,
  `observed_14d`, `escaped_observed`, `sessions`, `session_tokens`, `workflow_runs`,
  `workflow_tokens`, `tokens_per_merged_pr`, `sessions_per_merged_pr`. A repo whose merged PRs
  could not be read is `null`, and its slug is listed in the row's `repo_errors`.

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
`version` is the version of the plugin that wrote the row (a test keeps it equal to
`package.json`). It changes with every release, so a parser rule change always comes with a new
`version`, but a new `version` does not always mean a parser change.
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

The `loops` CLI is a second bundle, `bin/loops.mjs` (executable, zero runtime dependencies):

```bash
ln -sf "/path/to/agentic-tools/plugins/loops/bin/loops.mjs" ~/bin/loops
```

## Run

```bash
node ~/bin/loop-metrics --dry-run
```

```
loop-metrics [--projects-dir DIR] [--gstack-dir DIR] [--config FILE] [--out FILE] [--now ISO] [--dry-run] [--session FILE]
```

- Default: append one row to `--out` (default `~/.claude/metrics/loops.jsonl`, directory created
  if needed) and print it. `--projects-dir` defaults to `~/.claude/projects`, and `--gstack-dir`
  to `~/.gstack/projects`.
- `--dry-run` prints the row without appending. `--now` fixes the window end (for tests); PRs
  merged after it are ignored, so a rerun with an earlier `--now` sees the PRs that week saw.
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

## Per-repo metrics

Per-repo numbers come from a private config that names your repos, so no repo name or path lives
in this plugin. It is read from `--config FILE`, then `$LOOPS_CONFIG`, then
`~/.config/agentic-loops/config.json`; an empty `$LOOPS_CONFIG` counts as unset. With no file
at the default path, `repos` and `repo_errors` are `null` and nothing else changes. A config
that was named but is missing, or any malformed config, exits non-zero without a row.

```json
{
  "repos": [
    { "slug": "your-org/your-app", "path": "~/src/your-app" },
    { "slug": "your-org/tools", "path": "~/src/tools", "escape_ignore": ["dist/", "REPO_MAP.yml"] }
  ]
}
```

- `slug` is the GitHub `owner/name`; `path` is the main checkout (`~` expands, a relative path
  resolves against the config's directory).
- **Merged PRs** come from a `gh repo view` check and then one `gh pr list --state merged` call
  per repo, so `gh` must be installed and signed in. The scheduled job finds it in
  `/opt/homebrew/bin` or `/usr/local/bin`. A failed call warns, records that repo as `null`, and
  names it in `repo_errors`; the rest of the row is still written, since a lost week cannot be
  recomputed. A slug `gh` cannot resolve (a typo, a rename, no access) is reported the same way:
  `gh pr list` alone answers `[]` for it, so without the check the repo would read as quiet. A
  month of 1000+ merged PRs is refused the same way rather than silently cut short. Each `gh` call
  times out after 5 minutes (a `SIGTERM`) and is then reported the same way, so a stalled call
  no longer waits forever; a `gh` that ignores `SIGTERM` is not covered yet.
- **Sessions and tokens** belong to a repo when their project directory is the checkout's own or
  one of its `.claude/worktrees/` worktrees (including a session started in a subdirectory of
  such a worktree). Not counted: a session started in a subdirectory of the main checkout, and
  worktrees outside `.claude/worktrees/`. `session_tokens` sums input, cache-creation,
  cache-read and output tokens per unique API message; `workflow_tokens` sums the Workflow runs
  started there. `session_tokens` counts main-thread session transcripts only: Agent-tool
  subagent transcripts (`<session>/subagents/*.jsonl`) are not counted yet, so
  `tokens_per_merged_pr` understates sessions that use subagents (Workflow runs are counted
  separately, in `workflow_tokens`). Work done elsewhere (claude.ai on the web, another machine)
  leaves no local transcript: with no local session or run, the two per-PR ratios are `null`,
  not 0.
- **The escape proxy.** `fix_prs` counts merged PRs whose title starts with `revert`, `fix` or
  `hotfix` (after an optional version, as in `v1.2.0 fix(api): …`). A merged PR has `escaped`
  when a fix PR merged within the next 14 days touched one of its files and it was the **last**
  PR to touch that file before the fix, as `git blame` would point. Docs (`.md`, `.mdx`, any
  `.txt`), `VERSION`, manifests, lockfiles, snapshots and test files never count, nor does
  anything in the repo's `escape_ignore` (exact paths, or directory prefixes ending in `/`; use
  it for committed bundles and repo-wide bookkeeping files). The recent PRs have not had their
  14 days yet, so use `escaped_observed / observed_14d` for a rate, from `w30` only: no PR in
  `w7` is 14 days old, so there it is always 0/0. It is a proxy: a fix titled otherwise is
  missed, a fix that touches a file for another reason still counts, and `gh` lists at most 100
  files per PR, so files past the first 100 of a large PR are not compared.

Escape rate and cost per merged PR over 30 days, from the latest row:

```bash
tail -n 1 ~/.claude/metrics/loops.jsonl | jq -r '.w30.repos // {} | to_entries[] | select(.value != null) | .value as $v | "\(.key)\tmerged=\($v.merged_prs)\tescaped=\($v.escaped_observed)/\($v.observed_14d)\tMtok/PR=\(if $v.tokens_per_merged_pr then ($v.tokens_per_merged_pr/1e6*10|floor/10) else "?" end)\tsessions/PR=\($v.sessions_per_merged_pr // "?")"'
```

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

## The loops CLI

`loops --version`, `loops zone`, `loops env-check`. Node 18+, no install step. Exit codes: 0 ok,
1 an `env-check` FAIL, 2 usage or config error (the message goes to stderr).

### `loops zone`

Classifies a change against the repo's `risk-zones.md` (default `<repo root>/risk-zones.md`).

```bash
loops zone                      # merge-base diff vs origin/HEAD, origin/main, then main, plus dirty and untracked files
loops zone --committed --base origin/main
loops zone --paths a.go b/c.md  # skip git
git diff --name-only -z main... | loops zone --stdin -z --json
```

Flags: `--base REF`, `--committed` (leave out uncommitted and untracked files), `--paths P...`,
`--stdin [-z]` (newline or NUL separated), `--file F`, `--json`, `--explain` (one line per path
with the rows that matched). Renames count both sides; deletions count. Submodule pointer moves and
edits to tracked content inside a submodule count whatever `.gitmodules` or `diff.ignoreSubmodules` say (`ignore=all`
included); untracked files inside a submodule do not. A path with a line break, CR or NUL is rejected with exit 2
only when it comes from `--paths` or `--stdin`; filenames reported by git are classified as they are. `--stdin` exits 2 when `-z` does not match
the input: NUL in the input without `-z`, or newlines but no NUL with `-z`. An empty change prints
`zone: none`. In text and `--explain` output, a path that contains a control character (line break, escape, tab, DEL) is printed JSON-quoted, e.g. `"src/x\nzone: green"`, so a file name cannot add fake lines; plain names print unquoted, and `--json` is unchanged.

```
zone: red
prod: yes (l7: required; prod-touching: 2 paths; 1 unmatched (counted as no))
evidence: config, orchestration
driving rows:
  red  `.github/workflows/**`  2 paths: .github/workflows/ci.yml, .github/workflows/release.yml
paths: 9 (red 3, yellow 4 incl. 1 unmatched, green 2)
ship: /ship — red zone (<category>): full review + <one extra review chosen at L0>
judgment left to L0: <category>, <one extra review chosen at L0>; docs-only / trivial S0 rows;
  one-way changes (migration, deleted history, published release, public post) are red regardless
```

The zone is never in the exit code; read `--json` (`zone`, `prod`, `evidence`, `counts`,
`driving_rows`, `paths`, `ship`). The `ship:` line is the file's `## Ship prefix` bullet for the
zone, verbatim (a missing bullet is exit 2). When every path is green, an `alt:` line lists the
`docs-only` and `trivial S0` bullets for the triager to choose from.

The file format, parsed strictly (any violation is exit 2 with `file:line`):

- A header blockquote line containing `Schema version 1`. Other versions are rejected.
- A `## Zones` section with a table. Columns are found by name: `Glob`, `Zone`, `Prod`,
  `Evidence class`, `Why`. A row needs the full column count, a Zone of `green`, `yellow` or `red`,
  a Prod of `yes`, `no` or `?`, and at least one backticked glob in the Glob cell (other text in
  the cell is prose).
- Globs match repo-relative paths, case-sensitively. `*` is `[^/]*` (it matches dotfiles, unlike
  bash), `?` is one non-`/` character, `**/` is zero or more directories, any other `**` (such as a
  trailing `/**`) matches anything. `{a,b}` braces nest. `[...]`, `!`, a leading `/`, `{a..b}` and
  unbalanced braces are errors, so a typo cannot silently match nothing.
- A path takes the highest zone of every matching row; a path no row matches is yellow. The
  change takes the highest zone of its paths. A path is prod-touching if any matching row says
  `yes` or `?`; its evidence is the union of the matching rows' classes (minus `none`).
- A `## Ship prefix` section with `- <zone>: "<text>"` bullets (`red`, `yellow`, `green`, and
  optionally `docs-only` and `trivial S0`).

### `loops env-check`

Runs the checks in `.loops/env-check.toml` at the repo root and prints one line per result:

```
LEVEL id  message — fix: what to do
env-check: 1 FAIL, 1 WARN, 6 PASS, 0 SKIP
```

Order is groups `a` (pins), `b` (containers), `c` (checkout), `d` (harness), `e` (compose), then `x`. `INFO` lines
are not counted. A run with no FAIL, WARN or PASS (only SKIP and INFO rows, or none: a SKIP is not a check) adds
`WARN x.none  no check ran — fix: add checks to .loops/env-check.toml (see the loops README)` last (under `--static`:
`no check ran under --static (CI=true implies it)`, naming the checks that do run there); exit stays 0. Results with the same level and message fold into one line that ends
`(also: <ids>)`, so one root cause is one FAIL. Every WARN or FAIL carries a fix. Flags:
`--static` (also implied by `CI=true`), `--json`, `--quiet` (WARN and FAIL plus the summary),
`--compose-project` (print the Compose project name for this checkout and exit 0 when `e.project` keeps it, with one
`env-check: warning:` line on stderr per FAIL that keeps it; exit 1 with each FAIL and its fix on stderr when a FAIL
withholds it (a configured file missing, a shell `COMPOSE_PROJECT_NAME` Compose rejects, `git worktree list` failing
or not listing the main checkout, the name held by another checkout, a container of the name started from
another checkout or from none, `docker compose version` failing for any reason but a missing compose plugin (timed out, killed, refused or a non-zero exit), `docker ps` timing out, a failed run of another checkout
or of the main checkout's configured run), or when it is unknown (the main checkout with Compose unavailable and no
shell `COMPOSE_PROJECT_NAME`); exit 2 without compose `mode = "test"`; it always asks Compose, ignoring `--static`
and `CI=true`). `$HOME` is shown as `~` everywhere (a quoted path under it as `~/'rest'`, so a printed command still runs; relayed output is redacted before it is cut, so a cut never shows part of home). Only a whole path is replaced, at a segment boundary on both sides: with `HOME=/Users/bob`, `/Users/bob2`, `/Users/bob.old` and `/x/Users/bob` are left as they are, and a PATH list's `:/Users/bob:` becomes `:~:`. A `HOME` that is not an absolute path (`HOME=build`) redacts nothing. `--json` is `{schema, engine, mode, root,
results: [{level, id, message, fix, also, source}], summary: {fail, warn, pass, skip}, exit}`.
Text output escapes every row (and each `--compose-project` stderr line) once: control characters, bidi controls and
the zero-width space as `\t`, `\u001b`…, and a `— fix:` or ` -- fix:` inside a message or fix as `\u2014 fix:` or
`\u002d- fix:`, so a row has one fix. `--json` values are the raw text (redacted, not escaped), with DEL, C1, U+2028/2029,
bidi and zero-width characters written as `\uXXXX` like JSON's own C0 escapes, so `JSON.parse` returns them exactly.
env-check's git commands run without git's repo-local variables (the `git rev-parse --local-env-vars` set: `GIT_DIR`,
`GIT_WORK_TREE`, `GIT_INDEX_FILE`…), so they read the checkout env-check runs in; `loops zone` keeps them.

`--static` reads repo files only: no toolchain, tool or docker probes; one git rev-parse (`a.local.*`,
`b.containers`, `d.tools`, `d.sparse` are not run, `git worktree list` is not read, `c.shared` is SKIP unless that
rev-parse fails, `e.project` does not resolve the name). The rev-parse gives `[[local]]` checks the same
`ENV_CHECK_WORKTREE` full mode does. Only `[[local]]` checks with `static = true` run.

Unknown keys, wrong types, an unsupported `schema_version`, an `engine` range newer than this
CLI, a missing or non-executable local check, a local check `run` that is absolute or leaves the
repo, a `[[local]]` id `x.none` (reserved), `compare = "floor"` (removed in 0.6.0), and bad TOML are all exit 2.
The exit-2 error line of every `loops` command is redacted and escaped like a text row, the command name included.

```toml
schema_version = 1
engine = ">=0.4.0"                      # only ">=X.Y.Z"; an older CLI exits 2 "update agentic-tools"

[shared_checkout]                       # c.shared: FAIL in the main checkout, PASS in a linked worktree
hint = "git worktree add .claude/worktrees/<name> -b <branch> origin/main"
                                        # ENV_CHECK_ALLOW_MAIN=1 downgrades the FAIL to INFO
                                        # the worktree must be registered and own its git metadata:
                                        # a cp -R copy FAILs "copied?", a moved one FAILs "moved"
                                        # (fix: git worktree repair); an inherited GIT_DIR or
                                        # GIT_WORK_TREE naming another checkout FAILs (a hook's own
                                        # is silent); unreadable git metadata FAILs, also under
                                        # --static. ALLOW_MAIN downgrades none of these

[[pins]]                                # a.pins.<tool> (sources agree), a.local.<tool> (local toolchain)
tool = "go"
sources = ["go-mod:go.mod", "tool-versions", "setup-go:.github/workflows/*.yml"]
compare = "minor"                       # exact (default) | minor | major
local = "warn"                          # warn (default) | fail | off

[[pins]]
tool = "node"
sources = ["nvmrc", "engines", "dockerfile:build/Dockerfile"]
compare = "exact"                       # engines is a range: one INFO row, never compared

[harness]                               # d.*
tools = ["git", "go", "make"]           # d.tools: on PATH; an asdf or mise shim must also resolve a version here
files = ["go.mod", "VERSION"]           # d.files: regular files (symlinks followed), present and non-empty; a directory FAILs; working tree only (untracked counts)
entrypoints = "auto"                    # d.entrypoints: executable; "auto" = ./paths run by tracked .github/workflows (INFO when there are none), or a list
tracked = true                          # d.tracked: no tracked file deleted, 100755 bits intact
sparse = "warn"                         # d.sparse: WARN when core.sparseCheckout is on (any git bool spelling) or unreadable, else PASS

[compose]                               # e.*; omit the table for no compose checks
mode = "none"                           # none: FAIL if a compose file is tracked | test
files = ["compose.yml"]                 # test only: e.project and e.container_name
inputs = ["compose.yml", "docker/**"]   # test only: b.containers, globs over tracked files
containers = "fail"                     # fail (default) | warn: b.containers severity
derive = "dirname"                      # dirname (default) | slug-hash (<main, else wt>-<worktree slug>-<hash6>)
allow_container_name = ["app"]

[[local]]                               # a repo's own checks
id = "d.lint-lock"                      # <a-e or x>.<name>; x.none is reserved
run = ".loops/checks/lint-lock.sh"      # an executable, as a repo-relative path; listed explicitly, never auto-discovered
static = true                           # also run under --static (default false)
timeout_s = 15
```

**Pins contract.** `a.pins.<tool>` compares exact pins only: every pair of pins must agree at the `compare`
depth, and the pin is the most specific one. A range is never compared: after the verdict, each distinct
(source, value) range adds one INFO row `<source>: "<value>" is a range, not compared`. When every source yields only ranges,
`a.pins.<tool>` is a FAIL (`no exact pin among sources (...); pin an exact version in a supported source`) and no
`a.local.<tool>` row runs. A value in the "anything else" column is a FAIL `unsupported form "<value>" in <file>:<line>; pin an exact
version`; a `<tool>-version-file` name missing from the second table is a FAIL `unsupported form: <tool>-version-file
<name> in <workflow>:<line> is not a supported version file (...); pin an exact version`. `compare =
"floor"` was removed in 0.6.0 (exit 2); checking that a pin falls inside a range is a later `a.range` check.
These two tables are the only list of supported forms.

Pin source kinds are `kind` or `kind:path-or-glob` (a glob matches tracked files). A pin is one version or one
series: `1.26`, `v1.26.1`, `1.26.x`, `~1.26`, `^1`, `~> v2` (and node's `=20.11.1`). Every reader that takes a pin
(`.tool-versions`, `go.mod`, `volta.<tool>`, plain version files, Dockerfile `ARG` values, workflow inputs) accepts
exactly these forms; where the matrix lists no range, a range is a FAIL.

| kind | default file | pin (compared) | range (INFO, not compared) | anything else |
|---|---|---|---|---|
| `tool-versions` | `.tool-versions` | the first version field of every line for the tool (`node` also matches `nodejs`, `go` also `golang`; two such lines at different versions disagree), in any pin form (`=20.11.1`, `~20.11`, `^20`, `1.26.x`) | none | FAIL unsupported: a range (`>=20`), `system`, `latest`, `lts`, `ref:…`, `path:…`, `pypy3.9-7.3.11` |
| `nvmrc` | `.nvmrc` | the first non-blank, non-comment line (a trailing `# comment` is dropped, as nvm does) | none: a range (`>=20`, `^20.11`) is a FAIL `is a range, not a pinned version` | FAIL unsupported: `lts/*`, `lts/iron`, `lts/-1`, `node`, `stable`, `latest`, a version followed by other text; an empty or comment-only file is a FAIL `no version in <file>`, also when it is one of several glob matches |
| `node-version` | `.node-version` | as `nvmrc` | none (FAIL, as `nvmrc`) | FAIL unsupported, as `nvmrc` |
| `python-version` | `.python-version` | as `nvmrc`, without node's `=` (`=3.12.1` is a range) | none (FAIL, as `nvmrc`) | FAIL unsupported: `system`, `pypy3.9-7.3.11` |
| `go-mod` | `go.mod` | `toolchain goX`, else `go X`, in any pin form; the whole value up to a `//` comment is classified | none | FAIL unsupported: a range (`go >=1.20`), `go stable`, a version followed by other text (`go 1.26 latest`) |
| `engines` | `package.json` | none | `engines.<tool>`, always, even an exact-looking `20.11.0` | missing or not a string: FAIL |
| `dockerfile` | `Dockerfile` | `FROM [--flag] <image>:<version tag>` (image `golang` for go, else the tool name; variants such as `-alpine` dropped) and `ARG <TOOL>_VERSION=<v>` whose value (its whole shell word; quotes may wrap the whole value only) is a pin as written; an `ARG` line is split into shell words as Docker splits them, so an escaped quote (`ARG A=x\" NODE_VERSION=20`) does not hide the next pair; a tag that starts with `$<TOOL>_VERSION` (`node:${NODE_VERSION}-alpine`) is skipped, its `ARG` is the pin; a tag whose literal version a variant separator ends before its `$` (`node:18-${DISTRO}`, `node:20-alpine${X}`) reads that version; a tagless `FROM` naming an earlier `AS` stage alias is a stage reference and is skipped | none | FAIL unsupported: the tool image with no tag, a digest only, a non-version tag (`latest`, `lts-alpine3.20`), any other `$` tag (`node:lts-${X}`, `node:20.${MINOR}.0`, `node:20${SUFFIX}`, `python:3.13rc${BUILD}`), a `$` tag of another variable (`node:${OTHER}`), a prerelease the `$` may continue (`node:20-dev-${N}`, `node:22-rc-${N}`); an `ARG` value that is not a pin (`20 \|\| 22`, `20${SUFFIX}`, `"20"${SUFFIX}`, `${NODE_MAJOR}`, empty, `latest`, `20-alpine`); an `ARG` line naming `<TOOL>_VERSION` with an unterminated quote; an `escape` parser directive other than `\` |
| `setup-go` | `.github/workflows/*.{yml,yaml}` | each line of `go-version`, or `go-version-file` (second table) | each line of `go-version` that is a range (`>=1.20`, `^1.20`, `~1.20.3`) | FAIL unsupported: `latest`, `stable`, `oldstable`; FAIL `setup-go step without a version in <file>:<line>` for a step with neither `go-version` nor `go-version-file` (no `with:`, an empty `with:`, or only `cache:`/`check-latest:`) |
| `setup-node` | `.github/workflows/*.{yml,yaml}` | each line of `node-version`, or `node-version-file` (second table) | each line of `node-version` that is a range (`>=20`, `20 \|\| 22`, `18 - 20`) | FAIL unsupported: `latest`, `lts/*`, `node`, `current`; FAIL `setup-node step without a version in <file>:<line>` for a step with neither `node-version` nor `node-version-file` (the action has no default file) |
| `setup-python` | `.github/workflows/*.{yml,yaml}` | each line of `python-version`, or `python-version-file` (second table); a step with neither input reads `.python-version` at the repo root, as the action does from v4.7.0 | each line of `python-version` that is a range (`>=3.10`, `~=3.12`) | FAIL unsupported: `latest`, `pypy3.9`, `graalpy-24.0`; FAIL `setup-python step without a version in <file>:<line>` when that file is absent or the action ref is older than v4.7.0 |
| `golangci-action` | `.github/workflows/*.{yml,yaml}` | `with: version:` of `golangci/golangci-lint-action` (tool `golangci-lint`); a step with no `version`/`version-file` reads `github.com/golangci/golangci-lint/v2 vX` from `<working-directory>/go.mod`, as the action does (`golangci-lint vX` for refs v6 and older) | a range `version:` | FAIL unsupported: `latest`; FAIL `golangci-lint-action step without a version in <file>:<line>` when go.mod has no such line (the action installs latest) |
| `goreleaser-action` | `.github/workflows/*.{yml,yaml}` | `with: version:` of `goreleaser/goreleaser-action` (tool `goreleaser`), e.g. `~> v2` | a range `version:` (`^2.5`); a step with no `version` is the action's default `~> v2` (v6 and later), an INFO range | FAIL unsupported: `latest`; FAIL `goreleaser-action step without a version in <file>:<line>` for refs v5 and older (default latest) |

`<tool>-version-file` names are matched on the file's basename; any other name is a FAIL `unsupported form:
<tool>-version-file <name> in <workflow>:<line> is not a supported version file (...)`, with no plain-file fallback.

| `<tool>-version-file` name | reads | pin (compared) | range (INFO, not compared) |
|---|---|---|---|
| `go.mod`, `go.work` | `toolchain goX`, else `go X` | yes | none |
| `.tool-versions` | the tool's lines, as the `tool-versions` kind | yes | none |
| `package.json` | `volta.<tool>`, else `engines.<tool>` (neither is a FAIL) | `volta.<tool>`, in any pin form (a range there is a FAIL unsupported) | `engines.<tool>` |
| `pyproject.toml` | `[project] requires-python` when the file has a `project` table, else `[tool.poetry.dependencies] python` | none | always |
| `Pipfile` | `[requires] python_full_version`, else `python_version` | a pin | a range |
| `.nvmrc`, `.node-version`, `.python-version`, `.go-version` | the first non-blank, non-comment line, as the `nvmrc` kind | yes | none (a range, or an empty or comment-only file, is a FAIL) |

Workflow sources (`setup-*`, `golangci-action`, `goreleaser-action`) parse each workflow as YAML 1.2, as Actions does, and read every `jobs.*.steps[]` step (or a composite action's `runs.steps[]`) that uses the action. Any YAML form works: flow mappings, block scalars, a value on the next line, anchors and aliases. Action refs (`Actions/Setup-Node@v4`) and input names match case-insensitively, and a multi-line input (`python-version: |`) is read line by line. A workflow that does not parse is a FAIL. These are also a FAIL, not a skipped step: an input that is not a literal version (an expression like `${{ matrix.go }}`, a list or mapping); an empty input with no non-empty `-file` or version input beside it; an unquoted number that YAML reads differently from its text (`go-version: 1.20` reaches the action as 1.2, so quote it); a merge key (`<<:`) in `with:`; an alias with no anchor; and a `uses:` of the action outside a steps list. Keywords (`latest`, `stable`, `lts/*`, ...) are unsupported forms, as the matrix says. A step that uses the action but sets neither its version input nor its `-file` (no `with:`, an empty `with:`, or a `with:` with neither key) is never skipped, even beside a pinned step in the same or another matched workflow: setup-go and setup-node FAIL `<action> step without a version in <file>:<line>`; setup-python reads `.python-version` (FAIL when absent); golangci-lint-action reads the golangci-lint version in go.mod; goreleaser-action reports its default `~> v2` as a range. Each rule follows the action's upstream source (setup-go v7.0.0, setup-node v7.1.0, setup-python v7.1.0, golangci-lint-action v9.3.0, goreleaser-action v7.3.0).
A job that calls a reusable workflow (`jobs.<id>.uses`) is not read, and its `with:` inputs are never compared (their names belong to the called workflow). Under a glob, a workflow with no step that uses the action is skipped; when it calls a reusable workflow and another matched file gives the value, it adds an uncounted INFO row `<kind>:<file>: job <id> calls reusable workflow <ref> (line N), whose with: inputs are not read`. When no matched file gives a value, the FAIL names the files (up to 5, then `(+N more)`) and each one's reusable calls, and a named file with no step but a reusable call says so in its message and fix.
For node sources a single semver `=` is a pin (`=20.11.1`, `= v20.11.1`); `==` and, in `.python-version`, `=` are ranges. A value must start with a version (optionally `v`): implementation or keyword values that merely contain digits (`pypy3.9`, `graalpy-24.0`, `lts/-1`, `node:lts-alpine3.20`) are unsupported forms, never read as a version.
`pyproject.toml` and `Pipfile` are parsed as TOML (dotted keys and inline tables count); invalid TOML, a non-string value or a missing key is a FAIL. A named file that holds no version for the tool (a go.mod with no `go` line, a .tool-versions without the tool) is a FAIL. When a step sets both `<tool>-version` and `<tool>-version-file`, only the direct input is read and the file is ignored (it may even be missing), as the setup actions do.
Prereleases keep their identity: `22.0.0-rc.1`, `3.13.0rc1` and `1.26rc1` do not equal their release under `exact` (nor does `22` under `exact`). Under `minor`/`major` a prerelease is ignored only when it follows more components than the compare depth. So `22.0.0-rc.1` and `3.13.0rc1` match their line under `minor`, but a two-component prerelease such as `1.26rc1` or `3.13-dev` stays distinct from `1.26` and `1.26.x` under `minor`, as does `22-rc.1` under `major`. Only known prerelease shapes count: `-alpha`, `-beta`, `-rc`, `-pre`, `-preview`, `-dev`, `-next`, `-nightly`, `-canary`, `-snapshot`, `-ea`, and the attached PEP 440/Go forms `rc1`, `a2`, `b1`, `.dev0`. Any other suffix ends the version, both in Dockerfile `FROM` tags and in local `--version` output (an `ARG <TOOL>_VERSION=` value is classified as written, like any other pin, so `20-alpine` there is unsupported and `20-dev` is a prerelease): image variants (`-alpine`, `-slim-bookworm`, and a bare `-dev` straight after the version, the Chainguard/Wolfi dev image, so `node:20-dev` reads as 20; `-dev` followed by a number still counts as a prerelease), patchlevels (`3.1.4p223`), build ids, vendor suffixes (`-desktop.1`) and package revisions (`-1`).

Versions compare on the components both sides state, so `1.26` equals `1.26.1` under `exact`;
every pair of pins must agree, and the pin is the most specific one (a range never becomes the pin).
A configured source that is missing or yields neither a pin nor a range for the tool is a FAIL, never a PASS.
A Dockerfile is read as Docker reads its instructions: a line ending in `\` continues the instruction; a full-line
comment (`# …`) is dropped and never continued (inside a continued instruction it is dropped without ending it), as is
an empty line inside a continuation; the body of a `RUN`, `COPY` or `ADD` heredoc (`<<EOF`, `<<-"EOF"`, `<<\EOF`, `<<E"OF"`; a `<<` inside quotes is not one) is skipped up
to its delimiter line, and an unterminated heredoc is a FAIL, also on an instruction still open at end of file. Only the
default `\` escape is read: an `# escape=` parser directive that sets another escape character is an unsupported FAIL. An error names the physical line of the offending image
or value.
`a.local.*` runs the tool with `GOTOOLCHAIN=local GOPROXY=off MISE_AUTO_INSTALL=0` (`go version`, `node --version`,
`python3 --version`, otherwise `<tool> --version`), so Go downloads no toolchain and a mise shim installs no missing version; a probe that does
not answer in 10s is killed and reported as timed out at the pin's `local` level. The local version must
match the pin at the `compare` depth; ranges do not bind it. A probe that gives no version says why: `<tool> not found on
PATH`, `<path> could not start (missing interpreter in its #! line?)` (a file on PATH whose `#!` interpreter is not
there, which the OS reports as it does a missing file), `<cmd> could not run (<error>)`, `<cmd> exited <code>: <first output line>`, or `<cmd> printed no version:
<first output line>`; the output line is cut to 120 characters with control characters escaped. When a `.tool-versions`
line pins the version as written (`golangci-lint 1.62.2`), the fix names `asdf install <tool> <version>` and
`mise install <tool>@<version>`; for `go` and `node`, whose line may say `golang` or `nodejs`, it names a bare
`asdf install` (or `mise install`) in that file's directory. Any other pin source, and a prerelease written as is
(`golangci-lint 2.0.0-rc.1`), keeps the generic install fix.
`d.tools` never runs a listed tool. A tool found on PATH that is an asdf shim (a script with a `# asdf-plugin:` header
line) or a mise shim (a symlink to the mise binary) is checked by asking its manager: `asdf which <tool>` or
`mise which <tool>`, from the repo root with a 10s limit. An asdf shim that execs asdf by an absolute path asks that
asdf; otherwise asdf is looked up on PATH. A shim whose manager is not there, cannot run (`<manager> at <path> could not start (missing interpreter in its #! line?)`
for a manager whose `#!` interpreter is missing), times out, exits non-zero (its first output
line is shown, escaped) or prints no path is a FAIL row of its own, after any `missing on PATH` row. The one
exception follows mise's own fallback: a mise shim whose `mise which` exits non-zero still PASSes when an executable
copy of the tool that is no shim (neither asdf nor mise) sits on PATH after the shim's own directory, since the shim
runs that copy; the copy is found, never run. asdf has no such fallback.
The shim handling was checked against a real mise (2026-11-04): mise v2026.11.0 (linux-arm64 release binary,
sha256 verified) in a throwaway container from node:22.12.0-bookworm-slim
(sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213, linux/aarch64, Debian 12), with a tool
installed through mise but active in no config, a system copy later on PATH, and the mise shims first. In that
state the shim does not fail: it runs the later copy on PATH (exit 0), while `mise which <tool>` exits 1
('... is a mise bin however it is not currently active'). The 0.7.0 engine FAILed that state though the tool runs;
d.tools now PASSes it by the fallback rule above. With no later copy, the shim exits 1 ('No version is set for
shim') and d.tools FAILs it. The macOS mise build was not probed; the shim code is shared.

**Compose project (`e.project`, `mode = "test"`).** loops asks Compose, never parses for it:
`docker compose [-f <configured files>] config --no-env-resolution --format json` reads `name`. For each checkout
it asks up to three runs without `-p`: the configured `-f` run (when that checkout has every file), plain
`docker compose` from the first configured file's directory (or its nearest existing ancestor; Compose walks up from
there), and plain `docker compose` from the checkout root (when that is another directory); a run that finds no
compose file is no answer. From a worktree it asks this checkout, the main checkout and every other worktree whose
directory exists; from the main checkout, only the main checkout.
Other checkouts are asked without any `COMPOSE_*`; this checkout with your shell as is and, when your shell sets
any `COMPOSE_*` (even empty), again without them. Every run sets `COMPOSE_EXPERIMENTAL_GIT_REMOTE=0`,
`COMPOSE_EXPERIMENTAL_OCI_REMOTE=0` and `GIT_ALLOW_PROTOCOL=file` over your shell and any `.env`, so a remote (git or
OCI) `include:` or `extends.file:` is never fetched; such a file is a failed run (below). A checkout's **name** is your shell's non-empty
`COMPOSE_PROJECT_NAME`, else a worktree's derived name, else the main checkout's configured answer. Seen from a
worktree, the main checkout holds its answers and every other worktree holds its derived name and its answers (a
deleted one, its derived name); seen from the main checkout, worktrees hold their derived names. e.project runs
every check and reports every FAIL, the ones that withhold the name first, except that a missing configured file, an
invalid shell `COMPOSE_PROJECT_NAME`, a bad `git worktree list` and a failed `docker compose version` end evaluation
and are reported alone:
- a configured file missing here, a shell `COMPOSE_PROJECT_NAME` Compose rejects (it takes lowercase letters,
  digits, `-` and `_`, a letter or digit first; checked before asking Compose, even when Compose is unavailable), a
  `git worktree list` that fails or, from a worktree, does not list the main checkout first (fix: rerun
  `git worktree list --porcelain`), the name held by another checkout, or (main) equal to a worktree's derived
  name: FAIL, and the name is withheld;
- a container of the name started from another checkout's project directory or from outside every checkout
  (`working_dir` label): FAIL, withheld; a container of one of this checkout's answers: FAIL, the name is kept. The
  fix steers this checkout off that project (export another `COMPOSE_PROJECT_NAME`, or always pass `-p`) and names
  the stack's directory; it offers `docker compose -p <p> down` only when the `working_dir` label is missing or its
  directory is gone, since a stack whose directory exists may be running there on purpose;
- a worktree run without `-p` that would use a project other than its name, its derived name or (from its root)
  its own directory name, or a held one: FAIL, the name is kept; the fix names the `.env` to edit, or export
  `COMPOSE_PROJECT_NAME`, or always pass `-p` (unset an empty `COMPOSE_PROJECT_NAME` first).

`docker compose version` not found, or exiting non-zero with the Compose plugin absent (stderr says `unknown flag:
--short`, `'compose' is not a docker command` or `unknown command: docker compose`), is a SKIP; any other non-zero
exit (a daemon error, say), timing out, being killed or being refused (EACCES) is a FAIL, withheld. Any other Compose failure is a FAIL whose fix is the command to rerun as
`config --no-env-resolution -q` (Compose's error and exit, never the resolved model with its `.env` values),
directory and environment included, with the remote loaders off, or "upgrade Compose" when it is too old; a run that
exits 0 with unusable JSON or no project name has no error to rerun, so its fix says to check `docker compose version`
and upgrade Compose. loops does not copy Compose's output. Compose's own error line can still echo an interpolated value (`invalid containerPort:
<value>`), so read the rerun's output before sharing it. That FAIL withholds the name
when the failed run is another checkout's or the main checkout's configured run, and keeps it when it is one of this
checkout's other runs. If `docker ps` fails, the running-stack check did not run and the Result says so; if it times
out, that is a FAIL, withheld. `--static` / `CI=true` never ask Compose; `--compose-project` always does: exit 0 and
the name when it is kept (a warning on stderr for each FAIL that keeps it), exit 1 when it is withheld or unknown.
Verified with Compose v5.1.2, v5.5.0 and v2.38.2 (needs `config --no-env-resolution`; v2.38.2 also fails on a
missing `env_file`; the remote-loader switches are verified locally on v5.5.0, and CI's corpus covers its runner's
Compose). From a worktree: up to 9 + 3·peers probes of about 50 ms each, plus `docker compose version` and one
`docker ps`.

Not covered:
- Another checkout's exported shell `COMPOSE_PROJECT_NAME` (the main checkout's or a worktree's) is invisible to
  loops; the running-stack check catches it only while a container of that stack exists.
- Named volumes of a stack whose containers were removed are not seen by the running-stack check (the asked names
  still cover them).
- Plain runs from other subdirectories (per-service compose files) are not asked.
- Only `docker compose` is asked; a standalone `docker-compose` binary is not.
- Compose versions other than v5.1.2, v5.5.0 and v2.38.2: only the "no configuration file provided" and too-old wordings
  are pinned.
- A stack started with a root `.env` `COMPOSE_FILE` leaves the same labels as `-f <file>`, so the `b.containers`
  repair may miss that `.env`.
- The running-stack check does not run when `docker ps` fails (the PASS, or the first FAIL, says so).

```
                 .loops/env-check.toml ─┐
  git worktree list ──► checkouts ──────┼──► composeProject (policy, env-checks.ts)
                                        │        │ docker compose version once: not found / plugin absent → SKIP; other exit ≠ 0, timeout → FAIL
                                        │        │ runs (no -p): configured -f, plain from the first file's dir, plain from the root
                                        │        │ own: shell as is (+ again without COMPOSE_*) ──► compose-config.ts ──► docker compose config
                                        │        │ from a worktree, main + peers: no COMPOSE_*     {name|noFile|error}   --no-env-resolution --format json
                                        │        │ every run: remote loaders off (git/OCI include, extends.file → failed run)
                                        │        │ docker ps -a --format (Compose labels) ──► running stacks of the name and the answers
                                        │        ▼
                                        │   PASS N (COMPOSE_PROJECT_NAME | derived: slug-hash|dirname | compose)
                                        │   | every FAIL, withholding ones first (loops' text; fix = `config -q` rerun) | SKIP unavailable
                                        │        │
                                        └──► b.containers (same docker ps listing; skipped on any e.project FAIL)
  --compose-project ─► composeProject ─► stdout name: exit 0 kept (+ stderr warnings), 1 withheld or unknown
  --static / CI=true ─► compose files present only  (never asks Compose or docker; --compose-project is the exception)
```

`e.container_name` WARNs on a fixed `container_name`
unless allowlisted, reading each service's key from the parsed files (flow mappings, quoted keys and merge keys count;
a block scalar's text does not), and WARNs when a configured compose file cannot be parsed. Under `mode = "none"`, `e.none` counts any tracked `compose` or `docker-compose` file
in any directory and any letter case, bare or with a `.` suffix (`ops/compose.prod.yaml`). A `-` suffixed name
(`docker-compose-dev.yml`) counts only when the file, its documents merged as Compose merges them, has a top-level Compose key (`services`,
`include`, `networks`, `volumes`, `configs`, `secrets` or `models`, also through a `<<` merge key), holds only keys
Compose allows (`name`, `version` and `x-*`, as in a `name:`-only overlay; `version` alone is an empty file to
Compose), or cannot be read or parsed as YAML, so a workflow such as
`.github/workflows/compose-lint.yml` does not.

`b.containers` (compose `mode = "test"` with `inputs`, not under `--static`, skipped on any `e.project` FAIL) reads
the running containers of this checkout's project (`com.docker.compose.project` label) from e.project's
`docker ps -a` listing, and compares their creation time (whole seconds, so a container created just after a change
within the same second can read as stale) with the newest change to an `inputs` glob: the
later of the newest commit touching the inputs and the inputs' modification times on disk, so a pull,
merge or checkout that brings in an older-dated commit, or an uncommitted edit, still counts (a
checkout that rewrites an unchanged input can flag a fresh container; recreate the containers to clear it,
since a rebuild that hits the build cache leaves them running).
A container older than that change, or whose creation time loops cannot read, is `containers` severity (FAIL by default; when a stale container's time is unreadable and the level is FAIL, the fix also says to set `[compose] containers = "warn"`, since recreating the stack prints the same unreadable time); so is
a `git log` over the inputs that fails or prints no time (an empty log is the SKIP), and so is a tracked input whose
modification time loops cannot read (deleted from the working tree, or unreadable): `loops cannot read the
modification time of <file>`, never counted as time 0. The fix recreates the stack the
way it was started, run from the checkout root:
`docker compose -p <project> -f <file>... [--project-directory <dir>] [--env-file <file>]... up -d --build --force-recreate`.
It reads the stale containers' Compose labels when they all carry the same `config_files`, `working_dir` and
`environment_file`. The `-f` files are the `config_files` label (the override Compose loaded included), split only on
a comma that starts a new absolute path, when every entry is absolute and still exists; otherwise the configured
`[compose] files`. `--project-directory` is added when `working_dir` differs from the first file's directory as Compose spelled them,
and one `--env-file` per `environment_file` entry. Paths spelled under the checkout root print relative to it, as
Compose recorded them: a symlinked directory keeps its name, because Compose resolves `../` paths against it as
spelled, and a path recorded through another spelling of the root prints absolute. Docker present but
Compose unavailable, with no shell `COMPOSE_PROJECT_NAME`, leaves the project unknown in the main checkout (SKIP). Docker missing or down (`docker ps`
fails), no running container, or no commit touching the inputs is a SKIP, never a WARN.

**Local check protocol.** A `[[local]]` check is run with the repo root as cwd, no arguments, and
a timeout. It must be read-only, offline, and never print secret values. `env-check` runs the repo's own code
(local checks, `<tool> --version`), so run it only in checkouts you trust, as you would `make`.
`timeout_s` stops the check with SIGKILL (a trapped SIGTERM cannot outlive it). The check runs in its own process group, and
the timeout kills the whole group, so a child it started (`go` under a shell) does not keep running. A small node
supervisor in env-check's own process group starts the check and holds the deadline; it also kills the check's group
with SIGKILL when env-check is interrupted (Ctrl-C at the terminal, or SIGINT, SIGTERM or SIGHUP) and when env-check
dies while the check runs, so an interrupted run leaves no check behind. A child that leaves the group (`setsid`)
is out of its reach. A child it leaves
running when it exits on its own can hold the run open, so `exec` long commands. It prints one line per
result on stdout:

```
(PASS|WARN|FAIL|SKIP|INFO) <id> <message>[ — fix: <fix>]
```

`<id>` must be the configured id or `<id>.<name>`. The fix starts at the first ` — fix: ` (` -- fix: ` also works);
later ones belong to the fix (escaped in text output). An empty fix counts as none, so a WARN or FAIL gets the default `address the message
above and re-run`. Trailing whitespace is ignored, so CRLF line endings are fine; tabs are allowed. The environment has `ENV_CHECK_ROOT`,
`ENV_CHECK_MODE` (`full` or `static`), `ENV_CHECK_WORKTREE` (`1` when this is not the main checkout, a `cp -R` copy
included, which a configured `c.shared` FAILs; `0` in the main checkout; empty when git could not be read; the same under `--static`), `ENV_CHECK_PROJECT`
(the name `--compose-project` would print: empty when `e.project` withholds it, when it is unknown and under `--static`), `ENV_CHECK_ID`, `GOPROXY=off`, `GOTOOLCHAIN=local`,
`MISE_AUTO_INSTALL=0` (mise's `auto_install` setting, which per upstream jdx/mise `settings.toml` also turns off its exec and
not-found auto-install, so a shim never installs a missing version), `NO_COLOR=1`.
It fails closed: an unparseable line, a line with a control character other than tab (ESC, a mid-line CR, NUL…), a Unicode line
separator, a bidi control or a zero-width space included, is `FAIL <id>.protocol`, which echoes it as a double-quoted string cut to 80 characters, with `\`,
`"`, control characters, the dash of a `— fix:` and the first dash of a `-- fix:` escaped (`\r`, `\u001b`, `\u2014`, `\u002d`), so the output line still has one fix; no lines is a FAIL (`could not start (missing interpreter in its #! line?)` when the check's `#!` interpreter is not there,
`could not run (<signal or error>)` when it was killed); a nonzero
exit without a FAIL line adds one (with the first stderr line, cut to 120 characters and escaped the same way, unquoted);
a timeout adds a WARN, "not a pass",
after any lines printed before it (so a FAIL printed before the timeout still counts).

**Wrapper.** `templates/env-check` is a 27-line POSIX `sh` wrapper to copy into a repo as
`bin/env-check` (`chmod +x`). It runs the first regular file among `$LOOPS_BIN`, `$HOME/bin/loops` and
`loops` on PATH as `loops env-check "$@"` (through `node` when the file is not executable). Exit codes of its own:

| Exit | When | Output |
|---|---|---|
| 1 | an engine exists but `node -e 0` fails (`node` not on PATH, or an asdf/mise shim with no version set) | `FAIL d.tools  node not runnable here (...) — fix: ...` on stderr, nothing on stdout |
| 2 | `LOOPS_BIN` is set but is not a file, or a candidate is a dangling symlink | `env-check: LOOPS_BIN=<x> is not a file` or `env-check: <path> is a broken link (target missing)` on stderr, nothing on stdout; it never falls back to another engine |
| 3 | no engine is installed | a hint on stderr, `env-check: not run` on stdout; contributors without the engine can ignore it |

Any other exit code comes from the engine.

## Roadmap

Per-repo metrics landed in 0.3.0 and the `loops` CLI in 0.4.0. Still to come: CI rounds per PR, hook blocks, and the
unrouted-spawn share, as their sources come online.

See [`docs/wave0-plan.md`](docs/wave0-plan.md) for the reviewed Wave 0 design and its open items.
