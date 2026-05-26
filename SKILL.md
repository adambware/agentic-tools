---
name: dev-doctor-preflight
description: Run a read-only local-dev environment preflight before any local development work, then read and summarize the report. Use at the start of any coding session that touches a runnable app, Docker, or local services.
---

# Dev environment preflight

Before doing local development work in this repo, **run the doctor first**:

```bash
bash scripts/dev-doctor.sh
```

It is read-only — it inspects the environment and writes two reports. It never
installs, migrates, starts containers, runs tests, or formats anything.

Then **read the generated report** (`reports/dev-doctor.md`, or
`.agent/dev-doctor.json` for structured consumption) and summarize for the user:

1. **What environment was detected** — project root, git branch/commit, runtime
   versions, package/runtime files, Docker + Compose status.
2. **Whether the environment appears safe to use** — quote the report verdict
   (`OK` / `CAUTION` / `BLOCKED`).
3. **Any blockers or warnings** — list them verbatim from the report.
4. **Whether this is a worktree and whether Docker identity may collide** — if
   `is_worktree` is true and Compose named volumes/project name are shared
   engine-wide, call out the collision risk explicitly.
5. **Recommended next command** — from the report's `recommended_next`.

**Do not start coding until critical environment issues (blockers) are
acknowledged by the user.** If the verdict is `BLOCKED`, stop and surface the
blockers before making changes.
