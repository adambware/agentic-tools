#!/bin/bash
# critique-plan.sh — Parallel critique system for plan files
#
# Usage:
#   Manual/VSCode:  bash critique-plan.sh /path/to/my-plan.md
#   Hook (stdin):   Called by PostToolUse hook, reads JSON from stdin
#
# Spawns two parallel critic agents (Claude Opus + Codex CLI), waits for both,
# then feeds consolidated critiques back into the parent session.

set -euo pipefail

# ---------------------------------------------------------------------------
# Input handling
# ---------------------------------------------------------------------------
# Accept file path as argument (manual/VSCode) or extract from stdin JSON (hook)
PLAN_FILE=""
SESSION_ID=""

if [ $# -ge 1 ] && [ -n "${1:-}" ]; then
    PLAN_FILE="$1"
elif [ ! -t 0 ]; then
    # Hook mode: read JSON from stdin
    INPUT="$(cat)"
    PLAN_FILE="$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')"
    SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // empty')"
else
    echo "SKIP: No file path provided (pass as argument or pipe JSON on stdin)"
    exit 0
fi

# ---------------------------------------------------------------------------
# Guard clauses
# ---------------------------------------------------------------------------
if [ -z "$PLAN_FILE" ]; then
    echo "SKIP: No file path extracted"
    exit 0
fi

# Resolve to absolute path if relative
if [ "${PLAN_FILE#/}" = "$PLAN_FILE" ]; then
    PLAN_FILE="$(pwd)/$PLAN_FILE"
fi

if [ ! -f "$PLAN_FILE" ]; then
    echo "SKIP: File does not exist: $PLAN_FILE"
    exit 0
fi

# Case-insensitive check for plan/phase patterns
BASENAME="$(basename "$PLAN_FILE")"
if ! echo "$BASENAME" | grep -iqE '(plan|phase)'; then
    echo "SKIP: File does not match plan patterns (plan/phase): $BASENAME"
    exit 0
fi

echo "=== Plan critique triggered for: $PLAN_FILE ==="

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
PLAN_DIR="$(dirname "$PLAN_FILE")"
PLAN_BASE="${BASENAME%.*}"

CRITIQUE_OPUS="${PLAN_DIR}/${PLAN_BASE}_critique_opus.md"
CRITIQUE_CODEX="${PLAN_DIR}/${PLAN_BASE}_critique_codex.md"
FINAL_PLAN="${PLAN_DIR}/${PLAN_BASE}_final.md"

# Session ID: prefer stdin JSON, fall back to env vars
if [ -z "$SESSION_ID" ]; then
    SESSION_ID="${CLAUDE_SESSION_ID:-}"
fi
if [ -z "$SESSION_ID" ]; then
    SESSION_ID="${CLAUDE_TOOL_SESSION_ID:-}"
fi

HAS_SESSION="true"
if [ -z "$SESSION_ID" ]; then
    echo "WARNING: No parent session ID available. Critiques will run but auto-resume is disabled."
    HAS_SESSION="false"
fi

# Prevent "nested session" error when spawning claude from inside a hook
unset CLAUDECODE 2>/dev/null || true
unset CLAUDE_CODE_ENVIRONMENT_KIND 2>/dev/null || true

# ---------------------------------------------------------------------------
# Critique prompt
# ---------------------------------------------------------------------------
CRITIQUE_PROMPT="You are a senior staff engineer performing a design review.

Your job:
1. Read the plan file at: $PLAN_FILE
2. Explore the repository for relevant context — existing modules, current architecture, CLAUDE.md conventions, anything that bears on whether this plan is sound
3. Produce a structured critique covering:
   - Missing edge cases or failure modes
   - Architectural risks or tech debt traps
   - Sequencing problems (wrong order, missing prerequisites, things that will block later phases)
   - Scope gaps (what should be in this plan but isn't)
   - Assumptions that need explicit validation before work starts
   - Conflicts with existing code or conventions you found in the repo

Be specific. Reference actual files and line numbers where relevant. Be ruthless but constructive — the goal is a better plan, not a takedown."

# ---------------------------------------------------------------------------
# Parallel execution
# ---------------------------------------------------------------------------
echo "Spawning Opus critic..."
claude -p "$CRITIQUE_PROMPT" --output-format text > "$CRITIQUE_OPUS" 2>&1 &
PID_OPUS=$!
echo "  Opus PID: $PID_OPUS"

if command -v codex >/dev/null 2>&1; then
    echo "Spawning Codex critic..."
    codex exec "$CRITIQUE_PROMPT" > "$CRITIQUE_CODEX" 2>&1 &
    PID_CODEX=$!
    echo "  Codex PID: $PID_CODEX"
else
    echo "NOTE: codex not found on PATH — skipping Codex critic"
    cat > "$CRITIQUE_CODEX" <<'PLACEHOLDER'
# Codex Critique — Not Available

Codex CLI was not installed when this critique was generated.
To enable dual-critic mode, install Codex CLI and ensure it is on your PATH.
PLACEHOLDER
    PID_CODEX=""
fi

# Wait for both to finish
echo "Waiting for critics to complete..."
wait "$PID_OPUS" && echo "  Opus critic finished (exit 0)" || echo "  Opus critic finished (exit $?)"
if [ -n "$PID_CODEX" ]; then
    wait "$PID_CODEX" && echo "  Codex critic finished (exit 0)" || echo "  Codex critic finished (exit $?)"
fi

echo ""
echo "Critique files written:"
echo "  Opus:  $CRITIQUE_OPUS"
echo "  Codex: $CRITIQUE_CODEX"

# ---------------------------------------------------------------------------
# Build consolidation prompt
# ---------------------------------------------------------------------------
OPUS_CONTENT="$(cat "$CRITIQUE_OPUS")"
CODEX_CONTENT="$(cat "$CRITIQUE_CODEX")"

CONSOLIDATION_PROMPT="The two critic agents have completed their reviews of your plan.

## Critic 1: Opus (second instance)
$OPUS_CONTENT

---

## Critic 2: Codex
$CODEX_CONTENT

---

## Your Task: Consolidate

You wrote the original plan at $PLAN_FILE. You've now received external critique from two independent agents.

Produce a final revised plan that:
1. Integrates valid critique points — update the plan accordingly
2. Explicitly rejects critique points you disagree with — state why and keep your original approach
3. Resolves conflicts between the two critiques using your own judgment — pick a side and explain it
4. Calls out any new open questions surfaced by the critiques that need human decision before work starts
5. Preserves your original intent and structure where the critiques are off-base

Write the final consolidated plan to: $FINAL_PLAN

Format it as a clean, production-ready plan — not a critique response. The final.md should be the document someone picks up to start executing."

# ---------------------------------------------------------------------------
# Resume parent session
# ---------------------------------------------------------------------------
if [ "$HAS_SESSION" = "true" ]; then
    echo ""
    echo "Resuming parent session ($SESSION_ID) with consolidation prompt..."
    claude --resume "$SESSION_ID" -p "$CONSOLIDATION_PROMPT" --output-format text 2>&1 || {
        echo "WARNING: Failed to resume session. Writing consolidation prompt to file instead."
        HAS_SESSION="false"
    }
fi

if [ "$HAS_SESSION" = "false" ]; then
    CONSOLIDATION_FILE="${PLAN_DIR}/${PLAN_BASE}_consolidation_prompt.md"
    echo ""
    echo "Session ID not available or resume failed."
    echo "Writing consolidation prompt to: $CONSOLIDATION_FILE"
    echo "Paste its contents into your Claude session to consolidate the critiques."
    cat > "$CONSOLIDATION_FILE" <<EOF
$CONSOLIDATION_PROMPT
EOF
    echo ""
    echo "=== Consolidation prompt ==="
    echo "$CONSOLIDATION_PROMPT"
fi

echo ""
echo "=== Plan critique complete ==="
