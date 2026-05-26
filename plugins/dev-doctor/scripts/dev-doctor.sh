#!/usr/bin/env bash
#
# dev-doctor.sh — read-only local environment preflight.
#
# Inspects the local dev environment and writes a structured report an agent
# reads BEFORE making changes. This script NEVER mutates anything: no installs,
# no migrations, no containers, no tests, no formatters. It only reads state and
# emits warnings.
#
# Usage:
#   bash dev-doctor.sh [OUTPUT_FILE]
#
# Output:
#   Markdown report (default: <project-root>/reports/dev-doctor.md).
#   Override with the first arg or the DEV_DOCTOR_OUT env var.
#   The full report is also echoed to stdout.
#
# Compatible with macOS (bash 3.2) and Linux. Degrades gracefully when jq/yq
# are unavailable. Safe to run from any subdirectory.

set -u

# ---------------------------------------------------------------------------
# Setup: locate project root, resolve output path. (No writes to the repo yet.)
# ---------------------------------------------------------------------------

START_DIR="$(pwd)"

if git rev-parse --show-toplevel >/dev/null 2>&1; then
  PROJECT_ROOT="$(git rev-parse --show-toplevel)"
else
  PROJECT_ROOT="$START_DIR"
fi

OUT_FILE="${1:-${DEV_DOCTOR_OUT:-$PROJECT_ROOT/reports/dev-doctor.md}}"

# Accumulators. Warnings/blockers are collected and rendered together so the
# agent sees the most important findings up front.
WARNINGS=""
BLOCKERS=""

