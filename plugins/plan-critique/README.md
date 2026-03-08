# Plan Critique Plugin

Parallel critique system that spawns two independent AI reviewers (Claude Opus + Codex CLI) whenever a plan file is written or edited, then consolidates their feedback into a final revised plan.

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add adamb/agentic-tools

# Install this plugin
/plugin install plan-critique@agentic-tools
```

## How It Works

1. **Trigger**: Fires on any `Write` or `Edit` of a file matching `*plan*` or `*phase*` (case-insensitive)
2. **Parallel Review**: Spawns Claude Opus and Codex CLI as independent critics, both exploring the repo for context
3. **Consolidation**: Feeds both critiques back into the parent session to produce a merged `*_final.md` plan

## Output Files

For a plan file called `my-plan.md`, the hook produces:

| File | Contents |
|------|----------|
| `my-plan_critique_opus.md` | Opus critique |
| `my-plan_critique_codex.md` | Codex critique |
| `my-plan_final.md` | Consolidated plan (after resume) |
| `my-plan_consolidation_prompt.md` | Fallback if session resume fails |

All output files are written as siblings of the original plan file.

## Requirements

- `claude` CLI (required)
- `codex` CLI (optional — degrades gracefully with a placeholder if not installed)
- `jq` (required for stdin JSON parsing in hook mode)

## Manual Usage

You can also run the hook directly from the CLI:

```bash
bash hook.sh /path/to/plan.md
```
