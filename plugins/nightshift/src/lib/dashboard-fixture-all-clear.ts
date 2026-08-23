// Deterministic fixture: the quiet day (v3 A6 / T16-21 dashboard renderer).
// Mirrors the reference prototype's artboard 2 ("All clear — nothing needs
// the operator") — see ~/.gstack/projects/adambware-agentic-tools/designs/
// nightshift-dashboard-20260823/gen.mjs. Every date is hardcoded against
// "today" = 2026-08-23; no Date.now() anywhere.
//
// Repo names are fictional: "quillbase" (security + design lanes, both on,
// all entries current) and "novudesk" (security on, all current; design
// disabled) — 3 active lanes total. Registry ids that mirrored the
// prototype's private repo name are renamed BH-* -> QB-*.
import type { DashboardInput } from "./dashboard-run.js";
import type { CostRecord, DailyMetrics, RegistryEntry, RunMetrics } from "./types.js";

const TODAY = "2026-08-23";

/* ---------- trend window: 8 manual-cadence samples, matching the prototype's
   all-clear trend curves (freshness climbing 88->96, fpr falling 18->12,
   cost flat ~3.90). Dates are hardcoded, not computed from Date.now(). ---- */
interface TrendPoint {
  date: string;
  freshness: number;
  fpr: number;
  cost: number;
}

const TREND_POINTS: TrendPoint[] = [
  { date: "2026-07-28", freshness: 88, fpr: 18, cost: 3.9 },
  { date: "2026-07-31", freshness: 90, fpr: 16, cost: 3.95 },
  { date: "2026-08-04", freshness: 91, fpr: 15, cost: 3.88 },
  { date: "2026-08-09", freshness: 93, fpr: 14, cost: 3.92 },
  { date: "2026-08-12", freshness: 94, fpr: 13, cost: 3.9 },
  { date: "2026-08-17", freshness: 95, fpr: 13, cost: 3.94 },
  { date: "2026-08-21", freshness: 96, fpr: 12, cost: 3.89 },
  { date: "2026-08-23", freshness: 96, fpr: 12, cost: 3.9 },
];

const dailyTrend: DailyMetrics[] = TREND_POINTS.map((p) => ({
  date: p.date,
  lane: "security",
  ts: `${p.date}T06:14:00Z`,
  runs: 1,
  surfaces_total: 9,
  surfaces_green: Math.round((p.freshness / 100) * 9),
  surfaces_stale: 0,
  surfaces_overdue: 0,
  open_findings: 0,
  coverage_freshness_pct: p.freshness,
  median_staleness_ratio: 0.2,
  fpr_7d: p.fpr,
  fpr_30d: p.fpr + 2,
}));

/* ---------- quillbase: security + design, both on, all current ---------- */

const quillbaseSecEntries: RegistryEntry[] = [
  {
    id: "ASVS-AUTH-01",
    title: "Account authentication",
    kind: "vector",
    area: ["app/Http/Controllers/Account*"],
    weight: "critical",
    interval_days: 7,
    owner: "security",
    last_reviewed: "2026-08-22", // 1d ago -> current
  },
  {
    id: "ASVS-SESS-02",
    title: "Billing session handling",
    kind: "vector",
    area: ["app/Services/Billing/*"],
    weight: "critical",
    interval_days: 7,
    owner: "security",
    last_reviewed: "2026-08-21", // 2d ago -> current
  },
  {
    id: "QB-SEC-02",
    title: "Dispatch command handling",
    kind: "vector",
    area: ["app/Services/Dispatch/*"],
    weight: "critical",
    interval_days: 7,
    owner: "security",
    last_reviewed: "2026-08-22", // 1d ago -> current
  },
  {
    id: "ASVS-RATE-07",
    title: "Rate limiting middleware",
    kind: "vector",
    area: ["app/Http/Middleware/*"],
    weight: "high",
    interval_days: 14,
    owner: "security",
    last_reviewed: "2026-08-20", // 3d ago -> current
  },
  {
    id: "QB-SEC-04",
    title: "Triage gate prompt handling",
    kind: "vector",
    area: ["app/Services/TriageGate/*"],
    weight: "high",
    interval_days: 14,
    owner: "security",
    last_reviewed: "2026-08-21", // 2d ago -> current
  },
  {
    id: "QB-SEC-06",
    title: "Webhook signature validation",
    kind: "vector",
    area: ["app/Services/Webhooks/*"],
    weight: "medium",
    interval_days: 30,
    owner: "security",
    last_reviewed: "2026-08-18", // 5d ago -> current
  },
];

const quillbaseDesEntries: RegistryEntry[] = [
  {
    id: "FLOW-01",
    title: "Checkout flow",
    kind: "flow",
    area: ["/checkout (FLOW-01)"],
    weight: "critical",
    interval_days: 7,
    owner: "design",
    last_reviewed: "2026-08-22", // 1d ago -> current
  },
  {
    id: "FLOW-02",
    title: "Signup flow",
    kind: "flow",
    area: ["/signup (FLOW-02)"],
    weight: "high",
    interval_days: 14,
    owner: "design",
    last_reviewed: "2026-08-21", // 2d ago -> current
  },
  {
    id: "FLOW-03",
    title: "Settings flow",
    kind: "flow",
    area: ["/settings (FLOW-03)"],
    weight: "medium",
    interval_days: 30,
    owner: "design",
    last_reviewed: "2026-08-20", // 3d ago -> current
  },
];

