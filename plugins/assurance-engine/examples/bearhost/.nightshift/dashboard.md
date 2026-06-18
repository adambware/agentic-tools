# Coverage Dashboard — bearhost

> ENGINE-GENERATED. Do not hand-edit. The Assurance Engine rewrites this file at the end
> of each run from the registries' `(auto)` fields and the findings log. This is the
> at-a-glance coverage view; the weekly digest is the narrative you act on.

_Last generated: 2026-06-18 · Pack: bearhost · Window budget: security 6 / designer 4 · Cadence: security nightly_

## Security coverage (vectors.yml)

| area                                        | id          | owner    | weight   | last_reviewed | status        |
|---------------------------------------------|-------------|----------|----------|---------------|---------------|
| app/Http/Controllers/Auth/*                 | ASVS-AUTH-01| security | critical | 2026-06-16    | green         |
| app/Http/Middleware/*                        | ASVS-SESS-02| security | critical | 2026-06-15    | green         |
| app/Http/Controllers/**                      | ASVS-INPV-04| security | critical | 2026-06-14    | green         |
| config/** · app/Services/Vault/*             | ASVS-SECRET-05| security| critical | 2026-06-16    | green         |
| app/Http/Middleware/ThrottleRequests*        | ASVS-RATE-07| security | high     | 2026-06-05    | green         |
| app/Models/SiteCredential.php · Vault/*      | BH-SEC-01   | security | critical | 2026-06-16    | green         |
| app/Services/CommandChannel/*                | BH-SEC-02   | security | critical | 2026-06-10    | open-findings |
| app/Services/Monitor/UrlFetcher.php          | BH-SEC-03   | security | high     | 2026-06-08    | green         |
| app/Services/ContentGate/*                   | BH-SEC-04   | security | high     | 2026-05-30    | stale         |
| app/Http/Controllers/Site* · app/Policies/*  | BH-SEC-05   | security | critical | 2026-06-11    | open-findings |
| app/Http/Controllers/WebhookController.php   | BH-SEC-06   | security | medium   | 2026-05-20    | green         |
| app/Services/ContentGate/ReviewQueue.php     | BH-SEC-07   | security | medium   | 2026-04-22    | **overdue**   |

**Freshness:** 12 vectors · green 8 · stale 1 · overdue 1 · open-findings 2.

- `BH-SEC-07` (Content Gate output handling, medium) is **OVERDUE** — last reviewed
  2026-04-22, interval 30d, ~57 days stale. Surfaces in the digest's "overdue areas".
- `BH-SEC-04` (Content Gate prompt injection, high) is **stale** (due, not yet escalated).

## Designer coverage (flows.yml)

_Phase 2 — seeded but not active. Awaiting staging + seeded test site. 7 flows registered;
core flows to instrument first: FLOW-01 connect-a-site, FLOW-02 content-gate-triage._

## PM coverage (problems.yml)

_Phase 3 — deferred. evidence_sources empty; cadences.pm off._

## Open findings

| dedupe surface | severity | confidence | needs_human_verification | linear   |
|----------------|----------|------------|--------------------------|----------|
| BH-SEC-05      | critical | high       | true                     | BEAR-541 |
| BH-SEC-02      | critical | medium     | true                     | BEAR-512 |
| /content-gate (FLOW-02) | medium | high | false (anchor: friction_delta) | — |

Active suppressions: 1 (BH-SEC-03 redirect re-validation, expires 2026-07-15, BEAR-498).

## Digest-style summary (week of 2026-06-18)

- **New critical/high:** BH-SEC-05 cross-tenant IDOR on site config (filed BEAR-541);
  BH-SEC-02 command replay exposure (filed BEAR-512). Both `needs_human_verification`.
- **Repeated themes:** the Content Gate cluster (BH-SEC-04 stale, BH-SEC-07 overdue,
  plus a UX friction finding on the review queue) — the LLM-content surface is the
  thinnest-covered area and is trending; worth a focused pass.
- **Overdue areas:** BH-SEC-07 (Content Gate output handling), 57 days stale.
- **False-positive rate:** low this week (1 of 4 security findings refuted by the 2nd
  reviewer per run_metrics) — registry is reviewed-quality, safe to keep nightly.
- **Top 3 human decisions needed:**
  1. Verify + prioritize BH-SEC-05 (cross-tenant read) — critical, awaiting human verify.
  2. Confirm BH-SEC-02 replay model and decide nonce+expiry remediation scope.
  3. Schedule the overdue Content Gate review (BH-SEC-07) before it drifts further.
