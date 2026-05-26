# Testing

This repository uses shell tests because the shipped artifacts are Claude Code
plugin manifests, Markdown skills, and shell scripts. The local suite requires
`bash`, `git`, and `jq`.

Run the suite:

```bash
bash tests/dev-doctor-test.sh
```

The tests validate plugin JSON, shell syntax, real `dev-doctor` report
generation, machine-readable blocker behavior, and Compose collision-risk
reporting. Tests write only to per-run temporary directories under
`${TMPDIR:-/tmp}`.

When adding a plugin:

- Validate every JSON manifest with `jq empty`.
- Parse every shell script with `bash -n`.
- Add at least one behavior test that runs the real script or hook.
- Keep test dependencies minimal and document any new required tool here.
