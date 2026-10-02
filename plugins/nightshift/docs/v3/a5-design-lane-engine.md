# A5 — Design lane enablement (engine side)

**Scope:** `nightshift.workflow.js`, `agents/`, `skills/onboard/`. **Depends on:** A4.
**Gate:** lane gating refuses correctly on a pack missing browser config or personas.

(The novudesk **pack** side — onboard reconcile, personas, base_url — is session A8,
on the operator's machine.)

## Spec

### Per-adapter reviewer agents (plan §9.3)

The old promise "the orchestrator injects the concrete browser/MCP tool at dispatch
time" is impossible — **no dispatch API accepts a tools list**. Workflow `agent()` takes
`label, phase, schema, model, effort, isolation, agentType`; subagent tools come from
frontmatter only. Instead:

- Ship **one concrete agent per browser adapter** — e.g. `agents/ux-reviewer-playwright.md`
  granting `Read, Grep, Glob, Write, mcp__playwright__*`. Keep `agents/ux-reviewer.md`
  as the stack-agnostic base spec.
- `ns` preflight reads `stack_adapter.browser.tool` from the manifest and passes the
  agent type through `args` (launcher-side data, same principle as dispatch in A4).
- **`ux-reviewer` gains `Write` regardless of adapter** — it is the design lane's
  reviewer and must write `candidates.proposed.json` + `reviewed.json` per E3.

### Lane-parameterized workflow

`args.lane` selects reviewer agentType, registry file, and adapter grant. The design
lane's prerequisite gate (base_url + personas present, plus the environment-safety
assertions — see A7/T8) is enforced **launcher-side in `ns` preflight** — fail fast with
the reason, never half-run.

### Unchanged discipline

- Anchor discipline: no objective anchor → digest, never a ticket.
- The ux-reviewer drives flows via the manifest browser adapter (Playwright against the
  local URL).

### Evidence flow (hand-off to A7/A8)

Screenshots land in the run dir; screenshots referenced by **confirmed** findings are
copied to `$OPS/evidence/<repo>/` (content-addressed, lifecycle-pruned per A1's
`prune()`), so the dashboard can show them after the run dir is cleaned. The copy step
is launcher-side (A7); this session only ensures the reviewer writes evidence paths into
its artifacts.

## Failure modes to cover

| Codepath | Failure | Handling |
|---|---|---|
| lane gating | pack missing browser adapter or personas | refuse with reason (gate test) |

## Tasks

- [x] **T3 (P1)** — `agents/` — per-adapter ux-reviewer + `Write`
  - Files: `agents/ux-reviewer.md`, new `agents/ux-reviewer-playwright.md`
  - Verify: design dispatch resolves a browser tool; ux-reviewer can write its artifacts
  - Landed: `agents/ux-reviewer.md` (base spec, +`Write`, false dispatch-time-grant promise
    removed), `agents/ux-reviewer-playwright.md` (concrete adapter, `mcp__playwright__*`,
    self-contained), plus `agents/ux-refuter.md` / `agents/ux-refuter-2.md` — the v3
    orchestrator runs the two-tier refute gate for EVERY lane, so the design lane needed its
    own refuters rather than borrowing the security ones (see "Open for the next session").
- [x] Lane parameterization + onboard design branch (spec above)
  - `args` gains `registry` + `agents{reviewer,refuter_tier1,refuter_tier2}`; the workflow
    reads them as plain member accesses and stays at ZERO conditionals.
  - `src/lib/lane-plan.ts` + `bin/lane-plan.mjs` own the lane -> data tables
    (`REGISTRY_BY_LANE`, `AGENTS_BY_LANE`, `UX_REVIEWER_BY_ADAPTER`) and the design-lane
    prerequisite gate. `skills/design/SKILL.md` RUNS the binary and refuses on exit 2 —
    until `ns` exists (A7) the skill is the launcher, so a prose-only gate would have been
    dead code.
  - Gate evidence: probe pack missing `stack_adapter.browser` and probe pack missing
    `fixtures/personas.yml` both -> exit 2, empty stdout, specific reason, pack tree
    byte-identical, no `--out` file. Fully seeded pack -> exit 0 naming
    `ux-reviewer-playwright`. Security lane on a browser-less pack -> exit 0 (no leakage).

## Open for the next session (found by A5's adversarial round, NOT fixed here)

- **The mandatory `anchor` is prose-only.** `schemas/candidate-finding.yml` lists `anchor`
  as optional ("if present, in the enum"), so `bin/validate` passes an anchorless design
  candidate straight through both refuter tiers into `bin/record`. "No anchor -> not a
  ticket" is stated in three agent files and enforced nowhere. Fixing it needs a routing
  decision (drop vs. route to digest, per "no objective anchor -> digest, never a ticket")
  and touches `bin/dedupe` (which already takes `--lane`), so it was left out of A5 rather
  than half-built.
- **`manifest.allowlist` is documented as if it grants tools to agents** (`schemas/manifest.yml:40`,
  `templates/.nightshift/manifest.yml:46`, `skills/onboard/reference/onboard-mechanics.md:65`).
  It cannot: subagent tools come from frontmatter. Same false-promise family A5 killed
  elsewhere, but correcting it is a pack-schema change (onboard + templates + examples).
- **`--out` with no value writes a file named `true`** — `src/lib/args.ts` maps a valueless
  flag to `"true"`; shared by every bin, so out of A5's bounds.
- **`mcp__playwright__*` frontmatter wildcard is unverified at runtime.** If it is not
  honored, the resolved design reviewer holds no browser tool; `ux-reviewer-playwright.md`
  now self-refuses (`reviewed.json = []`) in that case, but A8's first real run should
  confirm the grant actually resolves.
- **Pack containment in `lane-plan` is lexical, not physical.** A symlinked
  `fixtures/personas.yml` pointing outside the pack is accepted. The pack is operator-owned,
  so this is documented rather than hardened (`contain.ts` stays A4's).
