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
{"schema":1,"version":"0.4.0","generated_at":"…","window_end":"…",
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
with the rows that matched). Renames count both sides; deletions count. An empty change prints
`zone: none`.

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
are not counted. Results with the same level and message fold into one line that ends
`(also: <ids>)`, so one root cause is one FAIL. Every WARN or FAIL carries a fix. Flags:
`--static` (also implied by `CI=true`), `--json`, `--quiet` (WARN and FAIL plus the summary),
`--compose-project` (print the Compose project name for this checkout, exit 1 if it cannot be
resolved). `$HOME` is shown as `~` everywhere. `--json` is `{schema, engine, mode, root,
results: [{level, id, message, fix, also, source}], summary: {fail, warn, pass, skip}, exit}`.

`--static` reads repo files only: no toolchain, tool, docker or worktree probes (`a.local.*`,
`b.containers`, `d.tools`, `d.sparse` are not run, `c.shared` is SKIP, `e.project` does not resolve the name) and only
`[[local]]` checks with `static = true` run.

Unknown keys, wrong types, an unsupported `schema_version`, an `engine` range newer than this
CLI, a missing or non-executable local check, and bad TOML are all exit 2.

```toml
schema_version = 1
engine = ">=0.4.0"                      # only ">=X.Y.Z"; an older CLI exits 2 "update agentic-tools"

[shared_checkout]                       # c.shared: FAIL in the main checkout, PASS in a linked worktree
hint = "git worktree add .claude/worktrees/<name> -b <branch> origin/main"
                                        # ENV_CHECK_ALLOW_MAIN=1 downgrades the FAIL to INFO

[[pins]]                                # a.pins.<tool> (sources agree), a.local.<tool> (local toolchain)
tool = "go"
sources = ["go-mod:go.mod", "tool-versions", "setup-go:.github/workflows/*.yml"]
compare = "minor"                       # exact (default) | minor | major | floor
local = "warn"                          # warn (default) | fail | off

[[pins]]
tool = "node"
sources = ["nvmrc", "engines", "dockerfile:build/Dockerfile"]
compare = "floor"                       # engines is a floor; every other source must be >= it

[harness]                               # d.*
tools = ["git", "go", "make"]           # d.tools: on PATH
files = ["go.mod", "VERSION"]           # d.files: present and non-empty
entrypoints = "auto"                    # d.entrypoints: executable; "auto" = ./paths run by .github/workflows, or a list
tracked = true                          # d.tracked: no tracked file deleted, 100755 bits intact
sparse = "warn"                         # d.sparse: WARN when core.sparseCheckout is on

[compose]                               # e.*; omit the table for no compose checks
mode = "none"                           # none: FAIL if a compose file is tracked | test
files = ["compose.yml"]                 # test only: e.project and e.container_name
inputs = ["compose.yml", "docker/**"]   # test only: b.containers, globs over tracked files
containers = "fail"                     # fail (default) | warn: b.containers severity
derive = "dirname"                      # dirname (default) | slug-hash (<main>-<worktree slug>-<hash6>)
allow_container_name = ["app"]

[[local]]                               # a repo's own checks
id = "d.lint-lock"                      # <a-e or x>.<name>
run = ".loops/checks/lint-lock.sh"      # any executable; listed explicitly, never auto-discovered
static = true                           # also run under --static (default false)
timeout_s = 15
```

Pin source kinds are `kind` or `kind:path-or-glob` (a glob matches tracked files):

| kind | default file | reads |
|---|---|---|
| `tool-versions` | `.tool-versions` | the line for the tool (`node` also matches `nodejs`) |
| `nvmrc`, `node-version`, `python-version` | `.nvmrc`, `.node-version`, `.python-version` | the whole file |
| `go-mod` | `go.mod` | `toolchain` if present, else `go` |
| `engines` | `package.json` | `engines.<tool>`, as a floor |
| `setup-go`, `setup-node`, `setup-python` | `.github/workflows/*.yml` | `<tool>-version`, or the file named by `<tool>-version-file` |
| `golangci-action`, `goreleaser-action` | `.github/workflows/*.yml` | `with: version:` of `golangci/golangci-lint-action` (tool `golangci-lint`) or `goreleaser/goreleaser-action` (tool `goreleaser`); `latest` is no version |
| `dockerfile` | `Dockerfile` | `FROM <image>:<tag>` (image `golang` for go, else the tool name) and `ARG <TOOL>_VERSION=` |

Versions compare on the components both sides state, so `1.26` equals `1.26.1` under `exact`.
A configured source that is missing or has no version for the tool is a FAIL, never a PASS.
`a.local.*` runs the tool with `GOTOOLCHAIN=local GOPROXY=off` (`go version`, `node --version`,
`python3 --version`, otherwise `<tool> --version`), so nothing downloads. The Compose project
(`mode = "test"`) is `COMPOSE_PROJECT_NAME`, else the file's `name:` in the main checkout, else
the derived name in a worktree. `e.project` FAILs if a worktree would reuse the main checkout's
name or two worktrees derive the same one; `e.container_name` WARNs on a fixed `container_name`
unless allowlisted.

`b.containers` (compose `mode = "test"` with `inputs`, not under `--static`) lists this
checkout's running containers (`docker ps` by the `com.docker.compose.project` label) and
compares their `Created` time (`docker inspect`) with the newest commit touching an `inputs` glob.
A container older than that commit is `containers` severity (FAIL by default). Docker missing or
down, or no running container, is a SKIP ("stack down"), never a WARN.

**Local check protocol.** A `[[local]]` check is run with the repo root as cwd, no arguments, and
a timeout. It must be read-only, offline, and never print secret values. `env-check` runs the repo's own code
(local checks, `<tool> --version`), so run it only in checkouts you trust, as you would `make`.
`timeout_s` stops the check itself; a child it leaves running can hold the run open, so `exec`
long commands. It prints one line per
result on stdout:

```
(PASS|WARN|FAIL|SKIP|INFO) <id> <message>[ — fix: <fix>]
```

`<id>` must start with the configured id. The environment has `ENV_CHECK_ROOT`,
`ENV_CHECK_MODE` (`full` or `static`), `ENV_CHECK_WORKTREE` (`0` or `1`), `ENV_CHECK_PROJECT`
(the Compose project, or empty), `ENV_CHECK_ID`, `GOPROXY=off`, `GOTOOLCHAIN=local`, `NO_COLOR=1`.
It fails closed: an unparseable line is `FAIL <id>.protocol`; no lines is a FAIL; a nonzero exit
without a FAIL line adds one (with the first stderr line); a timeout is a WARN, "not a pass".

**Wrapper.** `templates/env-check` is a 15-line POSIX `sh` wrapper to copy into a repo as
`bin/env-check` (`chmod +x`). It runs `$LOOPS_BIN`, then `$HOME/bin/loops`, then `loops` on PATH,
as `loops env-check "$@"`. With no engine or no `node` it prints a hint on stderr, `env-check:
not run` on stdout, and exits 3, which contributors without the engine can ignore.

## Roadmap

Per-repo metrics landed in 0.3.0 and the `loops` CLI in 0.4.0. Still to come: CI rounds per PR, hook blocks, and the
unrouted-spawn share, as their sources come online.

See [`docs/wave0-plan.md`](docs/wave0-plan.md) for the reviewed Wave 0 design and its open items.
