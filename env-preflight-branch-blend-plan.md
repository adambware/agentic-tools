# Env Preflight Branch Analysis and Blend Plan

## Goal

Ship one installable local development preflight plugin that agents can run before
touching a repo that may depend on `.tool-versions`, Docker Compose, env files,
worktrees, or local ports.

The winning version should be:

- Non-mutating: no installs, migrations, service starts/stops, formatters, tests,
  or secret-value printing.
- Plugin-shaped: lives under `plugins/<name>/`, has plugin metadata, a skill, a
  README, and a marketplace entry.
- Agent-friendly: produces a concise terminal summary plus a structured report
  the agent can read before proceeding.
- Robust enough for real local dev: detects runtime drift, Docker/Compose
  availability, worktree collision risks, env-file gaps, compose config issues,
  fixed ports, named volumes, and likely next commands.

## Branch Grades

| Branch | Grade | Verdict |
| --- | --- | --- |
| `feat/env-preflight-claudevsc-opus-5.7-55prompt` | A- | Best plugin packaging and best human-readable report. Needs structured JSON and a few broader compose-file checks. |
| `feat/env-preflight-claudecli-opus-5.7-55prompt` | B+ | Best machine-readable output and compact CLI summary. Weak install shape and less graceful path/output control. |
| `feat/env-preflight-codexcli-5.5-high` | B | Best crisp skill policy and focused risk model. Script is too thin to be the final implementation by itself, and branch has base drift. |

## Branch Analysis

### `feat/env-preflight-claudevsc-opus-5.7-55prompt`

Strengths:

- Uses the repository's canonical plugin layout:
  `plugins/dev-doctor/.claude-plugin/plugin.json`,
  `plugins/dev-doctor/README.md`, `plugins/dev-doctor/skills/dev-doctor/SKILL.md`,
  and a marketplace entry.
- The script has the strongest Markdown report: summary first, detailed sections,
  blockers/warnings, detected manifests, Docker status, compose validation, ports,
  named volumes, env-file key gaps, and likely setup commands.
- Supports an output-file argument and `DEV_DOCTOR_OUT`, which makes it easier to
  run without forcing writes into a particular repo location.
- Exits `2` on blockers, which gives agents an obvious gate when the environment
  should not be used yet.
- Handles `docker compose` and legacy `docker-compose`.

Risks and gaps:

- Only emits Markdown, so agents have to parse prose if they want structured
  fields.
- Compose-file detection misses `compose.yaml` and `docker-compose.yaml`.
- Uses emoji in generated report text. That is fine for humans, but less ideal as
  the only contract an agent reads.
- Worktree collision language is useful, but the implementation can over-warn when
  directory-derived project names are already unique.

### `feat/env-preflight-claudecli-opus-5.7-55prompt`

Strengths:

- Produces both `reports/dev-doctor.md` and `.agent/dev-doctor.json`; this is the
  best output contract.
- Has a very usable terminal summary with verdict, root, git state, Docker state,
  next command, and report paths.
- Treats environment problems as report data rather than shell failures, which is
  convenient when the preflight is informational.
- Includes a JSON escaper and basic JSON validation/pretty-printing when `jq` is
  present.
- Captures project containers by Compose project label.

Risks and gaps:

- Not packaged as a marketplace plugin; it adds a root `SKILL.md` and root
  `scripts/dev-doctor.sh`, which does not match this repo's plugin conventions.
- Always writes to `reports/` and `.agent/` under the target repo; there is no
  output override.
- Uses only `docker compose`, while the Claude VSC version gracefully falls back to
  legacy `docker-compose`.
- Recommends concrete next commands such as `docker compose up -d` or `npm install`.
  That is helpful, but the final skill should make clear these are suggestions to
  confirm, not commands to run automatically.
- Some parsing is overly compact, which makes future maintenance harder than the
  Claude VSC script.

### `feat/env-preflight-codexcli-5.5-high`

Strengths:

- Best skill policy: clear triggers, non-triggers, workflow, standards, and concise
  reporting guidance.
- Checks several practical collision risks that the other scripts only partially
  cover: `container_name:`, top-level Compose `name:`, fixed host ports, and
  referenced env files.
- Simple PASS/WARN/FAIL output is easy to skim and easy for agents to summarize.
- Uses the current plugin layout and marketplace entry.

Risks and gaps:

- Script is too shallow for the final plugin: no Markdown/JSON report, no detailed
  Docker context/project/container section, no `.env.example` key comparison, and
  no likely setup-command extraction beyond basic checks.
- Common-port probing is useful, but less precise than checking the ports the
  Compose config actually wants to publish.
- The branch appears based behind current `main`, so its PR diff includes already
  landed `pr-test-reviewer` and `test-plan-explorer` files. Those should not be
  part of the final env-preflight change.
- Current naming, `dev-env-preflight`, is clear but less memorable than
  `dev-doctor`.

## Recommended Blend

Use `feat/env-preflight-claudevsc-opus-5.7-55prompt` as the structural and report
base, then blend in the best parts from the other two branches.

### Product Shape

Ship one plugin named `dev-doctor`.

Rationale:

- `dev-doctor` is shorter, memorable, and maps naturally to the script/report
  names.
- The Claude VSC branch already packages it correctly.
- The skill can still describe itself as a "dev environment preflight" in the
  description and keywords, so discovery remains good.

