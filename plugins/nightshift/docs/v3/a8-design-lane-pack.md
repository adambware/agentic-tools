# A8 — Design lane, novudesk pack side (LOCAL)

**Runs on the operator's machine** (novudesk pack + `$OPS`). **Depends on:** A5, A7.
T8's environment-safety preflight (session A7) must be in place — it blocks this session.
**Gate:** a design run completes against the local dev server; findings anchored or a
clean pass; evidence copied + pruned.

## Spec

### Pack reconcile (`/nightshift:onboard`)

- Set `stack_adapter.browser.base_url` to the **local dev server** URL (must be a
  loopback host — preflight refuses otherwise).
- Add the manifest's **explicit non-production environment assertion** (required by
  preflight; refusal, not warning, when absent).
- Seed `fixtures/personas.yml`: account types, plans, permissions, data seeds, success
  criteria; credentials **referenced, not stored**.
- Flip design cadence on; `window_budget_k.design: 4` (proposal — adjustable anytime).
- Set `stack_adapter.browser.tool` so `ns` preflight can resolve the per-adapter
  reviewer agentType (A5).

### The run

- `ux-reviewer` (per-adapter concrete agent from A5) drives flows via the manifest
  browser adapter — Playwright against the local URL.
- Preflight refusals to verify live: dev server down ("start the dev server first"),
  personas missing, non-loopback base_url, missing non-prod assertion.
- Anchor discipline unchanged: no objective anchor → digest, never a ticket.

### Evidence

Screenshots land in the run dir; those referenced by **confirmed** findings are copied
to `$OPS/evidence/novudesk/` (content-addressed filenames, lifecycle pruning: retained
while a referencing finding is unresolved, pruned once `resolved_at` is set). The
dashboard links them relatively, so they only resolve from `$OPS/`.

## Why the safety posture is strict (plan §9.14)

This is the one part of the plan that can cause something irreversible: the reviewer
acts as a persona — submitting forms, changing state — and **browser actions never touch
the filesystem guard**. A reachable URL is not evidence of a seeded local environment.
Hence loopback + explicit non-prod assertion, enforced as refusal.

## Checklist

- [ ] Onboard reconcile lands in novudesk's pack (base_url, non-prod assertion,
      personas, cadence, K, adapter tool)
- [ ] Each preflight refusal verified by inducing it once
- [ ] First design run completes; findings anchored or clean pass
- [ ] Evidence copied to `$OPS/evidence/novudesk/` and lifecycle-pruned
