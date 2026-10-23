# /ship overlay — lean read-only review fan-out

This overlay rides on top of gstack's ship skill. **gstack `~/.claude/skills/ship/SKILL.md`
stays authoritative.** Follow it step by step, Steps 0–21, exactly as written and as
loaded this turn — all of its gates, logging, telemetry, version-bump, metrics and the
Step 17 credential guard run unchanged. This file overrides **only** the mechanism of the
two review-heavy steps, and hardens the push gate. Nothing here replaces or skips a SKILL.md
step; where this overlay and SKILL.md ever appear to conflict, SKILL.md wins except on the
two explicit points below.

When the hook's note is absent (spawned / Task / non-interactive `/ship` — `UserPromptSubmit`
does not fire there), this overlay simply is not present and ship runs as standard SKILL.md.
That is correct, just not lean. Do not claim ship is "always lean."

## Override 1 — Step 9 (specialist dispatch) and Step 11 (adversarial pass)

Run these two review fan-outs as a **read-only parallel Workflow over a patch file written
OUTSIDE the repo**, instead of in-context specialist/adversarial subagents. Everything else
in `sections/review-army.md` (Step 9) and `sections/adversarial.md` (Step 11) — the checklist
read, scope/`DIFF_LINES` selection, gate findings, approval/convergence gates, QA, and above
all the review-log start/finish bookkeeping — stays exactly as those sections say. You still
read those sections in full and execute them; you only swap HOW the reviewers run.

Procedure for Step 9 (repeat the analogous shape for each Step 11 attempt):

1. **Freeze first.** Do Step 9's setup through the point just before dispatch: finalize and
   commit the candidate so the working tree is clean. A single working-tree fingerprint `W`
   (`gstack-wtree`) must hold across review `--start`, review `--finish`, the adversarial
   `--start`/`--finish`, and the Step 11.5 dashboard read.
2. **Capture the token (orchestrator Bash).** Run `gstack-review-log --start review` and save
   `REVIEW_START` (for Step 11, `--start` per `sections/adversarial.md` → `PASS_START`,
   a fresh token per attempt). Capture it **before** writing the patch file and before the
   fan-out — same as SKILL.md captures it before reading the diff.
3. **Write the patch to this session's scratchpad (outside the repo).** `BASE=$(git merge-base origin/<base> HEAD)` then
   `git diff "$BASE" > "<scratchpad>/ship-review.patch"`, where `<scratchpad>` is this
   session's scratchpad directory — it is outside the repo and reclaimed automatically, so you
   need no cleanup. **Do NOT add an `rm -rf` or `trap ... EXIT` cleanup for it** — a
   destructive-command trap trips the host safety check and blocks the Workflow launch; the
   scratchpad is cleaned up for you. If no scratchpad is available, use `$(mktemp -d)` and
   still add no `rm -rf` trap. Never write the patch inside the worktree — a new untracked file
   would change `W`. Include non-ignored untracked source if SKILL.md's section does (it is
   already in the committed tree once you froze).
4. **Run the fan-out:** The reviewers workflow is **bundled with this plugin**; the `/ship`
   hook's injected note carries its **absolute path** (resolved from `${CLAUDE_PLUGIN_ROOT}`) —
   use that path verbatim as `scriptPath`. There is no machine-specific path to hardcode here.
   ```
   Workflow({ scriptPath: "<absolute scriptPath from the hook's note>",
              args: { stage: "review",            // or "adversarial" for Step 11
                      patchFile: "<$TMP/ship-review.patch>",
                      repoRoot: "<repo root>", diffBase: "<BASE>",
                      lenses: ["correctness","security","tests-gates","contracts"],
                      checklists: { ... optional specialist checklist paths ... } } })
   ```
   Use that **absolute** scriptPath exactly as the note gives it (no `~` — the host does not
   expand it). If the host cannot load that scriptPath, Read the file and pass its contents via
   `script:` inline instead. Reviewers are the `ship-lean-reviewer` agent (Read/Grep/Glob only)
   — read-only is **harness-enforced**, so no reviewer can flip `W` mid-review. Await the
   Workflow **within the same turn** (never end the turn mid-ship except at a native
   AskUserQuestion). Running `/ship` with this overlay is the skill-driven opt-in for the
   Workflow tool; the host still shows a one-time "review dynamic workflow" approval — a human
   approves it in an interactive session.
