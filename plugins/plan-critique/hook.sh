#!/bin/bash
# critique-plan.sh — Parallel critique system for plan files
#
# Usage:
#   Manual:       bash critique-plan.sh /path/to/my-plan.md
#   Hook (stdin): Called by PostToolUse hook on ExitPlanMode, reads JSON from stdin
#
# Spawns two parallel critic agents (Claude Opus + Codex CLI), waits for both,
# then outputs the consolidated critique to stdout (returned to parent session).

set -euo pipefail

# ---------------------------------------------------------------------------
# Debug setup
# ---------------------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PLAN_DIR="${REPO_ROOT}/.plan-critique"
mkdir -p "$PLAN_DIR"
DEBUG_LOG="${PLAN_DIR}/debug.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$DEBUG_LOG"
}

log "=== Hook invoked ==="
log "Args: $*"

# ---------------------------------------------------------------------------
# Input handling
# ---------------------------------------------------------------------------
PLAN_FILE=""
PLAN_CONTENT=""

if [ $# -ge 1 ] && [ -n "${1:-}" ]; then
    # Manual mode: file path as argument
    PLAN_FILE="$1"
    log "Manual mode: PLAN_FILE=$PLAN_FILE"
    if [ ! -f "$PLAN_FILE" ]; then
        echo "ERROR: File does not exist: $PLAN_FILE"
        exit 1
    fi
    PLAN_CONTENT="$(cat "$PLAN_FILE")"
elif [ ! -t 0 ]; then
    # Hook mode: read JSON from stdin
    INPUT="$(cat)"
    log "Hook mode stdin received (${#INPUT} bytes)"
    log "Full stdin JSON: $INPUT"
    PLAN_CONTENT="$(echo "$INPUT" | jq -r '.tool_input.plan // empty')"
    log "Extracted plan content length: ${#PLAN_CONTENT}"
else
    log "SKIP: No stdin and no args"
    echo "SKIP: No plan provided (pass file path as argument or pipe JSON on stdin)"
    exit 0
fi

# ---------------------------------------------------------------------------
# Guard clauses
# ---------------------------------------------------------------------------
if [ -z "$PLAN_CONTENT" ]; then
    log "SKIP: No plan content found"
    echo "SKIP: No plan content found"
    exit 0
fi

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
PLAN_FILE="${PLAN_DIR}/plan_${TIMESTAMP}.md"
CRITIQUE_OPUS="${PLAN_DIR}/plan_${TIMESTAMP}_critique_opus.md"
CRITIQUE_CODEX="${PLAN_DIR}/plan_${TIMESTAMP}_critique_codex.md"
FINAL_PLAN="${PLAN_DIR}/plan_${TIMESTAMP}_final.md"

# Write the plan content to a file so reviewers can read it
echo "$PLAN_CONTENT" > "$PLAN_FILE"

log "Plan written to: $PLAN_FILE"

# Prevent nested session errors
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
log "Spawning Opus critic..."
claude -p "$CRITIQUE_PROMPT" --output-format text > "$CRITIQUE_OPUS" 2>&1 &
PID_OPUS=$!
log "  Opus PID: $PID_OPUS"

if command -v codex >/dev/null 2>&1; then
    log "Spawning Codex critic..."
    codex exec "$CRITIQUE_PROMPT" > "$CRITIQUE_CODEX" 2>&1 &
    PID_CODEX=$!
    log "  Codex PID: $PID_CODEX"
else
    log "codex not found on PATH — skipping"
    cat > "$CRITIQUE_CODEX" <<'PLACEHOLDER'
# Codex Critique — Not Available

Codex CLI was not installed when this critique was generated.
To enable dual-critic mode, install Codex CLI and ensure it is on your PATH.
PLACEHOLDER
    PID_CODEX=""
fi

# Wait for both to finish
log "Waiting for critics to complete..."
wait "$PID_OPUS" && log "  Opus critic finished (exit 0)" || log "  Opus critic finished (exit $?)"
if [ -n "$PID_CODEX" ]; then
    wait "$PID_CODEX" && log "  Codex critic finished (exit 0)" || log "  Codex critic finished (exit $?)"
fi

log "Critique files written: $CRITIQUE_OPUS, $CRITIQUE_CODEX"

# ---------------------------------------------------------------------------
# Output consolidation prompt to stdout (returned to parent session)
# ---------------------------------------------------------------------------
OPUS_CONTENT="$(cat "$CRITIQUE_OPUS")"
CODEX_CONTENT="$(cat "$CRITIQUE_CODEX")"

cat <<EOF
The two critic agents have completed their reviews of your plan.

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

Format it as a clean, production-ready plan — not a critique response. The final.md should be the document someone picks up to start executing.
EOF

log "=== Plan critique complete ==="
