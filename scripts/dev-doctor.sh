#!/usr/bin/env bash
#
# dev-doctor.sh — read-only local-dev environment preflight.
#
# Inspects the local environment and writes a structured report
# (.agent/dev-doctor.json + reports/dev-doctor.md) for an agent to read
# before making any changes.
#
# CONTRACT: This script is READ-ONLY. It never installs, migrates, starts
# containers, runs tests, or formats. It only inspects and reports. It emits
# warnings; it never mutates state. Safe to run from any subdirectory on
# macOS or Linux.
#
# Exit status is always 0 unless the script itself is misused; environment
# problems are reported as warnings in the output, not as failures.

set -u

# ---------------------------------------------------------------------------
# Setup: locate project root, prepare output paths, detect optional tools
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Project root: prefer git toplevel, fall back to the script's parent dir.
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  ROOT="$(git rev-parse --show-toplevel)"
else
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

CWD="$(pwd)"
REPORT_DIR="$ROOT/reports"
AGENT_DIR="$ROOT/.agent"
MD_OUT="$REPORT_DIR/dev-doctor.md"
JSON_OUT="$AGENT_DIR/dev-doctor.json"

mkdir -p "$REPORT_DIR" "$AGENT_DIR" 2>/dev/null

have() { command -v "$1" >/dev/null 2>&1; }

HAS_JQ=false;  have jq  && HAS_JQ=true
HAS_YQ=false;  have yq  && HAS_YQ=true
HAS_GIT=false; have git && HAS_GIT=true
HAS_DOCKER=false; have docker && HAS_DOCKER=true
HAS_ASDF=false; have asdf && HAS_ASDF=true

# Collect findings. WARN/BLOCKER lines are surfaced prominently.
WARNINGS=()
BLOCKERS=()
warn()    { WARNINGS+=("$1"); }
blocker() { BLOCKERS+=("$1"); }

# JSON string escaper (handles quotes, backslashes, control chars) without jq.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

exists() { [ -e "$ROOT/$1" ] && echo true || echo false; }

# ---------------------------------------------------------------------------
# Git: branch, commit, dirty state, worktree status
# ---------------------------------------------------------------------------

GIT_BRANCH=""; GIT_COMMIT=""; GIT_DIRTY="unknown"; IS_WORKTREE=false; GIT_COMMON_DIR=""
if $HAS_GIT && git rev-parse --git-dir >/dev/null 2>&1; then
  GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null)"
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then GIT_DIRTY=true; else GIT_DIRTY=false; fi
  # A linked worktree has a .git *file* (not dir), or git-dir != common-dir.
  local_git_dir="$(git rev-parse --git-dir 2>/dev/null)"
  GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null)"
  if [ "$local_git_dir" != "$GIT_COMMON_DIR" ]; then IS_WORKTREE=true; fi
fi

# ---------------------------------------------------------------------------
# Detected package/runtime files
# ---------------------------------------------------------------------------

declare -a FILE_KEYS=(.tool-versions package.json composer.json go.mod Dockerfile \
  docker-compose.yml compose.yml .env .env.example Makefile)

# ---------------------------------------------------------------------------
# asdf: active versions vs .tool-versions
# ---------------------------------------------------------------------------

ASDF_REPORT=""
if [ "$(exists .tool-versions)" = true ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    tool="$(echo "$line" | awk '{print $1}')"
    want="$(echo "$line" | awk '{print $2}')"
    [ -z "$tool" ] && continue
    active=""; cur_line=""
    if $HAS_ASDF; then
      # asdf >=0.16 prints a "Name Version Source Installed" header row plus a
      # data row; older versions print "tool version (set by ...)". Match the
      # data row whose first column equals the tool name.
      cur_line="$(cd "$ROOT" && asdf current "$tool" 2>/dev/null \
        | awk -v t="$tool" '$1==t{print; exit}')"
      active="$(printf '%s' "$cur_line" | awk '{print $2}')"
      case "$active" in ______|"Not"*|"-") active="" ;; esac
    fi
    if $HAS_ASDF && [ -n "$active" ] && [ "$active" != "$want" ]; then
      warn "asdf: $tool active=$active but .tool-versions wants $want"
    fi
    # asdf >=0.16 reports an "Installed" column; "false" = requested version
    # is not installed on this machine.
    if printf '%s' "$cur_line" | grep -qiw false; then
      warn "asdf: $tool $want is not installed (run: asdf install $tool $want)"
    fi
    ASDF_REPORT+="$tool want=$want active=${active:-n/a}; "
  done < "$ROOT/.tool-versions"
