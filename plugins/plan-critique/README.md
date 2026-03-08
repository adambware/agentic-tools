# Plan Critique Plugin

Parallel critique system that spawns two independent AI reviewers (Claude Opus + Codex CLI) when you exit plan mode, then consolidates their feedback into a final revised plan.

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add adamb/agentic-tools

# Install this plugin
/plugin install plan-critique@agentic-tools
```

## How It Works

1. **Trigger**: Fires on `ExitPlanMode` — when a plan is finalized and approved
2. **Plan capture**: Extracts the plan content from the tool input and writes it to `.plan-critique/`
3. **Parallel Review**: Spawns Claude Opus and Codex CLI as independent critics, both exploring the repo for context
4. **Consolidation**: Feeds both critiques back into the parent session to produce a merged final plan

## Output Files

All output is written to `.plan-critique/` in the repository root:

| File | Contents |
|------|----------|
| `plan_<timestamp>.md` | The original plan |
| `plan_<timestamp>_critique_opus.md` | Opus critique |
| `plan_<timestamp>_critique_codex.md` | Codex critique |
| `plan_<timestamp>_final.md` | Consolidated plan (after resume) |
| `plan_<timestamp>_consolidation_prompt.md` | Fallback if session resume fails |

> **Tip**: Add `.plan-critique/` to your project's `.gitignore`.

## Requirements

- `claude` CLI (required)
- `codex` CLI (optional — degrades gracefully with a placeholder if not installed)
- `jq` (required for stdin JSON parsing in hook mode)

## Manual Usage

You can also run the hook directly from the CLI:

```bash
bash hook.sh /path/to/plan.md
```
