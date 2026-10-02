#!/usr/bin/env bash
# check-example-hygiene.sh — POSITIVE example-hygiene gate for the nightshift plugin.
# ==================================================================================
# This REPLACES the deleted assurance-engine-no-leak.yml denylist grep. Rather than
# blocking a list of real-looking strings, it asserts that examples are fictional by
# construction:
#
#   (a) Every URL under examples/ and templates/ ends in a reserved TLD
#       (.example | .test | .invalid | .localhost — RFC 6761/2606). Any URL that
#       doesn't is listed and fails the run.
#   (b) No example-pack sentinel (my-project, my-stack, PROJ, "# REQUIRED") survives
#       under examples/. Sentinels are EXPECTED in templates/ — that's their job — so
#       this rule is scoped to examples/ only.
#   (c) Render-smoke (optional but on by default): the template pack under
#       templates/.nightshift/ parses, and the onboard-answers fixture exists.
#
# Paths are resolved relative to the repo root, so the script works whether it is
# invoked from the repo root or from anywhere else.
set -euo pipefail

# Require PyYAML before doing anything (render-smoke section depends on it).
if ! python3 -c 'import yaml' 2>/dev/null; then
  echo "::error::PyYAML not installed — run: pip install pyyaml (or: python3 -m pip install pyyaml)"
  exit 1
fi

# --- Resolve repo root from this script's location (scripts/ lives in the plugin) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"          # plugins/nightshift
REPO_ROOT="$(cd "$PLUGIN_DIR/../.." && pwd)"        # repo root
cd "$REPO_ROOT"

EXAMPLES_DIR="plugins/nightshift/examples"
TEMPLATES_DIR="plugins/nightshift/templates"
FIXTURE="plugins/nightshift/fixtures/onboard-answers.example.yml"

RESERVED_TLD_RE='\.(example|test|invalid|localhost)$'
fail=0

echo "==> Example-hygiene check (repo root: $REPO_ROOT)"

# --- (a) Reserved-TLD rule for every URL under examples/ and templates/ -------------
echo "--> (a) Checking URLs use reserved TLDs under examples/ and templates/"
_HYGIENE_TMP=$(mktemp /tmp/nightshift-hygiene-XXXXXXXX)
for dir in "$EXAMPLES_DIR" "$TEMPLATES_DIR"; do
  [ -d "$dir" ] || continue
  while IFS= read -r -d '' file; do
    # Extract URLs, then strip trailing markdown/punctuation that commonly hugs a URL
    # (backticks, quotes, parens, brackets, angle brackets, commas, periods, semicolons).
    (grep -aEoh 'https?://[^[:space:]"'"'"'`)<>]+' "$file" 2>/dev/null || true) \
      | sed -E 's/[`"'"'"')\]>,;:.]+$//' \
      | while IFS= read -r url; do
          [ -n "$url" ] || continue
          # Isolate the host (strip scheme, then path/port/query).
          host="${url#*://}"
          host="${host%%/*}"
          host="${host%%:*}"
          host="${host%%\?*}"
          if ! printf '%s' "$host" | grep -qiE "$RESERVED_TLD_RE"; then
            echo "::error::non-reserved-TLD URL in $file: $url (host: $host)"
            echo "BADURL"   # signal via stdout marker; collected below
          fi
        done
  done < <(find "$dir" -type f -print0)
done > "$_HYGIENE_TMP" 2>&1 || true
if grep -q '^BADURL$' "$_HYGIENE_TMP" 2>/dev/null; then
  grep -v '^BADURL$' "$_HYGIENE_TMP" || true
  fail=1
fi
rm -f "$_HYGIENE_TMP" 2>/dev/null || true

# --- (b) No sentinels under examples/ (sentinels ARE allowed in templates/) ---------
echo "--> (b) Checking no example-pack sentinels survive under examples/"
if [ -d "$EXAMPLES_DIR" ]; then
  # Fixed-string sentinels. "# REQUIRED" is matched as a whole token.
  SENTINELS=("my-project" "my-stack" "PROJ" "# REQUIRED")
  for s in "${SENTINELS[@]}"; do
    if hits="$(grep -rInF -- "$s" "$EXAMPLES_DIR" 2>/dev/null)"; then
      echo "::error::sentinel \"$s\" found under $EXAMPLES_DIR:"
      printf '%s\n' "$hits"
      fail=1
    fi
  done
fi

# --- (c) Render-smoke: template pack parses + fixture exists ------------------------
echo "--> (c) Render-smoke: template pack parses + onboard fixture exists"
if [ ! -f "$FIXTURE" ]; then
  echo "::error::onboard-answers fixture missing: $FIXTURE"
  fail=1
else
  python3 -c "import sys,yaml; yaml.safe_load(open(sys.argv[1]))" "$FIXTURE" \
    || { echo "::error::onboard fixture failed to parse: $FIXTURE"; fail=1; }
fi

TEMPLATE_PACK="$TEMPLATES_DIR/.nightshift"
if [ -d "$TEMPLATE_PACK" ]; then
  while IFS= read -r -d '' yml; do
    python3 -c "import sys,yaml; yaml.safe_load(open(sys.argv[1]))" "$yml" \
      || { echo "::error::template pack YAML failed to parse: $yml"; fail=1; }
  done < <(find "$TEMPLATE_PACK" -type f \( -name '*.yml' -o -name '*.yaml' \) -print0)
else
  echo "::error::template pack directory missing: $TEMPLATE_PACK"
  fail=1
fi

# --- Verdict ------------------------------------------------------------------------
if [ "$fail" -ne 0 ]; then
  echo "==> FAIL: example-hygiene check found violations (see ::error:: lines above)."
  exit 1
fi
echo "==> PASS: all example/template URLs use reserved TLDs, no sentinels under examples/, render-smoke OK."
