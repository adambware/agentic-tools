# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **nightshift: non-gating planted-vuln eval (T14).** FPR only sees false positives, so a
  reviewer change that starts *missing* real issues reads as an improvement. The new
  `examples/novudesk/eval/` pairs a small NovuDesk target (4 planted, unambiguous
  vulnerabilities on real registry vectors + 3 clean control surfaces, no hints in the
  source) with an answer key kept outside the reviewed tree. `bin/eval-planted` scores a
  finished run's logged findings: caught/total and false-positives-on-clean. Report-only:
  it exits 0 whatever the score and nothing in CI runs a paid review. A planted vuln is
  credited as caught only to a finding filed under its own vector; a finding on a planted
  line under another vector no longer counts (it scores as other). `--run-id` exits 2 on records with no
  `run_id` (run candidate files) instead of filtering them all out and reporting 0/4.
  A finding that cites a planted file by bare or partial name (`tickets_controller.rb:7`)
  now matches when only one keyed file has that name, instead of always missing. A
  directory that holds several runs' `candidates.tier2.json`, or one beside logged
  findings, exits 2 rather than counting failed runs and pre-dedupe candidates.

### Fixed

- **nightshift: change detection diffs from the reviewed sha, not a date.** `git rev-list -1 --before=<last_reviewed>T23:59:59 HEAD` made any commit landing later on the same day as a review its own baseline, so its changes never reached `change_flag` until the surface went stale on age alone (up to 90 days for a low-weight vector). Registry entries now carry an engine-managed `last_reviewed_sha`, stamped by `bin/record` from `run.json.pack_sha` (left untouched when the run had no git), and `bin/select` / `bin/due` diff `<sha>..HEAD` directly. The date baseline remains only as a fallback for entries recorded before this field existed or a sha that no longer resolves (shallow clone, rewritten history). The sha comes from a registry committed in the reviewed repo, so anything that is not hex is refused both by `validate` and by the git runner itself: a value like `--output=<path>` would otherwise be parsed by `git diff` as an option.

## [loops 0.8.0] - 2026-11-12

`loops env-check` 0.8.0, PR A: Compose project policy v2. One worktree's broken Compose file no longer withholds the project name in every other checkout, and two `[compose]` keys cover a main checkout that runs other files or a wrapper-supplied `-p`.

PR B: pins. A pin can be checked against each range its sources declare, a source can be optional, `local` can pick a level per version component, a Dockerfile `FROM ${ARG}` is read, and `a.local` keeps reporting when the pins disagree and warns about an ambiguous asdf shim.

PR C: CI. A composite action runs `env-check --static` in a consumer's workflow, and `--require-checks` turns a check that stopped running (a deleted pin, a `[[local]]` that lost `static = true`) into a red build instead of a quiet pass.

PR D: local checks. A `[[local]]` can name the commands it `needs` and is skipped, not failed, where one is missing; an opt-in `d.node_modules` check catches an install that no longer matches `package-lock.json`; a check cut short gets SIGTERM and 2 s to clean up before SIGKILL, and its leftover processes are killed even if the supervisor dies; the wrapper's "engine not installed" hint now shows the install command.

### Added

- Composite action `plugins/loops/action.yml`, pinned by commit SHA (`uses: adambware/agentic-tools/plugins/loops@<sha>`). It runs `node bin/loops.mjs env-check --static --require-checks[=<ids>]` once from the consumer's checkout, prints the rows to the log with workflow commands paused, writes them to the step summary in a `text` fence longer than any backtick run in the output (also on exit 1), and exits with the engine's code. Inputs `working-directory` (default `.`, relative to `$GITHUB_WORKSPACE`) and `require-checks` (empty = bare `--require-checks`); no outputs. Node missing or older than 18 is exit 2 with `add actions/setup-node`; a Windows runner is exit 2. The logic is `scripts/action-env-check.sh`, which takes the inputs only as environment variables. The README's "Run the static checks in CI" has a complete workflow and a no-action fallback.
- `env-check --require-checks` (bare): `x.none` ("no check ran") is a FAIL, exit 1. `--require-checks=<ids>`: also each comma-separated id or glob (`a.pins.go`, `a.pins.*`) must produce at least one PASS, WARN or FAIL row, matched before rows are folded; an id in a built-in group (`a.` to `e.`) counts only env-check's own rows, never a `[[local]]` lookalike, and an exact id never matches a longer one. The space form (`--require-checks a.pins.go`), an empty value, a malformed or reserved id, and combining it with `--compose-project` are exit 2.
- New row `FAIL x.required  <id> not configured: no check produced this id`, or `<id> produced only SKIP/INFO rows (...)` naming up to three of them (for example `a.local.go`, which `--static` does not run). One row per unsatisfied id, in the order written, after `x.none`. `x.required` is reserved like `x.none`: a `[[local]]` with either id is exit 2. Both live in one `RESERVED_IDS` constant.
- CI: the `action-fixtures` job runs the action on `fixtures/env-check/clean` (passes) and `fixtures/env-check/mismatch` (fails, asserting the `FAIL a.pins.go` row), each copied into `$RUNNER_TEMP` as its own git repo.

### Changed

