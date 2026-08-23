# Non-gating planted-vuln eval (report-only)

**Task T14 (P3).** Unscheduled — any time after A4's prompts exist. **Never blocks CI.**

## Why (plan §9.17)

A4/A3 move the reviewer from sonnet/15-turns to Opus-5/24-turns with a new per-surface
prompt. FPR measures **false positives only**, so a prompt change that makes the
reviewer miss real issues would look like an *improving* FPR. This eval is the
false-negative counterweight.

## Spec

- Extend the NovuDesk example pack with **planted, unambiguous vulnerabilities** mapped
  to real vectors, plus **clean control surfaces**.
- An eval runner reports `caught/total` and `false-positives-on-clean`.
- **Report only, never blocking** — same precedent as the onboardme LLM-judge lane in
  TODOS.md.

## Task

- [ ] **T14** — Files: `examples/novudesk/`, new eval runner
  - Verify: reports caught/total + FP-on-clean; never blocks CI
