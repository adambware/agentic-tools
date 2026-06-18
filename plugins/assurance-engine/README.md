# Assurance Engine

A coverage-driven review loop that keeps **security surfaces**, **user flows**, and (later)
**product problems** continuously fresh, evidence-linked, and visible — while humans keep
roadmap, design, and remediation authority.

Built once as an **engine** (project-agnostic, this plugin); each codebase is onboarded as a
**pack** that lives in `<repo>/.nightshift/` and travels with the code.

> **Design discipline (non-negotiable):** optimize for coverage freshness, confidence, dedupe
> quality, and digest usefulness — **not** the number of findings. A schema field is added only
> when a real failure mode demands it.

## Install

```bash
# Add the marketplace (once)
/plugin marketplace add adambware/agentic-tools

# Install this plugin
/plugin install assurance-engine@agentic-tools
```

## Engine vs pack

```
plugins/assurance-engine/          # the ENGINE — project-agnostic, versioned once
  skills/                          # human-invokable entry points (onboard / run / garden / digest)
  agents/                          # generic reviewer subagents (security / refuter / ux / pm)
  taxonomy/                        # BASE libraries (owasp-asvs.yml) that packs clone + extend
  schemas/                         # canonical registry-entry + finding + manifest + run-metrics
  templates/.nightshift/           # copyable pack skeleton
  examples/bearhost/.nightshift/   # a worked seed proving the engine adapts to a real project

<each repo>/.nightshift/           # the PACK — travels with the code, versioned in the repo
  manifest.yml                     # stack adapter, allowlist, evidence sources, Linear labels, cadences
  registries/{vectors,flows,problems}.yml
  fixtures/                        # seeded test personas (designer)
  findings/                        # append-only log + suppressions
  dashboard.md                     # generated coverage view
```

## Skills

| Skill | What it does |
|-------|--------------|
| `assurance-onboard` | Onboard a codebase as a pack: drop `.nightshift/`, clone the base taxonomy into `vectors.yml` and extend, run a human-reviewed seed + garden pass. |
| `assurance-run` | Execute **one** bounded review run for a lane: select stalest/changed entries within the manifest budget, fan out the reviewer subagent (security requires a mandatory second *refuter*), dedupe, log, update state, emit `run_metrics`, apply severity gates. |
| `assurance-garden` | Weekly **registry gardening**: does each recent change map to an entry? If not, *propose* one (human approves). Flags orphaned entries and stale `area` mappings — the only defense against permanent blind spots. |
| `assurance-digest` | Produce the **weekly digest** — the management signal: new critical/high, repeated themes, overdue areas, false-positive rate, proposed entries awaiting approval, and the top 3 human decisions needed. |

## Reviewer subagents

| Agent | Role |
|-------|------|
| `security-reviewer` | Defensive review of a vector's code surface ("is this adequately protected?"). Proposes — never files — a finding with `preconditions` and an optional failing invariant test. **Assurance, not a pentest:** no exploit payloads or offensive tooling. |
| `security-refuter` | Mandatory **second, independent** reviewer. Re-examines the code and must *refute* before a finding is logged; rejections count toward `rejected_by_2nd_reviewer`. False-positive reduction is its north star. |
| `ux-reviewer` | Designer friction & a11y auditor. Requires seeded `fixtures/` personas; drives flows via the manifest browser adapter. Every ticket requires an objective `anchor`. |
| `pm-reviewer` | Evidence-grounded PM reviewer — **deferred/off** until `evidence_sources` are wired. Refuses to run dry to avoid inventing problems. |

## How a run works (the bounded loop)

1. Compute `staleness = (today - last_reviewed)/interval_days`; force-flag entries whose `area` changed in git since `last_reviewed`.
2. Sort by `max(staleness, change_flag) * weight`; take the top **K** (the manifest's `window_budget_k`).
3. Fan out the domain reviewer subagent per selected entry.
4. **Dedupe** against open findings by `dedupe_key`; honor active **suppressions**.
5. Append confirmed findings; update `last_reviewed`/`status`; emit `run_metrics`.
6. Apply **severity gates** (critical/high → Linear now; medium → only if reproducible/recurring/customer-facing; low → digest; taste → never without an anchor).

## Onboarding a codebase

1. Drop `.nightshift/` (copy from `templates/.nightshift/`) and fill in `manifest.yml`.
2. Clone `taxonomy/owasp-asvs.yml` into `.nightshift/registries/vectors.yml` and extend with project-specific surfaces; remap `area` globs from your `REPO_MAP.yml`.
3. Run a **human-reviewed seed + garden pass**.

Phase 1 (Security) is "done" not when the nightly run works, but when `vectors.yml` is reviewed,
complete-enough (weights + code mappings + owners), with a low false-positive rate. Designer
(phase 2) needs staging + seeded test personas; PM (phase 3) stays off until real signal exists.

See [`examples/bearhost/`](examples/bearhost/) for a worked seed that proves the engine adapts.

## Schemas

Canonical shapes live in [`schemas/`](schemas/): `registry-entry.yml` (the shared spine),
`finding.yml` (lean finding + suppression), `manifest.yml` (the portability layer), and
`run-metrics.yml`. Engine-managed fields are tagged `(auto)`; everything else is human-seeded.
