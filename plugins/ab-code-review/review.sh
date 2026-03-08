#!/bin/bash
# review.sh — Parallel code review system for branch diffs
#
# Usage:
#   Manual:   bash review.sh                  # Review current branch vs main
#             bash review.sh <base-branch>     # Review against a specific base
#   Skill:    Invoked by SKILL.md via Claude Code
#
# Spawns two parallel reviewer agents (Claude Opus + Codex CLI), waits for both,
# then outputs the consolidation prompt to stdout (returned to parent session).

set -euo pipefail

# ---------------------------------------------------------------------------
# Input handling
# ---------------------------------------------------------------------------
BASE_BRANCH=""

if [ $# -ge 1 ] && [ -n "${1:-}" ]; then
    BASE_BRANCH="$1"
fi

# ---------------------------------------------------------------------------
# Guard clauses
# ---------------------------------------------------------------------------
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: Not inside a git repository"
    exit 1
fi

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# ---------------------------------------------------------------------------
# Debug setup
# ---------------------------------------------------------------------------
REVIEW_DIR="${REPO_ROOT}/.code-review"
mkdir -p "$REVIEW_DIR"
DEBUG_LOG="${REVIEW_DIR}/debug.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$DEBUG_LOG"
}

log "=== Review invoked ==="
log "Args: $*"
log "CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-<unset>}"
log "REPO_ROOT=$REPO_ROOT"

# ---------------------------------------------------------------------------
# Branch detection
# ---------------------------------------------------------------------------
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

log "Branch: $CURRENT_BRANCH vs $BASE_BRANCH"
log "Diff stat: $DIFF_STAT"

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REVIEW_OPUS="${REVIEW_DIR}/review_${TIMESTAMP}_opus.md"
REVIEW_CODEX="${REVIEW_DIR}/review_${TIMESTAMP}_codex.md"
REVIEW_FINAL="${REVIEW_DIR}/review_${TIMESTAMP}_final.md"

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
log "Spawning Opus reviewer..."
claude -p "$REVIEW_PROMPT" --output-format text > "$REVIEW_OPUS" 2>&1 &
PID_OPUS=$!
log "  Opus PID: $PID_OPUS"

if command -v codex >/dev/null 2>&1; then
    log "Spawning Codex reviewer..."
    codex exec "$REVIEW_PROMPT" > "$REVIEW_CODEX" 2>&1 &
    PID_CODEX=$!
    log "  Codex PID: $PID_CODEX"
else
    log "codex not found on PATH — skipping"
    cat > "$REVIEW_CODEX" <<'PLACEHOLDER'
# Codex Review — Not Available

Codex CLI was not installed when this review was generated.
To enable dual-reviewer mode, install Codex CLI and ensure it is on your PATH.
PLACEHOLDER
    PID_CODEX=""
fi

# Wait for both to finish
log "Waiting for reviewers to complete..."
wait "$PID_OPUS" && log "  Opus reviewer finished (exit 0)" || log "  Opus reviewer finished (exit $?)"
if [ -n "$PID_CODEX" ]; then
    wait "$PID_CODEX" && log "  Codex reviewer finished (exit 0)" || log "  Codex reviewer finished (exit $?)"
fi

log "Review files written: $REVIEW_OPUS, $REVIEW_CODEX"

# ---------------------------------------------------------------------------
# Output consolidation prompt to stdout (returned to parent session)
# ---------------------------------------------------------------------------
cat <<EOF
Code review complete for branch $CURRENT_BRANCH (vs $BASE_BRANCH). Read and consolidate the reviews:
- Opus review: $REVIEW_OPUS
- Codex review: $REVIEW_CODEX

Triage all findings into must-fix, should-fix, and nit. Resolve conflicts between reviewers. Dismiss false positives. Create an ordered action plan for must-fix items.

Write the consolidated review to: $REVIEW_FINAL

Then begin executing the must-fix items from the action plan.
EOF

log "=== Code review complete ==="