- Behavior change (exit code): a failed `docker compose config` probe of another checkout (a peer worktree, or the main checkout seen from a worktree) is no longer a FAIL that withholds `e.project`. It is one `WARN e.project` per peer ("... and N more runs"), the name is kept, and the fix says to run `bin/env-check` in that checkout or `git worktree remove` it when abandoned. The peer's own run still FAILs. `ComposeProject` gains `warnings`, shown after `results`, so `results[0]` keeps its meaning.
- Behavior change (output): `--compose-project` prints each peer WARN as an `env-check: warning: <message> — fix: <fix>` line on stderr, after any FAIL lines; it still prints the name, and a WARN never changes its exit.
- From a worktree, the main checkout's plain derived name is held when any of its runs fails, so a worktree whose directory shares the main checkout's basename never shares its volumes.
- For a peer's run that fails on interpolation or a non-zero exit, a fallback `docker compose config --no-env-resolution --no-interpolate --no-normalize --format json` (scrubbed env, remote loaders off, 10 s) reads `name:` as written. A literal name is held; a templated one is resolved from the peer project directory's `.env` alone (never the process env), with Compose's `:-` and `-` defaults, and held when every variable resolves, plus a `.env` `COMPOSE_PROJECT_NAME` that beats it; only when a variable stays unresolved is nothing held for it (the WARN says its name reads a variable loops could not resolve from that checkout's `.env`); with no `name:` the `.env` or directory name is held. Its answer is only ever held, never this checkout's name. Any fallback failure, including a Compose without `--no-normalize`, holds nothing; runs are deduped, and after one timeout the rest skip it.
- A Compose failure on a required variable (`${VAR:?}` or `${VAR?}`) is the new error kind `interp`. Only the variable's name is read from Compose's stderr; in this checkout the fix is to set it in the project directory's `.env` or export it, copying it from `.env.example` or asking the repo owner for a secret.
- When a worktree's `derive = "dirname"` name equals the main checkout's, the FAIL names both paths and the fix offers `git worktree move` (when the project directory is the worktree root) or `derive = "slug-hash"`, warning that slug-hash renames every worktree's project, so their stacks stop first (`down`, without `-v`).
- New `[compose] main_project = "<name>"`: the `-p` name the repo's wrappers give the main checkout. It is the main checkout's name (Compose's answer need not match) for `e.project`, `b.containers` and `ENV_CHECK_PROJECT`, and it is always held from worktrees. A main-checkout shell `COMPOSE_PROJECT_NAME` that differs is a FAIL that withholds the name. The value must be a Compose project name (exit 2 otherwise). In a main-checkout run with `main_project` set, a failure of the main checkout's own configured run is still a FAIL but no longer withholds the name (the wrapper supplies `-p`), a deliberate reading of A4.
- New `[compose] main_files = [...]`: the main checkout's file set (default `files`), used by its runs, project directory, derived name, the missing-file check, the `container_name` scan and the `b.containers` fix, also when a worktree probes the main checkout.
- The unknown-key config error says a newer key needs a newer engine and an `engine = ">=0.8.0"` floor; the engine-floor error adds "stable checkout: git pull; CI: bump the action's pinned SHA".
- CI's compose-differential preflight fails unless `docker compose config --help` lists `--no-env-resolution`, `--no-interpolate` and `--no-normalize`.
- New `[[pins]] range = "check"` (default `"info"` keeps the INFO row): each distinct range a source yields (`engines`, `requires-python`, Poetry's `python`, a Pipfile range, setup-* range inputs, goreleaser-action's default `~> v2`) is checked against every distinct pin, a series pin standing for every release it names (covered also when only the union of `||` alternatives covers it, and outside when its overlap with the range holds no release, as `>20.0.0 <20.0.1` for pin `20`). The row is the worst result: `FAIL` if any pin is outside, else `WARN` if any is only partly inside (pin `20` against `>=20.11`), else INFO if a pin cannot be checked, else `PASS`; with more than one distinct pin it names the pin and its sources. Rows keep the id `a.pins.<tool>`. npm and Actions ranges are read as semver; Python packaging ranges as PEP 440 (`>3.11` is `>3.11.0`, `<=3.11` is `<=3.11.0`, `==3.12` is `3.12.0`, `~=3.11` is `>=3.11.0 <4.0.0`, `,` is and). `!=`, `===`, a prerelease, a PEP 440 operator (`~=`, `==`) or `,` outside Python packaging metadata, an exact-looking value and any form semver rejects stay INFO `(not a form range = "check" reads)`, as does a prerelease pin or one semver cannot read (`20.01.0`); while the pins disagree each range stays INFO `(the pins disagree)`. The `compare = "floor"` removal error now points to `range = "check"`.
- New `[[pins]] optional = [...]`: sources, exactly as written in `sources`, that are read when present and skipped when absent (a missing file, or a glob that matches no tracked file). An entry not in `sources` is exit 2 naming it. A present optional source that is invalid still FAILs, and so does a missing source that is not optional. When every source is optional and none is present, the row is `SKIP a.pins.<tool> no source present (all optional: ...)` and no `a.local` row runs.
- `[[pins]] local` also takes a table, `{ major = "fail", minor = "warn", patch = "info" }` (each `fail|warn|info|off`; a missing component is `warn`). `compare` decides first, so a difference it accepts stays PASS; a rejected local version is reported at the level of its first differing numeric component (a prerelease-only difference is `patch`), and a probe that gives no version (tool missing, unrunnable, timed out, no version printed) at `major`. The string forms keep their meaning; any other value (also a TOML date) is exit 2. A TOML date where any config table is expected is now exit 2 as well (it used to read as an empty table).
- Behavior change (rows): when the pins disagree (`a.pins.<tool>` FAILs), `a.local.<tool>` still probes the tool and reports it against each distinct pin, one row per pin at its own level naming that pin's sources (`PASS` for the pin it matches), with the fix `align the pins first (a.pins.<tool>); env-check then names the version to install`. The row used to vanish.
- Behavior change (level): when the probed command is an asdf shim whose `# asdf-plugin:` header lines name more than one plugin with a version active here (`ASDF_<PLUGIN>_VERSION`, else the nearest `.tool-versions` walking up from the checkout, else `$HOME/.tool-versions`), `WARN a.local.<tool>  ambiguous shim: provided by <plugin> <v> and <plugin> <v> (shim <path>)` follows the version row (the whole shim is read, up to 1 MiB), with a fix to find and remove the stray copy and run `asdf reshim`. Nothing extra runs (no `asdf current`, no `installs/` scan); mise shims are not checked.
- Behavior change (exit code): a Dockerfile `FROM ${BASE}` (also `FROM $IMG:20` and `FROM ${BASE:-node:20}`) is resolved through the `ARG`s declared before the first `FROM`, as Docker does: the last definition in that scope wins, and a value may use earlier global `ARG`s. The result is read as that literal image, so a non-tool image is skipped, a tool image is a pin, and a tool image with an unsupported tag FAILs. Such a `FROM` used to be skipped (a Dockerfile with no other tool pin then FAILed `no <tool> version found`).
- A `FROM` image whose variable has no value in the global `ARG` scope (no default, an `ARG` declared only inside a stage, an empty value, another `${...}` modifier, or an expansion longer than 4096 characters) is `INFO a.pins.<tool>  FROM <image> (line N): image set at build time, not compared`, never a FAIL. That INFO never stands in for a pin. A stage of the tool image tagged `$<TOOL>_VERSION` whose `ARG` has no value still FAILs `no <tool> version found`, as in 0.7, also when the image reaches that tag through another `ARG` (`ARG BASE=node:${NODE_VERSION}` then `FROM ${BASE}`, or `FROM ${IMG}:${NODE_VERSION}`), even when another unset variable follows the tag (`FROM ${IMG}:${NODE_VERSION}-${DISTRO}`). A Compose `build.args` or `--build-arg` override of the default is not read.
- Fixed: golangci-lint-action `install-mode: ""` is read as unset (`binary`), so `go.mod` is read as the action reads it, instead of a false FAIL "step without a version".
- Behavior change (timing): a `[[local]]` check cut short (at `timeout_s`, or when env-check is interrupted or dies) gets SIGTERM, or SIGINT for a Ctrl-C, then 2 s (`GRACE_MS`) to exit, then SIGKILL; it used to be SIGKILLed at once. One routine serves the timeout, interrupt and orphan paths. It turns off the orphan poll and ignores a repeat signal, so the grace holds after a Ctrl-C has killed env-check itself and after the check's first process exits. Before each signal the supervisor walks `ps -A -o pid=,ppid=,pgid=,lstart=` from the check, so a `setsid` child whose parent is still running is killed too. A double-forked daemon already reparented to init is still out of reach. A pid the supervisor saw is signalled only while it still runs with the start time it had, so a pid freed and reused is left alone. `ps` is `/bin/ps`, else `/usr/bin/ps`, else the first `ps` on PATH. If env-check dies while the supervisor lives, the supervisor removes the run dir on its way out.
- New row `WARN <id>  supervisor lost; check group killed` (or `... belongs to another process, nothing killed` for a live group that is not this run's, or `... could not be verified, nothing killed`), fix `rerun once; report it if it repeats`: when the supervisor dies or overruns the backstop, env-check kills the check's group itself. The supervisor publishes `{pgid, startMs}` to a pidfile in a per-run temp dir (removed after the run), and env-check kills `-pgid` only when `LC_ALL=C ps -A -o pid=,pgid=,lstart=` (in UTC) shows every process in that group started no earlier than `startMs` - 2.5 s (Linux's `lstart` can read up to about 2 s early). The engine's backstop is the timeout plus the supervisor's worst case (two 5 s `ps` listings, the grace and the settle) plus 3 s. A FAIL the check printed before the loss stands (the supervisor keeps a copy of the check's stdout in the run dir), and the WARN is added only when there is none. `RunResult` gains `lost` and `cleaned` (`"yes" | "no" | "unverified"`).
- New `[[local]] needs = ["<command>", ...]`: command names (not paths; anything else is exit 2). When one is not on PATH, or is an asdf or mise shim that resolves no version here (the same check as `d.tools`), the row is `SKIP <id> <name> not installed` with an install hint and the check does not run. Under `--static` it is a PATH lookup only. As with any SKIP, a needs-SKIP does not satisfy `--require-checks=<id>` (`x.required` FAILs).
- Fixed: `[[local]]` checks and the `a.local` version probes run on the same git environment as env-check's own git calls: a foreign `GIT_DIR` and the other repo-local `GIT_*` variables are dropped, a hook's own existing `GIT_INDEX_FILE` and `GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT` are kept. They used to inherit every `GIT_*` variable raw.
- New `[harness] node_modules = "fail" | "warn" | "off"` (default `"off"`; full mode only): `d.node_modules` compares each tracked `package-lock.json` (lockfileVersion 2 or 3; any other is INFO `unsupported lockfile`) with `node_modules/.package-lock.json` on every package record's `version` and `integrity`, by content only. One row per lockfile names the first difference, with the fix `npm ci` in that directory: `node_modules/` missing, a version or integrity drift, a package not installed (a dev package's message names `--omit=dev`), or an installed package the lockfile does not list. A package npm skips on this platform (`os`, `cpu`, and `libc` on Linux) never differs; a missing optional package this platform could install is a WARN, never a FAIL. Workspaces compare only the root lockfile and root `node_modules`, and each member link must exist. No hidden lockfile is a WARN `cannot verify`.
- CI: a `macos-latest` job runs `src/lib/proc.test.ts`, so the `ps` parsing and the kill sequence are tested on both platforms.
- Build: `semver` 7.7.3 is bundled into `bin/` (a new exact dev dependency, with `@types/semver` 7.7.1); still nothing to install at runtime.

### Upgrade notes

- Peer FAIL becomes WARN. A peer checkout's failed Compose probe was a FAIL (exit 1, `--compose-project` exit 1 with empty stdout); it is now a WARN and the name is kept. Anything that relied on that FAIL should run env-check in the broken checkout.
- WARN lines on stderr under `--compose-project`: peer WARN lines appear on stderr. Scripts that treat any stderr as failure should check the exit code instead.
- Set the engine floor, `engine = ">=0.8.0"` in `.loops/env-check.toml`, when adopting any 0.8.0 key (`main_project`, `main_files`, `range`, `optional`, a `local` table, `needs`, `node_modules`). An older engine then says it is too old instead of failing on an unknown key.
- Not in this change: a Docker shim without Compose (podman-docker, exit 125) still FAILs `e.project`; it stays on the 0.7.2 review-notes TODO.
- A pin disagreement now also prints `a.local.<tool>` rows, one per distinct pin; a mismatching one is a WARN, or a FAIL (exit 1, as the disagreement already is) under `local = "fail"`.
- A Dockerfile whose `FROM ${VAR}` resolves to the tool's image now adds that pin, which can surface a disagreement (or an unsupported-tag FAIL) that 0.7.x never saw.
- A Dockerfile whose only image of interest is `FROM ${VAR}` with no value in the global `ARG` scope used to FAIL `no <tool> version found`; it is now the INFO `image set at build time`, and the row's verdict comes from the other sources (with no other source, `no exact pin among sources` still FAILs). The exception is the tool's own image tagged with its unset `<TOOL>_VERSION` `ARG`, directly or through another `ARG`, which still FAILs.
- `install-mode: ""` now unset: it reads as unset, so a versionless golangci-lint-action step with it reads `go.mod`, so its pin now joins the comparison.
- A machine with a stray copy of a tool behind an asdf shim (a `go install`ed binary next to the tool's own plugin) now gets a WARN; the exit code is unchanged.
- `d.tools` reads an asdf shim's exec line from the whole shim, up to 1 MiB, not only its first 4 KiB: a long shim (one header line per installed version) that execs asdf by an absolute path now asks that asdf instead of the one on PATH.
- Not in this change: B7 (a workflow that runs Go with no `setup-go`) was cut to a TODO.
- Not in this change: D5 (`d.entrypoints` auto plus an extra list, and pre-commit `language: script` hooks) was cut to a TODO.
- `d.node_modules` is opt-in. Every tracked `package-lock.json` counts, a test fixture's too.
- SIGTERM + 2 s grace before SIGKILL: a `[[local]]` check cut short now gets SIGTERM + 2 s grace before SIGKILL (SIGINT for a Ctrl-C), so a timed-out run can take up to 2 s longer. A check that cleans up on SIGTERM now gets the chance; one that ignores it is still killed.
- A lost supervisor is a WARN. When a `[[local]]` check's supervisor dies (killed, out of memory) before the check times out or prints a FAIL, the row is now WARN `supervisor lost`, after the engine kills the check's group. In 0.7 a check killed that way read FAIL `could not run`.
- Re-copy the wrapper: copy `plugins/loops/templates/env-check` over your `bin/env-check` (`chmod +x`). Its exit 3 hint now carries the `mkdir -p ~/bin && ln -sf` install line and the full README install URL instead of `see CONTRIBUTING.md`. The engine is unchanged by this, but a repo keeps the old hint until it copies.
- `x.none` FAIL under `--require-checks`: in either form, a run that checks nothing is `FAIL x.none`, exit 1; without the flag it stays a WARN, exit 0, as in 0.7.
- `--require-checks` is a flag, not a config key, so `engine = ">=0.8.0"` in `.loops/env-check.toml` cannot make an older engine accept it: an engine before 0.8.0 exits 2 `unknown flag --require-checks...`. (flags are read before the config, so the floor is never reached). Pin the action, or the fallback's checkout, at an agentic-tools SHA that has the flag, and add the flag and move the pin in the same change.

## [ship-lean 1.0.0] - 2026-11-09

New plugin: a lean overlay for gstack's `/ship` skill, packaged from a
previously hand-installed set of `~/.claude` files so the hook and agent register
natively via `${CLAUDE_PLUGIN_ROOT}` — no machine-specific paths, no manual
`settings.json` edit.

### Added

- `UserPromptSubmit` hook (`hooks/ship-playbook-hook`, python3, fail-open) that
  injects a short overlay note when the prompt is an interactive `/ship`. Trigger
  is `^/ship(\s|$)` only; the natural-language form is off unless `SHIP_HOOK_NL=1`.
  Overlay and reviewers-workflow paths are resolved from `${CLAUDE_PLUGIN_ROOT}`;
  on a non-match, unset root, or any error it emits nothing and exits 0 — it never
  blocks or alters a prompt.
- `ship-lean-reviewer` agent, addressed as `ship-lean:ship-lean-reviewer` (`Read, Grep, Glob` only — read-only is harness-enforced)
  and `playbooks/ship-lean/reviewers.workflow.js`, the parallel read-only fan-out
  (per-lens `{lens, ok, findings}`, no silent lens drops, severity `CRITICAL|INFORMATIONAL`).
- `playbooks/ship.md`, the ~1-page overlay. `SKILL.md` stays authoritative; it
  overrides only Step 9 specialist dispatch + Step 11 adversarial pass (as a read-only
  parallel Workflow over an out-of-repo patch) and the push gate, which fails toward
  "Stop here — nothing pushed." Includes a degrade-to-standard path for when the
  Workflow can't run (lean is interactive-only).
- `scripts/migrate-from-manual-install.sh` (dry-run by default) and a README
  MIGRATION section: enabling the plugin while the old manual install is present
  double-fires the hook and duplicates the agent, so the manual files and the untagged
  `settings.json` `UserPromptSubmit` entry must be removed first. The script removes only the
  `ship-playbook-hook` command, so other hooks in the same matcher group stay.
- `test/ship-lean-test.sh`: hermetic, no-auth checks of the plugin's hook via
  `${CLAUDE_PLUGIN_ROOT}` (trigger matrix, fail-open, plugin-resolved paths), static
  manifest/JSON/syntax validation, and the `W` invariant (conditional on `gstack-wtree`).
  Wired into CI via `tests/ship-lean-test.sh`.

## [loops 0.7.1] - 2026-11-04

`loops env-check` 0.7.1 is a fixes-only release. Every row is escaped once, at the output edges. `c.shared` proves a worktree owns its git metadata instead of trusting `git rev-parse`. Several checks that used to pass or skip silently now fail or say why. Features the pilots asked for are listed in `TODOS.md` for 0.8.0.

### Changed

- Behavior change (exit code): `c.shared` PASSes a linked worktree only when it is registered in `git worktree list` and `<git-dir>/gitdir` names this folder. A `cp -R` copy (also one over another registered worktree) FAILs "copied?" with a recreate fix, and a moved worktree FAILs "moved" with `git worktree repair`. An inherited `GIT_DIR` or `GIT_WORK_TREE` naming another checkout FAILs; a `GIT_DIR` that names a `.git` gitfile is followed as git does, and the one git sets inside a hook is silent. A failed `rev-parse` or `worktree list` FAILs "could not read git metadata" in every mode instead of guessing. These come before `ENV_CHECK_ALLOW_MAIN`.
- Behavior change (exit code): `e.project` withholds the Compose project name (FAIL "could not read git metadata") when `git rev-parse` fails, instead of giving a linked worktree the main checkout's name.
- Behavior change (exit code): a `setup-go` or `setup-node` step with neither its version input nor its `-file` input is a FAIL "<action> step without a version in <file>:<line>", also beside a pinned sibling, where it used to be skipped. `setup-python` reads `.python-version` as its implicit file, `golangci-lint-action` reads the golangci-lint module version from `go.mod` (from v6.5.0, in `install-mode: binary` only, and only a `go.mod` inside the checkout), and `goreleaser-action` records its default `~> v2` as a range.
- Behavior change (exit code): Dockerfile pins fail closed. An `ARG` line is split into words as Docker splits it, so an escaped quote no longer hides the next pair; an unterminated quote on a line naming `<TOOL>_VERSION` is unsupported; a `FROM` tag whose `$` may continue a prerelease (`node:20-dev-${N}`) or names any variable other than `<TOOL>_VERSION` is unsupported instead of read or skipped.
- Behavior change (level): `x.none` fires when every counted row is SKIP, not only when no row is counted. The exit code stays 0, and the wording follows `--static`.
- Behavior change (exit code): `d.tools` PASSes a mise shim whose tool is installed but active in no config when an executable copy that is not a shim follows it on PATH, because mise's shim runs that copy (verified against mise 2026.11.0 on linux/aarch64). Without such a copy, for any other mise error (an untrusted or broken config), and for asdf, it still FAILs.
- `--static` now probes the worktree, so a static `[[local]]` gets the `ENV_CHECK_WORKTREE` that full mode exports instead of 0 inside a worktree. It is the empty string when git metadata is unreadable. `c.shared` still SKIPs under `--static` unless that read failed.
- env-check's git commands run on a clean git environment (the `git rev-parse --local-env-vars` set is dropped), so an inherited `GIT_DIR` cannot point env-check at another checkout. As git's own `prepare_other_repo_env` does, command-scope config (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` and its `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, such as `safe.directory` in CI) is kept and `GIT_CONFIG` is dropped. `GIT_INDEX_FILE` is kept when it names a file directly in this checkout's own git-dir (the `index.lock` git hands a `git commit -a` pre-commit hook), so `d.tracked` no longer FAILs a deletion being committed; one naming another checkout's index or any other path is dropped. `loops zone` keeps its inherited git environment as before.
- The `a.local` probe and every `[[local]]` check run with `MISE_AUTO_INSTALL=0`, so a mise shim never installs a missing version while it is checked.
- A `[[local]]` check runs in its own process group, and its timeout kills the whole group with SIGKILL, so a child such as `go` under a shell no longer outlives it. Interrupting env-check (Ctrl-C, SIGINT, SIGTERM or SIGHUP) or killing it while a local check runs kills that group too, through a small supervisor process.
- An executable file that cannot start because its `#!` interpreter is missing is reported as that in `a.local`, `d.tools` and `[[local]]` checks ("could not start (missing interpreter in its #! line?)"), instead of "not found" or "printed no results".
- `templates/env-check` fails loudly: an explicit `LOOPS_BIN` that is not a regular file exits 2, a dangling candidate symlink exits 2, and a chosen engine that cannot run because `node` does not start writes a `d.tools` FAIL row to stderr and exits 1. Exit 3 stays for "no candidate". Consumers get these only when they re-copy the wrapper.
- `--compose-project`'s stderr warning (a FAIL that keeps the name) separates its fix with ` — fix: `, like every other row; it was `; fix: `. A script that matched `; fix:` on that line must match ` — fix: `.

### Fixed

- Every row is escaped once, at the edges: text rows and the `--compose-project` stderr lines go through one renderer that redacts and then escapes, and `--json` carries values raw (so an unparseable `[[local]]` line and quoted Compose fix arguments are no longer double-escaped), writing DEL, C1, U+2028/9, bidi and zero-width characters as `\uXXXX` so `JSON.parse` round-trips them.
- The CLI's exit-2 error line is redacted and escaped whole, command prefix included, so a hostile argument or git stderr cannot reach the terminal raw.
- U+061C ARABIC LETTER MARK is escaped like the other bidi controls in text and `--json` output, and a `[[local]]` line containing it is a protocol FAIL.
- `redactHome` replaces `$HOME` only where it is a whole path (`/Users/bob2`, `/Users/bob.old` and `/x/Users/bob/y` stay), redacts `$HOME` followed only by punctuation (a sentence's period, `...`) again, builds no pattern from `$HOME`, and redacts nothing when `$HOME` is not absolute.
- A `[[local]]` check that writes more than 64 KB to stderr no longer loses its result lines (a false "printed no results").

## [loops 0.7.0] - 2026-11-02

`loops env-check` reports more of what it cannot verify and fails closed in four places that used to pass. A run that checks nothing now says so, local-check output is sanitized, and probe failures say why.

### Changed

- Behavior change (exit code): `d.tools` FAILs a tool on PATH that is an asdf shim (a `# asdf-plugin:` header) or a mise shim (a symlink to the mise binary) when its manager resolves no version for this checkout. It runs `asdf which <tool>` or `mise which <tool>` from the repo root with a 10s limit and never runs the listed tool. An older asdf shim's `exec <absolute path> exec` is asked only when that path names `asdf`; otherwise asdf is looked up on PATH. A missing manager, one that cannot run, a timeout, a non-zero exit (first output line shown, escaped) or empty output each give their own FAIL row after any "missing on PATH" row. `--static` and `CI=true` still run no `d.tools` probe.
- Behavior change (exit code): `d.files` FAILs a directory, or any other non-regular entry (a symlink to a directory too), as "not a regular file". Every directory used to PASS whatever it held. Untracked files still pass: `d.files` checks the working tree, and tracking is `d.tracked`'s job.
- Behavior change (level): a run with no counted row (no FAIL, WARN, PASS or SKIP) adds a counted WARN `x.none` with a fix, worded for `--static` when that is why. The exit code stays 0. `x.none` is reserved: a `[[local]]` using it is a config error (exit 2).
- Behavior change (exit code): a local-check line containing a control character other than tab, a Unicode line separator, a bidi control or a zero-width space (CRLF line ends still pass) is FAIL `<id>.protocol`, including a line that ends in or is only such a character. A rejected line is echoed as a quoted, escaped string cut to 80 code points, and the stderr excerpt is escaped too, so relayed text cannot move the cursor or read as a second fix. A bare trailing `— fix:` is an empty fix, and the README documents the split at the first separator.
- Behavior change (level): `d.sparse` reads `core.sparseCheckout` as a git boolean (`yes`, `on`, `1` now WARN), PASSes when it is off, and WARNs `could not read core.sparseCheckout` on a failed or odd read instead of passing.
- `entrypoints = "auto"` with no `./` command in tracked workflows adds an uncounted INFO `d.entrypoints` row instead of nothing.
- `a.local` tells apart a tool not on PATH, a probe that could not run, a non-zero exit and an exit with no version, with the tool's first output line escaped and cut to 120 characters. When a `.tool-versions` line pins the version as written, the fix names `asdf install` / `mise install` (a bare `asdf install` in that file's directory for go and node).
- Workflow pin sources note a job-level reusable-workflow call (`jobs.<id>.uses`). Under a glob, a workflow that only makes such a call adds an uncounted INFO row when another file gives the value; otherwise the FAIL names the files (up to 5) and the calls, with a fix saying reusable inputs are not read. `with:` inputs of a reusable call are never read.

### Fixed

- `redactHome` ignores a trailing slash on `$HOME`, which left a bare home path unredacted.
- Pin rows escape tracked file names and config text, and the `.tool-versions` install fix shell-quotes the directory it names.
- Cutting relayed text to length reads no further than the cut, so one huge output line no longer costs memory in proportion to its length.

## [loops 0.6.0] - 2026-11-02

`loops env-check` `a.pins` compares exact pins only. Ranges are reported, not compared, and a value loops cannot read as a pin or a range is a FAIL that names its file and line. The README's pin source matrix is the only list of supported forms, and a test checks it against the code. Two fail-open paths from 0.5.0 now fail closed.

### Changed

- `a.pins.<tool>` compares only exact pins (one version or one series, such as `20.11.1`, `1.26`, `1.26.x`, `~1.26`, `^1`), pairwise at the `compare` depth. Range sources never enter the comparison: `engines.<tool>`, `requires-python`, Poetry's `python`, a range in a Pipfile, and a range in a `setup-*`, `golangci-lint-action` or `goreleaser-action` input. Each distinct range adds one INFO row, `<source>: "<value>" is a range, not compared`, after the verdict.
- Behavior change: with no exact pin among a tool's sources (for example `engines` only, or `pyproject.toml` only), `a.pins.<tool>` FAILs `no exact pin among sources (…); pin an exact version in a supported source`, and no `a.local.<tool>` row is reported. 0.5.0 passed on the floor.
- Behavior change: the `a.pins.<tool>` PASS row names only the pin sources it compared; each range source gets its own INFO row (`<src>: "<value>" is a range, not compared`) instead of being listed in the PASS row.
- Behavior change: a pin below an `engines` range is no longer a FAIL (`.nvmrc` 18.2.0 with `engines.node` >=20.0.0 now PASSes, with an INFO row), and `a.local` no longer checks the local toolchain against an `engines` floor. A planned `a.range` check will cover a pin inside a range.
- Behavior change: an unsupported form is a FAIL `unsupported form "<value>" in <file>:<line>; pin an exact version`. This covers aliases (`lts/*`, `latest`, `node`, `stable`, `system`), `ref:` and `path:`, words such as `pypy3.9`, a version followed by other text, and a Dockerfile `FROM` of the tool image with no tag, a digest only or a non-version tag. A `latest` input used to be skipped, and a tagless `FROM` used to be ignored. A `FROM` tag built from a build arg (`node:${NODE_VERSION}`) is still skipped, and its `ARG` is read instead. Dockerfile `FROM` and `ARG` lines may now be indented or continued with a backslash, and every `NAME=value` on an `ARG` line is read.
- Behavior change: a `setup-*` direct input that is a range (`>=20`, `~=3.12`) is an INFO row. It was a FAIL `is a range`. Plain version files (`.nvmrc`, `.node-version`, `.python-version`, `.go-version`) still FAIL on a range.
- Behavior change: a `<tool>-version-file` is read only when its file name is supported: `go.mod`, `go.work`, `.tool-versions`, `package.json`, `pyproject.toml`, `Pipfile`, `.nvmrc`, `.node-version`, `.python-version` or `.go-version`. Any other name is an unsupported FAIL. 0.5.0 read it as a plain version file. A `volta.<tool>` value that is not a string is a FAIL, and the reader no longer falls back to `engines`.
- `compare = "floor"` is removed and is now a config error (exit 2). Use `exact`, `minor` or `major`.
- Behavior change: a non-zero exit from `docker compose version` is a SKIP (`compose unavailable`) only when stderr shows the compose plugin is missing (`unknown flag: --short`, `'compose' is not a docker command`, `unknown command: docker compose`). Any other non-zero exit is an `e.project` FAIL that withholds the name. 0.5.0 read every non-zero exit as a SKIP.
- Behavior change: `b.containers` counts a running container whose `CreatedAt` loops cannot read as stale, and says so. It used to count it as fresh. A failed or garbled `git log` over tracked `[compose] inputs` is now reported at the `containers` level, where it used to be a SKIP `no commit touches the [compose] inputs`. Empty `git log` output is still a SKIP, and the `git log` call passes `--no-show-signature` so a `log.showSignature` setting cannot hide the commit time. A tracked input whose modification time loops cannot read (deleted from the working tree, or unreadable) is reported at the `containers` level, `loops cannot read the modification time of <file>`; 0.5.0 counted it as time 0. The `containers = "warn"` hint for an unreadable `CreatedAt` is added to the fix only at the FAIL level.
- Behavior change: a Dockerfile `ARG <TOOL>_VERSION=` value is its whole shell word and must be a pin as written, by the same rule as every other pin; quotes may wrap the whole value only. `"20 || 22"`, `20${SUFFIX}`, `"20"${SUFFIX}`, `${NODE_MAJOR}`, an empty value, `latest` and a variant such as `20-alpine` are unsupported FAILs; 0.5.0 read a version off the front of the value. A bare `-dev` in an `ARG` value is now a prerelease (`20-dev`); in a `FROM` tag it is still the Chainguard dev variant.
- Behavior change: a Dockerfile `FROM` tag that starts with `$` is still skipped. A tag whose literal version a variant separator ends before its `$` (`node:18-${DISTRO}`, `node:20-alpine${X}`) reads that version, and any other `$` tag (`node:lts-${X}`, `node:20.${MINOR}.0`, `python:3.13rc${BUILD}`) is an unsupported FAIL; 0.5.0 skipped both.
- Behavior change: Dockerfile instructions are read as Docker reads them. A full-line comment is dropped and never continued, so `# note \` no longer swallows the next instruction; a comment or empty line inside a continued instruction is dropped without ending it; a `RUN`, `COPY` or `ADD` heredoc body is skipped (a `<<` inside quotes is not a heredoc; its name has its quotes removed as the shell does, so `<<E"OF"` ends at `EOF`; an unterminated one is a FAIL, also on an instruction still open at end of file). An `# escape=` parser directive that sets an escape other than `\` is an unsupported FAIL, since only the default escape is read. An error names the physical line of the offending image or value, also when an `AS` clause is on a continuation line.
- Behavior change: the pin-only readers (`.tool-versions`, `go.mod`, `volta.<tool>`) accept every pin form (`=20.11.1` for node, `~20.11`, `^20`, `1.26.x`), and a range there is an unsupported FAIL with file and line. A `go.mod` `go` or `toolchain` directive is classified whole, up to a `//` comment, so `go 1.26 latest` is unsupported and `go ~> v1` is a pin.
- Behavior change: an empty or comment-only plain version file (`.nvmrc`, `.node-version`, `.python-version`, `.go-version`) is a FAIL `no version in <file>`, also when it is one of several glob matches beside a file that holds a version.

### Removed

- The hand-written range math in `pins.ts` (engines, PEP 440 and Poetry lower bounds, exclusive and prerelease bounds) and the floor compare mode.

## [loops 0.5.0] - 2026-11-01

`loops env-check` `e.project` asks Compose for every project name instead of re-implementing Compose's rules, and checks the configured run and the plain runs from the first file's directory and the checkout root. The outcome changes against 0.4.1 are listed under Changed; the README's Compose project contract is the whole rule.

### Changed

- `e.project` asks Compose: each run is `docker compose [-f <configured files>] config --no-env-resolution --format json` (10 s timeout, verified against Docker Compose v5.1.2, v5.5.0 and v2.38.2). loops no longer parses compose files, `.env`, `COMPOSE_FILE` or overrides for the name, so Compose's own precedence decides. `docker compose version` runs once first: Docker missing or a non-zero exit is a SKIP `compose unavailable` (0.4.1 read the name from the files without Docker; an invalid shell `COMPOSE_PROJECT_NAME` or a bad `git worktree list` is still a FAIL that withholds the name, below), after which the name is the shell's `COMPOSE_PROJECT_NAME`, else a worktree's derived name, else unknown in the main checkout (`--compose-project` exits 1, `b.containers` SKIP `project unknown`, `ENV_CHECK_PROJECT` empty).
- Behavior change: a worktree `.env` whose `COMPOSE_PROJECT_NAME` is none of the worktree's own names (the shell's `COMPOSE_PROJECT_NAME`, its derived name, or, for the checkout-root `.env`, its directory name) now FAILs (0.4.1 used that name and passed). The worktree keeps its derived name for `-p`; the fix is to add `COMPOSE_PROJECT_NAME=<derived>` to the `.env` the FAIL names, or to export the name you want in the shell, or to always pass `-p`.
- A worktree's configured `-f` run and its plain run from the checkout root are checked like the plain run from the first file's directory (0.4.1 checked only that one, through its own parse): any of them that would use a project another checkout holds, or a name other than the worktree's name, derived name or (from its root) directory name, FAILs and keeps the name.
- This checkout is asked again without the shell's `COMPOSE_*` when the shell sets any (even empty), since another terminal would not carry them; those FAILs say "without your shell's COMPOSE_* (…)". Other checkouts are always asked without `COMPOSE_*`.
- Held names, from a worktree: the main checkout's answers, plus every other worktree's derived name and answers (a deleted worktree, its derived name until `git worktree prune`). 0.4.1 counted a peer under its `.env` name instead of its derived name, so a worktree using a peer's derived name now FAILs. From the main checkout only the worktrees' derived names count: a worktree whose `.env` names the main checkout's project is reported by that worktree's `e.project`, not the main checkout's, and the main checkout never asks Compose about a worktree's files, so a worktree's broken compose file or `.env` does not FAIL it.
- `e.project` runs every check and reports every FAIL, the ones that withhold the name first (0.4.1 stopped at the first FAIL), except that a missing configured file, an invalid shell `COMPOSE_PROJECT_NAME`, a bad `git worktree list` and a failed `docker compose version` end evaluation and are reported alone.
- No Compose text: a failed Compose run is a FAIL that says whose run failed and how (`exited 1`, `timed out after 10s`, `is too old`); it no longer quotes Compose's error or loops' own reading of the file (0.4.1's YAML, interpolation and `COMPOSE_PROJECT_NAME` diagnoses all read this way now), so a secret interpolated into Compose's error cannot reach the report. The fix is the command to rerun as `config --no-env-resolution -q`, with its directory, any `env -u` and the remote-loader switches, which prints Compose's error but never the interpolated model (Compose's error line itself can still echo an interpolated value), or "upgrade Docker Compose" when it is too old; a run that exits 0 with invalid JSON or no project name has nothing to rerun, so its fix says to check `docker compose version` and upgrade Docker Compose.
- An invalid shell `COMPOSE_PROJECT_NAME` (one Compose rejects, e.g. `Bad Name`: it takes lowercase letters, digits, `-` and `_`, a letter or digit first) is an `e.project` FAIL that withholds the name, checked before any Compose probe and also when Compose is unavailable.
- `e.project` withholds the name when `git worktree list` fails or, from a worktree, does not list the main checkout first, instead of taking the worktree for the main checkout; the fix is `git worktree list --porcelain` to see why.
- PASS wording: `N (COMPOSE_PROJECT_NAME)` now means the shell's only; a worktree reads `derived: slug-hash|dirname`, even when its `.env` names its derived name; the main checkout reads `compose` instead of `name: in compose file` or `derived: dirname`. The `--static` PASS no longer shows `, name: X`.
- `--compose-project` exits 0 and prints the name when `e.project` keeps it, with one stderr warning per FAIL that keeps it (a run without `-p` is unsafe, one of this checkout's other runs fails, or a stack of another of its answers was started elsewhere); exit 1 when a FAIL withholds the name (a configured file missing, an invalid shell `COMPOSE_PROJECT_NAME`, `git worktree list` failing or lacking the main checkout, the name held, a container of the name started elsewhere, `docker compose version` failing to run (timed out, killed or refused), a `docker ps` timeout, a failed run of another checkout or of the main checkout's configured run) or the name is unknown; exit 2 without compose `mode = "test"`. It still asks Compose under `--static` and `CI=true`. 0.4.1 exited 1 on a failure of this worktree's own files; that now keeps the name. `[[local]]` checks get the kept name in `ENV_CHECK_PROJECT` (0.4.1: empty on any FAIL); `b.containers` still skips on any `e.project` FAIL.
- The `b.containers` repair command recreates the stack the way it was started, from the stale containers' Compose labels when they agree: `docker compose -p <project> -f <file>... [--project-directory <dir>] [--env-file <file>]... up -d --build --force-recreate`, with the `-f` files taken from `config_files` (the override Compose loaded included) when every entry still exists, else the configured `[compose] files`. 0.4.1 named the configured files plus the `compose.override.*` beside a lone default-named file; with no usable labels the fix now names the configured files only. Label paths keep Compose's spelling: a path under the checkout root prints relative to it, a symlinked directory keeps its name (Compose resolves `../` against it as spelled), any other spelling prints absolute, and `--project-directory` is added when the spellings differ.
- `b.containers` reads e.project's `docker ps -a` listing; the `docker inspect` pass and its SKIP `docker inspect failed` are gone (SKIP `docker is not available (…)` when `docker ps` fails). Container times are whole seconds, so a container created just after a change within the same second can read as stale.

### Added

- Running stacks (`e.project`): one `docker ps -a` reads the Compose labels, and a container of this checkout's name or of one of its answers whose `working_dir` belongs to another checkout or to none is a FAIL "project p was started from project directory <dir>", withholding the name for a stack of the name and keeping it for another answer. A `docker ps` timeout is a FAIL; a failing `docker ps` leaves the check not run and the Result says so (the PASS, or the first FAIL). When the stack's project directory still exists (another checkout, a live worktree, a clone), the fix only steers this checkout off it (export another `COMPOSE_PROJECT_NAME`, or always pass `-p <name>`) and names that directory; it adds `docker compose -p <p> down` only when the `working_dir` label is missing or its directory is gone.
- Remote loaders off: every `docker compose config` probe sets `COMPOSE_EXPERIMENTAL_GIT_REMOTE=0`, `COMPOSE_EXPERIMENTAL_OCI_REMOTE=0` and `GIT_ALLOW_PROTOCOL=file` (after the `COMPOSE_*` scrub, over the shell and the checkout's `.env`), so a branch's git or OCI `include:` or `extends.file:` cannot make `env-check` fetch a URL carrying an interpolated secret; such a run is a failed run (FAIL), which withholds the name when it is another checkout's or the main checkout's configured run.
- `compose-config.test.ts` runs the Compose wrapper against the real `docker compose config`, and `compose-policy.test.ts` runs `e.project` end to end over real checkouts (a temp git repo with worktrees per row, `--json` and `--compose-project`, one row against a real Docker daemon). Both are skipped when Compose is absent; CI's `compose-differential` job runs them on `ubuntu-latest` with the runner's Compose plugin and `LOOPS_REQUIRE_COMPOSE=1`, so a missing plugin fails the job.
- The README lists what `e.project` does not cover.

## [loops 0.4.1] - 2026-11-01

### Fixed

- `loops env-check` pins: in exact, minor and major modes a range floor no longer counts as a pin, so `.nvmrc` 22.1.0 next to `engines.node` >=20.11.0 passes; an exact pin below the highest floor FAILs as `<src>=<v> below the floor <fl>`.
- `loops env-check` resolves the Compose project once per run instead of twice; the output is unchanged.

## [loops 0.4.0] - 2026-10-31

The `loops` CLI: `loops zone` and `loops env-check`, in a new bundle `bin/loops.mjs`.

### Added

- `loops zone` classifies a change's paths against a repo's `risk-zones.md`: a strict parser
  (exit 2 with `file:line` for a bad row, glob or schema version), bash-style brace globs, zone =
  highest matching row with an unmatched path rounding up to yellow, and the file's own
  `## Ship prefix` bullet copied verbatim. The diff is the merge base against `origin/HEAD`,
  `origin/main` or `main` (renames count both sides); uncommitted and untracked files are included
  unless `--committed`; staged paths count even when the working copy matches `HEAD`. `--paths`,
  `--stdin [-z]`, `--file`, `--json` and `--explain` are supported; a missing ship bullet is exit 2
  in `--json` mode too.
- `loops env-check` runs `.loops/env-check.toml`: version pins that must agree across
  `.tool-versions`, `.nvmrc`, `go.mod`, `package.json` engines, `setup-*` workflow steps, Dockerfile
  tags, golangci-lint and goreleaser actions and `.python-version` (exact, minor, major or floor), local toolchains checked offline,
  shared-checkout, harness (tools, files, entrypoints, tracked files, sparse checkout) and Compose
  (`none` or `test`) checks, including `b.containers` (running containers older than the newest
  commit to the Compose `inputs`; docker absent or the stack down is a SKIP), and repo-owned `[[local]]` checks over a one-line-per-result protocol that
  fails closed. Exit 0 ok, 1 FAIL, 2 usage or config error; `--static`, `--json`, `--quiet`,
  `--compose-project`; `$HOME` is redacted to `~`.
- Every pair of pin sources must agree on the parts both state, the
  pin is the most specific pinned version, and an `engines` floor still binds the local toolchain.
  `engines` ranges are read for their lower bound (`>=`, `^`, `~`, `X.x`, `||`), so `<20` is an
  error rather than a floor of 20. `setup-*` and action sources read `.yml` and `.yaml` workflows,
  and `node-version-file: package.json` reads `volta` or `engines`, not the app's own version.
- A `[[local]]` check's `run` must be a repo-relative path. Its result ids are the configured id or
  `<id>.<name>`, and a check that prints a FAIL and then times out keeps the FAIL.
- In a worktree, `e.project` takes the reserved project name from the main checkout's compose file,
  so a worktree cannot claim the main stack's project by editing its own `name:`.
  `ENV_CHECK_ALLOW_MAIN` only allows the shared checkout when it is `1`.
- Results with the same level and message fold into one line that names the other ids, so one root
  cause is one FAIL.
- `templates/env-check`: a 15-line POSIX wrapper that runs `$LOOPS_BIN`, `~/bin/loops` or `loops`
  on PATH, and exits 3 with `env-check: not run` when the engine or `node` is missing.
- `smol-toml` is a dev dependency, bundled into `bin/loops.mjs` (still zero runtime install).

### Changed

- The `loop-metrics` row `version` is now `0.4.0` (it follows the plugin version).

### Not in this release

- Shim-aware `a.shadow.*` duplicate-binary checks, Compose `dev` mode, a
  `loops zone --lint`, and cross-result dedup keys.

## [loops 0.3.0] - 2026-10-13

Per-repo metrics, the second half of Wave 0 slice 2.

### Added

- A private config (`--config`, `$LOOPS_CONFIG`, or `~/.config/agentic-loops/config.json`)
  names the repos to measure. An empty `$LOOPS_CONFIG` counts as unset. Without a config,
  `repos` and `repo_errors` are `null` and the row is otherwise unchanged.
- Each window gains `repos`: per repo, merged PRs, fix/revert PRs, a defect-escape proxy, local
  sessions and their tokens, Workflow runs and their tokens, and tokens and sessions per merged
  PR. The row gains `repo_errors`, the repos whose PRs `gh` could not read or resolve.
- A slug `gh` cannot resolve (a typo, a rename, no access) is recorded as `null` and named in
  `repo_errors`, rather than read as a repo with no merged PRs: `gh pr list` answers `[]` with exit
  0 for it, so each repo now makes a `gh repo view` check before the PR list. `gh` calls time out
  after 5 minutes, so a stalled call no longer waits forever; a `gh` that ignores `SIGTERM` is
  not covered yet.
- `session_tokens` counts main-thread transcripts only. Agent-tool subagent transcripts are not
  read yet, so `tokens_per_merged_pr` understates subagent-heavy work.
- The escape proxy blames like `git blame`: a fix within 14 days counts only against the last
  PR to touch a shared file, and docs, `VERSION`, manifests, lockfiles, snapshots and test files
  never count. Without these rules the first real run blamed 49 of 83 PRs in one repo, nearly
  all through the release files every PR bumps.
- PRs merged after `--now` are ignored, so a rerun with an earlier `--now` matches what that
  week's run would have seen.
- Session records now keep their project dir and per-message token totals (context plus output).
  An invalid `output_tokens` counts in `bad_records`.
- `version` is `0.3.0`.

## [loops 0.2.1] - 2026-10-03

Parser hardening from the loops 0.1.0 ship's final adversarial round. None of these cases occurs
in current data; each was a way malformed input could get past the drift counters.

### Changed

- An empty `uuid` or `message.id` is treated as absent instead of as a dedupe key every such
  record shares. A `message.id` that is empty or a non-null non-string falls back to `requestId`
  and counts in `bad_records`, once per record that carries it.
- Token counts and Workflow `durationMs` must be non-negative safe integers (session context
  fields, Workflow token counts and durations), so a sum or median can no longer overflow to
  `Infinity`, which JSON writes as `null`.
- A Workflow `workflowProgress` entry whose type is not `workflow_phase` or `workflow_agent`, or
  that is not an object, counts in `bad_records`.
- A transcript whose mtime is more than a minute in the future is not treated as live, so its
  torn last line counts.
- Appending a row also syncs the history file's directory, every run (an earlier run may have
  created the file and died before syncing it), and any directories created for it. A failed sync
  (or a failed close after it) now reports `row written but may not be on disk` rather than
  `cannot append`, and still prints the row. A filesystem that cannot sync directories at all
  skips the directory sync instead of failing every run.
- `version` is `0.2.1`.

## [loops 0.2.0] - 2026-10-03

Wave 0, slice 2 (lens noise, first pass): the weekly row now records how often each gstack review
lens is dispatched and what happens to its findings, with no change to gstack.

### Added

- **`lenses`** in each window, read from `~/.gstack/projects/<repo>/*-reviews.jsonl`
  (`skill: "review"` records only): review counts, and per lens the specialists block's
  dispatched / not-dispatched / reported counts plus the `findings[]` outcome counts (fixed,
  auto-fixed, skipped, other, critical, critical skipped). Findings whose category is not a lens
  go to `other`. Lens names are normalized (`red_team` -> `red-team`).
- **`parse_lenses`**: the review-log parser's own drift counters, separate from `parse`.
- **`--gstack-dir DIR`** (default `~/.gstack/projects`). Without gstack installed, `lenses` is
  `null` rather than zeros; a named directory that cannot be read refuses to write a row.

### Changed

- `version` is `0.2.0`. `schema` stays `1`: the new fields are additive.

## [dev-doctor 1.0.0] - 2026-10-01

### Added

- **`dev-doctor` 1.0.0** — an installable Claude Code plugin for read-only local environment preflights before agents run local development commands. Emits Markdown and JSON reports covering git/worktree state, runtime pins, Docker/Compose status, env-file gaps, collision risks, setup hints, and recommended next commands. Non-mutating by design: no installs, migrations, service starts/stops, tests, formatters, or secret-value printing.
- Root README discovery for `dev-doctor`.
- Reports default to `<git-dir>/dev-doctor/` so the preflight never adds untracked files to the checkout or flips its own `dirty` flag; `compose config` error excerpts have env-file values redacted.

### For Contributors

- Shell tests (`tests/dev-doctor-test.sh`, needs `bash`, `git`, `jq`) and a GitHub Actions `Test` workflow covering plugin manifests, report generation, env blockers, Compose parsing, env-key drift (including `export` prefixes), secret-value redaction, default report placement, worktree detection, and the exit-code contract.
- `TESTING.md` with conventions for marketplace plugin changes.

## [loops 0.1.0] - 2026-09-28

New plugin: **loops**. Wave 0, slice 1 measures how your engineering loops actually run, so
later loop rules can be kept or dropped against recorded history instead of impressions.

### Added

- **`loop-metrics`**, a zero-install Node 18+ CLI (committed bundle). Each run reads Claude Code's
  local session transcripts and Workflow run records and appends **one baseline row** to
  `~/.claude/metrics/loops.jsonl`, covering 7-day and 30-day windows:
  - Workflow runs: status mix, phases, tokens, duration, agents, per-model split.
  - Sessions: context peaks, compactions, sessions with 10+ compactions.
  - Parse counters.

  It reads only numeric fields and ids; message text is never read.
- **Counts that survive how transcripts repeat themselves.**
  - Records are deduped by `uuid` across the whole run. Resumes replay records within a file,
    and forks copy them across files; the original owns the shared records.
  - API usage is deduped by `message.id`, because one message is written once per content
    block.
  - Synthetic API-error records are not counted as calls.
  - Workflow runs are deduped by `runId`, and the finished copy is the one kept.
  - `--session FILE` prints one transcript's deduped counts next to its naive ones for manual
    validation.
- **A drift tripwire.** A renamed or missing field reads as zero but is still counted in
  `bad_records`, so a format change shows up in `parse` rather than as a quiet week. The same
  applies to:
  - an impossible or zone-less timestamp
  - a negative count
  - an unknown status or agent state
  - an unreadable directory, which counts in `bad_files` instead
- **Safe appends to the only history.**
  - A torn last row is fenced off with a newline, so the new row never glues onto it.
  - A failed write is truncated back.
  - The row is synced to disk before the tool exits 0.
  - A wrong `--projects-dir` or an unwritable `--out` exits non-zero with no row.
  - Every row carries a parser `version`.
- **A weekly launchd schedule** (README), with a `launchctl kickstart` proof run, plus a
  manual validation recipe against `jq`.
- **CI** (`loops-ci`): typecheck, 71 vitest tests, build, and a check that the committed
  bundle matches the source.

## [3.0.0] - 2026-08-23

Nightshift v3. The loop now runs **local-first behind one easy button** — `ns run <repo>
security` takes you from nothing to a refreshed dashboard on your own machine, with no
cloud in the run path. This release cuts on a system that has completed a real run, which
is the point: the last five defects below were found by running it, not by reading it.

### Added

- **`bin/ns` — the easy button.** POSIX shell, committed, shellchecked in CI, versioned with the engine. `ns run`, `ns run --due`, `ns status`, `ns dashboard`, `ns digest`, `ns cost add`, `--interactive`. Every decision it looks like it makes is made in vitest-covered TypeScript and handed back as a flat value: `bin/ops-target`, `bin/due`, `bin/workflow-args`, `bin/retain`, `bin/run-outcome`. What is left in the shell is sequencing, environment, and exit paths.
- **The ops home.** `templates/ops/{config.yml,runbook.md}` plus `schemas/ops-config.yml`. The operator's config, runbook, dashboard, digests, evidence and logs live outside every repo and are never committed; nothing operator-specific ships in the engine.
- **`bin/run-outcome`** — the success predicate. A run succeeded iff it left both halves of its durable evidence: `bin/record`'s run row, written under the per-repo lock after validate and dedupe, **and** the completion sentinel `bin/rollup` stamps at `metrics/runs/.complete/<run_id>`. Not "the CLI exited 0", not "the workflow returned complete" — both of which were true of a run that reviewed nothing. Not the row on its own either: record appends it *before* its own registry rewrite and before rollup, so a row with no sentinel is a chain that stopped halfway. A row with `reviewed: 0` against a non-zero `selected` is a failure too.
- **Dynamic Workflow v2** — full-K fan-out over the launcher's pre-chunked surfaces, reviewer + Tier-1 refuter per surface, deterministic merge, conditional Tier-2, then validate → dedupe → record → rollup. Zero conditionals in the workflow file, enforced by a scanner that fails the build if the file adopts a form it cannot see.
- **Per-run isolation** — `.run/<run_id>/` per attempt, a record lock with run_id uniqueness and a provenance assert, `bin/clean`, and one `prune()` for lifecycle retention.
- **The design lane, engine-side** — lane-parameterized workflow, one ux-reviewer per browser adapter, and a preflight that **refuses** a non-loopback `base_url` or a manifest that does not explicitly assert `environment: local|dev|test`. Staging and production are refused by name. Never warn-and-proceed.
- **`--plugin-dir "$ENGINE"` on every session `ns` starts**, so the bins, the agents the workflow dispatches to, and the PreToolUse guard all come from one tree instead of from whatever version happens to be installed.
- **`agent-budgets.test.ts`** — pins every agent's `maxTurns` by snapshot, and asserts no refuter is below 40, because nothing overrides a refuter's budget at dispatch.

### Changed

- **Agent types are plugin-qualified** (`nightshift:security-reviewer`). A plugin agent is addressable by its qualified name; the bare name resolved only if something else happened to provide one. **Breaking** for anything that pinned the bare strings.
- **The dashboard's "Decisions needed" panel rendered the wrong section, in fragments.** Found by the first live `ns digest` run. `parseDigest` matched a heading anchored as `/^#+\s*decisions/`, but the digest skill writes `## 1. Top 3 human decisions needed` — numbered, with the word mid-phrase. The match failed, the parser fell through to its bullets-anywhere fallback, and the panel showed the **findings** list instead of the decisions; every hard-wrapped item was also truncated at its first line break, because bullets were matched one line at a time. The parser now matches a heading *containing* the word, accepts `-`/`*`/`1.`/`**1.` item syntax (SKILL.md pins the digest's sections but deliberately not its bullet syntax), joins wrapped continuation lines, and strips emphasis so no raw `**` reaches the HTML. Verified against the real digest: all three decisions, in order, in full. Two regression tests named after the failure.
- **The refuters were told the wrong budget in their own prompts.** `agents/security-refuter.md` and `agents/ux-refuter.md` grant `maxTurns: 40` in frontmatter while the prose the refuter itself reads said "`maxTurns: 10`" — a live misinstruction to the model, in the exact release that un-starved them, and nothing overrides a refuter's budget at dispatch. Corrected, along with every shipped doc that still printed the pre-release numbers (`README.md`, `skills/security/SKILL.md`, `skills/security/reference/run-loop.md`). Those same references also advertised a dispatch effort of `xhigh`, which `Dispatch.effort` has never permitted (`"low" | "medium" | "high"`); the reviewer entry now states the real `MODEL_BY_BAND` table instead of a stale frontmatter floor. The shipped operator runbook likewise still claimed failures keep "exactly one" run dir when `clean-run.ts` keeps 5 for 7 days.
- **Turn budgets raised** on evidence: `MODEL_BY_BAND` critical 40→56 and high 32→48 (56 is the measured ceiling **plus headroom** — the two reviewers on the run that passed the gate used 42 and 39 tool calls, so 42 is the ceiling and turns are the conservative proxy for a tool-call measurement; 48 is unmeasured, kept below critical because no high-band surface has ever run); refuters Tier-1 10→40 and Tier-2 16→56. At the old numbers, reviewers on a real critical surface never reached the `Write` that produces their artifacts, and refuters never reached theirs — the chain completed correctly and reviewed nothing.
- **The headless prompt makes waiting the task.** The Workflow tool returns a task id, not a result, and the workflow is killed if the session ends first. `TaskOutput` is now in the default grant: `Workflow,TaskOutput,Read,Glob,Grep,Bash,Write,Agent`.
- `ns` exports `CLAUDE_PLUGIN_ROOT`, which is not set inside a Workflow subagent's Bash environment. The workflow interpolates that literal and relies on the shell to expand it; without the export every plumbing command ran as `node /bin/<name>.mjs`.
- Reviewer and refuter agents refreshed to the current model fleet, with the band→compute table pinned by snapshot so a tier change is a deliberate red-CI event.

