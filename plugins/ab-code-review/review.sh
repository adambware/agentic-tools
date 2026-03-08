#!/bin/bash
# review.sh — Parallel code review system for branch diffs
#
# Usage:
#   Manual:   bash review.sh                  # Review current branch vs main
#             bash review.sh <base-branch>     # Review against a specific base
#   Skill:    Invoked by SKILL.md via Claude Code
#
# Spawns two parallel reviewer agents (Claude Opus + Codex CLI), waits for both,
# then feeds consolidated review back into the parent session.

set -euo pipefail

# ---------------------------------------------------------------------------
# Input handling
# ---------------------------------------------------------------------------
SESSION_ID=""
BASE_BRANCH=""

if [ $# -ge 1 ] && [ -n "${1:-}" ]; then
    BASE_BRANCH="$1"
elif [ ! -t 0 ]; then
    # Skill/hook mode: read JSON from stdin
    INPUT="$(cat)"
    SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // empty')"
fi

# ---------------------------------------------------------------------------
# Guard clauses
# ---------------------------------------------------------------------------
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: Not inside a git repository"
    exit 1
fi

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Detect base branch if not provided
if [ -z "$BASE_BRANCH" ]; then
    if git show-ref --verify --quiet refs/heads/main; then
        BASE_BRANCH="main"
    elif git show-ref --verify --quiet refs/heads/master; then
        BASE_BRANCH="master"
    else
        echo "ERROR: Could not find main or master branch. Pass base branch as argument."
        exit 1
    fi
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
    echo "ERROR: You are on $BASE_BRANCH. Switch to a feature branch first."
    exit 1
fi

DIFF="$(git diff "${BASE_BRANCH}...HEAD")"
if [ -z "$DIFF" ]; then
    echo "SKIP: No diff between $CURRENT_BRANCH and $BASE_BRANCH"
    exit 0
fi

DIFF_STAT="$(git diff --stat "${BASE_BRANCH}...HEAD")"
COMMIT_LOG="$(git log --oneline "${BASE_BRANCH}..HEAD")"

echo "=== Code review triggered for branch: $CURRENT_BRANCH (vs $BASE_BRANCH) ==="
echo "$DIFF_STAT"
echo ""

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
REVIEW_DIR="${REPO_ROOT}/.code-review"
mkdir -p "$REVIEW_DIR"

REVIEW_OPUS="${REVIEW_DIR}/review_opus.md"
REVIEW_CODEX="${REVIEW_DIR}/review_codex.md"
REVIEW_FINAL="${REVIEW_DIR}/review_final.md"

# Session ID: prefer stdin JSON, fall back to env vars
if [ -z "$SESSION_ID" ]; then
    SESSION_ID="${CLAUDE_SESSION_ID:-}"
fi
if [ -z "$SESSION_ID" ]; then
    SESSION_ID="${CLAUDE_TOOL_SESSION_ID:-}"
fi

HAS_SESSION="true"
if [ -z "$SESSION_ID" ]; then
    echo "WARNING: No parent session ID available. Reviews will run but auto-resume is disabled."
    HAS_SESSION="false"
fi

# Prevent nested session errors
unset CLAUDECODE 2>/dev/null || true
unset CLAUDE_CODE_ENVIRONMENT_KIND 2>/dev/null || true

# ---------------------------------------------------------------------------
# Review prompt
# ---------------------------------------------------------------------------
REVIEW_PROMPT="You are a senior staff engineer performing a thorough code review.

## Context
- Repository: $REPO_ROOT
- Branch: $CURRENT_BRANCH (compared against $BASE_BRANCH)
- Commits:
$COMMIT_LOG

## The Diff
\`\`\`diff
$DIFF
\`\`\`

## Your Task

Perform a thorough code review of this diff. For each issue found, specify the file, line number, severity (must-fix / should-fix / nit), and a clear explanation.

Review for:
1. **Bugs, logic errors, off-by-one errors** — trace through the code paths mentally
2. **Security vulnerabilities** — injection, auth issues, data exposure, unsafe deserialization
3. **Performance issues** — unnecessary allocations, O(n^2) where O(n) is possible, missing indexes
4. **Missing error handling** — especially at system boundaries (I/O, network, subprocess, parsing)
5. **API contract violations** — check if changes break existing interfaces or assumptions
6. **Test coverage gaps** — what behavior is untested? What edge cases are missing?
7. **Style and convention violations** — check the repo's CLAUDE.md and existing patterns for conventions

Also explore the repository for context: read related files, check existing tests, understand the architecture. Do NOT review the diff in isolation.

## Output Format

Structure your review as:

### Summary
One paragraph overall assessment.

### Must-Fix Issues
Numbered list. Each item: file:line, description, suggested fix.

### Should-Fix Issues
Same format.

### Nits / Suggestions
Same format.

### What Looks Good
Brief list of things done well (important for morale and balance)."

# ---------------------------------------------------------------------------
# Parallel execution
# ---------------------------------------------------------------------------
echo "Spawning Opus reviewer..."
claude -p "$REVIEW_PROMPT" --output-format text > "$REVIEW_OPUS" 2>&1 &
PID_OPUS=$!
echo "  Opus PID: $PID_OPUS"

if command -v codex >/dev/null 2>&1; then
    echo "Spawning Codex reviewer..."
    codex exec "$REVIEW_PROMPT" > "$REVIEW_CODEX" 2>&1 &
    PID_CODEX=$!
    echo "  Codex PID: $PID_CODEX"
else
    echo "NOTE: codex not found on PATH — skipping Codex reviewer"
    cat > "$REVIEW_CODEX" <<'PLACEHOLDER'
# Codex Review — Not Available

Codex CLI was not installed when this review was generated.
To enable dual-reviewer mode, install Codex CLI and ensure it is on your PATH.
PLACEHOLDER
    PID_CODEX=""
fi

# Wait for both to finish
echo "Waiting for reviewers to complete..."
wait "$PID_OPUS" && echo "  Opus reviewer finished (exit 0)" || echo "  Opus reviewer finished (exit $?)"
if [ -n "$PID_CODEX" ]; then
    wait "$PID_CODEX" && echo "  Codex reviewer finished (exit 0)" || echo "  Codex reviewer finished (exit $?)"
fi

echo ""
echo "Review files written:"
echo "  Opus:  $REVIEW_OPUS"
echo "  Codex: $REVIEW_CODEX"

# ---------------------------------------------------------------------------
# Build consolidation prompt
# ---------------------------------------------------------------------------
OPUS_CONTENT="$(cat "$REVIEW_OPUS")"
CODEX_CONTENT="$(cat "$REVIEW_CODEX")"

CONSOLIDATION_PROMPT="Two independent code reviewers have completed their review of your branch ($CURRENT_BRANCH vs $BASE_BRANCH).

## Reviewer 1: Opus
$OPUS_CONTENT

---

## Reviewer 2: Codex
$CODEX_CONTENT

---

## Your Task: Triage and Action Plan

You are the orchestrator. Analyze both reviews and produce an action plan.

1. **Triage all findings** into:
   - **Must-fix** — bugs, security issues, broken contracts (block merge)
   - **Should-fix** — error handling gaps, performance issues, missing tests (fix before merge if time allows)
   - **Nit** — style, naming, minor suggestions (fix opportunistically)

2. **Resolve conflicts** between the two reviewers. Where they disagree, state which reviewer is correct and why.

3. **Dismiss false positives** — if a reviewer flagged something that is actually correct, explain why and dismiss it.

4. **Create an ordered action plan** for must-fix items. List the specific files to change, what to change, and in what order.

5. **Write the consolidated review** to: $REVIEW_FINAL

Then begin executing the must-fix items from the action plan."

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
    CONSOLIDATION_FILE="${REVIEW_DIR}/review_consolidation_prompt.md"
    echo ""
    echo "Session ID not available or resume failed."
    echo "Writing consolidation prompt to: $CONSOLIDATION_FILE"
    echo "Paste its contents into your Claude session to consolidate the reviews."
    cat > "$CONSOLIDATION_FILE" <<EOF
$CONSOLIDATION_PROMPT
EOF
    echo ""
    echo "=== Consolidation prompt ==="
    echo "$CONSOLIDATION_PROMPT"
fi

echo ""
echo "=== Code review complete ==="
