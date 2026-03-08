# claude-code-notifications

Push notifications to your phone via [ntfy](https://ntfy.sh) when Claude Code needs input, permission, or approval. Walk away from your dev machine and get pinged when attention is needed.

Works with the public ntfy.sh cloud or your own self-hosted ntfy server.

## Install

```bash
# Add the marketplace (if not already added)
claude mcp add-json agentic-tools '{"type":"url","url":"https://raw.githubusercontent.com/adambware/agentic-tools/main/.claude-plugin/marketplace.json"}'

# Install the plugin
claude plugin install claude-code-notifications
```

## Setup

Run the setup script once after installing:

```bash
bash plugins/claude-code-notifications/setup.sh
```

You will be prompted for:

| Setting | Description | Default |
|---------|-------------|---------|
| **Server URL** | Your ntfy server | `https://ntfy.sh` |
| **Topic** | Channel name for notifications | Random (e.g. `claude-notify-a8f3b2`) |
| **Access token** | Bearer token for authenticated servers | _(none)_ |
| **Priority** | Notification urgency: `min`, `low`, `default`, `high`, `max` | `high` |

Configuration is saved to `plugins/claude-code-notifications/.env` (gitignored).

Then install the **ntfy app** on your phone and subscribe to your topic:

- [iOS App Store](https://apps.apple.com/us/app/ntfy/id1625396347)
- [Android Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy)

If using a self-hosted server, add it in the ntfy app settings before subscribing to your topic.

## How It Works

1. Claude Code fires a `PermissionRequest` event whenever it needs approval for a tool call
2. The hook script reads the event JSON and extracts the tool name
3. A notification is sent to your ntfy topic via `curl`
4. Your phone receives a push notification with the tool name
5. The hook does **not** block — it outputs `{}` so Claude Code continues waiting for your response as normal

## Self-Hosted ntfy

For a private self-hosted setup:

1. Run your own [ntfy server](https://docs.ntfy.sh/install/)
2. During `setup.sh`, enter your server URL (e.g. `https://ntfy.example.com`)
3. If you've configured [access control](https://docs.ntfy.sh/config/#access-control), provide your access token
4. Subscribe to the topic in the ntfy app pointed at your server

You can also edit `.env` directly:

```bash
NTFY_SERVER="https://ntfy.example.com"
NTFY_TOPIC="claude-alerts"
NTFY_TOKEN="tk_your_access_token_here"
NTFY_PRIORITY="high"
```

## Requirements

- `curl`
- `jq` (optional — used for richer notifications; works without it)

## Manual Test

```bash
# Test your notification setup
curl -H "Title: Test" -d "Hello from Claude Code" https://your-server/your-topic
```
