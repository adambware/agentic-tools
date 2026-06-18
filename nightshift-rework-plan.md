# Nightshift — Rework Plan (`assurance-engine` → `nightshift`)

**For:** Fair Bear Labs · **Status:** Plan only, no code this session · **Date:** 2026-06-18
**Source:** ultracode session — 6 best-practices research agents → 7 grounded critique dimensions → Opus synthesis → adversarial critic → **live verification of Claude Code mechanics** (claude-code-guide). All four critic must-fixes and the version-sensitive mechanics doubts are resolved below.

---

## 0. Verified Claude Code mechanics (load-bearing — confirmed this session)

These were assertions in the draft; they are now **confirmed** against current Claude Code docs/behavior, so the plan can rely on them:

| Mechanic | Verified result | Consequence |
|---|---|---|
| Plugin skill command name | `/<plugin>:<folder>` — **colon, folder-name**. `/nightshift-qa` is **impossible**. | Commands are `/nightshift:qa`, `/nightshift:design`, … Folder name controls the command; ignore the `name:`-prefix bug folklore (it only matters for a plugin-root `SKILL.md`). |
| `disable-model-invocation: true` | Blocks **Claude** auto-invocation + removes description from context. Does **not** block subagent dispatch or file loads. Skill can't be *preloaded into subagents* (irrelevant — we dispatch agents by file path). | Safe to gate `qa`/`design`/`onboard`/`garden`. |
| `AskUserQuestion` | **Unavailable to subagents**; available in the **main-agent** skill context. Limits (from the live tool): 1–4 questions, 2–4 options each, ≤12-char headers, multiSelect, "Recommended" first. | The onboard interview must run in the **top-level skill**, never delegated to a subagent. Card design in §6 is valid. |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Real env var, **highest precedence** — overrides per-agent `model:` frontmatter. | Legit "drop every subagent a tier" budget lever. |
| `plugin.json` `dependencies` | Exists; enforced at **install/enable** (fails if missing). Not a runtime schema-sharing mechanism. | `nightshift-pm` may declare a dep on core `nightshift`, but must still **ship its own schema/dedupe pieces** — don't rely on cross-plugin runtime reuse. |
| `claude plugin validate --strict` | Exists; promotes warnings → errors. | Valid CI gate **iff** the runner has the `claude` CLI (see §7 fallback). |

---

## 1. TL;DR

Rename `assurance-engine` → **`nightshift`** and ship a leaner, budget-aware, trend-tracking, two-lane core. Headline decisions:

1. **Commands are colon-namespaced — `/nightshift:qa`, not `/nightshift-qa`.** Rename skill folders to bare verbs (`qa`, `design`, `onboard`, `digest`, `garden`). Document the colon loudly so the mental model matches reality.
2. **`qa` = the security lane** (security-reviewer + mandatory refuter), surfaced under a friendlier verb. All *internal* identifiers stay `security`. `design` = the designer lane.
3. **Drop the PM lane entirely** (decided this session). Zero delivered value today, and it pollutes core schemas/grants — remove `pm-reviewer` and all PM schema/prose from core. Core becomes strictly two-lane. The signal-discipline design (OBSERVED/ESTIMATED/STRATEGIC) is worth preserving as a doc note for a possible future revival, not as shipped code.
4. **Budget-aware fan-out via a two-stage refuter gate** + per-agent `maxTurns`/model tiers + the selection score reused as a compute-allocation key. The low-false-positive guarantee — **"no Tier-1 refute → no log"** — is preserved verbatim.
5. **Durable day-over-day tracking** = append-only `metrics/runs/<YYYY-MM>.jsonl` **and an append-only `metrics/daily.jsonl`** (reader takes the last line per `date+lane`); git history is the time-series; `merge=union` keeps it conflict-free. `dashboard.md` demoted to a disposable projection.
6. **Onboarding becomes a DETECT → BATCH-CONFIRM → SEED → REVIEW → GATE interview** using AskUserQuestion in the top-level skill — auto-detect first, ask only the deltas.
7. **Drop the leak-guard grep entirely.** Replace with a *positive* CI gate (`plugin validate --strict` + example schema/structure check + reserved-TLD/no-sentinel hygiene lint). Fully-fictional examples make the denylist obsolete by construction.

