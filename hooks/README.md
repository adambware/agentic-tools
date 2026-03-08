# Hooks

Event-driven shell commands that execute in response to agent lifecycle events.

## Structure

```
hooks/
└── <hook-name>/
    ├── hook.sh         # The shell script to run
    └── README.md       # Description, event type, and usage
```

## Hook Events

Common lifecycle events hooks can attach to:

- **PostToolUse**: Runs after a tool completes (validation, logging, follow-up actions)
- **PreToolUse**: Runs before a tool is invoked (guardrails, blocking dangerous commands)
- **SessionStart**: Runs when a new session begins (environment setup, dependency checks)
- **Stop**: Runs when the agent finishes responding (quality gates, continuation logic)
- **UserPromptSubmit**: Runs when a prompt is submitted (filtering, context injection)

## Available Hooks

| Hook | Event | Description |
|------|-------|-------------|
| [plan-critique](plan-critique/) | PostToolUse (Write/Edit) | Parallel critique system — spawns Opus + Codex reviewers for plan files |
