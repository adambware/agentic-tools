# A6 — The living document: `bin/dashboard`

**Scope:** `src/lib/dashboard-run.ts`, `src/bin/`, `templates/`, `examples/`.
**Depends on:** A2 (lane B). Can run parallel to A4.
**Gate:** four fixture snapshots green (populated / all-clear / cold-start / degenerate);
every token pair clears 4.5:1 in both themes; every status carries a non-colour channel;
the file passes a no-network open.

**Reference prototype** (real HTML, fixture data, 4 artboards, verified in light, dark,
and greyscale):
`~/.gstack/projects/adambware-agentic-tools/designs/nightshift-dashboard-20260823/dashboard-proto.html`
(generator `gen.mjs` in the same directory). `dashboard-run.ts` renders the same
structure; the generator is the reference for geometry and state strings.

## Command + inputs

- **`bin/dashboard --config $OPS/config.yml --out $OPS/dashboard.html`** — deterministic,
  vitest-covered like every other bin; pure render function in `src/lib/dashboard-run.ts`.
- Reads every configured repo's pack: registries (`status` / `last_reviewed` /
  `interval_days`), findings + suppressions, `daily.jsonl` (max-ts per date+lane),
  `costs.jsonl`, latest `$OPS/digests/<repo>.md` if present.

## Self-contained (plan §15.5)

*Self-contained* = **no network fetches** — no CDN, no webfont, no remote image; renders
correctly offline. Inline CSS + inline SVG only. Evidence renders as an `<a href>` to a
relative local path (`evidence/<repo>/<hash>.png`). `dashboard-run.ts` **stats each
referenced file at render time**; when absent it renders *"evidence no longer on disk
(pruned or never copied) — the anchor value above still stands"*. Relative hrefs mean
the dashboard only works from `$OPS/`; copying it elsewhere breaks evidence links
(runbook notes this).

System font stack with tabular numerals (deliberate — a webfont would mean
base64-embedding a face into a file rewritten every run).

## Six sections, in this order (plan §15.1)

0. **Verdict strip — the five-second answer.** A count plus up to 4 named items, each
   anchor-linked to its detail; the remainder rolls into "and N more". **Computed
   deterministically from pack data, never from the digest** (plan §15.2), from exactly
   three sources: open findings with `needs_human_verification` and no `resolved_at`;
   registry entries past `interval_days`; runs whose cost record carries
   `status: "error"`. Zero state: **"✓ Nothing needs you"** plus the freshness line.
1. **Decisions needed** — the digest's narrative queue: the judgment arithmetic cannot
   produce. Every item renders the digest's generation timestamp and run-distance; an
   amber banner appears once the digest is more than 2 runs behind. (This split of
   arithmetic-vs-judgment leaves the digest-cadence question free to go either way.)
2. **Per repo, per lane** — coverage table in **two columns** (plan §15.3): `Coverage`
   carries freshness only (`current | due | overdue | not yet reviewed`), derived from
   `last_reviewed` + `interval_days`; a separate `Open findings` column carries
   severity-tagged chips joined by `dedupe_key.surface`. Per-repo last-run + result
   lives in the repo header row. (The registry enum itself is untouched — source-side
   split is deferred to TODOS as P2.)
3. **Open findings** — severity, age, `needs_human_verification`, evidence link.
4. **Trends** — inline-SVG sparklines per the contract below.
5. **Hygiene strip** — orphaned run dirs, failed runs kept for diagnosis, cost-capture
   gaps, evidence store size. A failed run also appears in the verdict strip: the strip
   is the alarm, the hygiene strip is the ledger.

**Footer:** generated-at, engine version, 7d/30d cost. Cost never competes with the
alarm for the first viewport.

## Sparkline contract (plan §15.4)

The three series have opposite polarity (freshness-up good; FPR-up and cost-up bad), so
every sparkline ships with:

- **The current value as text**, larger than the chart — the number is the fact, the
  line is context.
- **A signed delta coloured by polarity** plus an explicit `higher is better` /
  `lower is better` label.
- **x positioned by real date, not array index** (manual cadence makes `daily.jsonl`
  sparse; index-positioning renders a 12-day hole as a smooth trend).
- **Under 2 points:** value plus "1 of 2 runs — trend starts next run". Never omit
  silently. **Zero points:** "no data" plus why. **Flat series:** centre it —
  `min === max` must not divide by zero.
- Geometry: 96×24, `role="img"`, `<title>` with sample count, window, endpoints.

## State table — 13 states, 4 fixtures (plan §15.6)

Each state names why it is empty and what to do; no blank regions.

| # | State | Renders as |
|---|---|---|
| 1 | zero repos configured | "No repos configured. Add one to `config.yml`." |
| 2 | repo configured, pack missing | "Cannot read this repo. Run `/nightshift:onboard` there, or set `enabled: false`." |
| 3 | repo onboarded, never run | every area `◇ not yet reviewed`; strip says "run `ns run <repo>`" |
| 4 | lane enabled, pack not ready | "`fixtures/personas.yml` missing and `base_url` unset — `ns` will refuse this lane" |
| 5 | lane not enabled for repo | "Lane not enabled for this repo. Turn it on in `config.yml`." |
| 6 | registry seeded but empty | "No areas registered yet. Run `/nightshift:garden` to propose entries." |
| 7 | no open findings anywhere | verdict strip: "✓ Nothing needs you" + freshness line |
| 8 | no digest yet | "The first digest is written after the first run." |
| 9 | digest ≥2 runs behind | amber banner + per-item run-distance |
| 10 | fewer than 2 trend points | value + "1 of 2 runs — trend starts next run" |
| 11 | zero trend points | "no data" + why |
| 12 | evidence referenced, file gone | missing-evidence line, anchor value retained |
| 13 | run failed / cost not captured | verdict strip item + hygiene row + footer "incomplete" |