elif $HAS_ASDF; then
  ASDF_REPORT="(.tool-versions not present)"
else
  ASDF_REPORT="(asdf not installed)"
fi

# ---------------------------------------------------------------------------
# Docker availability, context, compose config
# ---------------------------------------------------------------------------

DOCKER_RUNNING=false; DOCKER_CONTEXT=""; COMPOSE_FILE=""; COMPOSE_VALID="n/a"
COMPOSE_PROJECT=""; COMPOSE_PORTS=""; COMPOSE_VOLUMES=""; PROJECT_CONTAINERS=""

if $HAS_DOCKER; then
  if docker info >/dev/null 2>&1; then DOCKER_RUNNING=true; fi
  DOCKER_CONTEXT="$(docker context show 2>/dev/null)"
fi

# Pick the compose file actually present.
for f in docker-compose.yml compose.yml; do
  if [ "$(exists "$f")" = true ]; then COMPOSE_FILE="$f"; break; fi
done

# Determine the compose project name. Compose derives it from
# COMPOSE_PROJECT_NAME, else the basename of the project directory (lowercased,
# sanitized). Across worktrees the dir basename differs, so identity usually
# differs too — but we flag the collision risk explicitly.
if [ -n "$COMPOSE_FILE" ]; then
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    COMPOSE_PROJECT="$COMPOSE_PROJECT_NAME"
  else
    COMPOSE_PROJECT="$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')"
  fi

  # Validate compose config (read-only) and extract ports/volumes from the
  # rendered config when possible.
  if $HAS_DOCKER && $DOCKER_RUNNING; then
    if docker compose -f "$ROOT/$COMPOSE_FILE" config >/dev/null 2>&1; then
      COMPOSE_VALID=true
      RENDERED="$(docker compose -f "$ROOT/$COMPOSE_FILE" config 2>/dev/null)"
    else
      COMPOSE_VALID=false
      warn "compose: '$COMPOSE_FILE' failed 'docker compose config' validation"
      RENDERED=""
    fi
  else
    RENDERED="$(cat "$ROOT/$COMPOSE_FILE" 2>/dev/null)"
  fi

  # Exposed host ports — grep the "host:container" pattern from the config.
  # Works on rendered config or raw file; degrades without yq.
  COMPOSE_PORTS="$(printf '%s\n' "$RENDERED" \
    | grep -Eo '"?[0-9]{2,5}:[0-9]{2,5}"?' \
    | tr -d '"' | sort -u | tr '\n' ' ')"

  # Named volumes — scan the top-level volumes: block heuristically.
  COMPOSE_VOLUMES="$(printf '%s\n' "$RENDERED" \
    | awk '/^volumes:/{flag=1; next} /^[^[:space:]]/{flag=0} flag && /^[[:space:]]+[A-Za-z0-9._-]+:/{gsub(/[: ]/,""); print}' \
    | sort -u | tr '\n' ' ')"

  # Running containers belonging to this compose project.
  if $HAS_DOCKER && $DOCKER_RUNNING && [ -n "$COMPOSE_PROJECT" ]; then
    PROJECT_CONTAINERS="$(docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
      --format '{{.Names}} ({{.Status}})' 2>/dev/null | tr '\n' ';')"
  fi

  # Likely port conflicts: a host port from compose already LISTENing locally.
  for hostport in $(printf '%s\n' "$COMPOSE_PORTS" | tr ' ' '\n' | awk -F: 'NF==2{print $1}' | sort -u); do
    [ -z "$hostport" ] && continue
    busy=false
    if have lsof; then
      lsof -nP -iTCP:"$hostport" -sTCP:LISTEN >/dev/null 2>&1 && busy=true
    elif have ss; then
      ss -ltn 2>/dev/null | grep -qE "[:.]$hostport\b" && busy=true
    fi
    if $busy; then warn "port: $hostport already in use on this host (compose wants to bind it)"; fi
  done

  # Worktree volume-collision warning: named volumes are global to the Docker
  # engine, so two worktrees using the same project name share volumes.
  if $IS_WORKTREE && [ -n "$COMPOSE_VOLUMES" ]; then
    warn "worktree: named volumes ($COMPOSE_VOLUMES) are keyed to project '$COMPOSE_PROJECT' and shared engine-wide — sibling worktrees with the same project name will collide"
  fi
