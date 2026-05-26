#!/usr/bin/env bash
#
# dev-doctor.sh - read-only local development preflight.
#
# This script inspects the current checkout and writes Markdown + JSON reports
# for an agent to read before local development work. It never installs,
# migrates, starts/stops containers, runs tests, formats files, or prints secret
# values. The only writes are its own report files.

# Keep fail-fast behavior without nounset. macOS Bash 3.2 makes empty-array
# expansion brittle under nounset, but errexit/pipefail should still catch
# unexpected probe failures.
set -eo pipefail
set +u

START_DIR="$(pwd)"

have() {
  command -v "$1" >/dev/null 2>&1
}

if have git && git rev-parse --show-toplevel >/dev/null 2>&1; then
  PROJECT_ROOT="$(git rev-parse --show-toplevel)"
else
  PROJECT_ROOT="$START_DIR"
fi

DEFAULT_MD_OUT="$PROJECT_ROOT/reports/dev-doctor.md"
DEFAULT_JSON_OUT="$PROJECT_ROOT/.agent/dev-doctor.json"
MD_OUT="${1:-${DEV_DOCTOR_MD_OUT:-${DEV_DOCTOR_OUT:-$DEFAULT_MD_OUT}}}"
JSON_OUT="${DEV_DOCTOR_JSON_OUT:-$DEFAULT_JSON_OUT}"

WARNINGS=()
BLOCKERS=()
SETUP_HINTS=()
ASDF_JSON_ITEMS=()
ASDF_MD_ITEMS=()
MISSING_ENV_KEYS=()
PUBLISHED_PORTS=()
NAMED_VOLUMES=()
RUNNING_CONTAINERS=()
COMPOSE_ENV_FILES=()
COMPOSE_MISSING_ENV_FILES=()

warn() {
  WARNINGS+=("$1")
}

block() {
  BLOCKERS+=("$1")
}

