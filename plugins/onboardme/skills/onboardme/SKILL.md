---
name: onboardme
description: Produce a one-page codebase onboarding doc that makes an unfamiliar system picturable in about three minutes. Traces one real request end to end, names the major components, locates the systems of record, and marks the seams where you'd change things. Use when handing a system to a new lead or team, when someone asks "how does this codebase work?", or for a fast orientation before deeper work. Comprehension only — judgment and risk are out of scope.
---

# Codebase Onboarding One-Pager

You can't reason about a system you can't picture. This skill's only job is to make an
unfamiliar codebase **picturable** — fast enough that a new lead reads the result in
about three minutes and can then reason about the system on their own.

Comprehension is the deliverable. Risk assessment, quality judgment, and
recommendations are deliberately **out of scope** — other skills cover those. Every
line of the final one-pager should teach what the system *is* and *does*, not what you
think of it.

## When to use

- Handing a system off to a new lead or team
- "How does this codebase work?" / "Give me the lay of the land"
- Orienting yourself before deeper work in an unfamiliar repo

## How this skill works

You are the **orchestrator**. You gather source-grounded truth, hold a working draft of
the one-pager in your response/context as you learn, and emit the final artifact when
the trace is complete. You do **not** write files unless the user explicitly asks for
one — the one-pager is your reply.

The full tracing workflow, repo-shape guidance, evidence budget, context-rot rules, and
the optional delegation packet live in [reference/tracing.md](reference/tracing.md). The
exact output template and a filled example live in
[reference/output-template.md](reference/output-template.md). Read each when you reach
the step that needs it; don't preload them.

## Workflow

1. **Size the repo lightly.** Get the file-count shape, likely entrypoints, and whether
   it's a single app or a monorepo. This decides your path, not your understanding —
   keep it cheap.
2. **Choose a path.**
   - **Small / simple repo:** read narrowly yourself and capture the picture
     incrementally as you go.
   - **Large repo / monorepo:** avoid heavy source reading in your own context. If the
     host supports read-only/explorer subagents or delegated analysis, delegate focused
     discovery and have it return the compact packet from
     [reference/tracing.md](reference/tracing.md). If not, work inline under the same
     evidence budget and context-rot rules.
3. **Scout the real entrypoints** — how work actually enters (routes, CLI commands,
   message consumers, cron, webhooks). Read the wiring, not the README.
4. **Pick one representative operation** and trace it hop by hop until it reaches durable
   state or an external handoff. Prefer a write path; it touches more of the system.
5. **Derive 3–5 major components** from responsibility boundaries — not folder names alone.
6. **Locate the systems of record** needed to understand that journey, and who is allowed
   to write to each.
7. **Describe the observed seams** — where a change slots in cleanly vs. load-bearing
   internals. Describe what you see; do not turn it into advice.

Maintain the one-pager as a working draft in context throughout. Tighten it as evidence
firms up; mark anything you can't confirm as `unclear` rather than guessing.

## Guardrails

- **Comprehension, not judgment.** No "this should be refactored", no risk ratings, no
  praise or criticism. Describe what is.
- **Source over docs.** Treat docs as hypotheses; confirm against runtime wiring. (See
  the context-rot rules in [reference/tracing.md](reference/tracing.md).)
- **One real path, not the catalog.** Trace a single concrete operation through real
  names. Don't enumerate every endpoint.
- **Evidence stays internal.** The final one-pager has no citations, source lists,
  appendices, diagrams, risk ratings, TODOs, or recommendations — just the five sections.
- **Fixed shape.** Always the same five headings, same order, one page. The reader learns
  the template once and reuses it across systems.
- **Don't write files.** The one-pager is your reply unless the user asks to save it.
