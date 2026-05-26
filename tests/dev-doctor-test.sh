#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/plugins/dev-doctor/scripts/dev-doctor.sh"

assert_eq() {
  local want got label
  want="$1"
  got="$2"
  label="$3"
  if [ "$want" != "$got" ]; then
    printf 'not ok - %s\n  want: %s\n  got:  %s\n' "$label" "$want" "$got" >&2
    exit 1
  fi
}

assert_contains() {
  local needle file label
  needle="$1"
  file="$2"
  label="$3"
  if ! grep -Fq "$needle" "$file"; then
    printf 'not ok - %s\n  missing: %s\n  file: %s\n' "$label" "$needle" "$file" >&2
    exit 1
  fi
}

tmpdir() {
  mktemp -d "${TMPDIR:-/tmp}/dev-doctor-test.XXXXXX"
}

printf '1..7\n'

jq empty "$ROOT/.claude-plugin/marketplace.json" "$ROOT/plugins/dev-doctor/.claude-plugin/plugin.json"
printf 'ok 1 - plugin manifests are valid JSON\n'

bash -n "$SCRIPT"
printf 'ok 2 - dev-doctor script parses\n'

OUT="$(tmpdir)"
DEV_DOCTOR_JSON_OUT="$OUT/root.json" bash "$SCRIPT" "$OUT/root.md" >/tmp/dev-doctor-root.out
assert_eq "ok" "$(jq -r '.verdict' "$OUT/root.json")" "root run verdict"
assert_eq "true" "$(jq -r '.read_only' "$OUT/root.json")" "root run read-only flag"
assert_contains "dev-doctor report" "$OUT/root.md" "root Markdown report"
printf 'ok 3 - root smoke run writes valid Markdown and JSON\n'

FIXTURE="$(tmpdir)"
mkdir -p "$FIXTURE/app"
git -C "$FIXTURE" init -q
printf 'SECRET_TOKEN=\n' > "$FIXTURE/.env.example"
set +e
(
  cd "$FIXTURE/app"
  DEV_DOCTOR_JSON_OUT="$OUT/missing-env.json" bash "$SCRIPT" "$OUT/missing-env.md" >/tmp/dev-doctor-missing-env.out
)
status=$?
set -e
assert_eq "2" "$status" "missing env exit code"
assert_eq "blocked" "$(jq -r '.verdict' "$OUT/missing-env.json")" "missing env verdict"
assert_contains ".env.example exists but .env is missing" "$OUT/missing-env.md" "missing env blocker"
printf 'ok 4 - missing .env is a machine-readable blocker\n'

COMPOSE_FIXTURE="$(tmpdir)"
git -C "$COMPOSE_FIXTURE" init -q
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
YAML
set +e
(
  cd "$COMPOSE_FIXTURE"
  DEV_DOCTOR_JSON_OUT="$OUT/compose.json" bash "$SCRIPT" "$OUT/compose.md" >/tmp/dev-doctor-compose.out
)
status=$?
set -e
if [ "$status" != "0" ] && [ "$status" != "2" ]; then
  printf 'not ok - compose fixture exits cleanly or blocked\n  got: %s\n' "$status" >&2
  exit 1
fi
assert_eq "true" "$(jq -r '.docker.has_container_name' "$OUT/compose.json")" "compose container_name warning"
assert_eq "true" "$(jq -r '.docker.has_fixed_host_ports' "$OUT/compose.json")" "compose fixed port warning"
assert_contains "Compose references missing env file: .env.compose" "$OUT/compose.md" "compose missing env file warning"
printf 'ok 5 - compose collision risks are reported\n'

ENV_DRIFT_FIXTURE="$(tmpdir)"
git -C "$ENV_DRIFT_FIXTURE" init -q
cat > "$ENV_DRIFT_FIXTURE/.env.example" <<'ENV'
DATABASE_URL=
SECRET_TOKEN=
ENV
printf 'DATABASE_URL=postgres://example\n' > "$ENV_DRIFT_FIXTURE/.env"
(
  cd "$ENV_DRIFT_FIXTURE"
  DEV_DOCTOR_JSON_OUT="$OUT/env-drift.json" bash "$SCRIPT" "$OUT/env-drift.md" >/tmp/dev-doctor-env-drift.out
)
assert_eq "caution" "$(jq -r '.verdict' "$OUT/env-drift.json")" "env drift verdict"
assert_eq "SECRET_TOKEN" "$(jq -r '.env.missing_keys[0]' "$OUT/env-drift.json")" "env drift missing key"
assert_contains ".env is missing keys defined in .env.example" "$OUT/env-drift.md" "env drift warning"
printf 'ok 6 - .env key drift is reported without printing values\n'

MAKE_FIXTURE="$(tmpdir)"
git -C "$MAKE_FIXTURE" init -q
cat > "$MAKE_FIXTURE/Makefile" <<'MAKE'
setup:
	@echo setup
dev:
	@echo dev
MAKE
(
  cd "$MAKE_FIXTURE"
  DEV_DOCTOR_JSON_OUT="$OUT/make.json" bash "$SCRIPT" "$OUT/make.md" >/tmp/dev-doctor-make.out
)
assert_eq "ok" "$(jq -r '.verdict' "$OUT/make.json")" "make fixture verdict"
assert_eq "make setup" "$(jq -r '.recommended_next' "$OUT/make.json")" "make setup recommendation"
assert_contains 'make setup' "$OUT/make.md" "make setup hint"
printf 'ok 7 - Makefile setup hints drive the recommended next command\n'