elif $IS_WORKTREE; then
  : # no compose, nothing to collide
fi

if $HAS_DOCKER && ! $DOCKER_RUNNING; then
  warn "docker: CLI present but daemon not reachable (docker info failed)"
fi

# ---------------------------------------------------------------------------
# Missing required env files
# ---------------------------------------------------------------------------

ENV_STATUS=""
if [ "$(exists .env.example)" = true ] && [ "$(exists .env)" = false ]; then
  blocker "env: .env.example exists but .env is missing — copy and fill before running the app"
  ENV_STATUS=".env MISSING (.env.example present)"
elif [ "$(exists .env)" = true ]; then
  ENV_STATUS=".env present"
else
  ENV_STATUS="no .env/.env.example"
fi

# ---------------------------------------------------------------------------
# Obvious setup commands from README, Makefile, package.json scripts
# ---------------------------------------------------------------------------

SETUP_HINTS=""

# Makefile targets that look like setup/bootstrap.
if [ "$(exists Makefile)" = true ]; then
  targets="$(grep -Eo '^(setup|install|bootstrap|init|dev|up|start)[a-z0-9_-]*:' "$ROOT/Makefile" 2>/dev/null | sed 's/:.*//' | sort -u | tr '\n' ' ')"
  [ -n "$targets" ] && SETUP_HINTS+="make targets: $targets | "
fi

# package.json scripts (jq if available, else a light grep fallback).
if [ "$(exists package.json)" = true ]; then
  if $HAS_JQ; then
    pscripts="$(jq -r '.scripts | keys[]? // empty' "$ROOT/package.json" 2>/dev/null \
      | grep -Ei '^(setup|install|bootstrap|dev|start|build)$' | tr '\n' ' ')"
  else
    pscripts="$(grep -Eo '"(setup|bootstrap|dev|start|build)"[[:space:]]*:' "$ROOT/package.json" 2>/dev/null \
      | sed 's/[":].*//' | tr -d '"' | sort -u | tr '\n' ' ')"
  fi
  [ -n "$pscripts" ] && SETUP_HINTS+="npm scripts: $pscripts | "
fi

# First fenced/inline command from README that mentions install/setup/up.
for readme in README.md readme.md README; do
  if [ "$(exists "$readme")" = true ]; then
    hint="$(grep -Ei '(npm|yarn|pnpm|make|docker compose|docker-compose|composer|go) (install|run|setup|up|dev|start|mod)' "$ROOT/$readme" 2>/dev/null | head -1 | sed 's/^[[:space:]>*`-]*//; s/`//g')"
    [ -n "$hint" ] && SETUP_HINTS+="README: $hint"
    break
  fi
done
[ -z "$SETUP_HINTS" ] && SETUP_HINTS="(none detected)"

# Recommended next command — best-effort heuristic.
RECOMMENDED=""
if [ -n "${ENV_STATUS}" ] && echo "$ENV_STATUS" | grep -q MISSING; then
  RECOMMENDED="cp .env.example .env  # then fill in values"
