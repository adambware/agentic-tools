# Make `codebase-onepager` a Masterpiece Skill

## Summary

Evolve `codebase-onepager` from a single-file prose skill into a lean **orchestrator + adaptive subagent** skill that produces source-grounded, context-aware, portable onboarding artifacts — without bloating context or token cost. The user-facing output (the fixed five-section one-pager) is unchanged. What changes is *how the agent gets there*: the orchestrator stays small and clean, context-heavy reading is pushed into disposable subagents on large repos, and detail is pushed into reference files loaded only when needed.

This revises the prior single-file plan based on two decisions: (1) handle context rot via **both** input discipline and incremental/subagent capture, and (2) net-trim toward a <150-line `SKILL.md`, spilling detail to reference files.

## Architecture

### Orchestrator: `SKILL.md` (target <150 lines, warn at 200)

Holds only: the thesis, when-to-use, the workflow, the repo-sizing decision, dispatch logic, and the output contract by reference. It **never reads source into its own context window**. It assembles the one-pager section by section as findings return — incremental capture is the default, so the agent never holds the whole system in its head and reconstructs at the end.

### Adaptive subagent strategy (core cost lever)

The orchestrator sizes the repo first (file count, entry-point count, monorepo vs single app), then chooses:

- **Small / simple repo → inline.** Orchestrator reads directly with incremental capture. No spawn overhead.
- **Large / monorepo → fan out.** Dispatch focused subagents, each of which burns its own context window and returns a **distilled ~10-line result**, then is discarded. The orchestrator's context stays clean regardless of repo size.

Subagent split when fanning out:

- Scout entry points + pick the most representative operation (prefer a write path).
- Trace that one operation hop by hop (the expensive read).
- Inventory 3–5 major components + locate systems of record relevant to the journey.

Subagents use the read-only `Explore` agent (reads excerpts, not whole files) to stay cheap. They return findings, never transcripts.

### Reference files (progressive disclosure)

`SKILL.md` points to these; they are loaded only at the step that needs them:

- `reference/output-template.md` — the exact five-section template + filled example.
- `reference/tracing.md` — how to trace one operation across repo shapes (HTTP, CLI, worker, batch, library, event-driven, monorepo), and the evidence/context budget rules.

## Key Changes

- Keep the thesis, scope, and fixed output shape: comprehension only, no risk review, no recommendations, no extra generated files in the artifact.
- Update frontmatter `description` to mention source-grounded onboarding, one traced operation, systems of record, seams, and stale/unclear context handling.
- Replace the flat `Method` with an orchestrated workflow: size repo → (inline | fan out) → scout/trace/inventory → locate systems of record → describe seams → assemble incrementally.
- **Evidence and context budget** (in `reference/tracing.md`, summarized in SKILL.md):
  - Treat docs as hypotheses, not truth.
  - Prefer runtime wiring, route/command registration, queue config, schema, adapters, representative tests.
  - Follow one operation only until durable state or external handoff; widen only to resolve ambiguity.
  - Avoid generated, vendored, fixture, or sample code unless it defines runtime behavior.
  - Mark stale docs, dead code, conflicting paths, or unverified claims as `unclear`.
- **Context-rot handling while it works:**
  - Incremental capture: write each section as its finding returns.
  - Subagent isolation on large repos: heavy reads happen in disposable contexts.
- Harden **Where the truth lives**: "systems of record needed to understand the journey" (not "every store"); "intended writer; if multiple writers, say shared/unclear" (not "single component allowed to write").
- Tighten **The seams**: observed change boundaries (interfaces, queue contracts, route handlers, adapters, plugin points, ownership boundaries); keep `Cut here` / `Not here` but descriptive, not advisory.

## Output Contract (unchanged)

- Exactly these five headings, in order: `In one sentence`, `The request's journey`, `The major components`, `Where the truth lives`, `The seams`.
- No citations, appendices, diagrams, risk ratings, TODOs, or recommendations in the final one-pager.
- Inline markers allowed only for uncertainty: `unclear` and `(inferred)`.
- Roughly three-minute readable; each bullet or sentence must teach a system fact.

## Test Plan

- Static review: valid YAML frontmatter; `SKILL.md` under 150 lines; reference files loaded only on demand; output template still has exactly five sections; "comprehension, not judgment" remains explicit.
- Architecture review: orchestrator never reads source inline on the large-repo path; subagents return distilled results, not transcripts; repo-sizing decision is explicit and adaptive.
- Dry-run mentally against: HTTP service + DB + worker; CLI with local FS writes; event-driven service with queue consumers; monorepo with multiple apps; library with no request path.
- Acceptance criteria:
  - A future agent knows where to start and when to stop reading.
  - Stale/conflicting context is handled explicitly.
  - Token cost scales with repo size (no needless fan-out on small repos).
  - Orchestrator context stays clean on large repos.
  - The generated one-pager stays fixed-shape and portfolio-quality.

## Assumptions

- Multi-file is now allowed: `SKILL.md` + `reference/` files (revises the prior single-file constraint).
- Subagent use is adaptive, not always-on (revises "no subagents").
- The one-pager output stays comprehension-only; judgment, risk, and refactoring advice stay out of scope.
