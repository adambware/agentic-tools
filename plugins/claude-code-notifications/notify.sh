#!/bin/sh
# notify.sh — Send a push notification via ntfy when Claude Code needs input
#
# Called by the PermissionRequest hook. Reads event JSON from stdin,
# extracts the tool name, and fires a notification. Does NOT block or
# alter the permission decision — observe-only.
#
# Configuration is read from ${CLAUDE_PLUGIN_ROOT}/.env (created by setup.sh).

set -eu

# ---------------------------------------------------------------------------
# Load configuration
# ---------------------------------------------------------------------------
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")" && pwd)}"
ENV_FILE="${PLUGIN_ROOT}/.env"

if [ ! -f "$ENV_FILE" ]; then
    # No config yet — silently skip so we don't break Claude Code
    exit 0
fi

# Source the env file
# shellcheck disable=SC1090
. "$ENV_FILE"

# Required
NTFY_TOPIC="${NTFY_TOPIC:-}"
if [ -z "$NTFY_TOPIC" ]; then
    exit 0
fi

# Optional — defaults for public ntfy.sh cloud
NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"
NTFY_TOKEN="${NTFY_TOKEN:-}"
NTFY_PRIORITY="${NTFY_PRIORITY:-high}"

# ---------------------------------------------------------------------------
# Parse stdin (hook event JSON)
# ---------------------------------------------------------------------------
TOOL_NAME="unknown"

if [ ! -t 0 ]; then
    INPUT="$(cat)"
    if command -v jq >/dev/null 2>&1; then
        TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // "unknown"')" || true
    fi
fi

# ---------------------------------------------------------------------------
# Build notification
# ---------------------------------------------------------------------------
TITLE="Claude Code — Permission Needed"
BODY="Tool: ${TOOL_NAME}"

# ---------------------------------------------------------------------------
# Send notification
# ---------------------------------------------------------------------------
CURL_ARGS="-s -o /dev/null -w %{http_code}"

# Build auth header if token is set
AUTH_HEADER=""
if [ -n "$NTFY_TOKEN" ]; then
    AUTH_HEADER="Authorization: Bearer ${NTFY_TOKEN}"
fi

# Fire and forget — don't let notification failures block Claude Code
(
    if [ -n "$AUTH_HEADER" ]; then
        curl $CURL_ARGS \
            -H "Title: ${TITLE}" \
            -H "Priority: ${NTFY_PRIORITY}" \
            -H "Tags: robot" \
            -H "${AUTH_HEADER}" \
            -d "${BODY}" \
            "${NTFY_SERVER}/${NTFY_TOPIC}" >/dev/null 2>&1
    else
        curl $CURL_ARGS \
            -H "Title: ${TITLE}" \
            -H "Priority: ${NTFY_PRIORITY}" \
            -H "Tags: robot" \
            -d "${BODY}" \
            "${NTFY_SERVER}/${NTFY_TOPIC}" >/dev/null 2>&1
    fi
) &

# Output empty JSON — no opinion on the permission decision
echo '{}'
