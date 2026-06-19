#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source_dir="${repo_root}/plugins/onboardme/skills/onboardme"
fixtures_dir="${repo_root}/evals/onboardme/fixtures/repos"

if [[ ! -f "${source_dir}/SKILL.md" ]]; then
  echo "canonical onboardme skill not found: ${source_dir}/SKILL.md" >&2
  exit 1
fi

if [[ ! -f "${source_dir}/reference/tracing.md" || ! -f "${source_dir}/reference/output-template.md" ]]; then
  echo "canonical onboardme references are incomplete under ${source_dir}/reference" >&2
  exit 1
fi

if [[ ! -d "${fixtures_dir}" ]]; then
  echo "fixture repo directory not found: ${fixtures_dir}" >&2
  exit 1
fi

found=0
for repo in "${fixtures_dir}"/*; do
  [[ -d "${repo}" ]] || continue
  found=1
  dest="${repo}/.claude/skills/onboardme"
  case "${dest}" in
    "${repo}/.claude/skills/onboardme")
      rm -rf "${dest}"
      ;;
    *)
      echo "refusing to clear unexpected destination: ${dest}" >&2
      exit 1
      ;;
  esac
  mkdir -p "$(dirname "${dest}")"
  cp -R "${source_dir}" "${dest}"
done

if [[ "${found}" -eq 0 ]]; then
  echo "no fixture repositories found under ${fixtures_dir}" >&2
  exit 1
fi
