# Plan: `claude-code-notifications` Plugin

## Overview

A hook-based plugin that sends push notifications to your iPhone (via [ntfy.sh](https://ntfy.sh)) whenever Claude Code needs user input, permission, or approval. This lets you walk away from your dev machine and get pinged when attention is needed.

## How It Works

1. Claude Code fires a `PermissionRequest` hook event whenever it needs approval for a tool call
2. Our hook script receives the event JSON on stdin (contains tool name, input details)
3. The script sends a POST to `ntfy.sh/<your-topic>` with a notification summary
4. Your iPhone (with the ntfy app installed) receives an instant push notification
5. The hook script outputs `{"decision": null}` so it doesn't block — it's notification-only, not a gatekeeper

## Notification Trigger

- **Hook type**: `PermissionRequest` — fires on every tool call that needs user approval
- **Matcher**: `""` (empty string = match all tools) — so you get notified for *any* permission request, not just specific tools
- **Behavior**: observe-only — the hook sends the notification but does NOT deny/allow the request; it leaves that to the user

## Files to Create

```
plugins/claude-code-notifications/
├── .claude-plugin/
│   └── plugin.json              # Plugin metadata
├── hooks/
│   └── hooks.json               # Hook config (PermissionRequest, match all)
├── notify.sh                    # POSIX shell script: parse stdin, curl ntfy
├── setup.sh                     # One-time setup: prompts for topic name, writes .env
└── README.md                    # Install & config instructions
```

### 1. `plugin.json`
Standard metadata: name `claude-code-notifications`, version `1.0.0`, description.

### 2. `hooks.json`
```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/notify.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```
- Empty matcher = fires on all permission requests
- 10 second timeout — notification is a quick curl, no need for long timeout

### 3. `notify.sh` (core logic)
- Read JSON from stdin via `jq`
- Extract: tool name, brief summary of what's being requested
- Load config (topic name) from `${CLAUDE_PLUGIN_ROOT}/.env`
- `curl -s` POST to `https://ntfy.sh/${NTFY_TOPIC}` with:
  - Title: `Claude Code — Permission Needed`
  - Body: `Tool: <tool_name> — <brief description>`
  - Priority: `high` (so it cuts through Do Not Disturb if desired)
  - Tag: `robot` (shows a robot emoji in ntfy)
- Output `{}` (empty JSON = no opinion on the permission decision)
- Fail silently — if curl fails, don't block Claude Code

### 4. `setup.sh`
- Interactive script the user runs once after install
- Prompts for ntfy topic name (or generates a random one)
- Writes `NTFY_TOPIC=<value>` to `.env` in the plugin directory
- Prints instructions for installing the ntfy iOS app and subscribing to the topic

### 5. `README.md`
- What the plugin does
- Install via marketplace
- Setup instructions (run `setup.sh`, install ntfy iOS app, subscribe to topic)
- How to customize (change priority, filter specific tools, use self-hosted ntfy)
- Requirements: `curl`, `jq`

## Marketplace Update

Add entry to `.claude-plugin/marketplace.json`:
```json
{
  "name": "claude-code-notifications",
  "source": "./plugins/claude-code-notifications",
  "description": "Push notifications to your phone when Claude Code needs input",
  "version": "1.0.0",
  "keywords": ["hooks", "notifications", "ntfy", "push"]
}
```

## Security Note

- The ntfy topic name acts as a "password" — anyone who knows it can send/receive on it
- `setup.sh` will generate a random topic by default (e.g., `claude-notify-a8f3b2`) for basic privacy
- For stronger security, the README will mention ntfy's access control / self-hosting options
- `.env` file is gitignored (add to `.gitignore`) so topic names don't leak

## Implementation Order

1. Create plugin directory structure and `plugin.json`
2. Write `hooks.json`
3. Write `notify.sh` (core notification logic)
4. Write `setup.sh` (one-time config)
5. Write `README.md`
6. Update marketplace.json
7. Update `.gitignore` to exclude `.env` files in plugin dirs
8. Commit and push to feature branch
