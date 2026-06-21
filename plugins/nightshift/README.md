# Nightshift

A budget-aware, two-lane review loop that keeps **security surfaces** and **user flows**
continuously fresh, refuted, and visible — while humans keep roadmap, design, and remediation
authority.

Built once as an **engine** (project-agnostic, this plugin); each codebase is onboarded as a
**pack** that lives in `<repo>/.nightshift/` and travels with the code.

> **Design discipline (non-negotiable):** optimize for coverage freshness, confidence, dedupe
> quality, and digest usefulness — **not** the number of findings. A schema field is added only
> when a real failure mode demands it.

## Quick start (first run)

1. `/nightshift:onboard` — detect your stack, seed the registry from the base taxonomy, write the pack
2. `/nightshift:security` — validate allowlist, area globs, and refuter gate before the first cadence
3. `/nightshift:digest` — read the first weekly signal

The security lane is "done" not when it runs, but when `vectors.yml` is reviewed and the first run's false-positive rate is acceptably low. Start there.

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add adambware/agentic-tools

# Install this plugin
/plugin install nightshift@agentic-tools
```

## Engine vs pack

```
plugins/nightshift/                # the ENGINE — project-agnostic, versioned once
  skills/                          # human-invokable entry points (security / design / onboard / digest / garden)
  agents/                          # generic reviewer subagents (security / refuters / ux)
  taxonomy/                        # BASE libraries (owasp-asvs.yml) that packs clone + extend
  schemas/                         # canonical registry-entry + finding + manifest + metrics
  templates/.nightshift/           # copyable pack skeleton
  examples/novudesk/.nightshift/   # a worked seed proving the engine adapts (fully fictional)

<each repo>/.nightshift/           # the PACK — travels with the code, versioned in the repo
  manifest.yml                     # stack adapter, allowlist, Linear labels, cadences, pack_format
  registries/{vectors,flows}.yml
  fixtures/                        # seeded test personas (design lane)
  metrics/                         # append-only runs + daily rollups + findings
  dashboard.md                     # generated coverage view (disposable)