**PR-1 (the breaking `2.0.0` cut) = rename + CI swap only.** Everything else is **additive / non-breaking** and lands in follow-ups. The one other breaking change (the `designer`→`design` schema-key rename) is **deliberately deferred to PR-4**, where migration machinery lives — it does **not** ride in PR-1.

---

## 2. Naming & command taxonomy

### Final command set

| Command | Lane / role | Notes |
|---|---|---|
| `/nightshift:qa` | security lane (reviewer + mandatory refuter) | Description **first line**: "Security/assurance review run" — kills the "qa = unit tests" reading. |
| `/nightshift:design` | designer lane (ux-reviewer) | Description **first line**: "Prerequisite-gated — refuses until the pack has a staging browser adapter + seeded personas." Real command, fails fast and explains why (see §6 coherence fix). |
| `/nightshift:onboard` | lifecycle | Interactive interview; mutating + expensive; `disable-model-invocation`. |
| `/nightshift:digest` | lifecycle | Read-only weekly signal; the **one** skill left model-invocable. |
| `/nightshift:garden` | lifecycle | Registry gardening (proposes; humans approve); `disable-model-invocation`. |

*(No PM commands — the PM lane is dropped from core, §3.)*

### Rename map (old → new)

| Old | New |
|---|---|
| `plugins/assurance-engine/` | `plugins/nightshift/` |
| plugin.json `name: assurance-engine` | `name: nightshift`, `version: 2.0.0`; add `homepage`/`repository`/`license`/`keywords` |
| marketplace entry `assurance-engine` | `nightshift` — name, `source: ./plugins/nightshift`, refreshed description, **no `version`** (plugin.json is source of truth) |
| `skills/assurance-run/` | `skills/qa/` |
| (new sibling, thin-wraps shared run-loop) | `skills/design/` |
| `skills/assurance-onboard/` | `skills/onboard/` |
| `skills/assurance-digest/` | `skills/digest/` |
| `skills/assurance-garden/` | `skills/garden/` |
| `skills/assurance-run/reference/run-loop.md` | `skills/qa/reference/run-loop.md` (shared by `qa` + `design`) |
| README install `assurance-engine@agentic-tools` | `nightshift@agentic-tools` |
| `.github/workflows/assurance-engine-no-leak.yml` | **deleted** → `nightshift-ci.yml` (§7) |

### What does NOT rename (stability surface)

The `.nightshift/` pack dir; `owner: security`; agent file names (`security-reviewer`, `security-refuter`, `ux-reviewer`); all schema field names (`dedupe_key`, `last_reviewed`, `window_budget_k`, `anchor`, `interval_days`, …); `kind: vector|flow` values. **PR-1 only touches the command-facing surface.** Agent description *prose* re-keys "the assurance-run security lane" → "the nightshift qa (security) lane."

### The `designer` → `design` token (deferred to PR-4, NOT PR-1)

Three spellings exist: lane key `designer` (manifest `cadences`/`window_budget_k`), owner `design` (registry data), command `design`. Standardize on **`design` end-to-end**, but this is a **breaking manifest-key migration** (`cadences.designer`→`cadences.design`, `window_budget_k.designer`→`.design`). **Do not bundle it into the atomic PR-1 rename** — a migration bug there would block the whole rename. It lands in **PR-4**, gated by `pack_format`, alongside the rest of the migration machinery. Until then the engine reads `designer` (back-compat) and PR-4's migration rewrites it.

---

## 3. PM lane removal