elif [ -n "$COMPOSE_FILE" ] && $HAS_DOCKER && $DOCKER_RUNNING; then
  RECOMMENDED="docker compose up -d"
elif [ "$(exists Makefile)" = true ] && echo "$SETUP_HINTS" | grep -q "make targets"; then
  RECOMMENDED="make setup  # (verify target exists)"
elif [ "$(exists package.json)" = true ]; then
  RECOMMENDED="npm install"
elif [ "$(exists go.mod)" = true ]; then
  RECOMMENDED="go mod download"
else
  RECOMMENDED="(no obvious setup step detected)"
fi

# ---------------------------------------------------------------------------
# Safety verdict
# ---------------------------------------------------------------------------

if [ "${#BLOCKERS[@]}" -gt 0 ]; then
  VERDICT="BLOCKED — ${#BLOCKERS[@]} blocker(s), ${#WARNINGS[@]} warning(s)"
elif [ "${#WARNINGS[@]}" -gt 0 ]; then
  VERDICT="CAUTION — ${#WARNINGS[@]} warning(s)"
else
  VERDICT="OK — no issues detected"
fi

# ---------------------------------------------------------------------------
# Emit Markdown report
# ---------------------------------------------------------------------------

{
  echo "# dev-doctor report"
  echo
  echo "_Generated $(date -u '+%Y-%m-%dT%H:%M:%SZ') · read-only preflight · no changes were made._"
  echo
  echo "## Verdict: $VERDICT"
  echo

  if [ "${#BLOCKERS[@]}" -gt 0 ]; then
    echo "### 🔴 Blockers"
    for b in "${BLOCKERS[@]}"; do echo "- $b"; done
    echo
  fi
  if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo "### 🟡 Warnings"
    for w in "${WARNINGS[@]}"; do echo "- $w"; done
    echo
  fi

  echo "## Location"
  echo "- Project root: \`$ROOT\`"
  echo "- Working dir:  \`$CWD\`"
  echo

  echo "## Git"
  echo "- Branch:   \`${GIT_BRANCH:-n/a}\`"
  echo "- Commit:   \`${GIT_COMMIT:-n/a}\`"
  echo "- Dirty:    $GIT_DIRTY"
  echo "- Worktree: $IS_WORKTREE"
  [ "$IS_WORKTREE" = true ] && echo "- Common git dir: \`$GIT_COMMON_DIR\`"
  echo

  echo "## Detected files"
  for k in "${FILE_KEYS[@]}"; do
    printf -- "- %s: %s\n" "$k" "$(exists "$k")"
  done
  echo

  echo "## Runtime versions (asdf)"
  echo "- $ASDF_REPORT"
  echo

  echo "## Docker"
  echo "- CLI present: $HAS_DOCKER"
  echo "- Daemon reachable: $DOCKER_RUNNING"
  echo "- Context: \`${DOCKER_CONTEXT:-n/a}\`"
  echo "- Compose file: \`${COMPOSE_FILE:-none}\`"
  echo "- Compose config valid: $COMPOSE_VALID"
  echo "- Compose project name: \`${COMPOSE_PROJECT:-n/a}\`"
  echo "- Exposed host ports: ${COMPOSE_PORTS:-none}"
  echo "- Named volumes: ${COMPOSE_VOLUMES:-none}"
  echo "- Running project containers: ${PROJECT_CONTAINERS:-none}"
  echo

  echo "## Environment files"
  echo "- $ENV_STATUS"
  echo

  echo "## Setup hints"
  echo "- $SETUP_HINTS"
  echo
  echo "## Recommended next command"
  echo "\`\`\`bash"
  echo "$RECOMMENDED"
  echo "\`\`\`"
} > "$MD_OUT"

# ---------------------------------------------------------------------------
# Emit JSON report (jq if available for correctness, else hand-rolled)
# ---------------------------------------------------------------------------

# Build JSON arrays for warnings/blockers.
json_arr() {
  local out="[" first=true
  local item
  for item in "$@"; do
    $first || out+=","
    out+="\"$(json_escape "$item")\""
    first=false
  done
  out+="]"
  printf '%s' "$out"
}

