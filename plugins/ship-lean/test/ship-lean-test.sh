#!/usr/bin/env bash
# ship-lean-test.sh — hermetic self-test for the ship-lean plugin.
#
# Runs with NO auth and NO `claude` CLI: it drives the plugin's real hook
# directly, with CLAUDE_PLUGIN_ROOT pointed at the plugin dir (exactly how
# Claude Code invokes it), and asserts the UserPromptSubmit contract and the
# plugin-resolved paths. Static validation (JSON, shell/python syntax, manifest
# wiring) and the `W` invariant round it out.
#
# Adapted from the hand-install harness (scratchpad/ship-lean-harness.sh). Two
# differences, both because this is now a PLUGIN:
#   * Probe A (/ship -> UserPromptSubmit) and Probe B (additionalContext
#     honored) are properties of Claude Code itself (validated on 2.1.304) and
#     need a logged-in `claude`; they are an OPT-IN lane (INTERACTIVE_E2E=1),
#     not the default/CI lane. The default lane exercises the plugin's own hook.
#   * The upgrade-regression test (untagged settings.json hook surviving
#     gstack's prune-stale --all) is MOOT for a plugin: the hook is registered
#     by the plugin's hooks/hooks.json, never by an untagged settings.json
#     entry, so gstack's settings pruning cannot touch it.
#
# TAP-ish output; exits non-zero on any failure. Writes only to one scratch dir.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # plugins/ship-lean
HOOK="$ROOT/hooks/ship-playbook-hook"
OVERLAY="$ROOT/playbooks/ship.md"
SCRIPT="$ROOT/playbooks/ship-lean/reviewers.workflow.js"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
MARKETPLACE="$REPO_ROOT/.claude-plugin/marketplace.json"

PASS=0; FAIL=0
ok() { printf 'ok - %s\n' "$*"; PASS=$((PASS + 1)); }
no() { printf 'not ok - %s\n' "$*"; FAIL=$((FAIL + 1)); }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ship-lean-test.XXXXXX")"
cleanup() { [ "${KEEP_TMP:-0}" = 1 ] && printf '# kept %s\n' "$WORK" || rm -rf "$WORK"; }
trap cleanup EXIT

if ! command -v python3 >/dev/null 2>&1; then
  printf 'not ok - python3 is required\n' >&2; exit 1
fi

# run_hook <stdin-json>  [env assignments via RUNENV]
# Captures stdout to $OUT and exit code to $RC. CLAUDE_PLUGIN_ROOT defaults to
# the plugin dir unless RUNENV already sets/clears it.
OUT=""; RC=0
run_hook() {
  local json="$1"
  OUT="$(printf '%s' "$json" | env CLAUDE_PLUGIN_ROOT="$ROOT" ${RUNENV:-} python3 "$HOOK" 2>/dev/null)"
  RC=$?
}
# run_hook_noroot: same but with CLAUDE_PLUGIN_ROOT explicitly unset.
run_hook_noroot() {
  local json="$1"
  OUT="$(printf '%s' "$json" | env -u CLAUDE_PLUGIN_ROOT python3 "$HOOK" 2>/dev/null)"
  RC=$?
}

