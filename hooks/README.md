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

- **session-start**: Runs when a new session begins (environment setup, dependency checks)
- **pre-tool-use**: Runs before a tool is invoked (validation, guardrails)
- **post-tool-use**: Runs after a tool completes (logging, cleanup)
- **pre-commit**: Runs before a git commit (linting, formatting)
