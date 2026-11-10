# dev-doctor

`dev-doctor` is a read-only local-development preflight for agents. It inspects
the checkout and writes reports the agent can read before running dev servers,
tests, Docker Compose, migrations, package installs, or app CLIs.

It never mutates the project or local services: no installs, migrations,
container starts/stops, tests, formatters, or secret-value printing. It only
reads state and writes its own Markdown and JSON reports.

## What It Checks

- Project root and current working directory
- Git branch, commit, dirty state, and worktree count
- `.tool-versions` drift against active `asdf` versions
- Detected manifests such as `package.json`, `go.mod`, `Dockerfile`,
  `compose.yaml`, `docker-compose.yml`, `.env`, `.env.example`, and `Makefile`
- Docker CLI, daemon reachability, context, and Compose command availability
- Compose config validity, project name, top-level `name:`, `container_name:`,
  fixed host ports, referenced env files, named volumes, and running project
  containers
- Missing `.env` files and keys present in `.env.example` but absent from `.env`
- Likely setup/run commands from Makefile, package scripts, and README

## Install

```bash
/plugin marketplace add adambware/agentic-tools
/plugin install dev-doctor@agentic-tools
```

## Usage

Ask the agent:

```text
/dev-doctor
run dev doctor before starting the app
```

Or run the script directly. It inspects the git checkout that contains your
current directory, so run it from inside the project you want to check and
point Bash at the plugin script:

```bash
bash /path/to/dev-doctor/scripts/dev-doctor.sh
```

Inside a skill, `${CLAUDE_PLUGIN_ROOT}` is set to the installed plugin
directory, so the skill uses
`bash "${CLAUDE_PLUGIN_ROOT}/scripts/dev-doctor.sh"`.

Output defaults (printed in the terminal summary):

- Markdown: `<git-dir>/dev-doctor/dev-doctor.md`
- JSON: `<git-dir>/dev-doctor/dev-doctor.json`

`<git-dir>` is `git rev-parse --absolute-git-dir`, which is `.git/` for a
primary checkout and `.git/worktrees/<name>/` for a linked worktree. Reports
there are never tracked and never show up in `git status`. Outside a git
checkout the default is `${TMPDIR:-/tmp}/dev-doctor/<dir-name>/`.

Overrides:

```bash
bash /path/to/dev-doctor/scripts/dev-doctor.sh /tmp/dev-doctor.md
DEV_DOCTOR_MD_OUT=/tmp/dev-doctor.md DEV_DOCTOR_JSON_OUT=/tmp/dev-doctor.json bash /path/to/dev-doctor/scripts/dev-doctor.sh
```

Relative paths resolve against the current directory. If an override points
inside the checkout, those report paths are excluded from the dirty check.
`DEV_DOCTOR_OUT` is also accepted as a legacy Markdown output override.
`--help` prints usage.

## Exit Codes

- `0`: usable environment, with or without warnings
- `2`: blockers detected; read the report before running dependent commands
- `1`: script misuse (unknown flag, extra arguments) or unexpected script failure

Secret values from `.env` and Compose env files are never printed. Only key
names are compared, and any third-party output embedded in a report (the
`compose config` error excerpt) has those values redacted first.
