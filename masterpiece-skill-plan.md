# Upgrade `codebase-onepager` Into a Masterpiece Skill

## Summary

Revise `codebase-onepager` into a compact orchestrator skill with lean progressive-disclosure references. Keep the generated artifact unchanged: a fixed five-section, three-minute onboarding one-pager focused on comprehension only. The implementation should improve how the agent gathers truth: source-grounded tracing, context-rot handling, optional subagent delegation, and disciplined stopping rules.

## Key Changes

- Keep `SKILL.md` under 150 lines if practical, with a hard warning threshold around 200 lines.
- Add two reference files:
  - `reference/output-template.md`: exact five-section output template plus one filled example.
  - `reference/tracing.md`: tracing workflow, repo-shape guidance, evidence budget, context-rot rules, and optional subagent packet format.
- Reframe subagents as an **optional accelerator**, not a hard dependency:
  - Use generic wording compatible with Claude Code, opencode, Codex, and GitHub Copilot-style environments.
  - Say “if the host supports read-only/explorer subagents or delegated analysis.”
  - Avoid naming a specific `Explore` agent; in Codex terms this maps to the `explorer` role.
  - If subagents are unavailable, the skill must work inline with the same progressive-disclosure rules.
- Resolve the orchestrator contradiction:
  - Small/simple repo: orchestrator may read narrowly and capture incrementally.
  - Large/monorepo: orchestrator avoids heavy source reading and delegates focused discovery when available.
- Replace “write each section” with “maintain a working draft in the active response/context”; do not create files unless the user explicitly asks.
- Require delegated findings to return a compact structured packet:
  - candidate one-pager wording
  - source anchors used internally
  - uncertainty/conflict notes
  - stop condition reached
- Keep evidence internal by default. The final one-pager should not include citations, appendices, source lists, diagrams, risk ratings, TODOs, or recommendations.

## Skill Behavior

- Workflow:
  - Size the repo lightly: file count shape, likely entrypoints, monorepo vs single app.
  - Choose inline or optional delegated path.
  - Scout runtime entrypoints and select one representative operation, preferring a write path.
  - Trace that operation hop by hop until durable state or external handoff.
  - Derive 3-5 major components from responsibility boundaries, not folders alone.
  - Identify systems of record needed to understand the traced journey.
  - Describe observed seams without turning them into advice.
- Context-rot rules:
  - Treat docs as hypotheses, not truth.
  - Prefer runtime wiring, route/command registration, queue/topic config, schema, adapters, and representative tests.
  - Mark stale docs, dead code, conflicting paths, missing ownership, or unverified claims as `unclear`.
  - Avoid generated, vendored, fixture, and sample code unless it defines runtime behavior.
- Output contract remains exactly:
  - `In one sentence`
  - `The request's journey`
  - `The major components`
  - `Where the truth lives`
  - `The seams`

## Test Plan

- Static review:
  - Valid YAML frontmatter.
  - `SKILL.md` stays compact and points to references only where needed.
  - Final artifact template still has exactly five sections.
  - “Comprehension, not judgment” remains explicit.
- Compatibility review:
  - Instructions work without subagents.
  - Optional delegation language is host-agnostic.
  - No Codex-only API details leak into the user-facing skill instructions.
- Mental dry-runs:
  - HTTP service with database and worker.
  - CLI with filesystem writes.
  - Event-driven service.
  - Batch/cron-driven system.
  - Library with no request path.
  - Monorepo with multiple apps.
- Acceptance criteria:
  - A future agent knows where to start, when to widen, and when to stop.
  - The final one-pager stays clean and portfolio-quality.
  - Context rot is actively detected instead of smoothed over.
  - Large repos do not force the orchestrator to hold the whole system in context.
  - Small repos avoid unnecessary delegation overhead.

## Assumptions

- Multi-file skill structure is allowed: `SKILL.md` plus `reference/`.
- References should stay lean, not become a long architecture-analysis playbook.
- Source evidence is used internally and omitted from the final one-pager unless a user separately asks for auditability.
- The skill remains comprehension-only; judgment, risk, refactoring advice, and recommendations stay out of scope.