FILES_JSON="{"
first=true
for k in "${FILE_KEYS[@]}"; do
  $first || FILES_JSON+=","
  FILES_JSON+="\"$(json_escape "$k")\":$(exists "$k")"
  first=false
done
FILES_JSON+="}"

{
  printf '{\n'
  printf '  "generated_at": "%s",\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '  "read_only": true,\n'
  printf '  "verdict": "%s",\n' "$(json_escape "$VERDICT")"
  printf '  "project_root": "%s",\n' "$(json_escape "$ROOT")"
  printf '  "working_dir": "%s",\n' "$(json_escape "$CWD")"
  printf '  "git": {"branch": "%s", "commit": "%s", "dirty": %s, "is_worktree": %s, "common_dir": "%s"},\n' \
    "$(json_escape "$GIT_BRANCH")" "$(json_escape "$GIT_COMMIT")" \
    "$([ "$GIT_DIRTY" = true ] && echo true || echo false)" "$IS_WORKTREE" "$(json_escape "$GIT_COMMON_DIR")"
  printf '  "files": %s,\n' "$FILES_JSON"
  printf '  "asdf": "%s",\n' "$(json_escape "$ASDF_REPORT")"
  printf '  "docker": {"cli": %s, "running": %s, "context": "%s", "compose_file": "%s", "compose_valid": "%s", "compose_project": "%s", "ports": "%s", "volumes": "%s", "containers": "%s"},\n' \
    "$HAS_DOCKER" "$DOCKER_RUNNING" "$(json_escape "$DOCKER_CONTEXT")" "$(json_escape "$COMPOSE_FILE")" \
    "$(json_escape "$COMPOSE_VALID")" "$(json_escape "$COMPOSE_PROJECT")" "$(json_escape "$COMPOSE_PORTS")" \
    "$(json_escape "$COMPOSE_VOLUMES")" "$(json_escape "$PROJECT_CONTAINERS")"
  printf '  "env": "%s",\n' "$(json_escape "$ENV_STATUS")"
  printf '  "setup_hints": "%s",\n' "$(json_escape "$SETUP_HINTS")"
  printf '  "recommended_next": "%s",\n' "$(json_escape "$RECOMMENDED")"
  printf '  "warnings": %s,\n' "$(json_arr "${WARNINGS[@]+"${WARNINGS[@]}"}")"
  printf '  "blockers": %s\n' "$(json_arr "${BLOCKERS[@]+"${BLOCKERS[@]}"}")"
  printf '}\n'
} > "$JSON_OUT"

# If jq is available, pretty-print/validate the JSON in place (still read-only
# w.r.t. the environment — only rewrites our own output file).
if $HAS_JQ; then
  if tmp="$(jq . "$JSON_OUT" 2>/dev/null)"; then printf '%s\n' "$tmp" > "$JSON_OUT"; fi
fi

# ---------------------------------------------------------------------------
# Console summary
# ---------------------------------------------------------------------------

echo "dev-doctor: $VERDICT"
echo "  root:     $ROOT"
echo "  git:      ${GIT_BRANCH:-n/a}@${GIT_COMMIT:-n/a} dirty=$GIT_DIRTY worktree=$IS_WORKTREE"
echo "  docker:   running=$DOCKER_RUNNING context=${DOCKER_CONTEXT:-n/a} compose=${COMPOSE_FILE:-none}"
echo "  next:     $RECOMMENDED"
echo "  reports:  $MD_OUT"
echo "            $JSON_OUT"
[ "${#BLOCKERS[@]}" -gt 0 ] && { echo "  BLOCKERS:"; for b in "${BLOCKERS[@]}"; do echo "    - $b"; done; }
[ "${#WARNINGS[@]}" -gt 0 ] && { echo "  warnings:"; for w in "${WARNINGS[@]}"; do echo "    - $w"; done; }

exit 0
