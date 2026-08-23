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

- [ ] **T3 (P1)** — `agents/` — per-adapter ux-reviewer + `Write`
  - Files: `agents/ux-reviewer.md`, new `agents/ux-reviewer-playwright.md`
  - Verify: design dispatch resolves a browser tool; ux-reviewer can write its artifacts
- [ ] Lane parameterization + onboard design branch (spec above)
