#!/usr/bin/env bash
# migrate-from-manual-install.sh — remove the hand-installed lean /ship overlay
# from ~/.claude so the ship-lean plugin can own it instead.
#
# WHY: before this was a plugin, the overlay was five files hand-installed under
# ~/.claude plus an UNTAGGED entry under .hooks.UserPromptSubmit in
# ~/.claude/settings.json. If you enable the ship-lean plugin while that manual
# install is still present, the hook fires TWICE and the ship-lean-reviewer
# agent exists twice. This script removes the manual install. THEN enable the
# plugin: /plugin install ship-lean@agentic-tools
#
# SAFETY: dry-run by default — it prints what it WOULD remove and changes
# nothing. Re-run with --apply to actually remove. --apply backs up
# settings.json to settings.json.bak.<timestamp>.shiphook-migrate first.
#
# You run this yourself, in your own account. It only ever touches ~/.claude.
set -u

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"
HOOK="$CLAUDE_DIR/hooks/ship-playbook-hook"

# Files the manual install created.
FILES="
$CLAUDE_DIR/agents/ship-lean-reviewer.md
$CLAUDE_DIR/playbooks/ship.md
$CLAUDE_DIR/hooks/ship-playbook-hook
"
DIRS="
$CLAUDE_DIR/playbooks/ship-lean
"

say() { printf '%s\n' "$*"; }
act() { if [ "$APPLY" = 1 ]; then say "  [removed] $*"; else say "  [dry-run] would remove: $*"; fi; }

if [ "$APPLY" = 1 ]; then
  say "== ship-lean manual-install migration (APPLY) =="
else
  say "== ship-lean manual-install migration (DRY-RUN — nothing changed) =="
  say "   Re-run with --apply to actually remove."
fi
say ""

# 1) Remove files.
say "Files:"
for f in $FILES; do
  if [ -e "$f" ]; then
    act "$f"
    [ "$APPLY" = 1 ] && rm -f "$f"
  else
    say "  [absent]  $f"
  fi
done

# 2) Remove the ship-lean/ playbook dir.
say ""
say "Directories:"
for d in $DIRS; do
  if [ -e "$d" ]; then
    act "$d/"
    [ "$APPLY" = 1 ] && rm -rf "$d"
  else
    say "  [absent]  $d/"
  fi
done

# 3) Remove the UNTAGGED UserPromptSubmit entry pointing at the old hook.
say ""
say "settings.json UserPromptSubmit hook entry (-> ship-playbook-hook):"
if [ ! -f "$SETTINGS" ]; then
  say "  [absent]  $SETTINGS"
elif ! command -v python3 >/dev/null 2>&1; then
  say "  [skip]    python3 not found — remove the UserPromptSubmit entry whose"
  say "            command contains 'ship-playbook-hook' from $SETTINGS by hand."
else
  # Detect whether any matching entry exists; optionally rewrite.
  BACKUP="$SETTINGS.bak.$(date +%Y%m%d-%H%M%S).shiphook-migrate"
  APPLY="$APPLY" HOOK="$HOOK" SETTINGS="$SETTINGS" BACKUP="$BACKUP" python3 - <<'PY'
import json, os, sys

apply = os.environ["APPLY"] == "1"
settings = os.environ["SETTINGS"]
backup = os.environ["BACKUP"]
hook = os.environ["HOOK"]

try:
    with open(settings) as fh:
        data = json.load(fh)
except Exception as e:
    print("  [error]   could not parse %s (%s) — remove the entry by hand." % (settings, e))
    sys.exit(0)

hooks = (data.get("hooks") or {}).get("UserPromptSubmit") or []

def matches(entry):
    for h in (entry.get("hooks") or []):
        cmd = h.get("command") or ""
        if "ship-playbook-hook" in cmd:
            return True
    return False

kept, removed = [], []
for entry in hooks:
    (removed if matches(entry) else kept).append(entry)

if not removed:
    print("  [absent]  no UserPromptSubmit entry referencing ship-playbook-hook")
    sys.exit(0)

for entry in removed:
    for h in (entry.get("hooks") or []):
        if "ship-playbook-hook" in (h.get("command") or ""):
            tag = "  [removed] " if apply else "  [dry-run] would remove: "
            print(tag + (h.get("command") or ""))

if not apply:
    sys.exit(0)

# Apply: back up, then write the pruned settings.
import shutil
shutil.copy2(settings, backup)
if kept:
    data["hooks"]["UserPromptSubmit"] = kept
else:
    data["hooks"].pop("UserPromptSubmit", None)
    if not data["hooks"]:
        data.pop("hooks", None)
with open(settings, "w") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
print("  [backup]  %s" % backup)
PY
fi

say ""
if [ "$APPLY" = 1 ]; then
  say "Done. Now enable the plugin:"
else
  say "Nothing was changed. To apply, re-run:  $0 --apply"
  say "Then enable the plugin:"
fi
say "  /plugin marketplace add adambware/agentic-tools   # once per machine"
say "  /plugin install ship-lean@agentic-tools"
