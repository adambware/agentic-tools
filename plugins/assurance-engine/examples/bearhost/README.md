# BearHost — worked example pack

A concrete, end-to-end **worked example** that proves the Agentic Assurance Engine
adapts to a real project. **BearHost** is a control plane that manages connected
WordPress sites (laravel+vue), with a sibling repo `descry` (go) and a "Content Gate"
LLM that reviews monitored site content, driven against a BearHost staging URL.

This directory is **illustrative, not a live pack** — there is no real BearHost repo
here. It exists so a reader can see what a reviewed, populated `.nightshift/` looks like:
a filled-in manifest, a base+extension security registry, seeded designer flows and
personas, realistic findings, a suppression, and a generated dashboard.

## What it realizes (spec cross-reference)

See `assuranceenginev2.md`:

- **"manifest.yml (the portability layer)"** -> `.nightshift/manifest.yml`
- **"BearHost seed"** (the BH-SEC-01..07 table + base ASVS) -> `.nightshift/registries/vectors.yml`
- **`flows.yml` seed** (7 flows; connect-a-site + Content-Gate-triage as the two core
  flows) -> `.nightshift/registries/flows.yml`
- **Designer prerequisite** (seeded personas) -> `.nightshift/fixtures/personas.yml`
- **Security write-up fields + finding schema** -> `.nightshift/findings/log.jsonl`
- **"Rollout for BearHost"** (Phase 1 security now; Designer + PM deferred) -> reflected
  in `cadences`, the empty `problems.yml`, and the phase notes throughout.

## Contents

```
.nightshift/
  manifest.yml                  # bearhost: laravel+vue + ../descry go, staging browser, BEAR Linear
  registries/
    vectors.yml                 # base ASVS (remapped) + 7 BearHost BH-SEC-* extensions
    flows.yml                   # 7 designer flows (Phase 2); 2 core flows flagged
    problems.yml                # empty — PM deferred (Phase 3)
  fixtures/
    personas.yml                # single-site-owner, agency-admin, limited-member
  findings/
    log.jsonl                   # BH-SEC-05 IDOR, BH-SEC-02 replay, Content Gate UX friction
    suppressions.yml            # one time-boxed BH-SEC-03 suppression
  dashboard.md                  # generated coverage view + digest summary (overdue example)
```

The security content is deliberately **defensive**: findings are framed as failing
authorization/security invariants with explicit preconditions and human-verification
flags — no exploit payloads or offensive tooling. Optimized for coverage freshness,
confidence, and dedupe quality, not number of findings.
