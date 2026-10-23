# ship-lean

A **lean overlay** for gstack's `/ship` skill — not a rewrite of it. gstack `/ship`
is a 21-step workflow; its two review-heavy steps (Step 9 specialist dispatch,
Step 11 adversarial pass) normally run as in-context subagents, which burns the
orchestrator's context. This plugin moves just those two steps into a **read-only
parallel Workflow** over a patch file written **outside the repo**, so the reviewers
run in their own contexts and the orchestrator stays lean. Everything else about
`/ship` is untouched.

A `UserPromptSubmit` hook injects a short overlay note when you type `/ship`.
**gstack's `SKILL.md` stays authoritative** — all of its gates, logging, telemetry,
version-bump, metrics, and the Step 17 credential guard run exactly as written. The
overlay changes only *how* the Step 9/11 reviewers run and hardens the push gate.

## What it does

- **Overlay, not replacement.** The hook adds context; gstack's `SKILL.md` drives
  every step. Where the overlay and `SKILL.md` ever appear to conflict, `SKILL.md`
  wins except on the two explicit override points (the review mechanism and the push
  gate).
- **Override 1 — Steps 9 & 11 as a read-only fan-out.** The orchestrator freezes the
  tree (commits the candidate), captures the gstack review-log `--start` token in its
  own Bash, writes the diff to a patch file in the session scratchpad (outside the
  repo — **no `rm -rf` / `trap EXIT` cleanup**, which would trip the host safety check
  and block the Workflow), then runs the bundled `reviewers.workflow.js`. One
  `ship-lean-reviewer` agent per lens (correctness, security, tests-gates, contracts)
  reads the patch and the repo for context. The agent is restricted to `Read, Grep,
  Glob` — read-only is **harness-enforced by its tool allowlist, not by prompt**, so no
  reviewer can mutate the tree mid-review.
- **Override 2 — fail-safe push gate.** Before any push/PR, the push approval's
  `(recommended)` option is **"Stop here — nothing pushed."** A push happens *only* on a
  literal human selection in an interactive AskUserQuestion; an auto-decide, a prose
  fallback, or an unattended/spawned/headless session is **not** consent.

## The one invariant

**A single `gstack-wtree` fingerprint `W` holds across the review `--start`/`--finish`,
the adversarial `--start`/`--finish`, and the Step 11.5 dashboard read — and the
reviewers apply ZERO fixes.** The patch file lives outside the repo, so writing it does
not change `W`; the reviewers are read-only, so the fan-out cannot change `W`. If a fix
is genuinely needed, the orchestrator applies it, commits, re-freezes with a *fresh*
token, and re-runs the fan-out until a pass makes no edits. Any edit or stray untracked
file between `--start` and the Step 11.5 read degrades the record to STALE/UNVERIFIED and
Step 11.5 refuses to bind. All `gstack-*` calls run in the orchestrator's own Bash, never
inside a Workflow subagent.

## Interactive-only

Lean is **interactive-only**. `UserPromptSubmit` does not fire for spawned / Task /
non-interactive `/ship`, so the overlay is simply absent there and ship runs as standard
`SKILL.md` — correct, just not lean. Even when the overlay *is* present, running the
read-only Workflow needs a one-time human "review dynamic workflow" approval; an
unattended / headless / spawned session cannot give it. In that case the overlay
**degrades to `SKILL.md`'s standard in-context Step 9/11 reviewers** (step 4a of the
overlay) rather than stopping ship. Do not claim ship is "always lean."

## Prerequisites

- **gstack installed**, with its `/ship` skill (`~/.claude/skills/ship/SKILL.md`). This
  plugin is an **add-on** to gstack `/ship`; on its own it does nothing. The injected
  note defers to gstack's `SKILL.md` for every step.
- **Bun >= 1.4.2** — gstack's ship startup gate requires it.
- **Python 3** — the hook is a `python3` script (preinstalled on macOS).

## Enable

```bash
/plugin marketplace add adambware/agentic-tools   # once per machine
/plugin install ship-lean@agentic-tools
```

The plugin registers the `UserPromptSubmit` hook and the `ship-lean-reviewer` agent
natively via `${CLAUDE_PLUGIN_ROOT}` — no machine-specific paths, no manual
`settings.json` edit. Then just type `/ship` in an interactive session; on your first
run, approve the one-time "review dynamic workflow" prompt and watch for the
`review:correctness` / `review:security` / … reviewer agents and a Step 11.5 Review
Readiness of CLEARED.

## Migration from the hand-installed overlay

Before this was a plugin, the overlay was five files hand-installed under `~/.claude`
plus an **untagged** entry under `.hooks.UserPromptSubmit` in `~/.claude/settings.json`.

> **If you enable this plugin while the manual install is still present, the hook fires
> twice and the `ship-lean-reviewer` agent exists twice.** Remove the manual install
> first.

**You run the cleanup yourself**, in your own account — this repo's tooling never touches
your `~/.claude`. A helper is bundled; it is **dry-run by default** (prints what it would
remove and changes nothing) and only acts with `--apply`:

```bash
# see what would be removed (safe)
bash plugins/ship-lean/scripts/migrate-from-manual-install.sh

# actually remove it (backs up settings.json first)
bash plugins/ship-lean/scripts/migrate-from-manual-install.sh --apply
```

It removes:

- `~/.claude/agents/ship-lean-reviewer.md`
- `~/.claude/playbooks/ship.md`
- `~/.claude/playbooks/ship-lean/` (the reviewers workflow)
- `~/.claude/hooks/ship-playbook-hook`
- the untagged `.hooks.UserPromptSubmit` entry in `~/.claude/settings.json` whose command
  references `ship-playbook-hook` (a timestamped `settings.json.bak.*.shiphook-migrate`
  backup is written before the edit; the original manual-install backup
  `~/.claude/settings.json.bak.20261021-231607.shiphook` is left untouched)

To do it by hand instead, delete those four paths, delete the one `ship-lean/` directory,
and remove the matching UserPromptSubmit entry from `settings.json`. **Then** enable
`ship-lean@agentic-tools`.

## Layout

```
plugins/ship-lean/
├── .claude-plugin/plugin.json          # manifest
├── agents/ship-lean-reviewer.md        # read-only reviewer (Read, Grep, Glob)
├── hooks/
│   ├── hooks.json                      # UserPromptSubmit -> ship-playbook-hook
│   └── ship-playbook-hook              # python3 injector; paths from ${CLAUDE_PLUGIN_ROOT}
├── playbooks/
│   ├── ship.md                         # the ~1-page overlay (SKILL.md stays authoritative)
│   └── ship-lean/reviewers.workflow.js # the parallel read-only fan-out
├── scripts/migrate-from-manual-install.sh
├── test/ship-lean-test.sh              # hermetic hook + invariant checks
└── README.md
```
