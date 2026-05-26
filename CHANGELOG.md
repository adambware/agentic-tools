# Changelog

## [0.1.0.0] - 2026-05-26

### Added

- Added `dev-doctor`, an installable Claude Code plugin for read-only local environment preflights before agents run local development commands.
- Added Markdown and JSON report output for git/worktree state, runtime pins, Docker/Compose status, env-file gaps, collision risks, setup hints, and recommended next commands.
- Added README discovery for `pr-test-reviewer`, `test-plan-explorer`, and `dev-doctor`.

### For Contributors

- Added minimal-dependency shell tests and GitHub Actions coverage for plugin manifests, report generation, env blockers, Compose warnings, and setup-command detection.
- Added testing guidance for marketplace plugin changes.
