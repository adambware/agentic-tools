# NovuDesk — worked example pack

A concrete, end-to-end **worked example** that proves Nightshift adapts to a real
project. **NovuDesk** is a B2B AI-assisted helpdesk control plane
(rails+hotwire — customer portal, agent workspace, admin console), with a sibling repo
`../nova-worker` (go) for async ticket routing + AI triage, and a "Triage Gate" LLM
that classifies incoming ticket text, driven against a NovuDesk staging URL
(`https://staging.novudesk.example`).

This directory is **illustrative, not a live pack** — there is no real NovuDesk repo
here. It exists so a reader can see what a reviewed, populated `.nightshift/` looks like:
a filled-in manifest, a base+extension security registry, seeded designer flows and
personas, realistic findings, a suppression, and a generated dashboard.

## What it realizes (cross-reference)

See the plugin README (`plugins/nightshift/README.md`) and the rework plan
(`nightshift-rework-plan.md`):

- **"manifest.yml (the portability layer)"** -> `.nightshift/manifest.yml`
- **"NovuDesk seed"** (the ND-SEC-01..07 table + base ASVS) -> `.nightshift/registries/vectors.yml`
- **`flows.yml` seed** (7 flows; submit-a-ticket + Triage-Gate-review as the two core
  flows) -> `.nightshift/registries/flows.yml`
- **Design prerequisite** (seeded personas) -> `.nightshift/fixtures/personas.example.yml`
- **Security write-up fields + finding schema** -> `.nightshift/metrics/findings/2026-06.jsonl`
- **Durable metrics** (per-run + daily rollup trend) -> `.nightshift/metrics/runs/`,
  `.nightshift/metrics/daily.jsonl`
- **"Rollout for NovuDesk"** (Phase 1 security now; design deferred) -> reflected in
  `cadences` and the phase notes throughout.

## Contents

```
.nightshift/
  manifest.yml                  # novudesk: rails+hotwire + ../nova-worker go, staging browser, NOVU Linear
  .gitattributes                # metrics/**/*.jsonl merge=union (conflict-free appends)
  registries/
    vectors.yml                 # base ASVS (remapped) + 7 NovuDesk ND-SEC-* extensions
    flows.yml                   # 7 design flows (Phase 2); FLOW-01 submit-ticket + FLOW-02 triage-review core
  fixtures/
    personas.example.yml        # end-user, support-agent, workspace-admin
  findings/
    suppressions.yml            # one time-boxed ND-SEC-03 suppression
  metrics/
    runs/2026-06.jsonl          # append-only per-run records (security lane over June)
    daily.jsonl                 # append-only daily rollups (last-wins per date+lane) — the trend
    findings/2026-06.jsonl      # ND-SEC-05 IDOR, ND-SEC-02 replay, Triage Gate UX friction
  dashboard.md                  # disposable generated coverage view + digest summary (overdue example)
```

## What each file proves (design properties)

| File | Design property it proves |
| ---- | ------------------------------------------------------------- |
| `registries/vectors.yml` (ND-SEC-05) | **Multi-tenant IDOR** — one workspace must not reach another's ticket-scoped resources or customer PII. |
| `registries/vectors.yml` (ND-SEC-04, ND-SEC-07) | **LLM prompt-injection / output handling** — untrusted ticket text flows into the Triage Gate prompt, and model output is rendered to agents. |
| `registries/vectors.yml` (ND-SEC-02) | **Control-plane -> nova-worker replay** — signed dispatch commands need nonce/replay protection on the worker channel. |
| `fixtures/personas.example.yml` | **Multi-role personas** — end-user, support-agent, and workspace-admin exercise distinct permission and feature-flag surfaces. |
| `registries/flows.yml` | **Identifiable UX flows** — 7 named, persona-bound flows with FLOW-01 (submit a ticket) and FLOW-02 (Triage Gate review) marked core. |
| `metrics/findings/2026-06.jsonl` + `findings/suppressions.yml` | **Reviewed findings + accepted risk** — ND-SEC-05 IDOR, ND-SEC-02 replay, Triage Gate UX friction (each with `first_seen`/`last_seen`/`run_id` lifecycle fields), and a time-boxed ND-SEC-03 SSRF suppression. |
| `metrics/runs/2026-06.jsonl` + `metrics/daily.jsonl` | **Durable day-over-day tracking** — append-only per-run records (split `rejected_tier1`/`rejected_tier2`) and daily coverage-freshness rollups that make the trend readable over weeks. |

The security content is deliberately **defensive**: findings are framed as failing
authorization/security invariants with explicit preconditions and human-verification
flags — no exploit payloads or offensive tooling. Optimized for coverage freshness,
confidence, and dedupe quality, not number of findings.