Plugin files:

```text
plugins/dev-doctor/
|-- .claude-plugin/plugin.json
|-- README.md
|-- scripts/
|   `-- dev-doctor.sh
`-- skills/dev-doctor/
    `-- SKILL.md
```

Marketplace:

- Add only `dev-doctor`.
- Preserve existing `pr-test-reviewer` and `test-plan-explorer` entries from
  current `main`.
- Do not carry the Codex branch's duplicate/base-drift changes into the final PR.

### Script Contract

Start from the Claude VSC script and add:

- JSON report output from the Claude CLI branch:
  `.agent/dev-doctor.json` by default.
- Optional output controls:
  - `DEV_DOCTOR_MD_OUT`
  - `DEV_DOCTOR_JSON_OUT`
  - first positional argument as Markdown override for compatibility
- Terminal summary from the Claude CLI branch:
  verdict, root, git branch/commit/dirty, worktree, Docker reachability, compose
  file, recommended next command, and report paths.
- Compose checks from the Codex branch:
  - `compose.yaml` and `docker-compose.yaml` detection
  - `container_name:` warning
  - top-level `name:` warning
  - fixed host port warning
  - Compose-referenced missing env files
- Keep legacy `docker-compose` fallback from the Claude VSC branch.
- Keep blocker exit semantics from the Claude VSC branch:
  - exit `0` for clean/warnings
  - exit `2` for blockers
  - reserve exit `1` for script misuse or unexpected script failure

### Report Contract

The Markdown report should remain human-readable and summary-first:

1. Verdict
2. Blockers
3. Warnings
4. Location
5. Git/worktree
6. Detected files
7. Runtime versions
8. Docker/Compose
9. Env files
10. Setup hints
11. Recommended next command

The JSON report should expose at least:

```json
{
  "generated_at": "ISO-8601 timestamp",
  "read_only": true,
  "verdict": "ok | caution | blocked",
  "project_root": "...",
  "working_dir": "...",
  "git": {
    "branch": "...",
    "commit": "...",
    "dirty": false,
    "is_worktree": false,
    "worktree_count": 1
  },
  "files": {},
  "asdf": [],
  "docker": {
    "cli_present": true,
    "daemon_reachable": true,
    "context": "...",
    "compose_command": "docker compose",
    "compose_file": "compose.yaml",
    "compose_valid": true,
    "compose_project": "...",
    "published_ports": [],
    "named_volumes": [],
    "running_project_containers": []
  },
  "env": {
    "env_present": true,
    "example_present": true,
    "missing_keys": []
  },
  "setup_hints": [],
  "recommended_next": "...",
  "warnings": [],
  "blockers": []
}
```

Keep JSON plain and predictable. Prefer arrays/booleans over packed strings.

### Skill Policy

Use the Codex branch's trigger policy as the spine of `SKILL.md`, then add the
Claude VSC branch's explicit reporting order.

Final behavior:

- Run the script near the start of sessions that will execute local dev commands:
  dev servers, tests, Docker Compose, migrations, seed scripts, package installs,
  or project CLIs.
- Skip it for pure code reading, docs-only edits, remote-only GitHub work, or tiny
  edits that will not execute local project commands.
- Read the report before proceeding.
- If the verdict is blocked, stop and surface blockers before running dependent
  commands.
- If warnings are present, summarize only material warnings before continuing.
- Do not run suggested next commands automatically unless the user asked for that
  type of action and the preflight did not block it.

### README

Blend the Claude VSC README's installability with the Codex README's crisp
statement of purpose.

Include:

- What it checks.
- What it never does.
- Install commands.
- Usage examples:
  - `/dev-doctor`
  - "run dev doctor before starting the app"
  - direct script invocation
- Output paths.
- Exit codes.

## Implementation Plan

1. Start a clean branch from current `main`.
2. Add `plugins/dev-doctor` using the Claude VSC plugin files as the base.
3. Replace the script with the blended version described above.
4. Update `.claude-plugin/marketplace.json` and root `README.md`.
5. Do not include `plugins/dev-env-preflight`, root `SKILL.md`, or root
   `scripts/dev-doctor.sh`.
6. Validate locally:
   - `bash -n plugins/dev-doctor/scripts/dev-doctor.sh`
   - `jq empty .claude-plugin/marketplace.json`
   - Run the script from repo root with outputs directed to `/tmp` or another
     scratch path.
   - Run from a subdirectory to verify root detection.
   - Test behavior when Docker is missing/unreachable if possible.
7. Review generated Markdown and JSON manually for:
   - no secret values
   - no mutation
   - clear blocked/caution/ok verdict
   - stable JSON shape
   - no duplicate marketplace entries

## Acceptance Criteria

- Plugin installs as `dev-doctor`.
- Skill instructions are concise and action-oriented.
- Script is safe on macOS Bash 3.2 and Linux Bash.
- Script can run from any subdirectory.
- Script never mutates the target environment beyond writing its own report files.
- Reports include both Markdown and JSON.
- Blockers are machine-detectable and produce exit code `2`.
- Missing `.env`, invalid Compose config, unreachable Docker daemon for a
  Compose-backed repo, asdf drift, port collisions, and worktree/Compose collision
  risks are visible.
- The final diff is limited to the `dev-doctor` plugin, marketplace, README, and
  this plan if we keep it.
