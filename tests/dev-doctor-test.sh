#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/plugins/dev-doctor/scripts/dev-doctor.sh"

if ! command -v jq >/dev/null 2>&1; then
  printf 'not ok - jq is required to run dev-doctor tests\n' >&2
  exit 1
fi

# One scratch tree for the whole run; removed on exit unless KEEP_TMP=1.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dev-doctor-test.XXXXXX")"
cleanup() {
  if [ "${KEEP_TMP:-0}" = 1 ]; then
    printf '# kept %s\n' "$WORK"
  else
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

OUT="$WORK/out"
mkdir -p "$OUT"

fail() {
  printf 'not ok - %s\n' "$1" >&2
  shift
  while [ "$#" -gt 0 ]; do printf '  %s\n' "$1" >&2; shift; done
  exit 1
}

assert_eq() {
  local want got label
  want="$1"
  got="$2"
  label="$3"
  [ "$want" = "$got" ] || fail "$label" "want: $want" "got:  $got"
}

assert_contains() {
  local needle file label
  needle="$1"
  file="$2"
  label="$3"
  grep -Fq -- "$needle" "$file" || fail "$label" "missing: $needle" "file: $file"
}

assert_not_contains() {
  local needle file label
  needle="$1"
  file="$2"
  label="$3"
  if grep -Fq -- "$needle" "$file"; then
    fail "$label" "found: $needle" "file: $file"
  fi
}

fixture() {
  local dir
  dir="$WORK/$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  printf '%s' "$dir"
}

commit_all() {
  git -C "$1" -c user.name=dev-doctor-test -c user.email=test@example.invalid add -A
  git -C "$1" -c user.name=dev-doctor-test -c user.email=test@example.invalid commit -q -m fixture
}

# run_doctor <cwd> <name> [script args...]
# Runs the script from <cwd> with report overrides under $OUT, captures the
# exit code in STATUS, and never lets a non-zero exit abort the suite.
STATUS=0
run_doctor() {
  local dir name
  dir="$1"
  name="$2"
  shift 2
  set +e
  (
    cd "$dir" && DEV_DOCTOR_JSON_OUT="$OUT/$name.json" bash "$SCRIPT" "$OUT/$name.md" "$@" > "$OUT/$name.out" 2>&1
  )
  STATUS=$?
  set -e
}

assert_status() {
  local want name
  want="$1"
  name="$2"
  if [ "$STATUS" != "$want" ]; then
    cat "$OUT/$name.out" >&2 || true
    fail "$name exit code" "want: $want" "got:  $STATUS"
  fi
}

printf '1..12\n'

jq empty "$ROOT/.claude-plugin/marketplace.json" "$ROOT/plugins/dev-doctor/.claude-plugin/plugin.json"
printf 'ok 1 - plugin manifests are valid JSON\n'

bash -n "$SCRIPT"
printf 'ok 2 - dev-doctor script parses\n'

run_doctor "$ROOT" root
assert_status 0 root
assert_eq "$(cd "$ROOT" && git rev-parse --show-toplevel)" "$(jq -r '.project_root' "$OUT/root.json")" "root run inspects the repo root"
assert_eq "ok" "$(jq -r '.verdict' "$OUT/root.json")" "root run verdict"
assert_eq "true" "$(jq -r '.read_only' "$OUT/root.json")" "root run read-only flag"
assert_contains "dev-doctor report" "$OUT/root.md" "root Markdown report"
assert_eq "generated_at read_only verdict project_root working_dir git files asdf docker env setup_hints recommended_next warnings blockers" \
  "$(jq -r 'keys_unsorted | join(" ")' "$OUT/root.json")" "root JSON top-level shape"
printf 'ok 3 - root smoke run writes valid Markdown and JSON\n'

FIXTURE="$(fixture missing-env)"
mkdir -p "$FIXTURE/app"
printf 'SECRET_TOKEN=\n' > "$FIXTURE/.env.example"
run_doctor "$FIXTURE/app" missing-env
assert_status 2 missing-env
assert_eq "blocked" "$(jq -r '.verdict' "$OUT/missing-env.json")" "missing env verdict"
assert_contains ".env.example exists but .env is missing" "$OUT/missing-env.md" "missing env blocker"
printf 'ok 4 - missing .env is a machine-readable blocker\n'

COMPOSE_FIXTURE="$(fixture compose)"
cat > "$COMPOSE_FIXTURE/compose.yaml" <<'YAML'
services:
  web:
    image: nginx:alpine
    container_name: fixed-web
    env_file:
      - .env.compose
    ports:
      - "8080:80"
volumes:
  app-data:
    driver: local
YAML
run_doctor "$COMPOSE_FIXTURE" compose
if [ "$STATUS" != "0" ] && [ "$STATUS" != "2" ]; then
  cat "$OUT/compose.out" >&2 || true
  fail "compose fixture exits cleanly or blocked" "got: $STATUS"
fi
assert_eq "true" "$(jq -r '.docker.has_container_name' "$OUT/compose.json")" "compose container_name warning"
assert_eq "true" "$(jq -r '.docker.has_fixed_host_ports' "$OUT/compose.json")" "compose fixed port warning"
assert_eq '["app-data"]' "$(jq -c '.docker.named_volumes' "$OUT/compose.json")" "compose named volumes exclude nested option keys"
assert_contains "Compose references missing env file: .env.compose" "$OUT/compose.md" "compose missing env file warning"
printf 'ok 5 - compose collision risks are reported\n'

ENV_DRIFT_FIXTURE="$(fixture env-drift)"
cat > "$ENV_DRIFT_FIXTURE/.env.example" <<'ENV'
DATABASE_URL=
SECRET_TOKEN=
ENV
printf 'DATABASE_URL=postgres://SENTINEL_VALUE_DO_NOT_PRINT\n' > "$ENV_DRIFT_FIXTURE/.env"
run_doctor "$ENV_DRIFT_FIXTURE" env-drift
assert_status 0 env-drift
assert_eq "caution" "$(jq -r '.verdict' "$OUT/env-drift.json")" "env drift verdict"
assert_eq "SECRET_TOKEN" "$(jq -r '.env.missing_keys[0]' "$OUT/env-drift.json")" "env drift missing key"
assert_contains ".env is missing keys defined in .env.example" "$OUT/env-drift.md" "env drift warning"
for f in env-drift.md env-drift.json env-drift.out; do
  assert_not_contains "SENTINEL_VALUE_DO_NOT_PRINT" "$OUT/$f" "env value leaked into $f"
done
printf 'ok 6 - .env key drift is reported without printing values\n'

MAKE_FIXTURE="$(fixture make)"
cat > "$MAKE_FIXTURE/Makefile" <<'MAKE'
setup:
	@echo setup
dev:
	@echo dev
MAKE
run_doctor "$MAKE_FIXTURE" make
assert_status 0 make
assert_eq "ok" "$(jq -r '.verdict' "$OUT/make.json")" "make fixture verdict"
assert_eq "make setup" "$(jq -r '.recommended_next' "$OUT/make.json")" "make setup recommendation"
assert_contains 'make setup' "$OUT/make.md" "make setup hint"
printf 'ok 7 - Makefile setup hints drive the recommended next command\n'

EXPORT_FIXTURE="$(fixture env-export)"
cat > "$EXPORT_FIXTURE/.env.example" <<'ENV'
# Copy this file to .env and fill in the values.
export FOO=
  BAR=
Copy this file to .env
BAZ=
ENV
printf 'FOO=1\nexport BAR=2\n' > "$EXPORT_FIXTURE/.env"
run_doctor "$EXPORT_FIXTURE" env-export
assert_status 0 env-export
assert_eq '["BAZ"]' "$(jq -c '.env.missing_keys' "$OUT/env-export.json")" "export-prefixed and prose lines"
printf 'ok 8 - env key diff handles export prefixes and ignores prose\n'

INLINE_FIXTURE="$(fixture compose-inline)"
cat > "$INLINE_FIXTURE/compose.yaml" <<'YAML'
services:
  web:
    image: nginx:alpine
    user: "1000:1000"
    env_file: [.env.a, '.env.b']  # local only
YAML
printf 'A=1\n' > "$INLINE_FIXTURE/.env.a"
printf 'B=1\n' > "$INLINE_FIXTURE/.env.b"
run_doctor "$INLINE_FIXTURE" compose-inline
if [ "$STATUS" != "0" ] && [ "$STATUS" != "2" ]; then
  cat "$OUT/compose-inline.out" >&2 || true
  fail "inline compose fixture exits cleanly or blocked" "got: $STATUS"
fi
assert_eq '[".env.a",".env.b"]' "$(jq -c '.docker.env_files' "$OUT/compose-inline.json")" "inline env_file list is split"
assert_eq '[]' "$(jq -c '.docker.missing_env_files' "$OUT/compose-inline.json")" "existing inline env files are not reported missing"
assert_not_contains '"1000"' "$OUT/compose-inline.json" "user id mistaken for a published port"
printf 'ok 9 - inline Compose env_file lists and user ids are parsed correctly\n'

CLEAN_FIXTURE="$(fixture clean)"
printf '# fixture\n' > "$CLEAN_FIXTURE/README.md"
commit_all "$CLEAN_FIXTURE"
GIT_DIR_ABS="$(cd "$CLEAN_FIXTURE" && git rev-parse --absolute-git-dir)"
set +e
( cd "$CLEAN_FIXTURE" && bash "$SCRIPT" > "$OUT/clean-default.out" 2>&1 )
STATUS=$?
set -e
assert_status 0 clean-default
[ -f "$GIT_DIR_ABS/dev-doctor/dev-doctor.md" ] || fail "default Markdown report path" "missing: $GIT_DIR_ABS/dev-doctor/dev-doctor.md"
[ -f "$GIT_DIR_ABS/dev-doctor/dev-doctor.json" ] || fail "default JSON report path" "missing: $GIT_DIR_ABS/dev-doctor/dev-doctor.json"
assert_eq "" "$(git -C "$CLEAN_FIXTURE" status --porcelain)" "default reports leave the checkout clean"
set +e
( cd "$CLEAN_FIXTURE" && bash "$SCRIPT" > "$OUT/clean-default.out" 2>&1 )
STATUS=$?
set -e
assert_status 0 clean-default
assert_eq "false" "$(jq -r '.git.dirty' "$GIT_DIR_ABS/dev-doctor/dev-doctor.json")" "second run does not see its own reports as dirt"
set +e
( cd "$CLEAN_FIXTURE" && DEV_DOCTOR_JSON_OUT=out/r.json bash "$SCRIPT" out/r.md > "$OUT/clean-override.out" 2>&1 )
STATUS=$?
set -e
assert_status 0 clean-override
assert_eq "false" "$(jq -r '.git.dirty' "$CLEAN_FIXTURE/out/r.json")" "in-repo report override is excluded from dirty"
printf 'y\n' >> "$CLEAN_FIXTURE/README.md"
set +e
( cd "$CLEAN_FIXTURE" && DEV_DOCTOR_JSON_OUT=out/r.json bash "$SCRIPT" out/r.md > "$OUT/clean-override.out" 2>&1 )
STATUS=$?
set -e
assert_status 0 clean-override
assert_eq "true" "$(jq -r '.git.dirty' "$CLEAN_FIXTURE/out/r.json")" "a real change is still reported dirty"
printf 'ok 10 - default report paths never dirty the checkout\n'

git -C "$CLEAN_FIXTURE" worktree add -q "$WORK/clean-wt" -b dev-doctor-test-wt
WT_GIT_DIR="$(cd "$WORK/clean-wt" && git rev-parse --absolute-git-dir)"
set +e
( cd "$WORK/clean-wt" && bash "$SCRIPT" > "$OUT/worktree.out" 2>&1 )
STATUS=$?
set -e
assert_status 0 worktree
assert_eq "true" "$(jq -r '.git.is_worktree' "$WT_GIT_DIR/dev-doctor/dev-doctor.json")" "linked worktree detected"
assert_eq "2" "$(jq -r '.git.worktree_count' "$WT_GIT_DIR/dev-doctor/dev-doctor.json")" "worktree count"
[ "$WT_GIT_DIR" != "$GIT_DIR_ABS" ] || fail "worktree report dir is private to the worktree"
printf 'ok 11 - linked worktrees are detected and get their own report dir\n'

set +e
bash "$SCRIPT" --help > "$OUT/help.out" 2>&1; help_status=$?
bash "$SCRIPT" --bogus > "$OUT/bogus.out" 2>&1; bogus_status=$?
bash "$SCRIPT" a b > "$OUT/extra.out" 2>&1; extra_status=$?
set -e
assert_eq "0" "$help_status" "--help exit code"
assert_contains "usage: dev-doctor.sh" "$OUT/help.out" "--help prints usage"
assert_eq "1" "$bogus_status" "unknown flag exit code"
assert_eq "1" "$extra_status" "extra positional exit code"
printf 'ok 12 - usage and argument errors follow the exit-code contract\n'
