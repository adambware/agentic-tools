---
name: dev-doctor
description: Read-only local environment preflight. Before any local development work, run scripts/dev-doctor.sh, read the generated report, and summarize what was detected, whether the environment is safe, any blockers, worktree/Docker identity collisions, and the recommended next command. Use at the start of a coding session, when picking up an unfamiliar checkout, when entering a git worktree, or before running/building/migrating anything locally.
---

# dev-doctor: environment preflight

Before changing code in an unfamiliar or freshly-checked-out local environment,
you need a deterministic picture of what's there. `dev-doctor.sh` is a **free,
read-only** Bash step that inspects the environment and writes a structured
report. It never installs, migrates, starts containers, runs tests, or formats —
it only reads state and emits warnings.

## The rule

Before local development work, run:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/dev-doctor.sh"
```

(Outside this plugin, the path is `scripts/dev-doctor.sh` or wherever the script
lives. It writes `reports/dev-doctor.md` under the project root by default; pass
a path argument or set `DEV_DOCTOR_OUT` to change it. The full report is also
printed to stdout, so you can read it directly from the command output.)

Then **read the report** and summarize for the user, in this order:

1. **What environment was detected** — runtimes (`.tool-versions`), package
   managers (`package.json`, `composer.json`, `go.mod`), Docker/Compose,
   Makefile, env files.
2. **Whether the environment appears safe to use** — quote the report's verdict
   (✅ safe / ⚠️ warnings / ⛔ blockers).
3. **Any blockers or warnings** — missing `.env`, version mismatches, port
   conflicts, invalid Compose config, unreachable Docker daemon.
4. **Whether this is a worktree and whether Docker identity may collide** — if
   the report flags multiple worktrees or a directory-derived Compose project
   name, call out that containers and named volumes can collide with sibling
   worktrees unless `COMPOSE_PROJECT_NAME` is set per worktree.
5. **Recommended next command** — the most likely setup/run command from the
   report's "Likely setup commands" section (e.g. `make setup`, `npm install`,
   `docker compose up`).

## Do not start coding until critical environment issues are acknowledged

If the report's verdict is **⛔ blockers present** (the script also exits non-zero,
code `2`), stop and surface the blockers to the user before making changes. Do
not silently work around a missing `.env`, an unreachable Docker daemon, or an
invalid Compose config — name the issue and let the user decide.

For ⚠️ warnings (e.g. an asdf version mismatch), proceed only after noting them.

## What the script checks

- Working directory and project root (safe to run from any subdirectory)
- Git branch, commit, dirty state, worktree status
- Detected manifests: `.tool-versions`, `package.json`, `composer.json`,
  `go.mod`, `Dockerfile`, `docker-compose.yml`, `compose.yml`, `.env`,
  `.env.example`, `Makefile`
- Active `asdf` versions vs `.tool-versions`
- Docker availability and current Docker context
- Docker Compose config validity, inferred project name, running containers
- Published host ports and likely port conflicts
- Named volumes that may collide across worktrees
- Missing required env files (and keys present in `.env.example` but not `.env`)
- Likely setup commands from README, Makefile, and package scripts

It degrades gracefully when `jq`/`yq`/`asdf`/`docker` are unavailable, and works
on macOS and Linux.
