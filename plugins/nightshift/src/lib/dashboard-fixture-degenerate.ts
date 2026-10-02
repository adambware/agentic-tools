// Fixture for artboard 4 ("degenerate") of the dashboard reference prototype
// (~/.gstack/projects/adambware-agentic-tools/designs/nightshift-dashboard-20260823/gen.mjs).
// Everything absent at once: a repo whose pack cannot be read, a run with no
// cost capture, a single trend sample, and a finding whose evidence file is
// gone. Fully deterministic — hardcoded dates only, no Date.now().
//
// States exercised (plan §15 numbering):
//   2  — configured repo whose .nightshift/ pack is missing (novudesk)
//   9  — stale digest banner (>2 runs behind)
//   10 — single-sample trend ("1 of 2 runs — trend starts next run")
//   11 — zero-point trend with a named reason (cost, no envelope captured)
//   12 — open finding whose evidence file is no longer on disk
//   13 — recorded run with no matching cost line (cost-capture gap)
import type { DashboardInput } from "./dashboard-run.js";

const TODAY = "2026-08-23";

export const degenerateFixture: DashboardInput = {
  generated_at: "2026-08-23 06:14",
  engine_version: "3.0.0-dev",
  today: TODAY,
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
              title: "Account controller auth checks",
              kind: "vector",
              area: ["app/Http/Controllers/Account*"],
              weight: "critical",
              interval_days: 7,
              owner: "security",
              last_reviewed: "2026-08-22", // 1d elapsed / 7d interval => current
            },
            {
              id: "QB-SEC-02",
              title: "Dispatch command replay handling",
              kind: "vector",
              area: ["app/Services/Dispatch/*"],
              weight: "critical",
              interval_days: 7,
              owner: "security",
              last_reviewed: "2026-08-16", // 7d elapsed / 7d interval => due (== 1.0)
            },
            {
              id: "QB-SEC-03",
              title: "Webhook signature window",
              kind: "vector",
              area: ["app/Services/Webhooks/*"],
              weight: "medium",
              interval_days: 30,
              owner: "security",
              last_reviewed: "2026-08-10", // 13d elapsed / 30d interval => current
            },
          ],
        },
        {
          lane: "design",
          state: "disabled",
          entries: [],
        },
      ],
      findings: [
        {
          dedupe_key: {
            surface: "FLOW-01",
            symptom: "form_reset_on_error",
            root_cause: "shared_error_state_across_fields",
          },
          severity: "medium",
          confidence: "medium",
          needs_human_verification: false,
          anchor: "friction_delta",
          measured: "+4 steps",
          evidence: "evidence/quillbase/f3a91c02.png",
          first_seen: "2026-08-20",
          last_seen: "2026-08-20",
          run_id: "20260820-0611-design",
          repo: "quillbase",
          lane: "design",
          title: "Checkout: card errors clear the whole form",
          evidence_present: false,
        },
      ],
      suppressions: [],
      run_records: [
        {
          run_id: "20260823-0612-security",
          ts: "2026-08-23T06:12:00Z",
          date: "2026-08-23",
          lane: "security",
          pack_sha: "a1b2c3d4",
          selected: 3,
          reviewed: 3,
          findings_created: 0,
          confirmed: 0,
          rejected_tier1: 0,
          rejected_tier2: 0,
          suppressed: 0,
          usage_by_model: {},
          usage_spent: 0,
          elapsed: 0,
        },
      ],
      daily: [
        {
          date: "2026-08-23",
          lane: "security",
          ts: "2026-08-23T06:14:00Z",
          runs: 1,
          surfaces_total: 3,
          surfaces_green: 2,
          surfaces_stale: 1,
          surfaces_overdue: 0,
          open_findings: 0,
          coverage_freshness_pct: 67,
          median_staleness_ratio: 0.43,
          fpr_7d: 20,
          fpr_30d: 22,
        },
      ],
      costs: [],
    },
    {
      name: "novudesk",
      path: "~/Developer/novudesk",
      pack_present: false,
      lanes: [],
      findings: [],
      suppressions: [],
      run_records: [],
      daily: [],
      costs: [],
    },
  ],
  digests: [
    {
      repo: "quillbase",
      generated_at: "2026-08-14 06:03",
      runs_behind: 4,
      age_days: 9,
      items: [{ text: "Verify `QB-SEC-02` — critical, awaiting human verification.", repo: "quillbase" }],
    },
  ],
  orphan_run_dirs: [],
};
