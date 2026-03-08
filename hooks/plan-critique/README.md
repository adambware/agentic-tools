# Plan Critique Hook

Parallel critique system that spawns two independent AI reviewers (Claude Opus + Codex CLI) whenever a plan file is written or edited, then consolidates their feedback into a final revised plan.

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

## Trigger Methods

| Method | How |
|--------|-----|
| Automatic | PostToolUse hook fires on Write/Edit (registered in `.claude/settings.json`) |
| VSCode | "Run Plan Critiques" task (`Ctrl+Shift+P` > Tasks: Run Task) |
| CLI | `bash hooks/plan-critique/hook.sh /path/to/plan.md` |

## Requirements

- `claude` CLI (required)
- `codex` CLI (optional — degrades gracefully with a placeholder if not installed)
- `jq` (required for stdin JSON parsing in hook mode)

## Configuration

The hook is registered in `.claude/settings.json` as an async PostToolUse hook:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash hooks/plan-critique/hook.sh",
            "async": true,
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```
