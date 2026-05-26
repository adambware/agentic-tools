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

Or run the script directly from the plugin directory:

```bash
bash scripts/dev-doctor.sh
```

From another project checkout, point Bash at the installed plugin script:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/dev-doctor.sh"
```

Output defaults:

- Markdown: `reports/dev-doctor.md`
- JSON: `.agent/dev-doctor.json`

Overrides:

```bash
bash scripts/dev-doctor.sh /tmp/dev-doctor.md
DEV_DOCTOR_MD_OUT=/tmp/dev-doctor.md DEV_DOCTOR_JSON_OUT=/tmp/dev-doctor.json bash scripts/dev-doctor.sh
```

`DEV_DOCTOR_OUT` is also accepted as a legacy Markdown output override.

## Exit Codes

- `0`: usable environment, with or without warnings
- `2`: blockers detected; read the report before running dependent commands
- `1`: script misuse or unexpected script failure