4a. **If the Workflow cannot run here, degrade to standard — do NOT stop ship.** When the
   Workflow call errors, the script won't load, or its approval is unavailable (an
   unattended / headless / spawned session cannot approve a dynamic workflow), the lean
   fan-out simply isn't available this run. Fall back to **SKILL.md's standard in-context
   Step 9 specialist dispatch and Step 11 adversarial pass** (Agent-tool subagents, which need
   no Workflow approval) and run them exactly as `sections/review-army.md` /
   `sections/adversarial.md` say, with their own review-log bookkeeping. Lean is
   interactive-only; standard ship is correct, just not lean. This fallback happens **before**
   any reviewer runs, so it is distinct from the incomplete-coverage STOP in step 5.
5. **No silent lens drops (when the fan-out DID run).** The result has per-lens
   `{lens, ok, findings}`. If `anyLensFailed` is true (any lens `ok:false` or a dead agent
   after the fan-out started), do **not** certify a clean pass and do **not** silently fall
   back: finish the review row `completed:false, converged:false, status:"unavailable"` via
   `gstack-review-log … --finish REVIEW_START`, print why, run `gstack-skill-end` in that same
   Bash call, and STOP. (Contrast step 4a: there the fan-out never started, so standard review
   still provides full coverage.)
6. **Reviewers apply ZERO fixes.** A fix ⇒ the tree changed ⇒ `converged:false` ⇒ the record
   never becomes CURRENT. Feed the returned findings into SKILL.md's normal Step 9.2 Fix-First
   / gate handling. If a fix is genuinely needed: apply it yourself, commit, then **re-freeze
   with a fresh token** and re-run the fan-out until a pass makes no edits (SKILL.md's repair
   insertion `9 → 10 → 11` applies).
7. **Finish the row (orchestrator Bash) on the unchanged tree.** Run the section's own
   `gstack-review-log '{…, "completed":true, "converged":true, …}' --finish REVIEW_START`
   exactly as `sections/review-army.md` / `sections/adversarial.md` specify. `--finish` stamps
   the binding fields; because the tree never changed since `--start`, `W` holds and Step 11.5
   binds. Do **not** hand-roll a bindcheck — SKILL.md Step 9.4 / 11 / 11.5 own that.

All `gstack-*` calls run in the orchestrator's own Bash — **never** inside a Workflow
subagent (reviewers have no Bash anyway). The patch file lives outside the repo for the whole
fan-out.

## Override 2 — fail-safe push gate (Step 16 "Report, then push" → Step 17)

Before any `git push` or PR/MR creation, the human must explicitly choose to push. Make the
gate fail toward **not** pushing:

- The push approval's **`(recommended)` option is "Stop here — nothing pushed."** Push/open-PR
  is a non-recommended option. gstack's `question-preference-hook` auto-decides the
  `(recommended)` option, and spawned/unattended auto-choose it — so recommending "stop"
  means every auto path declines to push.
- A push happens **only on a literal human selection** of the push option in an interactive
  AskUserQuestion. A PreToolUse auto-decide, a prose fallback, or `SESSION_KIND`
  unattended / spawned / headless is **NOT consent**: print `gate_pending — not pushed (no
  human approval)`, run `gstack-skill-end` in the same Bash call, and stop. (This is stricter
  than, and layered on top of, SKILL.md's own spawned/headless STOP-before-push rules — keep
  those too.)
- Keep Step 17's credential pre-push guard (`redact_prepush_hook`) verbatim, the existing-PR
  open-gate lookup, the idempotency check, and "never force-push."

## Non-negotiables (carried from the adversarial review)

- **Never `git add -A`.** This repo family includes vuln-research operator notes, evidence and
  targets (hard rule: no findings/targets in commits). Stage only explicit paths (SKILL.md
  Step 15 as written); STOP on any stray untracked file.
- **One frozen `W`.** Any edit or new untracked file between `--start` and the Step 11.5 read
  degrades the record to STALE/UNVERIFIED and Step 11.5 refuses to bind.
- **Same turn, one skill-start/-end pair.** Await each Workflow in the same turn; end a turn
  mid-ship only at a native AskUserQuestion. Run `gstack-skill-end` in the same Bash call that
  prints any STOP/gate reason, so the Stop hook never synthesizes a dangling `completed`.