### Fixed

- **A run that reviewed nothing reported success**, wrote an `ok` cost row, deleted the run dir holding the only evidence, and refreshed the dashboard to say all was well. The outcome is now read from durable state.
- **`bin/ns` could not find its engine through the documented symlink install.** `dirname $0` of the link made the engine the PATH directory's parent, and because that directory exists the check passed and the error blamed the engine build. It now walks the symlink chain.
- The dashboard regenerates on **every** exit path — success, failure, crash, Ctrl-C, and preflight refusal — via an EXIT trap, after the cost row is written. A failed run that leaves yesterday's dashboard looking fresh is the silent staleness this system exists to prevent.
- SIGINT/SIGTERM now stop the run instead of finalizing and carrying on to invoke the model anyway.
- `ns run --due` no longer feeds its work list to the model on stdin, where the first session swallowed the rest of the sweep.
- A refused run no longer leaves scratch directories inside the operator's repository.
- **A run whose registry rewrite or rollup failed still reported success.** `bin/record` appends its run row and *then* rewrites the registry, and the workflow chains `bin/rollup` after record — so either failing left a row that read as completion, and `ns` deleted the diagnostic run dir and refreshed the dashboard to green while freshness stamps or the daily metrics never landed. `bin/rollup` now takes `--run-id` and stamps a completion sentinel as its last act; `bin/run-outcome` requires it.
- **The dashboard called a failed run green.** It derived the lane status line on its own — any run row at all printed `<lane> ok`, with the dollar amount beside it — including the reviewed-nothing run `bin/run-outcome` had just failed the launcher for. Both surfaces now apply one exported rule.
- **The dashboard advertised design packs the launcher would always refuse.** Readiness checked personas and `base_url`; preflight also requires a known browser adapter, a loopback host, and an explicit non-production `environment`. Both now derive readiness from one predicate, with the launcher's refusal ordering preserved.
- **The design preflight never checked that the dev server answers.** T8 specified refusing when the server is down; only the static half had shipped, so a design run dispatched paid reviewers at an unreachable target. `ns` now probes `base_url` with a bounded `curl` after preflight and before any spend — any HTTP response counts as up, and a missing `curl` degrades to a logged warning rather than a refusal.
- **Repo display names were unvalidated free text** while being used as an `$OPS/evidence/<name>/` path segment that retention *prunes*, and as a word in the space-delimited `<repo> <lane>` pairs `ns run --due` reads back. `../logs` escaped the ops directories; `My App` broke due parsing. Names must now be a single safe token, refused at config-read time rather than silently sanitized.
- **`$OPS/evidence/<repo>` was never checked for being a symlink.** `mkdirSync` followed it, and the lifecycle prune — whose symlink defense only ever made symlink *children* leaves — then walked and deleted through it, outside the evidence store. A non-directory evidence root is now refused before anything is copied or pruned.
- **`ns` wrote shell fragments to predictable `$TMPDIR` paths and sourced them.** On a shared `/tmp` the path is guessable from the pid, so a planted symlink turned the redirect into an arbitrary overwrite and the `.` into arbitrary execution as the operator. All six sites now use `mktemp`.
- **`ns digest` refused design-only repos**, hardcoding `--lane security` purely to resolve the repo's paths, though the digest is lane-agnostic and the config explicitly allows any subset of lanes.
- **The plugin root was interpolated unquoted into every plumbing command.** A checkout path containing whitespace word-split the executable path and failed every stage *after* the reviewers had been billed.
- **`prune()` followed a symlinked root.** The lstat-not-stat discipline in both policies protected the *children* of the pruned directory and said nothing about the directory itself, so a symlinked `$OPS/logs` or `.nightshift/.run` handed retention a listing of another tree and let it delete from it. A non-directory prune root is now refused before either policy branch runs.
- **One malformed metrics line aborted the entire `--due` fleet sweep.** `readJsonl` parses without a guard, and the runs-shard and `costs.jsonl` reads sat outside the per-target error handling that already isolates a malformed registry — so a single half-written line in one repo's metrics stopped every later repository from being considered. Both reads are now caught at the target boundary and mark only that repo/lane unrunnable.
- **Repo display names collided case-insensitively but were compared case-sensitively.** `Foo` and `foo` both passed validation and then resolved to the same `$OPS/evidence/<name>/` directory and the same `$OPS/digests/<name>.md` on the case-insensitive filesystem this ops home actually runs on, so one repo overwrote the other's digest and cross-pruned its evidence. The collision key is now normalized; the refusal still names both original spellings.
- **`dashboard.out` was accepted verbatim and overwritten on every finalization.** `bin/ns` concatenates it onto `$OPS_HOME` rather than resolving it, so a `..` segment walked out of the ops home and silently clobbered a real operator-authored file — a runbook, for instance — once per run. It must now be a plain filename, refused at config-read time.
- **The dashboard's orphan-run scan still read the raw configured path.** Loading the repo was fixed to use the expanded root, but the abandoned-run-directory check kept building `.nightshift/.run` from the unexpanded value, where a documented `~/code/...` entry is just a cwd-relative path that quietly matches nothing. It now takes the root from the same expanded value, so the two cannot drift apart again.