ups() { printf '{"hook_event_name":"UserPromptSubmit","prompt":%s}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")"; }

echo "========== STATIC VALIDATION =========="

for j in "$ROOT/.claude-plugin/plugin.json" "$ROOT/hooks/hooks.json" "$MARKETPLACE"; do
  if command -v jq >/dev/null 2>&1; then
    jq empty "$j" >/dev/null 2>&1 && ok "valid JSON: ${j#$REPO_ROOT/}" || no "invalid JSON: ${j#$REPO_ROOT/}"
  else
    python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$j" >/dev/null 2>&1 \
      && ok "valid JSON: ${j#$REPO_ROOT/}" || no "invalid JSON: ${j#$REPO_ROOT/}"
  fi
done

bash -n "$0" 2>/dev/null && ok "bash -n: this test" || no "bash -n: this test"
bash -n "$ROOT/scripts/migrate-from-manual-install.sh" 2>/dev/null \
  && ok "bash -n: migrate script" || no "bash -n: migrate script"
python3 -c "compile(open('$HOOK').read(), '$HOOK', 'exec')" 2>/dev/null \
  && ok "python3 compiles: ship-playbook-hook" || no "python3 compiles: ship-playbook-hook"

# hooks.json wiring: UserPromptSubmit, no matcher, ${CLAUDE_PLUGIN_ROOT}, ship-playbook-hook, timeout.
python3 - "$ROOT/hooks/hooks.json" <<'PY' && ok "hooks.json wires UserPromptSubmit -> \${CLAUDE_PLUGIN_ROOT}/.../ship-playbook-hook" || no "hooks.json wiring wrong"
import json,sys
d=json.load(open(sys.argv[1]))
e=d["hooks"]["UserPromptSubmit"]
assert isinstance(e,list) and len(e)==1, "one UserPromptSubmit entry"
entry=e[0]
assert "matcher" not in entry, "no matcher"
h=entry["hooks"][0]
assert h["type"]=="command"
assert "${CLAUDE_PLUGIN_ROOT}" in h["command"], "uses CLAUDE_PLUGIN_ROOT"
assert "ship-playbook-hook" in h["command"], "targets the hook"
assert h["command"].startswith("python3 "), "invoked via python3"
assert isinstance(h.get("timeout"), int) and h["timeout"]>0, "has a positive timeout"
assert d.get("description"), "has a description"
PY

# marketplace.json has a ship-lean entry pointing at ./plugins/ship-lean.
python3 - "$MARKETPLACE" <<'PY' && ok "marketplace.json lists ship-lean -> ./plugins/ship-lean" || no "marketplace.json missing/incorrect ship-lean entry"
import json,sys
d=json.load(open(sys.argv[1]))
m=[p for p in d["plugins"] if p.get("name")=="ship-lean"]
assert len(m)==1, "exactly one ship-lean entry"
assert m[0]["source"]=="./plugins/ship-lean", "source path"
assert m[0].get("description"), "has a description"
assert m[0].get("keywords"), "has keywords"
PY

# agent: read-only tool allowlist, correct name.
python3 - "$ROOT/agents/ship-lean-reviewer.md" <<'PY' && ok "agent ship-lean-reviewer is read-only (Read, Grep, Glob)" || no "agent allowlist/name wrong"
import re,sys
t=open(sys.argv[1]).read()
fm=t.split('---',2)[1]
assert re.search(r'^name:\s*ship-lean-reviewer\s*$', fm, re.M), "name"
mt=re.search(r'^tools:\s*(.+)$', fm, re.M)
assert mt, "tools line present"
tools={x.strip() for x in mt.group(1).strip().lstrip('[').rstrip(']').split(',')}
assert tools=={"Read","Grep","Glob"}, "exactly Read, Grep, Glob (got %r)" % tools
PY

echo "========== HOOK BEHAVIOR (plugin path, no auth) =========="

# /ship: emits the envelope; note carries the plugin-resolved overlay + scriptPath.
run_hook "$(ups '/ship')"
if [ "$RC" = 0 ] && [ -n "$OUT" ] \
   && printf '%s' "$OUT" | grep -Fq '"hookEventName": "UserPromptSubmit"' \
   && printf '%s' "$OUT" | grep -Fq 'LEAN /ship OVERLAY IS ACTIVE' \
   && printf '%s' "$OUT" | grep -Fq "$OVERLAY" \
   && printf '%s' "$OUT" | grep -Fq "$SCRIPT"; then
  ok "/ship injects additionalContext with plugin-resolved overlay + absolute scriptPath"
else
  no "/ship injection missing fields (rc=$RC)"
fi

# scriptPath in the note is ABSOLUTE and has no literal ~ (no machine-specific path).
run_hook "$(ups '/ship')"
if printf '%s' "$OUT" | grep -Fq "$SCRIPT" && ! printf '%s' "$OUT" | grep -Fq '~/.claude/playbooks'; then
  ok "injected scriptPath is absolute from CLAUDE_PLUGIN_ROOT (no ~-path)"
else
  no "injected scriptPath not plugin-resolved"
fi

# Never emits a decision/block on a /ship match (cannot break prompt submission).
run_hook "$(ups '/ship')"
if ! printf '%s' "$OUT" | grep -Eq '"(decision|block)"'; then
  ok "/ship output contains no decision/block (never alters the prompt)"
else
  no "/ship output contained decision/block"
fi

# Args are sliced case-correctly and echoed.
run_hook "$(ups '/ship --no-pr')"
printf '%s' "$OUT" | grep -Fq 'Invocation args: --no-pr' \
  && ok "/ship --no-pr slices args (Invocation args: --no-pr)" || no "args not sliced"

# Case-insensitive trigger.
run_hook "$(ups '/Ship')"
[ -n "$OUT" ] && ok "/Ship (uppercase) triggers" || no "/Ship did not trigger"

# Near-misses must NOT trigger.
run_hook "$(ups '/shipping now')"
[ -z "$OUT" ] && [ "$RC" = 0 ] && ok "/shipping does NOT trigger" || no "/shipping wrongly triggered"
run_hook "$(ups '/ship-it')"
[ -z "$OUT" ] && [ "$RC" = 0 ] && ok "/ship-it does NOT trigger" || no "/ship-it wrongly triggered"

# NL form off by default, on with SHIP_HOOK_NL=1.
run_hook "$(ups 'ship this PR')"
[ -z "$OUT" ] && ok "NL 'ship this' off by default" || no "NL triggered without opt-in"
RUNENV="SHIP_HOOK_NL=1" run_hook "$(ups 'ship it')"
[ -n "$OUT" ] && ok "NL 'ship it' on with SHIP_HOOK_NL=1" || no "NL opt-in did not trigger"
unset RUNENV

# Fail-open: no CLAUDE_PLUGIN_ROOT -> nothing, exit 0.
run_hook_noroot "$(ups '/ship')"
[ -z "$OUT" ] && [ "$RC" = 0 ] && ok "no CLAUDE_PLUGIN_ROOT -> empty, exit 0 (fail-open)" || no "not fail-open without plugin root (rc=$RC)"

# Fail-open: wrong event, junk stdin, empty stdin.
run_hook '{"hook_event_name":"PreToolUse","prompt":"/ship"}'
[ -z "$OUT" ] && [ "$RC" = 0 ] && ok "wrong hook_event_name -> empty, exit 0" || no "wrong event not fail-open (rc=$RC)"
run_hook 'not json at all'
[ -z "$OUT" ] && [ "$RC" = 0 ] && ok "junk stdin -> empty, exit 0" || no "junk not fail-open (rc=$RC)"
run_hook ''
[ -z "$OUT" ] && [ "$RC" = 0 ] && ok "empty stdin -> empty, exit 0" || no "empty not fail-open (rc=$RC)"

echo "========== W INVARIANT (conditional on gstack-wtree) =========="
WTREE=""
if [ -x "$HOME/.claude/skills/gstack/bin/gstack-wtree" ]; then WTREE="$HOME/.claude/skills/gstack/bin/gstack-wtree"
elif command -v gstack-wtree >/dev/null 2>&1; then WTREE="$(command -v gstack-wtree)"; fi
if [ -z "$WTREE" ]; then
  printf '# skip - gstack-wtree not installed; W-invariant checked locally only\n'
else
  TR="$WORK/r"; mkdir -p "$TR"
  ( cd "$TR" && git init -q && git config user.email t@t && git config user.name t \
    && printf 'hello\n' > a.txt && git add a.txt && git commit -qm init )
  W0="$(cd "$TR" && "$WTREE")"
  mkdir -p "$WORK/out"; printf 'diff\n' > "$WORK/out/p.patch"
  W1="$(cd "$TR" && "$WTREE")"
  [ "$W0" = "$W1" ] && ok "W stable while patch lives OUTSIDE repo" || no "W changed on outside patch"
  printf 'x\n' > "$TR/stray.txt"; W2="$(cd "$TR" && "$WTREE")"
  [ "$W0" != "$W2" ] && ok "W changes on in-repo untracked file" || no "W unchanged on stray file"
fi

if [ "${INTERACTIVE_E2E:-0}" = 1 ]; then
  echo "========== OPT-IN E2E (needs a logged-in claude; INTERACTIVE_E2E=1) =========="
  printf '# Probe A/B are Claude Code properties (validated on 2.1.304). To reconfirm\n'
  printf '# against this plugin: enable ship-lean, run an interactive /ship, and verify\n'
  printf '# the review:*/adversarial:* agents fire and Step 11.5 reads CLEARED.\n'
fi

echo
printf 'SUMMARY: PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
[ "$FAIL" = 0 ] || exit 1
