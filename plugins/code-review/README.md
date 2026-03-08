# Code Review Plugin

Parallel code review system that spawns two independent AI reviewers (Claude Opus + Codex CLI) to review your branch diff against main, then consolidates their feedback into a triaged action plan.

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add adamb/agentic-tools

# Install this plugin
/plugin install code-review@agentic-tools
```

## How It Works

1. **Trigger**: Manual — invoke via the `/code-review` skill or run `bash review.sh` directly
2. **Diff**: Computes `git diff main...HEAD` for your current branch
3. **Parallel Review**: Spawns Claude Opus and Codex CLI as independent reviewers, both exploring the repo for context
4. **Consolidation**: Feeds both reviews back into the parent session to produce a triaged action plan and begins fixing must-fix issues

## Output Files

All output is written to `.code-review/` in the repository root:

| File | Contents |
|------|----------|
| `review_opus.md` | Opus review |
| `review_codex.md` | Codex review |
| `review_final.md` | Consolidated review with action plan |
| `review_consolidation_prompt.md` | Fallback if session resume fails |

> **Tip**: Add `.code-review/` to your project's `.gitignore`.

## Requirements

- `claude` CLI (required)
- `codex` CLI (optional — degrades gracefully with a placeholder if not installed)
- `jq` (required if invoked via stdin JSON mode)
- Must be on a feature branch (not main/master)

## Manual Usage

```bash
# Review current branch vs main
bash review.sh

# Review current branch vs a specific base
bash review.sh develop
```