### Upgrading

`ns` has no default ops home — set `NIGHTSHIFT_OPS` or pass `--ops`. Symlink `bin/ns` onto
your PATH rather than copying it, so it stays versioned with the engine it launches. Packs
predating v3 should be re-checked against the current schemas: `pack_format` is still `1`
and is still never read, which is a known gap for the first external adopter.

## [2.4.0] - 2026-08-23

Nightshift v3 lane B: every run's real cost is now recorded and trended, and the
whole fleet is visible in one self-contained local HTML page you can open with no
network. (v3 sessions A2 + A6; the 3.0.0 release cuts after A7.)

### Added

- **`bin/record-cost`** — captures what a run actually cost into a new append-only `metrics/costs.jsonl` (new `cost-record` schema). Status is gated on `is_error` and nothing else: a failed headless run reports `subtype: "success"` right next to `is_error: true`, so keying on `subtype` would file every failure as a free success. A fixture of that exact envelope ships as a regression test. Interactive runs without JSON output can record a `source: "manual"` line instead, and a run with no cost line at all shows up as a visible gap rather than as $0.
- **Cost windows in the daily rollup** — `cost_usd_7d`, `cost_usd_30d`, and `cost_usd_avg_per_run_30d`. Failed runs count toward the totals (a partial burn is still real spend) but are excluded from the per-run average, so one crash cannot make the average look cheap. Additive fields, so `pack_format` stays `1`.
- **`bin/dashboard`** — one self-contained HTML page covering every onboarded repo, regenerated on each run. Opens with no network: no scripts, no remote fonts, no external images. Leads with a verdict strip answering "what needs me?" computed only from pack data, then decisions from the digest, per-repo coverage split into freshness and open findings, sparkline trends for freshness / false-positive rate / cost, and a hygiene strip for orphaned run dirs and missing evidence. Cost lives in the footer and never competes with the alarm.
- Accessibility is enforced, not aspirational: every foreground/background token pair clears WCAG AA 4.5:1 in both light and dark themes, and no state is signalled by colour alone.

