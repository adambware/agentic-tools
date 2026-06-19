# Adam Does Agentic Tools

Adam's Claude Code plugin marketplace — a collection of hooks, skills, and agents you can install.

Currently focused on using Claude and Codex in parallel to critique plans and PRs.

More orchestration patterns and plugin types to come!

## Quick Start

```bash
# Add this marketplace (once per machine)
/plugin marketplace add adambware/agentic-tools

# Install a plugin into your current project
/plugin install plan-critique@agentic-tools
```

## Available Plugins

| Plugin | Type | Description |
|--------|------|-------------|
| [plan-critique](plugins/plan-critique/) | Hook | Parallel critique system — spawns Opus + Codex reviewers for plan files |
| [ab-code-review](plugins/ab-code-review/) | Skill | Parallel code review — spawns Opus + Codex to review your branch diff |
| [onboardme](plugins/onboardme/) | Skill | Onboarding one-pager — traces one real request to make a codebase picturable in ~3 minutes |
| [nightshift](plugins/nightshift/) | Skills + Agents | Budget-aware, two-lane assurance loop — `/nightshift:security` (security + mandatory refuter) and `/nightshift:design` (UX) — keeping security surfaces and user flows fresh and refuted; onboard any repo as a `.nightshift/` pack |
| [pr-test-reviewer](plugins/pr-test-reviewer/) | Skill | Test-focused PR review — grades tests present, flags testability changes, suggests highest-value missing tests |
| [test-plan-explorer](plugins/test-plan-explorer/) | Skill | Risk-prioritized test plan for under-tested code — decides what is worth testing and why before tests are written |

## Changelog & Roadmap

- [CHANGELOG.md](CHANGELOG.md) — version history and release notes
- [TODOS.md](TODOS.md) — open work items and deferred decisions

## Creating a New Plugin

1. Create `plugins/<name>/`
2. Add `.claude-plugin/plugin.json`:
   ```json
   {
     "name": "<name>",
     "version": "1.0.0",
     "description": "What it does"
   }
   ```
3. Add your components:
   - Hooks: `hooks/hooks.json`
   - Skills: `skills/<skill-name>/SKILL.md`
   - MCP servers: `.mcp.json`
4. Add an entry to `.claude-plugin/marketplace.json`
5. Add a `README.md` with install instructions

## Structure

```
agentic-tools/
├── .claude-plugin/
│   └── marketplace.json        # Plugin registry
├── plugins/
│   └── <plugin-name>/
│       ├── .claude-plugin/
│       │   └── plugin.json     # Plugin metadata
│       ├── hooks/hooks.json    # Hook definitions (if any)
│       ├── skills/             # Skill definitions (if any)
│       ├── .mcp.json           # MCP servers (if any)
│       └── README.md
├── CLAUDE.md
└── README.md
```
