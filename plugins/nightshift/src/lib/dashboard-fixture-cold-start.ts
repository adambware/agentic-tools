// Fixture: cold start — day one. One repo onboarded, security lane on with
// three never-reviewed entries, design lane not-ready, zero runs recorded.
// Mirrors reference prototype artboard 3 (gen.mjs), with the private repo name
// substituted for the fictional "quillbase" (see A6 task confidentiality rule).
//
// The failure mode this guards against: a null last_reviewed entry must render
// as "not yet reviewed" (◇, neutral coverState "never"), NEVER as "overdue".
import type { DashboardInput } from "./dashboard-run.js";

export const coldStartFixture: DashboardInput = {
  generated_at: "2026-08-23 09:02",
  engine_version: "3.0.0-dev",
  today: "2026-08-23",
  repos: [
    {
      name: "quillbase",
      pack_present: true,
      lanes: [
        {
          lane: "security",
          state: "on",
          entries: [
            {
              id: "QB-SEC-01",
              title: "Account controllers",
              kind: "vector",
              area: ["app/Http/Controllers/Account*"],
              weight: "critical",
              interval_days: 7,
              owner: "security",
              // last_reviewed intentionally unset: coverState() must derive
              // "never" here, not "overdue".
            },
            {
              id: "QB-SEC-02",
              title: "Billing service",
              kind: "vector",
              area: ["app/Services/Billing/*"],
              weight: "critical",
              interval_days: 7,
              owner: "security",
            },
            {
              id: "QB-SEC-03",
              title: "Rate-limit middleware",
              kind: "vector",
              area: ["app/Http/Middleware/*"],
              weight: "high",
              interval_days: 14,
              owner: "security",
            },
          ],
        },
        {
          lane: "design",
          state: "not-ready",
          not_ready_reason:
            "`fixtures/personas.yml` is missing and `stack_adapter.browser.base_url` is unset",
          entries: [],
        },
      ],
      findings: [],
      suppressions: [],
      run_records: [],
      daily: [],
      costs: [],
    },
  ],
  digests: [],
  orphan_run_dirs: [],
  // evidence_stats omitted: no evidence store to report on day one.
};