**Decision: DROP the PM lane entirely from the system.** No `nightshift-pm` plugin. The PM lane has zero delivered value today (it's `off` everywhere and refuses to run without `evidence_sources`), and keeping it — even extracted — is maintenance and schema surface for a capability nobody is using. Extraction was the safer default; **removal is the chosen call.** Preserve the genuinely-good ideas (OBSERVED/ESTIMATED/STRATEGIC signal discipline; "briefs only, humans keep roadmap authority"; the unmet `WebFetch`-scoping-hook requirement) as a short **`docs/future-pm-lane.md`** design note so a future revival starts from the thinking, not from scratch.

### What to delete

- `agents/pm-reviewer.md`
- `registries/problems.yml` (template + `examples/novudesk/`) and the PM `dashboard.md` block
- Manifest keys: `evidence_sources`, `linear.labels.pm`, `cadences.pm`, `window_budget_k.pm`
- All PM/`problem`/`evidence_sources` prose threaded through core skills and schemas (see below)

### Schema & prose cleanup (core becomes cleanly two-lane)

- **`manifest.yml`** — remove `evidence_sources`, `cadences.pm`, `linear.labels.pm`, `window_budget_k.pm`. `cadences` and `window_budget_k` carry only `security` + `design`.
- **`registry-entry.yml`** — drop `kind: problem` and `owner: product` from the documented enums; `kind` ∈ `vector|flow`, `owner` ∈ `security|design` (keep `eng` if it's used). Keep `signal_class` only if a remaining lane uses it; otherwise delete it (it was added for PM).
- **`finding.yml`** — it's already lane-neutral (`symptom`/`dedupe_key`); no PM-specific fields to remove beyond any `signal`/`roadmap_gap` block the PM reviewer emitted — delete those.
- **Skills** — strip every PM line: `qa`/`design` lane inputs, `garden`'s "Signal / `evidence_sources`" bullet, `digest`'s "(security, designer, and pm if active)" → "(security and design)", `onboard`'s "PM last — deferred" phase. Update the README agent table (drop the `pm-reviewer` row) and the phased-rollout narrative (two phases, not three).

This is a net **deletion** PR — smaller core, no new plugin to maintain, and no dangling "deferred" vocabulary implying a lane that will never arrive.

---

## 4. Budget-aware orchestration

**North-star guarantee (unchanged, explicit): security never logs an unrefuted finding. "No Tier-1 refute → no log" stays verbatim.** Everything below cuts cost *without* touching that promise.

### Three named budget dials (document together in README + run-loop.md)

1. **K** = `window_budget_k[<lane>]` — hard per-window ceiling. **Never raised to clear backlog**; overdue surplus routes to the digest/trend.
2. **`maxTurns`** per agent + an in-prompt tool-call budget line.
3. **Model tier per role** (frontmatter), globally overridable via `CLAUDE_CODE_SUBAGENT_MODEL` (verified: overrides frontmatter).

### Model tiers by ROLE

| Agent / skill | Model | `maxTurns` | Effort |
|---|---|---|---|
| `qa`/`design` orchestrator skill | sonnet | — | default |
| `security-reviewer`, `ux-reviewer` | sonnet | 15 | default |
| `security-refuter` (Tier-1, always) | haiku | **8** (add — currently uncapped) | low |
| **`security-refuter-2`** (Tier-2, conditional, new file) | **sonnet/high** (NOT opus by default — see note) | 12 | high |
| `digest` | haiku | — | low |

> **Tier-2 model — corrected from the draft.** Start Tier-2 at **sonnet/high**, not opus. The cross-model critic in the cited research catches only ~3% of total kills; an opus pass on every critical/high survivor over-spends for marginal lift. Promote Tier-2 to opus **only if** `rejected_tier2` proves it earns the cost. Conversely, if `rejected_tier2` trends toward ~0, **retire Tier-2 entirely** — the metric in §5 tells you which.

### Conditional refuter policy (the core budget change)

Convert the uniform mandatory refuter into a **two-stage gate**:

- **Tier-1 (always):** the existing refuter on **every** candidate — independent re-read, context-asymmetric (claim + location only, never the reviewer's narrative). Add `maxTurns: 8`. **"No Tier-1 refute → no log" preserved.**
- **Tier-2 (conditional):** the separate sonnet/high refuter **only** when a Tier-1 survivor is **critical/high severity OR confidence==low** (union predicate — recommended; pin it, it sets the expensive-pass spend rate).

Research basis: a cheap first pass kills ~63–79% of candidates; spending the expensive pass on all of them wastes budget on candidates the cheap pass already eliminated.

### Score reused as compute-allocation key

The existing `score = max(staleness, change_flag) * weight_multiplier` (selection-only today) becomes a **fan-out budget table** in `run-loop.md`:

| Band | Reviewers | Reads | Refuter |
|---|---|---|---|
| low/medium | 1 | ~5–8 | Tier-1 only |
| high | 1 | ~8–10 | Tier-1 |
| critical (or change_flag on critical/high) | 1 | ~10–12 | Tier-1 + conditional Tier-2 |

### Concrete token/throughput guidance

- **Parallelize reviewers 3–5 at a time inside K** (parallel Agent dispatch). Get speed from parallelism *inside* K, not from raising K.
- **De-hardcode BOTH reviewer grants (PR-3).** Drop `Bash(bin/rails test:*)` from `security-reviewer.md:4` **and `mcp__playwright__*` from `ux-reviewer.md:4`** — both are stack-baked-in config that locks the lane to one stack regardless of the pack's manifest. Grant only `Read, Grep, Glob`; the orchestrator injects `manifest.stack_adapter.test` (security) / `manifest.stack_adapter.browser` (design) as the scoped grant at dispatch.
- **Prompt caching (softened claim):** the shared reviewer/refuter preamble + OWASP-ASVS taxonomy is identical across fan-out calls, so it's a *caching candidate* — but cross-subagent cache sharing is **not guaranteed** (each subagent is a separate context). Treat as "may help; measure," not a guaranteed budget feature.
- **Verdict caching — DEFERRED (not PR-3).** It overlaps heavily with the `change_flag==0` selection skip the engine already has (an unchanged area usually isn't selected at all), and it adds cache-invalidation + a privacy surface. Revisit only if profiling shows selected-but-unchanged critical areas are a real cost.

---

## 5. Durable day-over-day coverage tracking

**Problem today:** `run-metrics.yml` is a schema with **no file, no writer, no timestamp**; the dashboard's FPR line is hand-authored prose; the registry stores only the *latest* `last_reviewed`. The trend the user wants **does not exist anywhere.**

### Storage scheme (all committed text under `<repo>/.nightshift/metrics/` — never under `CLAUDE_PLUGIN_ROOT`)

| File | Mutability | Role |
|---|---|---|
| `metrics/runs/<YYYY-MM>.jsonl` | **append-only** | one NDJSON object per run; monthly partition |
| `metrics/daily.jsonl` | **append-only** (one fresh rollup line per recompute; **reader takes the LAST line per `date+lane`**) | the day-over-day trend |
| `metrics/findings/<YYYY-MM>.jsonl` | append-only (migrate `findings/log.jsonl` here) | date-partitioned findings log |
| `dashboard.md` | regenerated, disposable | current-state projection only |
| `trends.md` | regenerated, disposable | CHANGELOG-style delta lines |
| `.nightshift/.gitattributes` | static (onboard writes it) | `metrics/**/*.jsonl merge=union` |

> **Merge-safety fix (critic must-fix #1).** The draft made `daily.jsonl` "regenerate-in-place" under `merge=union` — which is **not** conflict-free (union keeps both branches' rewritten lines → duplicate `date+lane` rollups). Corrected: `daily.jsonl` is **append-only**, and the reader **takes the last line per `(date, lane)`**. Now union-merge is correct by construction — concurrent branches just append, the reader dedupes on read. (Alternative if you dislike the dedupe-on-read: derive `daily.jsonl` entirely on read from `runs/*.jsonl` and never commit it. Recommended primary: append-only + last-wins.) The durable truth is `runs/*.jsonl` + `daily.jsonl` + git history of the registries; all Markdown is throwaway.

### Schema changes

**Extend `run-metrics.yml`** into the per-run NDJSON record — add `run_id`, `ts` (ISO-8601), `date`, `lane`, `pack_sha`, `usage_by_model`, `refuter_invoked` (bool), `suppressed` (count). **Split** `rejected_by_2nd_reviewer` → `rejected_tier1` + `rejected_tier2` (so FPR is splittable by stage, and the §4 "retire Tier-2 if it trends to ~0" decision is measurable).

**New `schemas/daily-metrics.yml`:** `{date, lane, runs, surfaces_total, surfaces_green, surfaces_stale, surfaces_overdue, open_findings, coverage_freshness_pct, median_staleness_ratio, fpr_7d, fpr_30d}`. `coverage_freshness_pct` (share of in-scope surfaces with staleness ratio ≤ 1.0) and the two FPR windows are the headline trend lines. **Denominator scopes to lanes whose cadence != off**, so deferred lanes don't make freshness look artificially terrible. Recomputed for the affected day at the end of each run.

**Add to `finding.yml`:** `first_seen`, `last_seen` (bumped when a `dedupe_key` recurs), `resolved_at` (optional), `run_id`. Makes finding age, time-to-resolve, and "motionless open finding" computable — none of which is possible today.

### Deltas + digest read path

- Deltas = today's `daily.jsonl` rollup minus the previous committed rollup line. Render as CHANGELOG lines: `2026-06-18 · security · freshness 83%→79% (-4) · 2 overdue · FPR_7d 24%`.
- **Rewrite `digest` to fold over `metrics/daily.jsonl`** (not the non-existent `run_metrics` blob): tail the rollup for 7/30-day FPR + freshness, use `first_seen`/`last_seen` for motionless findings, read registry status for current overdue. **This rewrite lands in PR-4** (with the writer), not earlier — see §10 sequencing note.

### Optional (NOT PR-4 core)

`metrics/badge.json` (shields endpoint) and `trends.md` sparklines are nice-to-haves the user didn't ask for. The directive ("a trend you can read over weeks") is satisfied by `daily.jsonl` + CHANGELOG delta lines. Flag badge/sparklines as optional polish.

---

## 6. Onboarding interview redesign

**Today:** a prose playbook with the right *soul* (phased, reviewed-beats-complete, weak-lane deferral) but wrong *body* — zero auto-detection, no AskUserQuestion, no completion gate, and it references a `REPO_MAP.yml` it never creates.

### Flow: DETECT → BATCH-CONFIRM → SEED → REVIEW → GATE → WRITE (runs in the top-level skill)

0. **Detection preamble (mandatory):** inject globs for `package.json`/`Gemfile`/`go.mod`/`pyproject`/`Cargo.toml` + their script fields, `.github/workflows/*.yml`, Dockerfile/compose, monorepo markers, and an existing `.nightshift/`. Render a "Here's what I detected" summary; ask only deltas.
1. **Batched cards** (≤4, Recommended-first, **provenance in every option description**).
2. **Seed a draft** `vectors.yml` (clone `owasp-asvs.yml`, remap area globs from the detected tree).
3. **One multiSelect approval card:** "which proposed vectors look real?"
4. **Deterministic gate:** grep the rendered pack for surviving sentinels (`my-project`, `my-stack`, `https://staging.my-project.example`, `PROJ`, unconfirmed `make test`/`make build`) + REQUIRED-empty keys; any survivor → a precise batched question. Onboarding isn't "done" until clean.
5. **Final "Write pack" confirm card.**

### Question set (security-only v1)

| Card | Questions (Recommended-first, ≤12-char headers) |
|---|---|
| **1 · Lanes** | multiSelect: Security [Recommended, pre-checked] · Design [desc: "needs staging + seeded personas — see design branch"]  *(no PM — dropped from core)* |
| **2 · Repos & cmds** | per detected repo: Test cmd [Recommended = detected + provenance] · Build cmd [+provenance] · Stack [+provenance] |
| **3 · Filing & budget** | Linear project key — **genuine question, can't detect** (with "Skip / no Linear") · `window_budget_k.security` default 6 [Recommended] |
| **Fast path** | Card 1's lead Recommended option = **"Accept all detected defaults and seed the pack"** — a confident standard repo finishes in ONE interaction |
| **Final** | "Write pack" [Recommended] · escape "Edit a field"/"Other" |

### Design-lane coherence (critic must-fix #3 + gap #1)

`/nightshift:design` is a **real** command, not shipped permanently inert. Resolution:
- Its **description's first line** declares it's prerequisite-gated and it **fails fast with a clear reason** if the pack lacks a staging browser adapter + seeded personas (no silent half-run).
- Onboarding gives it a **real path to working**: if the user selects **Design** at Card 1, the interview adds a branch — confirm/seed `fixtures/personas.example.yml` → `personas.yml`, capture `stack_adapter.browser.base_url` (staging) — so the lane can actually run. If they don't select Design, onboarding auto-defers it with **one explanatory line, not a question**.
- This removes the §2-vs-§6 inconsistency: v1 default is security-only, **and** there's a concrete way to light up design when the user wants it.

### Discipline rules

- **Auto-defer without asking:** set deferred values for unselected lanes; surface ONE line, never a question.
- **Provenance makes auto-detect safe:** option label = value, description = where it came from.
- **Reconcile mode + `.pack-meta.yml`:** write `{answers, engine_version, template_ref, pack_format}`. On re-run with an existing `.nightshift/`, **diff detected-vs-recorded, ask only about drift**, never clobber `(auto)` fields or hand-tuned weights. This is what makes onboarding *many* repos non-destructive.
- **Add `AskUserQuestion` to `allowed-tools`** (verified main-agent-only — keep the interview in the top-level skill, never a subagent). Keep `disable-model-invocation: true`.
- **Resolve the `REPO_MAP.yml` dangling reference:** drop it; build the area→path map in-memory from the detected tree.
- **Pre-PR-5 check (small, non-blocking):** confirm AskUserQuestion's current limits in the onboard runtime match the card design (1–4 Q / 2–4 options / ≤12-char headers). Provide a plain numbered-prompt fallback so the flow degrades gracefully if a constraint differs.

---

## 7. Leak guard & example strategy

**Decision: DROP the grep entirely. Do not port it.** Rationale:

- The example is **fictional by construction** (RFC 6761 `.example` TLDs, invented `nova-worker`/`NOVU`) — there's no working-tree residue to police.
- The grep is **mis-scoped**: it skips `assurance-engine-review-plan.md` at the repo root and all git history — exactly where real residue lives.
- It's an **unmaintainable denylist** (`bear-` even false-positives on the word "bear"). Fiction-by-construction is the principled fix the denylist only approximates.

### Replace with `nightshift-ci.yml` (path-filtered on `plugins/nightshift/**`, `plugins/nightshift-pm/**`)

1. **Install + run `claude plugin validate ./plugins/nightshift --strict`** (+ `nightshift-pm`). **CI must install the `claude` CLI** (add the install step); **degraded fallback** if unavailable → steps 2–3 only, which are still strictly better than the denylist. (Open decision #7.)
2. **Example structure/schema check.** ⚠️ The `schemas/*.yml` are **prose-commented YAML, not machine schemas** — nothing validates them today. Either (a) author real JSON Schema (or a small validation script) as scoped work, or (b) downgrade this step to a structural lint (required keys present, YAML/JSONL parses). Don't pretend a validator exists. (Critic gap #5 — call this out as real, currently-unscoped work; default to (b) unless you want the schema authoring.)
3. **Example-hygiene lint** (`scripts/check-example-hygiene.sh`) — *positive* rules: every URL under `examples/`/`templates/` ends in a reserved TLD (`.example|.test|.invalid|.localhost`); no sentinel (`my-project`, `# REQUIRED`) survives in `examples/`; optional render-smoke-test of `templates/.nightshift/` from a checked-in `fixtures/onboard-answers.example.yml`.

**Land the workflow swap in the SAME commit as the dir rename** — renaming the dir makes the old `plugins/assurance-engine/**` path filter stop matching, which would silently report a false "passed."

### One-time cleanup (not CI)

Delete/scrub `assurance-engine-review-plan.md` at the repo root (largest residue site, untracked working artifact). **Make an explicit git-history decision** (open decision #5): the strings are a fictional-sounding codename with no secrets — accept history if the marketplace stays private/internal; run `git filter-repo` before any *public* listing. State the choice; don't leave it an oversight.

### Contributor rule (move the guarantee upstream)

Add to README/CONTRIBUTING: *"Example packs must be fully fictional. Never use a real project as a scratch example. All example/template URLs must use a reserved TLD. The canonical public example is NovuDesk."*

---

## 8. Skills & progressive disclosure

The skills are already short, well-described, and sensibly model-tiered — `assurance-run` is a textbook progressive-disclosure example. Fixes are surgical:

- **Frontmatter discipline (cheapest, highest leverage):** add `disable-model-invocation: true` to `qa`, `design`, and `garden` (expensive/mutating). Keep `digest` model-invocable + read-only (`Read, Glob, Grep`) so Claude can proactively offer the weekly signal. Net: ~3 lines.
- **`qa` vs `design`:** split the single lane-parameterized run skill into two folders, both thin-wrapping the shared `skills/qa/reference/run-loop.md`. This is what produces two lane-named commands.
- **Extract onboard mechanics** to `skills/onboard/reference/onboard-mechanics.md` (manifest-field table, template tree, taxonomy clone/remap — currently inline ~70 lines). Trim body to milestone + phased-rollout guardrail + step skeleton + "read at step N, don't preload." ~120 → ~60 lines.
- **Re-key all descriptions' trigger phrases** from `assurance-*` to the colon-commands; update sibling cross-references.
- **Consistency fixes:** `digest` says "assemble all five" but lists four sections — settle on four, align header+body+description. Verify 1:1 step mapping between `qa` SKILL.md and `run-loop.md`.
- **Dynamic injection:** add a top-of-file `git diff --name-only` backtick-bang line to `qa`/`design` so changed-area data arrives pre-rendered.
- **Dispatch reviewer/refuter by file path** (`${CLAUDE_PLUGIN_ROOT}/agents/*.md`) so `disable-model-invocation` on the run skill never blocks them (verified: it doesn't block subagent dispatch anyway).
- When PM extracts, **strip all PM-deferred narration** from core skill bodies; drive lane availability from manifest/pack-format flags, not prose.

---

## 9. Everything-else critique

- **`pack_format` integer in `manifest.yml`** — versioned independently of engine semver. **Ships in PR-1** so every later schema change (designer→design, metrics fields, finding lifecycle fields) is a clean versioned migration the engine auto-applies or fails loudly on. This is the single mechanism that makes "onboard many repos, upgrade centrally" safe.
- **Stack-adapter presets** (`adapters/rails.yml`, `adapters/go.yml`, …) carrying default test/build commands + least-privilege allowlists; the pack *extends* a preset and overrides only deltas (Renovate/ESLint model). Collapses most onboarding questions to one confirmation. (Follow-up, not PR-1.)
- **`CLAUDE_CODE_SUBAGENT_MODEL`** documented as the single env lever to drop all subagents a tier — named alongside K and maxTurns as the three budget dials.
- **plugin.json metadata** now that it's public-facing: `homepage`, `repository`, `license`, `keywords`.

---

## 10. Sequenced rollout

Each PR independently landable. **Only PR-1 (rename) and PR-4's token-rename are breaking; everything else is additive.** Don't frame the whole sequence as one breaking event — PR-1 is `2.0.0`, later PRs are minor bumps.

| PR | Scope | Why this order |
|---|---|---|
| **PR-1 · Rename + CI swap** *(breaking, 2.0.0)* | Dir → `plugins/nightshift/`; plugin.json name/version/metadata; marketplace entry; README; skill folders → `qa`/`onboard`/`digest`/`garden` + split `design`; agent-description prose re-key; **add `pack_format`**; **delete leak grep + add `nightshift-ci.yml` in the same commit**; one-time root review-doc cleanup. **Excludes the `designer`→`design` schema-key rename.** | Everything references the new names/paths; must land first and atomically (CI path-filter safety). Pure rename = reversible, no data migration. |
| **PR-2 · PM removal** *(net deletion)* | Delete `pm-reviewer.md`, `problems.yml`, PM manifest keys, PM dashboard block, and all PM/`evidence_sources` prose from core skills/schemas/README; tighten `kind`/`owner` enums; add `docs/future-pm-lane.md` design note. | Shrinks core surface before metrics/orchestration touch schemas. |
| **PR-3 · Budget-aware orchestration** *(additive)* | Two-stage refuter gate (+ new `security-refuter-2.md`, **sonnet/high**); `maxTurns: 8` on Tier-1; fan-out budget table in `run-loop.md`; parallelism note; **de-hardcode BOTH reviewer grants** (Rails test + playwright). | Pure logic/frontmatter; depends only on renamed agent files. |
| **PR-4 · Durable metrics + token rename** *(token rename breaking; gated by `pack_format`)* | Extend `run-metrics.yml` (+ split FPR stages); new `daily-metrics.yml` (append-only, last-wins); finding lifecycle fields; `metrics/` layout + `.gitattributes`; **migrate `findings/log.jsonl`** → `metrics/findings/<YYYY-MM>.jsonl` (**backfill `first_seen` via `git log` on the file; `run_id: "migrated"`; `last_seen = first_seen`**); demote `dashboard.md`, add `trends.md`; **rewrite `digest` read path here**; **`designer`→`design` key rename + migration**. `pack_format` bump. | Builds on PR-3's split kill-counters; co-locates the only other breaking change with the migration machinery; keeps `digest` from pointing at a non-existent source between PRs. |
| **PR-5 · Onboarding interview** *(additive)* | DETECT→CONFIRM→SEED→GATE flow; AskUserQuestion in allowed-tools; `.pack-meta.yml` + reconcile mode; design-lane wiring branch; completion gate; resolve `REPO_MAP.yml`; onboard writes `.gitattributes` from PR-4. | Depends on the PR-4 metrics layout it must scaffold. |
| **PR-6 · Skills trims** *(cosmetic)* | Extract onboard mechanics to reference; `disable-model-invocation` flags; `digest` four/five consistency; dynamic-injection lines. | Safe to land last. |

---

## 11. Decisions — settled this session ✅ + still open

**Settled (2026-06-18):**
- ✅ **`qa` scope:** security-only. `/nightshift:qa` is the security lane permanently; description leads "Security/assurance review run." No correctness/test family.
- ✅ **PM lane:** **dropped entirely** (§3) — no `nightshift-pm` plugin; net-deletion PR-2; preserve the thinking in `docs/future-pm-lane.md`.
- ✅ **Design lane in v1:** ship it **reachable but default-off** — `/nightshift:design` + the onboarding wiring branch exist, but onboarding's default path stays security-only.
- ✅ **Next step:** plan is the deliverable; no implementation this session.

**Still open (decide when implementation starts):**
1. **Tier-2 refuter:** trigger predicate critical/high **OR** low-confidence (union, recommended) vs intersection; start model **sonnet/high** (recommended) vs opus. Sets the expensive-pass spend rate.
2. **`designer`→`design` rename:** PR-4 gated migration (recommended) vs keep `designer` forever and only add the `design` command.
3. **Git-history residue:** accept (codename, no secrets) or `git filter-repo` before publishing. Hinges on whether this marketplace goes public.
4. **CI schema validation depth:** author real JSON Schema/validator (more work, real validation) vs structural lint only (recommended default). Tied to whether CI has the `claude` CLI for `plugin validate`.
