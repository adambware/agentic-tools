#!/usr/bin/env bash
# action-env-check.sh: the logic of the loops composite action (plugins/loops/action.yml).
#
# Runs `node <action>/bin/loops.mjs env-check --static --require-checks[=<ids>]` once, from the
# consumer's checkout, prints its rows to the log, writes them to $GITHUB_STEP_SUMMARY inside a
# text fence, and exits with the engine's exit code (0 clean, 1 a FAIL row, 2 usage or config).
# Exit 2 of its own: node missing or older than 18, a working-directory that is not a directory,
# no engine bundle, a Windows runner.
#
# Inputs come only from the environment (action.yml maps them; never interpolated into code):
#   INPUT_WORKING_DIRECTORY  the checkout to check; relative to $GITHUB_WORKSPACE (default .)
#   INPUT_REQUIRE_CHECKS     empty: bare --require-checks; else --require-checks=<value>, one argv
#                            element (the engine validates the ids and trims around commas)
#   GITHUB_ACTION_PATH       the action's directory (default: this script's parent directory)
# Bash 3.2 compatible (macOS runners).
set -u

err() { printf '::error::loops env-check: %s\n' "$1"; }

if [ "${RUNNER_OS:-}" = "Windows" ]; then
  err "Windows runners are not supported; run this job on ubuntu-latest or macos-latest"
  exit 2
fi

action_path=${GITHUB_ACTION_PATH:-}
if [ -z "$action_path" ]; then
  action_path=$(cd "$(dirname "$0")/.." && pwd) || exit 2
fi
engine=$action_path/bin/loops.mjs
if [ ! -f "$engine" ]; then
  err "no engine at $engine (is GITHUB_ACTION_PATH the plugins/loops directory?)"
  exit 2
fi

wd=${INPUT_WORKING_DIRECTORY:-}
[ -n "$wd" ] || wd=.
case $wd in
  /*) ;;
  *) wd=${GITHUB_WORKSPACE:-$PWD}/$wd ;;
esac
if [ ! -d "$wd" ]; then
  err "working-directory $wd is not a directory"
  exit 2
fi

setup_node="add actions/setup-node (node-version: 20) before this step"
if ! command -v node >/dev/null 2>&1; then
  err "node is not on PATH; $setup_node"
  exit 2
fi
# `node --version` prints v<major>.<minor>.<patch>; read the first line only, strip CR and spaces.
ver=$(node --version 2>/dev/null | head -n 1 | tr -d '[:space:]')
major=${ver#v}
major=${major%%.*}
case $ver in
  v[0-9]*) ;;
  *) major= ;;
esac
case $major in
  '' | *[!0-9]*)
    err "cannot read the node version (node --version printed \"$ver\"); $setup_node"
    exit 2
    ;;
esac
# Strip leading zeros so the test below never reads an octal-looking number.
major=$(printf '%s' "$major" | sed 's/^0*//')
if [ -z "$major" ] || [ "$major" -lt 18 ]; then
  err "node $ver is older than 18; $setup_node"
  exit 2
fi

req=${INPUT_REQUIRE_CHECKS:-}
req=${req#"${req%%[![:space:]]*}"}
req=${req%"${req##*[![:space:]]}"}
if [ -z "$req" ]; then
  flag=--require-checks
else
  flag=--require-checks=$req
fi

out=$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/loops-env-check.XXXXXX") || {
  err "cannot create a temp file"
  exit 2
}
trap 'rm -f "$out"' EXIT

# No pipe: the engine's exit code is $? of this subshell.
(cd "$wd" && exec node "$engine" env-check --static "$flag") >"$out" 2>&1
code=$?

# The rows go to the log with workflow commands off, so a row that echoes a check's output never
# runs as one. A token from /dev/urandom ends the pause.
token=$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
[ -n "$token" ] || token=loops-env-check-$$-$RANDOM
printf '::stop-commands::%s\n' "$token"
awk '{ print }' "$out"
printf '::%s::\n' "$token"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  # The fence is longer than the longest backtick run in the output, so no row can close it.
  longest=$(awk '{ n = 0; for (i = 1; i <= length($0); i++) { if (substr($0, i, 1) == "`") { n++; if (n > m) m = n } else n = 0 } } END { print m + 0 }' "$out")
  len=3
  [ "$longest" -lt 3 ] || len=$((longest + 1))
  fence=$(printf "%${len}s" '' | tr ' ' '`')
  {
    printf '### loops env-check (exit %s)\n\n' "$code"
    printf '%stext\n' "$fence"
    awk '{ print }' "$out"
    printf '%s\n' "$fence"
  } >>"$GITHUB_STEP_SUMMARY" || printf '::warning::loops env-check: could not write the step summary\n'
fi

case $code in
  0) ;;
  1) err "a FAIL row (above); exit 1" ;;
  2) err "usage or config error (above); exit 2" ;;
  *) err "the engine exited $code" ;;
esac
exit "$code"