### Changed

- The verdict strip now surfaces registry areas that are **due** (past their interval) alongside those that are **overdue**, at a distinct warn severity. A critical-weight area sitting exactly on its interval used to be invisible on the page whose only job is telling you what needs attention. When more items compete than fit, the four shown are the four most severe rather than the first four found.
- `$OPS/config.yml` accepts the documented shape — `lanes: [security, design]` with `enabled: true` and no `name` — and still accepts the older lane-map spelling. A repo with no `name` takes its directory name instead of rendering as "undefined".
- One unreadable repo no longer blanks the page: it is marked unreadable with the parse error, and every other repo still renders.
- Retired the committed `dashboard.md` projection from the pack template and the example pack. The generated HTML replaces it.

### Fixed

- A successful run whose `total_cost_usd` was missing or mistyped was silently recorded as costing $0. It is now refused, the same way a missing `is_error` already was.
- A retried `record-cost` wrote a second row for the same run, double-counting that run's spend in every cost window and in the dashboard footer. Repeated rows are now reduced to the most recent per run.
- A malformed line in `costs.jsonl` produced `NaN` cost totals that landed in `daily.jsonl` as `null` and silently flatlined the cost trend. Cost rows are now validated on read, naming the offending file and line, and the rollup is validated before it is written.
- Cost validation now rejects negative spend, fractional or negative token counts, and impossible calendar dates like `2026-99-99` — which previously passed and then fell outside every date window.
- Trends collapsed two repositories' same-day rows for a lane into one, so a single repo's numbers stood in for all of them. Rows are now reduced per repository before being averaged.
- Suppressions past their expiry date were still displayed as active accepted-risk, contradicting the auto-lift the dedupe engine already applies.
- A failed run kept raising the alarm after a later successful run had already fixed it, when that re-run recorded no cost line.
- Finding anchors used only the surface id, so two repositories sharing a taxonomy id produced duplicate DOM ids and every link jumped to the first repository's card.
- Scanning the evidence store followed directory symlinks, so a symlink cycle could hang the rebuild and a link outward could bill someone else's bytes to the store.