json_escape() {
  local s
  s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

json_string_array() {
  local first item
  first=1
  printf '['
  for item in "$@"; do
    if [ "$first" -eq 0 ]; then printf ','; fi
    printf '"%s"' "$(json_escape "$item")"
    first=0
  done
  printf ']'
}

json_raw_array() {
  local first item
  first=1
  printf '['
  for item in "$@"; do
    if [ "$first" -eq 0 ]; then printf ','; fi
    printf '%s' "$item"
    first=0
  done
  printf ']'
}

add_unique_array() {
  local name value existing eval_items
  name="$1"
  value="$2"
  [ -z "$value" ] && return 0
  eval "eval_items=(\"\${${name}[@]}\")"
  for existing in "${eval_items[@]}"; do
    [ "$existing" = "$value" ] && return 0
  done
  eval "$name+=(\"\$value\")"
}

file_exists_bool() {
  if [ -e "$PROJECT_ROOT/$1" ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

trim_simple() {
  printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

sanitize_compose_name() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-'
}

detect_compose_command() {
  if have docker && docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
  elif have docker-compose; then
    printf 'docker-compose'
  fi
}

GENERATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Git and worktree state.
GIT_BRANCH=""
GIT_COMMIT=""
GIT_DIRTY=false
IS_WORKTREE=false
WORKTREE_COUNT=0

if have git && git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  GIT_COMMIT="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || true)"
  if [ -n "$(git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null)" ]; then
    GIT_DIRTY=true
  fi
  if [ -f "$PROJECT_ROOT/.git" ]; then
    IS_WORKTREE=true
  fi
  WORKTREE_COUNT="$(git -C "$PROJECT_ROOT" worktree list 2>/dev/null | wc -l | tr -d ' ')"
  [ -z "$WORKTREE_COUNT" ] && WORKTREE_COUNT=1
fi

# Detected files.
DETECTED_FILES=".tool-versions package.json pnpm-lock.yaml yarn.lock package-lock.json composer.json go.mod Dockerfile Containerfile compose.yaml compose.yml docker-compose.yml docker-compose.yaml .env .env.example Makefile README.md"

# Runtime versions.
if [ -f "$PROJECT_ROOT/.tool-versions" ]; then
  if have asdf; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        ''|\#*) continue ;;
      esac
      tool="$(printf '%s' "$line" | awk '{print $1}')"
      want="$(printf '%s' "$line" | awk '{print $2}')"
      [ -z "$tool" ] && continue
      [ -z "$want" ] && want="unspecified"
      current_line="$(cd "$PROJECT_ROOT" && asdf current "$tool" 2>/dev/null | awk -v t="$tool" '$1==t{print; found=1} END{if(!found) exit 0}' || true)"
      if [ -z "$current_line" ]; then
        active=""
      else
        active="$(printf '%s' "$current_line" | awk '{print $2}')"
      fi
      status="ok"
      if [ -z "$active" ]; then
        status="unresolved"
        warn "asdf: $tool is pinned to $want but no active version resolves"
      elif [ "$active" != "$want" ]; then
        status="mismatch"
        warn "asdf: $tool active version $active differs from pinned $want"
      fi
      if printf '%s' "$current_line" | grep -qiw false; then
        status="not_installed"
        warn "asdf: $tool $want is not installed"
      fi
      ASDF_JSON_ITEMS+=("{\"tool\":\"$(json_escape "$tool")\",\"wanted\":\"$(json_escape "$want")\",\"active\":\"$(json_escape "${active:-}")\",\"status\":\"$(json_escape "$status")\"}")
      ASDF_MD_ITEMS+=("$tool: wanted $want, active ${active:-unresolved}, status $status")
    done < "$PROJECT_ROOT/.tool-versions"
  else
    warn ".tool-versions is present but asdf is not on PATH; runtime versions are unverified"
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        ''|\#*) continue ;;
      esac
      tool="$(printf '%s' "$line" | awk '{print $1}')"
      want="$(printf '%s' "$line" | awk '{print $2}')"
      [ -n "$tool" ] && ASDF_JSON_ITEMS+=("{\"tool\":\"$(json_escape "$tool")\",\"wanted\":\"$(json_escape "${want:-}")\",\"active\":\"\",\"status\":\"asdf_missing\"}")
      [ -n "$tool" ] && ASDF_MD_ITEMS+=("$tool: wanted ${want:-unspecified}, active unverified, status asdf_missing")
    done < "$PROJECT_ROOT/.tool-versions"
  fi
fi

# Docker and Compose.
DOCKER_CLI_PRESENT=false
DOCKER_DAEMON_REACHABLE=false
DOCKER_CONTEXT=""
COMPOSE_COMMAND="$(detect_compose_command)"
COMPOSE_FILE=""
COMPOSE_VALID=null
COMPOSE_PROJECT=""
COMPOSE_PROJECT_SOURCE=""
COMPOSE_TOP_NAME=""
COMPOSE_HAS_CONTAINER_NAME=false
COMPOSE_HAS_FIXED_PORTS=false
COMPOSE_CONFIG_ERROR=""

if have docker; then
  DOCKER_CLI_PRESENT=true
  DOCKER_CONTEXT="$(docker context show 2>/dev/null || true)"
  if docker info >/dev/null 2>&1; then
    DOCKER_DAEMON_REACHABLE=true
  fi
fi

for f in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
  if [ -f "$PROJECT_ROOT/$f" ]; then
    COMPOSE_FILE="$f"
    break
  fi
done

if [ -n "$COMPOSE_FILE" ]; then
  if [ "$DOCKER_CLI_PRESENT" != true ]; then
    block "Compose file is present but Docker CLI is not on PATH"
  elif [ "$DOCKER_DAEMON_REACHABLE" != true ]; then
    block "Compose file is present but Docker daemon is not reachable"
  fi
  if [ -z "$COMPOSE_COMMAND" ]; then
    block "Compose file is present but neither docker compose nor docker-compose is available"
  fi

  if grep -nE '^[[:space:]]*container_name:' "$PROJECT_ROOT/$COMPOSE_FILE" >/dev/null 2>&1; then
    COMPOSE_HAS_CONTAINER_NAME=true
    warn "Compose uses container_name; this can collide across worktrees or parallel checkouts"
  fi

  COMPOSE_TOP_NAME="$(awk -F: '/^name:[[:space:]]*/ {print $2; exit}' "$PROJECT_ROOT/$COMPOSE_FILE" 2>/dev/null | sed 's/[#].*$//; s/["'\'']//g; s/^[[:space:]]*//; s/[[:space:]]*$//')"
  if [ -n "$COMPOSE_TOP_NAME" ]; then
    COMPOSE_PROJECT="$(sanitize_compose_name "$COMPOSE_TOP_NAME")"
    COMPOSE_PROJECT_SOURCE="compose name"
    warn "Compose has a top-level name ($COMPOSE_TOP_NAME); verify it is unique per worktree/session"
  elif [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    COMPOSE_PROJECT="$COMPOSE_PROJECT_NAME"
    COMPOSE_PROJECT_SOURCE="COMPOSE_PROJECT_NAME"
    if [ "$IS_WORKTREE" = true ] || [ "${WORKTREE_COUNT:-0}" -gt 1 ]; then
      warn "COMPOSE_PROJECT_NAME is set to $COMPOSE_PROJECT; verify sibling worktrees do not share it"
    fi
  else
    COMPOSE_PROJECT="$(sanitize_compose_name "$(basename "$PROJECT_ROOT")")"
    COMPOSE_PROJECT_SOURCE="directory"
  fi

  # Raw Compose checks that do not require Docker.
  if grep -nE '^[[:space:]]*-[[:space:]]*"?[0-9]{2,5}:' "$PROJECT_ROOT/$COMPOSE_FILE" >/dev/null 2>&1; then
    COMPOSE_HAS_FIXED_PORTS=true
    warn "Compose maps fixed host ports; parallel worktrees may conflict"
  fi

  while IFS= read -r env_file || [ -n "$env_file" ]; do
    env_file="$(trim_simple "$env_file")"
    env_file="${env_file#./}"
    [ -z "$env_file" ] && continue
    add_unique_array COMPOSE_ENV_FILES "$env_file"
    if [ ! -f "$PROJECT_ROOT/$env_file" ]; then
      add_unique_array COMPOSE_MISSING_ENV_FILES "$env_file"
      warn "Compose references missing env file: $env_file"
    fi
  done <<EOF_ENVFILES
$(awk '
  /^[[:space:]]*env_file:[[:space:]]*/ {
    line=$0
    sub(/^[[:space:]]*env_file:[[:space:]]*/, "", line)
    gsub(/[\047"\[\],]/, "", line)
    if (line != "") print line
    in_env=1
    next
  }
  in_env && /^[[:space:]]*-[[:space:]]*/ {
    line=$0
    sub(/^[[:space:]]*-[[:space:]]*/, "", line)
    gsub(/[\047"]/, "", line)
    print line
    next
  }
  in_env && /^[[:space:]]+[A-Za-z0-9_.-]+:[[:space:]]*/ { in_env=0 }
  in_env && /^[^[:space:]]/ { in_env=0 }
' "$PROJECT_ROOT/$COMPOSE_FILE" 2>/dev/null)
EOF_ENVFILES

  RAW_NAMED_VOLUMES="$(awk '
    /^volumes:[[:space:]]*$/ { in_vol=1; next }
    in_vol && /^[^[:space:]]/ { in_vol=0 }
    in_vol && /^[[:space:]]+[A-Za-z0-9_.-]+:/ {
      line=$0
      sub(/:.*/, "", line)
      gsub(/[[:space:]]/, "", line)
      print line
    }
  ' "$PROJECT_ROOT/$COMPOSE_FILE" 2>/dev/null | sort -u)"
  while IFS= read -r vol || [ -n "$vol" ]; do
    [ -n "$vol" ] && add_unique_array NAMED_VOLUMES "$vol"
  done <<EOF_VOLUMES
$RAW_NAMED_VOLUMES
EOF_VOLUMES

  if [ "${#NAMED_VOLUMES[@]}" -gt 0 ] && { [ "$COMPOSE_PROJECT_SOURCE" = "compose name" ] || [ "$COMPOSE_PROJECT_SOURCE" = "COMPOSE_PROJECT_NAME" ]; }; then
    warn "Compose named volumes are scoped by project name ($COMPOSE_PROJECT); shared project names reuse volumes"
  fi

  if [ -n "$COMPOSE_COMMAND" ]; then
    set +e
    CONFIG_OUT="$(cd "$PROJECT_ROOT" && $COMPOSE_COMMAND -f "$COMPOSE_FILE" config 2>&1)"
    CONFIG_STATUS=$?
    set -e
    if [ "$CONFIG_STATUS" -eq 0 ]; then
      COMPOSE_VALID=true
      HOST_PORTS_LONG="$(printf '%s\n' "$CONFIG_OUT" | grep -Eo 'published:[[:space:]]*"?[0-9]{2,5}' | grep -Eo '[0-9]{2,5}' || true)"
      HOST_PORTS_SHORT="$(printf '%s\n' "$CONFIG_OUT" | grep -Eo '"?[0-9]{2,5}:[0-9]{2,5}"?' | tr -d '"' | cut -d: -f1 || true)"
      while IFS= read -r port || [ -n "$port" ]; do
        [ -n "$port" ] && add_unique_array PUBLISHED_PORTS "$port"
      done <<EOF_PORTS
$(printf '%s\n%s\n' "$HOST_PORTS_LONG" "$HOST_PORTS_SHORT" | grep -E '^[0-9]+$' | sort -un || true)
EOF_PORTS
    else
      COMPOSE_VALID=false
      COMPOSE_CONFIG_ERROR="$(printf '%s\n' "$CONFIG_OUT" | head -n 8)"
      block "Compose config failed to validate"
    fi
  fi

  for port in "${PUBLISHED_PORTS[@]}"; do
    in_use=""
    if have lsof; then
      in_use="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1}' || true)"
    elif have ss; then
      in_use="$(ss -ltnH "( sport = :$port )" 2>/dev/null | head -n1 || true)"
    fi
    if [ -n "$in_use" ]; then
      warn "Port $port is already in use; Compose may fail to bind it"
    fi
  done

  if [ "$DOCKER_DAEMON_REACHABLE" = true ] && [ -n "$COMPOSE_PROJECT" ]; then
    while IFS= read -r container || [ -n "$container" ]; do
      [ -n "$container" ] && RUNNING_CONTAINERS+=("$container")
    done <<EOF_CONTAINERS
$(docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --format '{{.Names}} ({{.Status}})' 2>/dev/null || true)
EOF_CONTAINERS
  fi
fi

# Environment files. Only key names are read; values are never printed.
ENV_PRESENT=false
ENV_EXAMPLE_PRESENT=false
if [ -f "$PROJECT_ROOT/.env" ]; then ENV_PRESENT=true; fi
if [ -f "$PROJECT_ROOT/.env.example" ]; then ENV_EXAMPLE_PRESENT=true; fi

if [ "$ENV_EXAMPLE_PRESENT" = true ] && [ "$ENV_PRESENT" != true ]; then
  block ".env.example exists but .env is missing"
elif [ "$ENV_EXAMPLE_PRESENT" = true ] && [ "$ENV_PRESENT" = true ]; then
  while IFS= read -r key || [ -n "$key" ]; do
    [ -n "$key" ] && MISSING_ENV_KEYS+=("$key")
  done <<EOF_KEYS
$(comm -23 \
  <(grep -Eo '^[A-Za-z_][A-Za-z0-9_]*' "$PROJECT_ROOT/.env.example" 2>/dev/null | sort -u) \
  <(grep -Eo '^[A-Za-z_][A-Za-z0-9_]*' "$PROJECT_ROOT/.env" 2>/dev/null | sort -u) 2>/dev/null)
EOF_KEYS
  if [ "${#MISSING_ENV_KEYS[@]}" -gt 0 ]; then
    warn ".env is missing keys defined in .env.example"
  fi
fi

# Setup hints and recommended next command.
if [ -f "$PROJECT_ROOT/Makefile" ]; then
  while IFS= read -r target || [ -n "$target" ]; do
    [ -n "$target" ] && SETUP_HINTS+=("make $target")
  done <<EOF_MAKE
$(grep -Eo '^[a-zA-Z0-9_.-]+:' "$PROJECT_ROOT/Makefile" 2>/dev/null | sed 's/:$//' | grep -Ei 'setup|install|init|bootstrap|up|dev|start|build|migrate' | sort -u | head -n 10 || true)
EOF_MAKE
fi

if [ -f "$PROJECT_ROOT/package.json" ]; then
  if have jq; then
    PACKAGE_SCRIPTS="$(jq -r '.scripts // {} | keys[]' "$PROJECT_ROOT/package.json" 2>/dev/null | grep -Ei 'setup|install|dev|start|build|migrate|bootstrap' | sort -u | head -n 10 || true)"
  else
    PACKAGE_SCRIPTS="$(grep -Eo '"(setup|install|dev|start|build|migrate|bootstrap)[^"]*"[[:space:]]*:' "$PROJECT_ROOT/package.json" 2>/dev/null | sed 's/"[[:space:]]*:.*//; s/"//g' | sort -u | head -n 10 || true)"
  fi
  while IFS= read -r script_name || [ -n "$script_name" ]; do
    [ -n "$script_name" ] && SETUP_HINTS+=("npm run $script_name")
  done <<EOF_PACKAGE
$PACKAGE_SCRIPTS
EOF_PACKAGE
fi

for readme in README.md readme.md README; do
  if [ -f "$PROJECT_ROOT/$readme" ]; then
    while IFS= read -r hint || [ -n "$hint" ]; do
      [ -n "$hint" ] && SETUP_HINTS+=("$hint")
    done <<EOF_README
$(grep -Eo '(make |npm |pnpm |yarn |docker compose |docker-compose |composer |go |asdf )[a-zA-Z0-9_:. /-]+' "$PROJECT_ROOT/$readme" 2>/dev/null | grep -Ei 'install|setup|up|dev|start|build|init|migrate|bootstrap' | sed 's/[[:space:]]*$//' | sort -u | head -n 8 || true)
EOF_README
    break
  fi
done

RECOMMENDED_NEXT="No obvious setup step detected"
if [ "$ENV_EXAMPLE_PRESENT" = true ] && [ "$ENV_PRESENT" != true ]; then
  RECOMMENDED_NEXT="cp .env.example .env  # then fill in values"
elif [ -n "$COMPOSE_FILE" ] && [ -n "$COMPOSE_COMMAND" ] && [ "$DOCKER_DAEMON_REACHABLE" = true ] && [ "$COMPOSE_VALID" != false ]; then
  RECOMMENDED_NEXT="$COMPOSE_COMMAND -f $COMPOSE_FILE up -d"
elif [ -f "$PROJECT_ROOT/Makefile" ] && printf '%s\n' "${SETUP_HINTS[@]}" | grep -q '^make setup$'; then
  RECOMMENDED_NEXT="make setup"
elif [ -f "$PROJECT_ROOT/package.json" ]; then
  if [ -f "$PROJECT_ROOT/pnpm-lock.yaml" ]; then
    RECOMMENDED_NEXT="pnpm install"
  elif [ -f "$PROJECT_ROOT/yarn.lock" ]; then
    RECOMMENDED_NEXT="yarn install"
  else
    RECOMMENDED_NEXT="npm install"
  fi
elif [ -f "$PROJECT_ROOT/go.mod" ]; then
  RECOMMENDED_NEXT="go mod download"
fi

if [ "${#BLOCKERS[@]}" -gt 0 ]; then
  VERDICT="blocked"
elif [ "${#WARNINGS[@]}" -gt 0 ]; then
  VERDICT="caution"
else
  VERDICT="ok"
fi

# Write Markdown.
MD_DIR="$(dirname "$MD_OUT")"
JSON_DIR="$(dirname "$JSON_OUT")"
mkdir -p "$MD_DIR" "$JSON_DIR" 2>/dev/null || {
  printf 'dev-doctor: could not create report directories\n' >&2
  exit 1
}

{
  printf '# dev-doctor report\n\n'
  printf '_Generated %s. Read-only preflight; no environment changes were made._\n\n' "$GENERATED_AT"
  printf '## Verdict\n\n'
  printf -- '- Status: `%s`\n' "$VERDICT"
  printf -- '- Blockers: %s\n' "${#BLOCKERS[@]}"
  printf -- '- Warnings: %s\n\n' "${#WARNINGS[@]}"

  printf '## Blockers\n\n'
  if [ "${#BLOCKERS[@]}" -eq 0 ]; then
    printf -- '- None\n'
  else
    for item in "${BLOCKERS[@]}"; do printf -- '- %s\n' "$item"; done
  fi
  printf '\n## Warnings\n\n'
  if [ "${#WARNINGS[@]}" -eq 0 ]; then
    printf -- '- None\n'
  else
    for item in "${WARNINGS[@]}"; do printf -- '- %s\n' "$item"; done
  fi

  printf '\n## Location\n\n'
  printf -- '- Project root: `%s`\n' "$PROJECT_ROOT"
  printf -- '- Working directory: `%s`\n' "$START_DIR"

  printf '\n## Git/worktree\n\n'
  printf -- '- Branch: `%s`\n' "${GIT_BRANCH:-n/a}"
  printf -- '- Commit: `%s`\n' "${GIT_COMMIT:-n/a}"
  printf -- '- Dirty: `%s`\n' "$GIT_DIRTY"
  printf -- '- This checkout is linked worktree: `%s`\n' "$IS_WORKTREE"
  printf -- '- Worktree count: `%s`\n' "$WORKTREE_COUNT"

  printf '\n## Detected files\n\n'
  for f in $DETECTED_FILES; do
    printf -- '- `%s`: `%s`\n' "$f" "$(file_exists_bool "$f")"
  done

  printf '\n## Runtime versions\n\n'
  if [ "${#ASDF_MD_ITEMS[@]}" -eq 0 ]; then
    printf -- '- No `.tool-versions` entries detected.\n'
  else
    for item in "${ASDF_MD_ITEMS[@]}"; do
      printf -- '- %s\n' "$item"
    done
  fi

  printf '\n## Docker/Compose\n\n'
  printf -- '- Docker CLI present: `%s`\n' "$DOCKER_CLI_PRESENT"
  printf -- '- Docker daemon reachable: `%s`\n' "$DOCKER_DAEMON_REACHABLE"
  printf -- '- Docker context: `%s`\n' "${DOCKER_CONTEXT:-n/a}"
  printf -- '- Compose command: `%s`\n' "${COMPOSE_COMMAND:-n/a}"
  printf -- '- Compose file: `%s`\n' "${COMPOSE_FILE:-none}"
  printf -- '- Compose config valid: `%s`\n' "$COMPOSE_VALID"
  printf -- '- Compose project: `%s`\n' "${COMPOSE_PROJECT:-n/a}"
  printf -- '- Compose project source: `%s`\n' "${COMPOSE_PROJECT_SOURCE:-n/a}"
  printf -- '- Uses `container_name`: `%s`\n' "$COMPOSE_HAS_CONTAINER_NAME"
  printf -- '- Uses fixed host ports: `%s`\n' "$COMPOSE_HAS_FIXED_PORTS"
  printf -- '- Published host ports: '
  if [ "${#PUBLISHED_PORTS[@]}" -eq 0 ]; then printf 'none\n'; else printf '`%s` ' "${PUBLISHED_PORTS[@]}"; printf '\n'; fi
  printf -- '- Named volumes: '
  if [ "${#NAMED_VOLUMES[@]}" -eq 0 ]; then printf 'none\n'; else printf '`%s` ' "${NAMED_VOLUMES[@]}"; printf '\n'; fi
  printf -- '- Compose env files: '
  if [ "${#COMPOSE_ENV_FILES[@]}" -eq 0 ]; then printf 'none\n'; else printf '`%s` ' "${COMPOSE_ENV_FILES[@]}"; printf '\n'; fi
  printf -- '- Running project containers: '
  if [ "${#RUNNING_CONTAINERS[@]}" -eq 0 ]; then printf 'none\n'; else printf '`%s` ' "${RUNNING_CONTAINERS[@]}"; printf '\n'; fi
  if [ -n "$COMPOSE_CONFIG_ERROR" ]; then
    printf '\nCompose config error excerpt:\n\n```text\n%s\n```\n' "$COMPOSE_CONFIG_ERROR"
  fi

  printf '\n## Env files\n\n'
  printf -- '- `.env` present: `%s`\n' "$ENV_PRESENT"
  printf -- '- `.env.example` present: `%s`\n' "$ENV_EXAMPLE_PRESENT"
  printf -- '- Missing keys from `.env`: '
  if [ "${#MISSING_ENV_KEYS[@]}" -eq 0 ]; then printf 'none\n'; else printf '`%s` ' "${MISSING_ENV_KEYS[@]}"; printf '\n'; fi

  printf '\n## Setup hints\n\n'
  if [ "${#SETUP_HINTS[@]}" -eq 0 ]; then
    printf -- '- None detected\n'
  else
    for item in "${SETUP_HINTS[@]}"; do printf -- '- `%s`\n' "$item"; done
  fi

  printf '\n## Recommended next command\n\n'
  printf '```bash\n%s\n```\n' "$RECOMMENDED_NEXT"
} > "$MD_OUT" || {
  printf 'dev-doctor: could not write Markdown report: %s\n' "$MD_OUT" >&2
  exit 1
}

# Write JSON.
FILES_JSON="{"
first_file=1
for f in $DETECTED_FILES; do
  if [ "$first_file" -eq 0 ]; then FILES_JSON="$FILES_JSON,"; fi
  FILES_JSON="$FILES_JSON\"$(json_escape "$f")\":$(file_exists_bool "$f")"
  first_file=0
done
FILES_JSON="$FILES_JSON}"

{
  printf '{\n'
  printf '  "generated_at": "%s",\n' "$GENERATED_AT"
  printf '  "read_only": true,\n'
  printf '  "verdict": "%s",\n' "$VERDICT"
  printf '  "project_root": "%s",\n' "$(json_escape "$PROJECT_ROOT")"
  printf '  "working_dir": "%s",\n' "$(json_escape "$START_DIR")"
  printf '  "git": {\n'
  printf '    "branch": "%s",\n' "$(json_escape "${GIT_BRANCH:-}")"
  printf '    "commit": "%s",\n' "$(json_escape "${GIT_COMMIT:-}")"
  printf '    "dirty": %s,\n' "$GIT_DIRTY"
  printf '    "is_worktree": %s,\n' "$IS_WORKTREE"
  printf '    "worktree_count": %s\n' "${WORKTREE_COUNT:-0}"
  printf '  },\n'
  printf '  "files": %s,\n' "$FILES_JSON"
  printf '  "asdf": %s,\n' "$(json_raw_array "${ASDF_JSON_ITEMS[@]}")"
  printf '  "docker": {\n'
  printf '    "cli_present": %s,\n' "$DOCKER_CLI_PRESENT"
  printf '    "daemon_reachable": %s,\n' "$DOCKER_DAEMON_REACHABLE"
  printf '    "context": "%s",\n' "$(json_escape "$DOCKER_CONTEXT")"
  printf '    "compose_command": "%s",\n' "$(json_escape "$COMPOSE_COMMAND")"
  printf '    "compose_file": "%s",\n' "$(json_escape "$COMPOSE_FILE")"
  printf '    "compose_valid": %s,\n' "$COMPOSE_VALID"
  printf '    "compose_project": "%s",\n' "$(json_escape "$COMPOSE_PROJECT")"
  printf '    "compose_project_source": "%s",\n' "$(json_escape "$COMPOSE_PROJECT_SOURCE")"
  printf '    "has_container_name": %s,\n' "$COMPOSE_HAS_CONTAINER_NAME"
  printf '    "has_fixed_host_ports": %s,\n' "$COMPOSE_HAS_FIXED_PORTS"
  printf '    "published_ports": %s,\n' "$(json_string_array "${PUBLISHED_PORTS[@]}")"
  printf '    "named_volumes": %s,\n' "$(json_string_array "${NAMED_VOLUMES[@]}")"
  printf '    "env_files": %s,\n' "$(json_string_array "${COMPOSE_ENV_FILES[@]}")"
  printf '    "missing_env_files": %s,\n' "$(json_string_array "${COMPOSE_MISSING_ENV_FILES[@]}")"
  printf '    "running_project_containers": %s\n' "$(json_string_array "${RUNNING_CONTAINERS[@]}")"
  printf '  },\n'
  printf '  "env": {\n'
  printf '    "env_present": %s,\n' "$ENV_PRESENT"
  printf '    "example_present": %s,\n' "$ENV_EXAMPLE_PRESENT"
  printf '    "missing_keys": %s\n' "$(json_string_array "${MISSING_ENV_KEYS[@]}")"
  printf '  },\n'
  printf '  "setup_hints": %s,\n' "$(json_string_array "${SETUP_HINTS[@]}")"
  printf '  "recommended_next": "%s",\n' "$(json_escape "$RECOMMENDED_NEXT")"
  printf '  "warnings": %s,\n' "$(json_string_array "${WARNINGS[@]}")"
  printf '  "blockers": %s\n' "$(json_string_array "${BLOCKERS[@]}")"
  printf '}\n'
} > "$JSON_OUT" || {
  printf 'dev-doctor: could not write JSON report: %s\n' "$JSON_OUT" >&2
  exit 1
}

if have jq; then
  if pretty_json="$(jq . "$JSON_OUT" 2>/dev/null)"; then
    printf '%s\n' "$pretty_json" > "$JSON_OUT"
  else
    printf 'dev-doctor: generated invalid JSON: %s\n' "$JSON_OUT" >&2
    exit 1
  fi
fi

printf 'dev-doctor: %s\n' "$VERDICT"
printf '  root:     %s\n' "$PROJECT_ROOT"
printf '  git:      %s@%s dirty=%s worktree=%s count=%s\n' "${GIT_BRANCH:-n/a}" "${GIT_COMMIT:-n/a}" "$GIT_DIRTY" "$IS_WORKTREE" "$WORKTREE_COUNT"
printf '  docker:   cli=%s daemon=%s context=%s compose=%s file=%s\n' "$DOCKER_CLI_PRESENT" "$DOCKER_DAEMON_REACHABLE" "${DOCKER_CONTEXT:-n/a}" "${COMPOSE_COMMAND:-n/a}" "${COMPOSE_FILE:-none}"
printf '  next:     %s\n' "$RECOMMENDED_NEXT"
printf '  reports:  %s\n' "$MD_OUT"
printf '            %s\n' "$JSON_OUT"

if [ "${#BLOCKERS[@]}" -gt 0 ]; then
  printf '  blockers:\n'
  for item in "${BLOCKERS[@]}"; do printf '    - %s\n' "$item"; done
fi
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf '  warnings:\n'
  for item in "${WARNINGS[@]}"; do printf '    - %s\n' "$item"; done
fi

if [ "${#BLOCKERS[@]}" -gt 0 ]; then
  exit 2
fi
exit 0
