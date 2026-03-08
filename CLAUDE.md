# CLAUDE.md

Project-level instructions for Claude Code sessions.

## Project Overview

This repository is a Claude Code plugin marketplace. Each plugin lives in `plugins/<name>/` and can contain hooks, skills, agents, or MCP servers.

## Conventions

- Each plugin lives in its own directory under `plugins/`
- Every plugin has `.claude-plugin/plugin.json` with name, version, and description
- Every plugin directory includes a `README.md` with install instructions
- Hook scripts should be POSIX-compatible shell
- Use `${CLAUDE_PLUGIN_ROOT}` in hook commands to reference files within the plugin

## Adding a Plugin

1. Create `plugins/<name>/` with the appropriate structure
2. Add an entry to `.claude-plugin/marketplace.json`
3. See the top-level README.md for the full template
