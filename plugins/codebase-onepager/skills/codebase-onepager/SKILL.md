---
name: codebase-onepager
description: Produce a one-page codebase onboarding doc that makes an unfamiliar system picturable in about three minutes. Traces one real request end to end, names the major components, locates the systems of record, and marks the seams where you'd change things. Use when handing a system to a new lead or team, when someone asks "how does this codebase work?", or for a fast orientation before deeper work. Comprehension only — judgment and risk are out of scope.
---

# Codebase Onboarding One-Pager

You can't assess a system you can't picture. This skill's only job is to make an
unfamiliar codebase **picturable** — fast enough that a new lead reads it in about
three minutes and can then reason about the system on their own.

Comprehension is the deliverable. Risk assessment, quality judgment, and
recommendations are deliberately **out of scope** — other skills cover those.
Every line you write should teach the reader what the system *is* and *does*, not
what you think of it.

## When to use

- Handing a system off to a new lead or team
- "How does this codebase work?" / "Give me the lay of the land"
- Orienting yourself before deeper work in an unfamiliar repo

## Method

1. **Find the real entry points.** Locate how work actually enters the system —
   HTTP routes, CLI commands, message consumers, cron jobs, webhooks. Read the
   routing/wiring, not just the README.
2. **Pick one representative operation** — the most central thing the system does
   (e.g. "place an order", "ingest a document"). You will trace this one path end
   to end. Prefer a write path; it touches more of the system than a read.
3. **Follow it through the code**, hop by hop: entry → service → queue → worker →
   data store. Note what happens in what order, and what each hop hands to the next.
4. **Inventory the major components** (aim for 3–5) and what each is responsible for.
5. **Locate the data stores and systems of record.** For each, determine which
   single component is allowed to write to it.
6. **Identify the seams** — the boundaries where a change cleanly slots in
   (interfaces, queue contracts, plugin points) versus the load-bearing internals
   where a change ripples.

Verify against the code. If you can't confirm something, say "unclear" rather than
guessing — a confident wrong picture is worse than a marked gap.

## Output

Emit exactly these five sections, in order. Keep it to one page (~3 minutes to read).
Every line must be load-bearing. State **facts** plainly; do not editorialize. If you
must note an inference, mark it `(inferred)`.

```markdown
# <System> — Onboarding One-Pager

## In one sentence
<What the system does, in plain language. No jargon, no acronyms unexpanded.>

## The request's journey
<Trace one real operation end to end as a short narrative — the order of events,
not a box diagram. "A POST to /orders hits OrderController, which validates and
writes a row to orders (status=pending), then enqueues an OrderPlaced message;
the fulfillment worker picks it up, reserves inventory, and flips the row to
confirmed." Name the real endpoint, services, queues, workers, and tables.
Behavior and ordering teach more than structure.>

## The major components
- **<Component>** — <its one job, in a sentence.>
- **<Component>** — <its one job.>
<3–5 total. Each is a box and what that box is for.>

## Where the truth lives
- **<Store / system of record>** — <what it holds; the component allowed to write to it.>
- **<Store>** — <what it holds; its sole writer.>
<List every data store and external system of record, and who owns writes to each.>

## The seams
- **Cut here:** <boundaries where a change slots in cleanly — interface, queue
  contract, plugin point — and what kind of change belongs there.>
- **Not here:** <load-bearing internals where a change ripples; what makes them rigid.>
```

## Guardrails

- **Comprehension, not judgment.** No "this should be refactored", no risk ratings,
  no praise or criticism. Describe what is.
- **One real path, not the catalog.** Trace a single concrete operation through real
  names. Don't enumerate every endpoint.
- **Narrative over diagram.** The journey section is prose that conveys ordering and
  causation, not an ASCII box-and-arrow chart.
- **Fixed shape.** Always the same five headings, same order — the reader learns the
  template once and reuses it across systems.
- **Cut ruthlessly.** If a line doesn't change what the reader knows or can do, delete it.
