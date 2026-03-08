# Agentic Tools

A collection of agentic AI tools: skills, hooks, agents, prompts, MCP servers, workflows, and core configuration files.

## Structure

```
agentic-tools/
├── skills/          # Reusable skill definitions
├── hooks/           # Event-driven hooks (session-start, pre-commit, etc.)
├── agents/          # Agent configurations and definitions
├── prompts/         # Prompt templates and system prompts
├── core/            # Core files (AGENTS.md, CLAUDE.md, etc.)
├── mcp-servers/     # MCP server configurations and custom servers
└── workflows/       # Multi-step orchestrated workflows
```

## Categories

### Skills
Packaged capabilities that can be invoked by name. Each skill defines a trigger, a prompt, and optionally the tools it needs.

### Hooks
Shell commands that run in response to lifecycle events (e.g., PostToolUse, PreToolUse, Stop). Useful for environment setup, linting, guardrails, and automated review pipelines. See [hooks/](hooks/) for available hooks.

### Agents
Agent definitions and configurations — system prompts, tool access policies, and behavioral guidelines for specialized agents.

### Prompts
Reusable prompt templates and system prompts. Can be parameterized and composed into larger workflows.

### Core
Foundational configuration files like `AGENTS.md` and `CLAUDE.md` that define project-level instructions and conventions.

### MCP Servers
Model Context Protocol server configurations and custom server implementations that extend agent capabilities with external tools and data sources.

### Workflows
Multi-step orchestrated processes that combine skills, agents, and prompts into end-to-end pipelines (e.g., code review, CI/CD, onboarding).