```

## Skills

Plugin commands are **colon-namespaced** by their skill folder: `/nightshift:security`,
`/nightshift:design`, and so on. (The dash form `/nightshift-security` does not exist.)

| Command | What it does |
|---------|--------------|
| `/nightshift:security` | **Security/assurance review run.** Execute **one** bounded run for the security lane: select stalest/changed vectors within the manifest budget (**K**), fan out the security-reviewer subagent, run the mandatory refuter gate, dedupe, log findings, update state, emit per-run metrics, apply severity gates. |
| `/nightshift:design` | **Designer (UX) review run.** Prerequisite-gated — refuses to run until the pack has a staging browser adapter (`stack_adapter.browser.base_url`) **and** seeded `fixtures/personas.yml`. Fails fast with a clear reason rather than half-running. Shares the bounded run-loop with `/nightshift:security`. |
| `/nightshift:onboard` | Onboard a codebase as a pack: detect the stack, batch-confirm deltas, seed a draft `vectors.yml` from the base taxonomy, run a human-reviewed seed + gate pass, then write the pack. Interactive + mutating. |
| `/nightshift:digest` | Produce the **weekly digest** — the management signal: new critical/high, repeated themes, overdue surfaces, false-positive rate, proposed entries awaiting approval, and the top human decisions needed. Read-only; the one skill left model-invocable. |
| `/nightshift:garden` | Weekly **registry gardening**: does each recent change map to an entry? If not, *propose* one (humans approve). Flags orphaned entries and stale `area` mappings — the only defense against permanent blind spots. |

## Reviewer subagents

| Agent | Role |
|-------|------|
| `security-reviewer` | Defensive review of a vector's code surface ("is this adequately protected?"). Proposes — never files — a finding with `preconditions` and an optional failing invariant test. **Assurance, not a pentest:** no exploit payloads or offensive tooling. |
| `security-refuter` | **Tier-1, always.** Mandatory independent re-read of **every** candidate — given the full proposed finding but instructed to ignore the reviewer's narrative and re-read source itself. Must *refute* before a finding survives; rejections count toward `rejected_tier1`. (haiku, `maxTurns 8`, low effort.) |
| `security-refuter-2` | **Tier-2, conditional.** Runs **only** when a Tier-1 survivor is critical/high severity **OR** `confidence == low` (union predicate). A second, harder pass; rejections count toward `rejected_tier2`. (sonnet/high, `maxTurns 12`.) |
| `ux-reviewer` | Designer friction & a11y auditor for the design lane. Requires seeded `fixtures/` personas; drives flows via the manifest browser adapter. Every ticket requires an objective `anchor`. |

## How a run works (the bounded loop)

The core is strictly **two-lane** — `security` and `design`.

1. Compute `staleness = (today - last_reviewed)/interval_days`; force-flag entries whose `area` changed in git since `last_reviewed`.
2. Sort by `max(staleness, change_flag) * weight`; take the top **K** (the manifest's `window_budget_k[<lane>]`).
3. Fan out the lane reviewer subagent per selected entry (parallelize 3–5 at a time **inside K**).
4. Run the **two-stage refuter gate** (security lane — see below).
5. **Dedupe** against open findings by `dedupe_key`; honor active **suppressions**.
6. Append confirmed findings (with `first_seen`/`last_seen`/`run_id`); update `last_reviewed`/`status`; write the per-run metrics record.
7. Apply **severity gates** (critical/high → surface for human Linear filing; medium → only if reproducible/recurring/customer-facing; low → digest; taste → never without an anchor).

### The two-stage refuter gate (security lane)

> **North-star guarantee:** Security never logs an unrefuted finding. **No Tier-1 refute → no log.**

- **Tier-1 (`security-refuter`, always):** runs on **every** candidate. An unrefuted candidate is never logged.
- **Tier-2 (`security-refuter-2`, conditional):** runs **only** when a Tier-1 survivor is critical/high severity **OR** `confidence == low` (union predicate). A cheap first pass kills most candidates; the expensive pass is spent only where it earns its cost.

### Three budget dials

Budget is controlled by three independent levers — tune them together:

1. **K** = `window_budget_k[<lane>]` — a hard per-window ceiling. **Never raised to clear backlog**; overdue surplus routes to the digest/trend. Get throughput from parallelism *inside* K, not from raising K.
2. **`maxTurns`** per agent + an in-prompt tool-call budget line.
3. **Model tier per role** (agent frontmatter `model:`), globally overridable via the **`CLAUDE_CODE_SUBAGENT_MODEL`** env var — highest precedence, overrides every agent's frontmatter to drop the whole fleet a tier.

## Pack format

`manifest.yml` carries an integer **`pack_format`** (starts at `1`), versioned independently of
the plugin's semver. It gates future migrations: the engine reads it to know which pack schema it
is looking at and either auto-applies a migration or fails loudly — which is what makes "onboard
many repos, upgrade the engine centrally" safe.

## Onboarding a codebase

`/nightshift:onboard` runs an interactive **DETECT → BATCH-CONFIRM → SEED → REVIEW → GATE → WRITE**
interview in the top-level skill:

1. **Detect** the stack (package manifests + script fields, CI workflows, Dockerfile/compose, monorepo markers, an existing `.nightshift/`) and render a "here's what I detected" summary.
2. **Batch-confirm** only the deltas, then **seed** a draft `vectors.yml` by cloning `taxonomy/owasp-asvs.yml` and remapping `area` globs from the detected tree (the area→path map is built **in-memory** at onboard — there is no `REPO_MAP.yml`).
3. **Review** the proposed vectors, **gate** on a clean pack (no surviving sentinels / required-empty keys), then **write** the pack.

The security lane is "done" not when the run works, but when `vectors.yml` is reviewed,
complete-enough (weights + code mappings + owners), with a low false-positive rate. The **design**
lane is reachable but default-off: if selected during onboarding, the interview adds a branch to
seed `fixtures/personas.yml` and capture the staging `stack_adapter.browser.base_url`; otherwise
it is auto-deferred with one explanatory line.

**To absorb stack drift later** (new CI tool, renamed test command, added sibling repo), re-run `/nightshift:onboard` — it detects the existing `.nightshift/` and enters **reconcile mode**, confirming only the deltas and never clobbering hand-tuned globs or `(auto)` fields. Don't hand-edit `manifest.yml` for structural changes; use onboard so the gate runs again.

See [`examples/novudesk/`](examples/novudesk/) for a worked seed that proves the engine adapts.

## Deterministic engine (v2.1)

Every *checkable* behavior — selection, dedupe, the metrics writer, the daily rollup,
schema validation, the read-only guard — is owned by a small TypeScript core under
[`src/`](src/), authored in TS and shipped as **bundled, node-runnable `bin/*.mjs`**
that an onboarded repo runs with **zero install**. The model only reviews code and
refutes findings; it never executes deterministic logic (D1). The seams between the
deterministic core, the Workflow orchestrator, and the judgment agents are pinned in
[`CONTRACTS.md`](CONTRACTS.md).

```
bin/select    read registry + git diff → top-K stalest/changed → surfaces.json
bin/validate  schema-gate any artifact (aborts the run on failure)
bin/dedupe    candidates → new | recurring | suppressed (decisions.json)
bin/record    append per-run record + finding lines; update registry state (atomic)
bin/rollup    recompute + append the daily rollup (freshness / median / FPR)
hooks/guard   PreToolUse read-only guard — blocks source + git mutation, allows .nightshift/
```

The orchestrator is [`nightshift.workflow.js`](nightshift.workflow.js) — a thin
Workflow shell with **zero decision logic** (E4): it only sequences free Bash plumbing
(`bin/*.mjs`) and subscription judgment agents, passing artifacts by **file, never by
text** (E2/E3).

**Develop:**

```bash
cd plugins/nightshift
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest — full-branch coverage of the core
npm run build       # bundle src/{bin,hooks}/*.ts → committed bin/*.mjs, hooks/*.mjs
npm run check       # all three
```

CI (`nightshift-ci.yml`) runs the above and fails if the committed `bin/`/`hooks/`
artifacts are out of sync with `src/`. All writes are atomic (temp + fsync + rename, or
a whole-line jsonl append) and the record step is chained so a `bin/validate` failure
aborts before any durable state is touched (E6).

## Schemas

Canonical shapes live in [`schemas/`](schemas/): `registry-entry.yml` (the shared spine),
`finding.yml` (lean finding + suppression, with `first_seen`/`last_seen`/`resolved_at`/`run_id`
lifecycle fields), `candidate-finding.yml` (the model-written artifact gated by `bin/validate`
before it enters the stateful path), `manifest.yml` (the portability layer + `pack_format`), and
the metrics shapes (per-run + daily rollup). Engine-managed fields are tagged `(auto)`; everything
else is human-seeded. The machine validators (`src/lib/validate.ts`) mirror these and are what
`bin/validate` enforces.

## Contributor rule

Example packs must be **fully fictional**. Never use a real project as a scratch example. All
example/template URLs must use a reserved TLD (`.example` / `.test` / `.invalid` / `.localhost`).
The canonical public example is **NovuDesk**.

Run `scripts/check-example-hygiene.sh` locally before opening a PR — it validates reserved-TLD
usage, no-sentinel fields, and YAML render-smoke for all example/template packs. The same check
runs in CI via `nightshift-ci.yml`.
