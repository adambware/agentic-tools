---
name: assurance-garden
description: Run a registry gardening pass over an assurance pack — scan recent code, flows, and signal to find changes that map to NO existing registry entry, propose new entries for human approval (never auto-add), and flag orphaned entries and stale area mappings. Use when someone says "registry gardening", "find coverage gaps", "what changed that isn't reviewed", or wants to check the .nightshift/ registry still covers the codebase. This is the only defense against permanent blind spots.
---

# Assurance Engine — Registry Gardening

A weekly recurring pass that keeps the registry honest. The engine only reviews surfaces
that have a registry entry; anything the registry doesn't know about is a **permanent
blind spot** until gardening finds it. This pass is the sole defense against that — and
its output **replaces a separate coverage schema**. There is no other coverage map; the
registry, kept gardened, *is* the coverage map.

Optimize for closing real gaps and keeping mappings accurate — NOT for proposing the most
entries. A handful of correct proposals a human will approve beats a long speculative list.

## What gardening produces

A single **reviewable list, written for human approval** — never an edit to the registry.
Three sections:

1. **Proposed new entries** — surfaces with no covering registry entry.
2. **Orphaned entries** — registry entries whose `area` no longer maps to anything real.
3. **Stale area mappings** — entries whose `area` globs drifted from where the code moved.

## Workflow

### 1. Scan recent change

Look at what moved since the last gardening pass, across all sources the pack has:

- **Code** — new/changed files and modules in the repos listed in `manifest.yml`. Use git
  to bound the window (since the last pass / last N days).
- **Flows** — new or changed user journeys (Designer lane, once `flows.yml` exists).
- **Signal** — for the PM lane, `evidence_sources` (deferred for most packs; skip if
  `evidence_sources` is empty).

### 2. Map each change to the registry

For each meaningful change, ask: **does this map to an existing registry entry's `area`?**

- **Maps cleanly** → covered; nothing to do.
- **Maps to nothing** → a coverage gap. Draft a **proposed new entry** (next step).
- **Maps, but the entry's `area` is now wrong** → a **stale area mapping**; record the
  drift and the corrected globs.

### 3. Draft proposals (do not add them)

For each gap, draft a candidate registry entry conforming to
`${CLAUDE_PLUGIN_ROOT}/schemas/registry-entry.yml`: a proposed `id` (project-prefixed),
`title`, `kind`, `area` globs (from the actual paths), suggested `weight` + `interval_days`,
and `owner` lane. Mark it clearly as **PROPOSED — awaiting human approval**. Leave the
`(auto)` fields (`last_reviewed`, `status`, `linear`) unset.

### 4. Flag orphans and stale mappings

- **Orphaned entry** — its `area` globs match no files in the repo anymore (code deleted,
  module renamed away). Propose retiring it or remapping it; don't delete unilaterally.
- **Stale area mapping** — code that the entry intends to cover has moved out of its `area`
  globs. Propose the corrected globs.

### 5. Hand the list to a human

Present the three sections as one reviewable artifact. The human approves, edits, or
rejects each item; only then does anything change in `.nightshift/registries/`. The
approved new entries also feed the weekly digest's "proposed new registry entries
awaiting approval".

## Guardrails

- **Never auto-add, auto-edit, or auto-delete a registry entry.** Gardening only
  *proposes*; the human holds registry authority. This is non-negotiable.
- **Coverage gaps are the priority.** A missed surface is a permanent blind spot; a
  missed orphan is just noise. Lead with the gaps.
- **Propose lean.** Only surfaces a reviewer could actually act on — don't pad the list.
- **The registry is the coverage schema.** Keep these proposals accurate enough that the
  gardened registry can be trusted as the single coverage view; there is no other.
- Keep field names exact (`area`, `last_reviewed`, `interval_days`, `weight`, `owner`,
  `status`) so approved proposals drop straight into the registry.
