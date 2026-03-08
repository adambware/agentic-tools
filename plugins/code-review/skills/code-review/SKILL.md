# Code Review

Run a parallel code review of your current branch against main using two independent AI reviewers (Claude Opus + Codex).

## When to use

Use this skill when the user asks for a code review of their current branch, their changes, or their diff.

## How to invoke

Run the review script:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/review.sh
```

You can also pass a base branch if the user specifies one:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/review.sh develop
```

The script will:
1. Compute `git diff main...HEAD` for the current branch
2. Spawn two parallel reviewers (Opus + Codex)
3. Wait for both to finish
4. Feed consolidated feedback back into this session with an action plan

## Output

Review files are written to `.code-review/` in the repository root:

| File | Contents |
|------|----------|
| `review_opus.md` | Opus review |
| `review_codex.md` | Codex review |
| `review_final.md` | Consolidated review with action plan |

## Requirements

- Current directory must be inside a git repository
- Branch must have commits ahead of main
- `claude` CLI must be available
- `codex` CLI is optional (degrades gracefully)
