# dev-doctor

A **read-only** local-development preflight. Before a coding session, it runs a
deterministic, free Bash analysis of your environment and writes a structured
report the agent reads before making any changes. It **never mutates anything** —
no installs, migrations, containers, tests, or formatters. It only reads state
and emits warnings.

## What it checks

- Working directory and project root (safe to run from any subdirectory)
- Git branch, commit, dirty state, and worktree status
- Detected manifests: `.tool-versions`, `package.json`, `composer.json`,
  `go.mod`, `Dockerfile`, `docker-compose.yml`, `compose.yml`, `.env`,
  `.env.example`, `Makefile`
- Active `asdf` versions vs `.tool-versions`
- Docker availability and current Docker context
- Docker Compose config validity and inferred project name
- Running containers for this project
- Published host ports and **likely port conflicts**
- **Named volumes that may collide across worktrees**
- Missing required env files (and keys in `.env.example` absent from `.env`)
- Likely setup commands from README, Makefile, and package scripts

It degrades gracefully when `jq` / `yq` / `asdf` / `docker` are unavailable, and
runs on macOS (bash 3.2) and Linux.

## Usage

```bash
# Default: writes <project-root>/reports/dev-doctor.md and prints to stdout
bash scripts/dev-doctor.sh

# Custom output path
bash scripts/dev-doctor.sh .agent/dev-doctor.md
DEV_DOCTOR_OUT=.agent/dev-doctor.md bash scripts/dev-doctor.sh
```

Exit code is `0` when the environment is usable (even with warnings) and `2`
when blockers are present, so you can gate a script on it:

```bash
bash scripts/dev-doctor.sh || echo "environment has blockers — review the report"
```

The generated report is a build artifact — add `reports/dev-doctor.md` (or
your chosen path) to `.gitignore` in the consuming project.

## Install

```bash
/plugin marketplace add adambware/agentic-tools
/plugin install dev-doctor@agentic-tools
```

## The agent rule

The bundled `dev-doctor` skill tells the agent to run the script and read the
report **before** local development work, then summarize: what was detected,
whether it's safe to use, any blockers/warnings, whether this is a worktree with
possible Docker identity collisions, and the recommended next command — and to
**not start coding until critical environment issues are acknowledged.**
