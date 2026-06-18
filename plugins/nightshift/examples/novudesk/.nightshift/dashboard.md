# Coverage Dashboard — novudesk

> ENGINE-GENERATED. Do not hand-edit. Nightshift rewrites this file at the end of each
> run from the registries' `(auto)` fields and the findings log. This is the at-a-glance
> coverage view; the weekly digest is the narrative you act on.
>
> Disposable projection — the durable truth is `metrics/*.jsonl` + git history; this file
> is regenerated from them and can be deleted at any time.

_Last generated: 2026-06-18 · Pack: novudesk · Window budget: security 6 / design 4 · Cadence: security nightly_

## Security coverage (vectors.yml)

| area                                        | id          | owner    | weight   | last_reviewed | status        |
|---------------------------------------------|-------------|----------|----------|---------------|---------------|
| app/controllers/sessions_controller.rb      | ASVS-AUTH-01| security | critical | 2026-06-16    | green         |
| app/controllers/concerns/authentication.rb  | ASVS-SESS-02| security | critical | 2026-06-15    | green         |
| app/controllers/** · app/models/**          | ASVS-INPV-04| security | critical | 2026-06-14    | green         |
| config/credentials.yml.enc · app/services/vault/* | ASVS-SECRET-05| security| critical | 2026-06-16    | green         |
| config/initializers/rack_attack.rb          | ASVS-RATE-07| security | high     | 2026-06-05    | green         |
| app/models/integration_token.rb · vault/*   | ND-SEC-01   | security | critical | 2026-06-16    | green         |
| app/services/dispatch/*                      | ND-SEC-02   | security | critical | 2026-06-10    | open-findings |
| app/services/webhooks/url_fetcher.rb         | ND-SEC-03   | security | high     | 2026-06-08    | green         |
| app/services/triage_gate/*                   | ND-SEC-04   | security | high     | 2026-05-30    | stale         |
| app/controllers/tickets_controller.rb · app/policies/* | ND-SEC-05   | security | critical | 2026-06-11    | open-findings |
| app/controllers/webhooks_controller.rb       | ND-SEC-06   | security | medium   | 2026-05-20    | green         |
| app/services/triage_gate/review_queue.rb     | ND-SEC-07   | security | medium   | 2026-04-22    | **overdue**   |

**Freshness:** 12 vectors · green 8 · stale 1 · overdue 1 · open-findings 2.

- `ND-SEC-07` (Triage Gate output handling, medium) is **OVERDUE** — last reviewed
  2026-04-22, interval 30d, ~57 days stale. Surfaces in the digest's "overdue areas".
- `ND-SEC-04` (Triage Gate prompt injection, high) is **stale** (due, not yet escalated).

## Design coverage (flows.yml)

_Phase 2 — seeded but not active. Awaiting staging + seeded test site. 7 flows registered;
core flows to instrument first: FLOW-01 submit-ticket, FLOW-02 triage-gate-review._

## Open findings

| dedupe surface | severity | confidence | needs_human_verification | linear   |
|----------------|----------|------------|--------------------------|----------|
| ND-SEC-05      | critical | high       | true                     | NOVU-541 |
| ND-SEC-02      | critical | medium     | true                     | NOVU-512 |
| /triage (FLOW-02) | medium | high | false (anchor: friction_delta) | — |

Active suppressions: 1 (ND-SEC-03 redirect re-validation, expires 2026-07-15, NOVU-498).

## Digest-style summary (week of 2026-06-18)

- **New critical/high:** ND-SEC-05 cross-workspace IDOR on ticket-scoped resources (filed NOVU-541);
  ND-SEC-02 command replay exposure (filed NOVU-512). Both `needs_human_verification`.
- **Repeated themes:** the Triage Gate cluster (ND-SEC-04 stale, ND-SEC-07 overdue,
  plus a UX friction finding on the review queue) — the LLM-content surface is the
  thinnest-covered area and is trending; worth a focused pass.
- **Overdue areas:** ND-SEC-07 (Triage Gate output handling), 57 days stale.
- **False-positive rate:** low this week (1 of 4 security candidates refuted by the tiered
  refuter — Tier-1 haiku on every candidate, conditional Tier-2 sonnet/high on critical/high
  or low-confidence survivors; see `metrics/runs/2026-06.jsonl`) — registry is
  reviewed-quality, safe to keep nightly.
- **Top 3 human decisions needed:**
  1. Verify + prioritize ND-SEC-05 (cross-workspace read) — critical, awaiting human verify.
  2. Confirm ND-SEC-02 replay model and decide nonce+expiry remediation scope.
  3. Schedule the overdue Triage Gate review (ND-SEC-07) before it drifts further.