## [2.3.0] - 2026-08-15

### Added

- **`reviewed.json`** — new review-phase artifact: the reviewer records the surface ids it *actually* reviewed, and `bin/run-meta` (new required `--reviewed` flag) gates it deterministically — every id must be a unique member of the selected surfaces, abort (exit 2) otherwise — before copying it into `run.json` as `reviewed_ids`. `selected` and `reviewed` in the per-run metrics are now genuinely independent counts.
- `bin/run-meta` survivor **identity** check: every Tier-1 survivor must match a proposed candidate by canonical `dedupe_key` (multiset subset, the same canonicalization `bin/dedupe` uses). The refuter may remove candidates but can no longer *substitute* different same-count findings that would pass schema validation and keep `rejected_tier1` (the FPR denominator) falsely low.

### Fixed

- With `window_budget_k > 1`, surfaces that were selected but never reviewed were stamped `last_reviewed`/`status: green` as if freshly reviewed (`reviewed_ids` assumed all-selected while the workflow reviews only index 0) — silent registry-freshness corruption that hid un-reviewed vectors. Registry stamping now covers only the ids in `reviewed.json`; unreviewed surfaces keep their state, stay stale, and re-select next run.

## [2.2.0] - 2026-06-22

### Added

- **`bin/run-meta`** — new deterministic engine step that assembles `run.json` (the per-run `RunMeta`) from `surfaces.json`, `candidates.proposed.json` (pre-refute), and `candidates.json` (Tier-1 survivors). Runs first in the record phase so `bin/record` has `run.json` to consume. Computes `rejected_tier1 = proposed_count − survivors_count` and the `reviewed_ids` set; authored as a thin argv shell over `lib/run-meta-build` (zero decision logic). Full-branch vitest coverage (validation throws, no-git fallback, injected date/ts, empty surfaces, blank-run_id guard, survivors-exceed-proposed guard).
- Two-file refute convention wired through the security workflow: the reviewer writes `candidates.proposed.json`, the Tier-1 refuter overwrites `candidates.json` with survivors, and `run-meta` reads both so the pre-refute count is preserved for the false-positive-rate denominator.
- `bin/validate` now gates **both** model-written candidate artifacts (`candidates.proposed.json` and `candidates.json`) before the stateful path, restoring the "validate gates every model-written artifact" invariant.

