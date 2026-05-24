# Onboardme Plugin

Produces a one-page codebase onboarding doc that makes an unfamiliar system **picturable** in about three minutes. It traces one real request end to end, names the major components, locates the systems of record, and marks the seams where you'd change things. Comprehension only — risk and judgment are deliberately out of scope.

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add adamb/agentic-tools

# Install this plugin
/plugin install onboardme@agentic-tools
```

## Usage

Invoke via the `/onboardme` skill, or just ask "how does this codebase work?" / "give me the lay of the land" in an unfamiliar repo.

## How It Works

The skill acts as an orchestrator that gathers source-grounded truth and holds a working draft of the one-pager in context as it learns:

1. **Sizes the repo** lightly to choose a path — read narrowly (small repo) or delegate focused discovery (large repo / monorepo, if the host supports read-only/explorer subagents).
2. **Scouts the real entrypoints** and traces one representative operation hop by hop until it reaches durable state or an external handoff.
3. **Derives 3–5 major components**, locates the systems of record, and describes the observed seams.

Docs are treated as hypotheses and confirmed against runtime wiring; anything that can't be confirmed is marked `unclear`.

## Output

A fixed five-section one-pager, emitted as the reply (no files written unless you ask):

- **In one sentence** — what the system does, in plain language
- **The request's journey** — one real operation traced end to end as a narrative
- **The major components** — 3–5 boxes and what each is for
- **Where the truth lives** — every data store / system of record and its sole writer
- **The seams** — where a change slots in cleanly vs. load-bearing internals

The artifact carries no citations, source lists, diagrams, risk ratings, TODOs, or recommendations.

## Structure

```
onboardme/
├── .claude-plugin/plugin.json
├── skills/onboardme/
│   ├── SKILL.md
│   └── reference/
│       ├── output-template.md   # Exact five-section template + filled example
│       └── tracing.md           # Repo-shape guidance, evidence budget, context-rot rules
└── README.md
```
