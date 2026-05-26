---
name: dev-doctor
description: Read-only local environment preflight. Use near the start of local development sessions before running dev servers, tests, Docker Compose, migrations, package installs, seed scripts, or app CLIs, especially in repos with .tool-versions, Compose files, env files, worktrees, or local ports.
---

# dev-doctor

`dev-doctor` is a non-mutating preflight for local development. It inspects the
checkout and writes reports for the agent to read before running commands that
depend on the machine, worktree, Docker daemon, runtimes, ports, or env files.

## Trigger Policy

Run this skill near the start of sessions that will execute local development
commands: dev servers, tests, Docker Compose services, migrations, seed scripts,
package installs, or app CLIs. Be more aggressive when the repo has
`.tool-versions`, `compose.yaml`, `docker-compose.yml`, `.env.example`, or
multiple git worktrees.

Skip it for pure code reading, docs-only edits, remote-only GitHub work, or tiny
edits that will not execute local project commands.

## Workflow

Run the bundled script from the current project checkout:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/dev-doctor.sh"
```

Then read the terminal summary and the generated reports before proceeding. The
script writes Markdown to `reports/dev-doctor.md` and JSON to
`.agent/dev-doctor.json` by default. A first positional argument or
`DEV_DOCTOR_MD_OUT` changes the Markdown path; `DEV_DOCTOR_JSON_OUT` changes the
JSON path.

Report back to the user in this order:

1. What environment was detected: runtimes, package managers, Docker/Compose,
   Makefile, env files, and worktree status.
2. The verdict: `ok`, `caution`, or `blocked`.
3. Any blockers, then material warnings.
4. Whether Docker identity may collide across worktrees because of
   `container_name:`, a top-level Compose `name:`, fixed host ports, named
   volumes, or a shared `COMPOSE_PROJECT_NAME`.
5. The recommended next command, as a suggestion to confirm.

## Stop Conditions

If the verdict is `blocked` or the script exits `2`, stop and surface the
blockers before running dependent commands. Do not silently work around missing
env files, invalid Compose config, or an unreachable Docker daemon for a
Compose-backed repo.

For `caution`, summarize only the warnings that matter to the requested work and
continue when they do not block it.

## Standards

- The script never installs packages, starts or stops services, runs migrations,
  runs tests, formats files, or prints secret values.
- `.tool-versions` is treated as the source of truth for runtime versions.
- Docker-dependent work requires both a Compose command and a reachable Docker
  daemon.
- Compose projects used from worktrees need isolated project names, containers,
  ports, and volumes.
- Suggested next commands are not run automatically unless the user asked for
  that type of action and the preflight did not block it.