### Changed

- `findings_created` is now **derived inside `bin/record`** (`confirmed + recurring + rejected_tier1 + rejected_tier2`, i.e. `proposed_count − suppressed`) instead of being injected. `run-meta` cannot compute it because it runs before dedupe and so cannot know how many survivors will be suppressed. A new cross-module test proves the identity end-to-end (run-meta → record).
- The `RunMeta` interface is centralized in `lib/types.ts`; the duplicate inline definition in `bin/record.ts` was removed.

### Fixed

- `run-meta` now aborts (exit 2) on a blank `run_id` (e.g. an empty `run-id.txt` on resume) and when survivors exceed proposed candidates, instead of silently writing a corrupt run record or a negative `rejected_tier1`.

## [2.0.0] - 2026-06-18

### Added

- **nightshift plugin** — two-lane, budget-aware assurance loop that keeps security surfaces and user flows continuously covered, refuted, and visible without manual scheduling.
  - `/nightshift:security` — select the stalest/changed registry vectors within a hard K-window budget, fan out the security-reviewer subagent, run the mandatory two-stage refuter gate (Tier-1 haiku always + Tier-2 sonnet on critical/high or low-confidence), dedupe against open findings, log confirmed findings, update registry state, and write durable per-run and daily-rollup metrics.
  - `/nightshift:design` — prerequisite-gated UX review lane; refuses until the pack has a staging browser adapter and seeded `fixtures/personas.yml`. Drives stale/changed flows against staging personas, anchors findings, and shares the run-loop mechanics with the security lane.
  - `/nightshift:onboard` — interactive DETECT → BATCH-CONFIRM → SEED → REVIEW → GATE → WRITE flow; detects the stack, seeds a draft `vectors.yml` from the OWASP ASVS base taxonomy, and reconciles on re-runs without clobbering hand-tuned config.
  - `/nightshift:digest` — weekly management signal: new critical/high findings, repeated themes, overdue surfaces, false-positive rate, and the top 3 human decisions needed. Read-only.
  - `/nightshift:garden` — weekly registry gardening: proposes new entries for code changed since last review, flags orphaned entries and stale area mappings.
  - Two-stage refuter gate with split `rejected_tier1` / `rejected_tier2` counters so false-positive rate is attributable by tier and the "retire Tier-2 if it trends to ~0" decision is measurable.
  - Durable metrics: append-only `metrics/runs/<YYYY-MM>.jsonl` (per-run) and `metrics/daily.jsonl` (day-over-day trend). `merge=union` in `.gitattributes` makes concurrent-branch appends conflict-free; readers use max-ts per `(date, lane)` to handle out-of-order union-merge lines.
  - `pack_format` integer in `manifest.yml` gates future migrations: the engine detects the version and either auto-migrates or fails loudly before writing.
  - NovuDesk worked example — a fully fictional B2B helpdesk pack with seeded vectors, flows, personas, realistic findings, a suppression, and metrics showing both security and design lanes running.
  - CI: `nightshift-ci.yml` — positive example-hygiene gate (reserved-TLD check, no-sentinel check, YAML render-smoke) replacing the old denylist grep.