**`not yet reviewed` is first-class, distinct from `overdue`** (plan §15.9): a freshly
onboarded repo has `last_reviewed: null` everywhere; naive freshness math renders day
one as a wall of red. It gets its own glyph (`◇`), neutral tone, and copy. A null
`last_reviewed` must **never** render as `overdue`.

Snapshot fixtures: **populated** (2 repos, mixed states, 1 failed run — base:
`examples/novudesk/`), **all-clear**, **cold-start**, **degenerate** (states 2, 9, 10,
11, 12, 13 at once).

## Token + accessibility contract, enforced by vitest (plan §15.7)

- **Colour is never the only channel.** Every coverage state carries a glyph
  (`✓ ◐ ▲ ◇`), a text label, a row tint, and a left-border weight. Every severity
  carries a text abbreviation (`CRIT / HIGH / MED / LOW`). Every trend delta carries an
  arrow **and** a visually-hidden "improving"/"worsening". The full page survives
  `grayscale(1)` with every status readable.
- **Contrast ≥ 4.5:1 for all text, both themes** — asserted in vitest from the token
  values (prototype measured 4.87–17.59 light, 5.50–13.71 dark).
- **Three colour-scheme states.** Light palette on bare `:root` (the "no preference"
  majority case must render correctly); dark redefined under
  `@media (prefers-color-scheme: dark)`; `body` gets an explicit background token.
- **Semantics.** `<caption>` + `th scope` on every table; `role="img"` + `<title>` on
  every sparkline; visible `:focus-visible` on links (the only navigation).
- **Viewport.** Wide tables scroll in their own `overflow-x: auto` container; the body
  never scrolls sideways. **No JS** — so default ordering does the work: worst-first
  within a lane, never alphabetical.
- **Motion: none.** **Type:** system stack, tabular numerals, body ≥13px, nothing below
  11px except uppercase micro-labels ≥10.5px at ≥5:1 contrast.

## Also in this session

- Digest convention: `ns digest <repo>` runs `/nightshift:digest` headless and writes
  `$OPS/digests/<repo>.md` (the skill stays read-only over the pack; the write is the
  launcher's). Engine side here: the dashboard consumes the file when present.
- **Retire committed `dashboard.md` in packs** (template + docs). The pack keeps durable
  truth (JSONL + registries); projection lives in the ops home only. Reuse from the
  retired template: its four coverage terms (re-axised per the two-column split), its
  bold-status-in-plain-markdown instinct (formalised as the a11y contract), its per-lane
  tally line.

## Explicitly deferred design decisions (do not add)

Real typeface · inline base64 evidence thumbnails · sorting/filtering/collapsing (JS;
revisit past ~5 repos) · manual light/dark toggle · mobile layout · registry `status`
enum split (TODOS P2) · a `DESIGN.md` (the contract above is the right size).

## Failure modes to cover

| Codepath | Failure | Handling |
|---|---|---|
| `bin/dashboard` | a configured pack is missing | render gap row naming the fix (state 2) |
| `bin/dashboard` | fewer than 2 trend points | value + "1 of 2 runs" (state 10) |
| `bin/dashboard` | fresh repo, `last_reviewed` null everywhere | `not yet reviewed`, never `overdue` (state 3) |
| `bin/dashboard` | evidence file referenced but gone | stat at render; explicit missing state (state 12) |

## Tasks

- [ ] **T16 (P1)** — verdict strip + section order; cost only in the footer
  - Verify: populated snapshot shows the strip first
- [ ] **T17 (P1)** — computed strip, dated digest
  - Verify: strip derives with the digest file absent; a 4-run-old digest renders the staleness banner
- [ ] **T18 (P1)** — split coverage from findings (two columns)
  - Verify: an area both overdue and carrying an open critical renders both facts
- [ ] **T19 (P1)** — sparkline contract
  - Verify: 12-day gap renders as a gap; flat series no divide-by-zero; 1-point series shows its value
- [ ] **T20 (P1)** — 13-state table + 4 fixtures
  - Verify: four snapshots green; null `last_reviewed` never renders `overdue`
- [ ] **T21 (P2)** — token + a11y contract, enforced (`src/lib/dashboard-a11y.test.ts`)
  - Verify: 11 token pairs × 2 themes ≥4.5:1; non-colour channel everywhere; `caption` / `th scope` / `role="img"` + `<title>` asserted
- [ ] **T23 (P2)** — evidence: self-contained definition + missing-file state
  - Verify: no-network open renders fully; deleted evidence renders the missing state, not a dead link

(T22 — regenerate on every `ns` exit path — is launcher-side: session A7.)