const qbSecRun: RunMetrics = {
  run_id: "qb-sec-20260823",
  ts: "2026-08-23T06:12:00Z",
  date: "2026-08-23",
  lane: "security",
  pack_sha: "a1b2c3d",
  selected: 6,
  reviewed: 6,
  findings_created: 0,
  confirmed: 0,
  rejected_tier1: 0,
  rejected_tier2: 0,
  suppressed: 0,
  usage_by_model: { "claude-sonnet-5": 6 },
  usage_spent: 3.9,
  elapsed: 412,
};

const qbDesRun: RunMetrics = {
  run_id: "qb-des-20260823",
  ts: "2026-08-23T06:11:00Z",
  date: "2026-08-23",
  lane: "design",
  pack_sha: "a1b2c3d",
  selected: 3,
  reviewed: 3,
  findings_created: 0,
  confirmed: 0,
  rejected_tier1: 0,
  rejected_tier2: 0,
  suppressed: 0,
  usage_by_model: { "claude-sonnet-5": 3 },
  usage_spent: 3.9,
  elapsed: 268,
};

// One cost row per historical trend date (security lane), plus the
// same-day design cost row -- every run_record above has a matching ok
// cost row, and the trend curve gets its 8 flat-ish points.
const quillbaseCosts: CostRecord[] = TREND_POINTS.map((p) => ({
  run_id: p.date === "2026-08-23" ? qbSecRun.run_id : `qb-sec-hist-${p.date}`,
  lane: "security",
  date: p.date,
  ts: `${p.date}T06:12:00Z`,
  usd: p.cost,
  input_tokens: 42_000,
  output_tokens: 3_100,
  cache_read_tokens: 18_000,
  cache_creation_tokens: 1_200,
  source: "cli-json",
  status: "ok",
}));
quillbaseCosts.push({
  run_id: qbDesRun.run_id,
  lane: "design",
  date: "2026-08-23",
  ts: "2026-08-23T06:11:00Z",
  usd: 3.9,
  input_tokens: 31_000,
  output_tokens: 2_400,
  cache_read_tokens: 12_000,
  cache_creation_tokens: 900,
  source: "cli-json",
  status: "ok",
});

/* ---------- novudesk: security on (current), design disabled ---------- */

const novudeskSecEntries: RegistryEntry[] = [
  {
    id: "ASVS-AUTH-01",
    title: "Session controller authentication",
    kind: "vector",
    area: ["app/controllers/sessions_controller.rb"],
    weight: "critical",
    interval_days: 7,
    owner: "security",
    last_reviewed: "2026-08-22", // 1d ago -> current
  },
  {
    id: "ND-SEC-04",
    title: "Triage gate",
    kind: "vector",
    area: ["app/services/triage_gate/*"],
    weight: "high",
    interval_days: 14,
    owner: "security",
    last_reviewed: "2026-08-21", // 2d ago -> current
  },
  {
    id: "ND-SEC-07",
    title: "Triage gate review queue",
    kind: "vector",
    area: ["app/services/triage_gate/review_queue.rb"],
    weight: "medium",
    interval_days: 30,
    owner: "security",
    last_reviewed: "2026-08-19", // 4d ago -> current
  },
];

const ndSecRun: RunMetrics = {
  run_id: "nd-sec-20260821",
  ts: "2026-08-21T07:00:00Z",
  date: "2026-08-21",
  lane: "security",
  pack_sha: "f7e6d5c",
  selected: 3,
  reviewed: 3,
  findings_created: 0,
  confirmed: 0,
  rejected_tier1: 0,
  rejected_tier2: 0,
  suppressed: 0,
  usage_by_model: { "claude-sonnet-5": 3 },
  usage_spent: 2.98,
  elapsed: 201,
};

const novudeskCosts: CostRecord[] = [
  {
    run_id: ndSecRun.run_id,
    lane: "security",
    date: "2026-08-21",
    ts: "2026-08-21T07:00:00Z",
    usd: 2.98,
    input_tokens: 22_000,
    output_tokens: 1_700,
    cache_read_tokens: 9_000,
    cache_creation_tokens: 500,
    source: "cli-json",
    status: "ok",
  },
];

/* ---------- the fixture ---------- */

export const allClearFixture: DashboardInput = {
  generated_at: "2026-08-23 06:14",
  engine_version: "3.0.0-dev",
  today: TODAY,
  repos: [
    {
      name: "quillbase",
      pack_present: true,
      lanes: [
        { lane: "security", state: "on", entries: quillbaseSecEntries },
        { lane: "design", state: "on", entries: quillbaseDesEntries },
      ],
      findings: [],
      suppressions: [],
      run_records: [qbSecRun, qbDesRun],
      daily: dailyTrend,
      costs: quillbaseCosts,
    },
    {
      name: "novudesk",
      pack_present: true,
      lanes: [
        { lane: "security", state: "on", entries: novudeskSecEntries },
        { lane: "design", state: "disabled", entries: [] },
      ],
      findings: [],
      suppressions: [],
      run_records: [ndSecRun],
      daily: [],
      costs: novudeskCosts,
    },
  ],
  digests: [
    {
      repo: "quillbase",
      generated_at: "2026-08-23 06:14",
      runs_behind: 0,
      age_days: 0,
      items: [],
    },
    {
      repo: "novudesk",
      generated_at: "2026-08-23 06:14",
      runs_behind: 0,
      age_days: 0,
      items: [],
    },
  ],
  orphan_run_dirs: [],
  evidence_stats: { files: 0, bytes: 0, unreferenced: 0 },
};