add_warning() { WARNINGS="${WARNINGS}- ⚠️  $1
"; }
add_blocker() { BLOCKERS="${BLOCKERS}- 🛑 $1
"; }

have() { command -v "$1" >/dev/null 2>&1; }

# Read a top-level string field from a JSON file without requiring jq.
# Usage: json_field <file> <key>
json_field() {
  _file="$1"; _key="$2"
  if have jq; then
    jq -r --arg k "$_key" '.[$k] // empty' "$_file" 2>/dev/null
  else
    # Best-effort grep fallback for: "key": "value"
    grep -o "\"$_key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$_file" 2>/dev/null \
      | head -n1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/'
  fi
}

# ---------------------------------------------------------------------------
# Build the report in a buffer, then write once at the end.
# ---------------------------------------------------------------------------

R=""
say() { R="${R}$1
"; }

say "# dev-doctor report"
say ""
say "_Read-only environment preflight. Generated $(date '+%Y-%m-%d %H:%M:%S %Z')._"
say ""

# --- Location -------------------------------------------------------------
say "## Location"
say ""
say "- Working directory: \`$START_DIR\`"
say "- Project root: \`$PROJECT_ROOT\`"
if [ "$START_DIR" != "$PROJECT_ROOT" ]; then
  say "- Note: running from a subdirectory of the project root."
fi
say ""

# --- Git ------------------------------------------------------------------
say "## Git"
say ""
if git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  G_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  G_COMMIT="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null)"
  G_DIRTY_COUNT="$(git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  say "- Branch: \`$G_BRANCH\`"
  say "- Commit: \`$G_COMMIT\`"
  if [ "${G_DIRTY_COUNT:-0}" -gt 0 ]; then
    say "- Working tree: **dirty** ($G_DIRTY_COUNT uncommitted change(s))"
  else
    say "- Working tree: clean"
  fi

  # Worktree detection: a linked worktree has a .git *file* (gitdir pointer)
  # rather than a .git directory, and shows up in `git worktree list`.
  IS_WORKTREE="no"
  if [ -f "$PROJECT_ROOT/.git" ]; then
    IS_WORKTREE="yes"
  fi
  WT_COUNT="$(git -C "$PROJECT_ROOT" worktree list 2>/dev/null | wc -l | tr -d ' ')"
  say "- Linked worktree (this checkout): $IS_WORKTREE"
  say "- Total worktrees for this repo: ${WT_COUNT:-1}"
  if [ "$IS_WORKTREE" = "yes" ] || [ "${WT_COUNT:-1}" -gt 1 ]; then
    say "- Worktrees in play — Docker project name / named volumes may collide (see Docker section)."
    DD_IN_WORKTREE="yes"
  else
    DD_IN_WORKTREE="no"
  fi
else
  say "- Not a git repository."
  DD_IN_WORKTREE="no"
fi
say ""

# --- Detected manifests ---------------------------------------------------
say "## Detected project files"
say ""
MANIFESTS=".tool-versions package.json composer.json go.mod Dockerfile docker-compose.yml compose.yml .env .env.example Makefile"
FOUND_ANY="no"
for f in $MANIFESTS; do
  if [ -e "$PROJECT_ROOT/$f" ]; then
    say "- \`$f\` ✓"
    FOUND_ANY="yes"
  fi
done
[ "$FOUND_ANY" = "no" ] && say "- (none of the common manifest files detected at project root)"
say ""

# --- Runtime versions: asdf vs .tool-versions -----------------------------
TV="$PROJECT_ROOT/.tool-versions"
if [ -f "$TV" ]; then
  say "## Runtime versions (.tool-versions vs active)"
  say ""
  if have asdf; then
    # Compare each pinned tool/version against what asdf currently resolves.
    while IFS= read -r line; do
      # skip blanks and comments
      case "$line" in ''|\#*) continue ;; esac
      tool="$(printf '%s' "$line" | awk '{print $1}')"
      want="$(printf '%s' "$line" | awk '{print $2}')"
      [ -z "$tool" ] && continue
      # asdf output varies by version: older prints "tool version /path" on one
      # line; newer (golang) prints a header row + data row. Take the last
      # non-empty line and its version column, ignoring any "Version" header.
      active="$(cd "$PROJECT_ROOT" && asdf current "$tool" 2>/dev/null \
        | grep -v -i '^[[:space:]]*name[[:space:]]' | awk 'NF{v=$2} END{print v}')"
      if [ -z "$active" ]; then
        say "- \`$tool\`: pinned \`$want\`, active **unresolved** (not installed / not set)"
        add_warning "asdf: \`$tool\` pinned to \`$want\` but no active version resolves."
      elif [ "$active" = "$want" ]; then
        say "- \`$tool\`: \`$want\` ✓"
      else
        say "- \`$tool\`: pinned \`$want\`, active **\`$active\`** (mismatch)"
        add_warning "asdf: \`$tool\` active \`$active\` differs from pinned \`$want\`."
      fi
    done < "$TV"
  else
    say "- \`asdf\` not on PATH — cannot compare active versions. Pinned tools:"
    while IFS= read -r line; do
      case "$line" in ''|\#*) continue ;; esac
      say "  - \`$line\`"
    done < "$TV"
    add_warning "\`.tool-versions\` present but \`asdf\` is not installed; runtime versions unverified."
  fi
  say ""
fi

# --- Docker ---------------------------------------------------------------
say "## Docker"
say ""
COMPOSE_FILE=""
for c in docker-compose.yml compose.yml; do
  if [ -f "$PROJECT_ROOT/$c" ]; then COMPOSE_FILE="$PROJECT_ROOT/$c"; break; fi
done

if ! have docker; then
  say "- Docker CLI: not installed."
  [ -n "$COMPOSE_FILE" ] && add_warning "Compose file present but Docker is not installed."
else
  if docker info >/dev/null 2>&1; then
    say "- Docker CLI: installed; daemon **reachable**."
    DOCKER_UP="yes"
  else
    say "- Docker CLI: installed; daemon **not reachable** (is Docker running?)."
    DOCKER_UP="no"
    [ -n "$COMPOSE_FILE" ] && add_blocker "Compose file present but the Docker daemon is not reachable."
  fi

  DCTX="$(docker context show 2>/dev/null)"
  [ -n "$DCTX" ] && say "- Docker context: \`$DCTX\`"

  # Determine the compose command form available.
  COMPOSE_CMD=""
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif have docker-compose; then
    COMPOSE_CMD="docker-compose"
  fi

  if [ -n "$COMPOSE_FILE" ]; then
    say "- Compose file: \`${COMPOSE_FILE#$PROJECT_ROOT/}\`"

    # Named volumes from the RAW compose file's top-level `volumes:` stanza.
    # We read the raw file (not `compose config`) because Compose prunes
    # volumes not referenced by a service from normalized output. Named volumes
    # are namespaced by project name, so identical names across worktrees that
    # share a project name collide.
    RAW_VOLS="$(awk '
      /^volumes:[[:space:]]*$/ {inv=1; next}
      inv && /^[^[:space:]]/ {inv=0}
      inv && /^[[:space:]]+[A-Za-z0-9_.-]+:/ {
        line=$0; sub(/:.*/,"",line); gsub(/[[:space:]]/,"",line); print line
      }
    ' "$COMPOSE_FILE" 2>/dev/null | sort -u)"

    # Project name: Compose defaults to the basename of the project directory,
    # lowercased with non-alnum stripped. COMPOSE_PROJECT_NAME overrides it.
    if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
      PROJ="$COMPOSE_PROJECT_NAME"
      say "- Compose project name: \`$PROJ\` (from COMPOSE_PROJECT_NAME)"
    else
      PROJ="$(basename "$PROJECT_ROOT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
      say "- Compose project name (inferred): \`$PROJ\`"
      if [ "${DD_IN_WORKTREE:-no}" = "yes" ]; then
        add_warning "Worktree dir name drives the Compose project name (\`$PROJ\`). Sibling worktrees with the same dir name share containers/volumes — set COMPOSE_PROJECT_NAME per worktree to isolate."
      fi
    fi

    if [ -n "$RAW_VOLS" ]; then
      say "- Named volumes (project-scoped as \`${PROJ}_<name>\`):"
      for v in $RAW_VOLS; do say "  - \`$v\` → \`${PROJ}_${v}\`"; done
      if [ "${DD_IN_WORKTREE:-no}" = "yes" ]; then
        add_warning "Named volumes are scoped by project name; without a per-worktree COMPOSE_PROJECT_NAME they may collide with sibling worktrees."
      fi
    fi

    if [ "${DOCKER_UP:-no}" = "yes" ] && [ -n "$COMPOSE_CMD" ]; then
      # Validate config without starting anything (config is read-only).
      CONFIG_OUT="$(cd "$PROJECT_ROOT" && $COMPOSE_CMD config 2>&1)"
      if [ $? -eq 0 ]; then
        say "- Compose config: **valid**."

        # Published host ports. `docker compose config` normalizes ports to the
        # long form (`published: "8080"`), but short forms (`8080:80`) survive
        # in some versions, so handle both.
        HOST_PORTS_LONG="$(printf '%s\n' "$CONFIG_OUT" \
          | grep -Eo 'published:[[:space:]]*"?[0-9]{2,5}' | grep -Eo '[0-9]{2,5}')"
        HOST_PORTS_SHORT="$(printf '%s\n' "$CONFIG_OUT" \
          | grep -Eo '[0-9]{2,5}:[0-9]{2,5}' | cut -d: -f1)"
        HOST_PORTS="$(printf '%s\n%s\n' "$HOST_PORTS_LONG" "$HOST_PORTS_SHORT" \
          | grep -E '^[0-9]+$' | sort -un)"
        if [ -n "$HOST_PORTS" ]; then
          say "- Published host ports (from compose config):"
          for p in $HOST_PORTS; do
            # Read-only conflict check: is the port already listening?
            INUSE=""
            if have lsof; then
              INUSE="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1}')"
            elif have ss; then
              INUSE="$(ss -ltnH "( sport = :$p )" 2>/dev/null | head -n1)"
            fi
            if [ -n "$INUSE" ]; then
              say "  - \`$p\` — **in use** (${INUSE})"
              add_warning "Port \`$p\` is already in use; \`$COMPOSE_CMD up\` may fail to bind."
            else
              say "  - \`$p\` — free"
            fi
          done
        else
          say "- Published host ports: none detected."
        fi

      else
        say "- Compose config: **invalid**."
        say '  ```'
        say "$(printf '%s\n' "$CONFIG_OUT" | head -n 8)"
        say '  ```'
        add_blocker "Compose config failed to validate (see Docker section)."
      fi

      # Running containers for this project (read-only ps).
      RUNNING="$(cd "$PROJECT_ROOT" && $COMPOSE_CMD ps --format '{{.Name}} {{.State}} {{.Ports}}' 2>/dev/null)"
      if [ -n "$RUNNING" ]; then
        say "- Running containers for this project:"
        printf '%s\n' "$RUNNING" | while IFS= read -r r; do say "  - $r"; done
      else
        say "- Running containers for this project: none."
      fi
    elif [ -z "$COMPOSE_CMD" ]; then
      add_warning "Compose file present but neither \`docker compose\` nor \`docker-compose\` is available."
    fi
  else
    say "- No Compose file at project root."
  fi
fi
say ""

# --- Environment files ----------------------------------------------------
say "## Environment files"
say ""
if [ -f "$PROJECT_ROOT/.env.example" ]; then
  say "- \`.env.example\` present."
  if [ ! -f "$PROJECT_ROOT/.env" ]; then
    say "- \`.env\` **missing** (template exists)."
    add_blocker "\`.env.example\` exists but \`.env\` is missing — copy and fill it before running the app."
  else
    say "- \`.env\` present."
    # Surface keys present in the example but absent from .env (names only;
    # values are never read or printed).
    MISSING_KEYS="$(comm -23 \
      <(grep -Eo '^[A-Za-z_][A-Za-z0-9_]*' "$PROJECT_ROOT/.env.example" 2>/dev/null | sort -u) \
      <(grep -Eo '^[A-Za-z_][A-Za-z0-9_]*' "$PROJECT_ROOT/.env" 2>/dev/null | sort -u) 2>/dev/null)"
    if [ -n "$MISSING_KEYS" ]; then
      say "- Keys in \`.env.example\` but not in \`.env\`:"
      for k in $MISSING_KEYS; do say "  - \`$k\`"; done
      add_warning "\`.env\` is missing keys defined in \`.env.example\`."
    fi
  fi
elif [ -f "$PROJECT_ROOT/.env" ]; then
  say "- \`.env\` present (no \`.env.example\` to compare against)."
else
  say "- No \`.env\` / \`.env.example\` at project root."
fi
say ""

# --- Likely setup commands ------------------------------------------------
say "## Likely setup commands"
say ""
FOUND_SETUP="no"

# Makefile targets (names only).
if [ -f "$PROJECT_ROOT/Makefile" ]; then
  TARGETS="$(grep -Eo '^[a-zA-Z0-9_.-]+:' "$PROJECT_ROOT/Makefile" 2>/dev/null \
    | sed 's/:$//' | grep -Ei 'setup|install|init|bootstrap|up|dev|start|build|migrate' | sort -u)"
  if [ -n "$TARGETS" ]; then
    say "- From \`Makefile\`:"
    for t in $TARGETS; do say "  - \`make $t\`"; done
    FOUND_SETUP="yes"
  fi
fi

# package.json scripts.
PJ="$PROJECT_ROOT/package.json"
if [ -f "$PJ" ]; then
  if have jq; then
    SCRIPTS="$(jq -r '.scripts // {} | to_entries[] | "\(.key)"' "$PJ" 2>/dev/null \
      | grep -Ei 'setup|install|dev|start|build|migrate|bootstrap' | sort -u)"
  else
    SCRIPTS="$(grep -Eo '"(setup|install|dev|start|build|migrate|bootstrap)[a-z:]*"[[:space:]]*:' "$PJ" 2>/dev/null \
      | sed 's/"[[:space:]]*:.*//; s/"//g' | sort -u)"
  fi
  if [ -n "$SCRIPTS" ]; then
    say "- From \`package.json\` scripts:"
    for s in $SCRIPTS; do say "  - \`npm run $s\`"; done
    FOUND_SETUP="yes"
  fi
fi

# README: surface the first few fenced/inline commands that look like setup.
for readme in README.md readme.md README; do
  if [ -f "$PROJECT_ROOT/$readme" ]; then
    HINTS="$(grep -Eo '(make |npm |pnpm |yarn |docker compose |docker-compose |composer |go |asdf )[a-zA-Z0-9_:. -]+' \
      "$PROJECT_ROOT/$readme" 2>/dev/null \
      | grep -Ei 'install|setup|up|dev|start|build|init|migrate|bootstrap' \
      | sed 's/[[:space:]]*$//' | sort -u | head -n 8)"
    if [ -n "$HINTS" ]; then
      say "- Mentioned in \`$readme\`:"
      printf '%s\n' "$HINTS" | while IFS= read -r h; do say "  - \`$h\`"; done
      FOUND_SETUP="yes"
    fi
    break
  fi
done

[ "$FOUND_SETUP" = "no" ] && say "- No obvious setup commands detected."
say ""

# ---------------------------------------------------------------------------
# Assemble final report: header summary (warnings/blockers) + detail body.
# ---------------------------------------------------------------------------

SUMMARY="## Summary
"
if [ -n "$BLOCKERS" ]; then
  SUMMARY="${SUMMARY}
**Verdict: ⛔ blockers present — do not start coding until acknowledged.**

### Blockers
${BLOCKERS}"
elif [ -n "$WARNINGS" ]; then
  SUMMARY="${SUMMARY}
**Verdict: ⚠️  usable with warnings — review before proceeding.**
"
else
  SUMMARY="${SUMMARY}
**Verdict: ✅ environment looks safe to use.**
"
fi
if [ -n "$WARNINGS" ]; then
  SUMMARY="${SUMMARY}
### Warnings
${WARNINGS}"
fi
SUMMARY="${SUMMARY}
"

# Insert the summary right after the generated-at line. We rebuild by splitting
# on the first "## Location" header.
HEAD_PART="$(printf '%s' "$R" | awk '/^## Location/{exit} {print}')"
BODY_PART="$(printf '%s' "$R" | awk 'f{print} /^## Location/{f=1; print}')"
FINAL="${HEAD_PART}
${SUMMARY}
${BODY_PART}"

# Write the report (the only filesystem write this script performs).
OUT_DIR="$(dirname "$OUT_FILE")"
mkdir -p "$OUT_DIR" 2>/dev/null
if printf '%s\n' "$FINAL" > "$OUT_FILE" 2>/dev/null; then
  WROTE="$OUT_FILE"
else
  # Fall back to a temp file if the target dir is not writable.
  WROTE="${TMPDIR:-/tmp}/dev-doctor.md"
  printf '%s\n' "$FINAL" > "$WROTE"
fi

printf '%s\n' "$FINAL"
printf '\n---\nReport written to: %s\n' "$WROTE"

# Exit non-zero only when blockers exist, so callers can gate on it if desired.
if [ -n "$BLOCKERS" ]; then exit 2; fi
exit 0