### Changed

- Plugin renamed from `assurance-engine` to `nightshift`; skill commands are colon-namespaced (`/nightshift:security`, `/nightshift:design`, etc.).
- Example pack genericized from the private BearHost project to the fully fictional NovuDesk.
- Two-stage refuter replaces the single second-reviewer pass; `rejected_by_2nd_reviewer` field retired in favour of split `rejected_tier1` / `rejected_tier2`.
- `design` lane cadence default changed from `weekly` to `off` in the template manifest; design requires explicit opt-in during onboarding.

### Fixed

- `_HYGIENE_TMP` variable was assigned inside the for-loop body but expanded as the loop redirect target — caused `unbound variable` crash under `set -u`, silently voiding the TLD gate. Fixed by initialising before the loop.
- `last_seen` was never bumped when a recurring finding was dropped at dedupe. Dedupe step now updates `last_seen` and `run_id` on the existing open finding so motionless-finding detection stays accurate.
- `daily.jsonl` reader used physical last-line semantics, which break after concurrent branch merges via `merge=union`. All readers updated to use max-ts per `(date, lane)`.
- Dead `| grep -v 'nightshift-ci.yml'` filter in the CI workflow (the file is outside the scan root and was a no-op).
- `security-refuter.md` documentation claimed "context-asymmetric (claim + location only)" but the agent receives the full proposed finding. Docs updated to say "independent re-read, instructed not to rely on the reviewer's narrative."
- `findings_created` in example JSONL was less than `rejected_tier1` alone (impossible values). Fixed to `confirmed + rejected_tier1 + rejected_tier2`; schema clarified that `suppressed` is excluded from this count and tracked separately.
- Prompt-injection guardrails added to security and design SKILL.md: agents now receive only structural dedupe fields from open findings/suppressions (no free-form narrative).
- `/nightshift:security` and `/nightshift:design` SKILL.md listed `findings/` as the open-findings path; correct path is `metrics/findings/<YYYY-MM>.jsonl` (`findings/` holds suppressions only).
- Root README and marketplace description referenced a dead `/nightshift:qa` command; corrected to `/nightshift:security`.
- NovuDesk example missing `fixtures/personas.yml` (design gate prerequisite); file added so the example is internally consistent with its design-lane metrics.
