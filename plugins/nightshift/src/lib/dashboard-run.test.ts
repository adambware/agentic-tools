// A6 snapshot + state-coverage suite for the dashboard renderer (plan §15.6).
// Covers: 4 fixture snapshots (T20 gate), all 13 dashboard states reachable
// from the four fixtures plus a handful of minimal inline inputs, the
// coverState() boundary math (plan §15.9), the sparkline geometry contract,
// and the T16/T18/worst-first/overflow structural assertions.
//
// Every inline input below is fully deterministic: "today" is always the
// fixed literal "2026-08-23" (matching the fixtures), and any date arithmetic
// in the coverState boundary tests derives from that literal via a local
// helper — never Date.now().
import { describe, it, expect } from "vitest";
import {
  populatedFixture,
  allClearFixture,
  coldStartFixture,
  degenerateFixture,
} from "./dashboard-fixtures.js";
import {
  renderDashboard,
  coverState,
  sparkline,
  maxTsDaily,
  findingAnchor,
  type DashboardInput,
} from "./dashboard-run.js";
import type { RegistryEntry } from "./types.js";

const TODAY = "2026-08-23";

/** today - n days, as YYYY-MM-DD. Deterministic: derived only from the fixed
 *  TODAY literal above, never from Date.now(). */
function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Same fixed-TODAY arithmetic as daysAgo, in the other direction. */
function daysAhead(n: number): string {
  return daysAgo(-n);
}

/* ---------- 1. snapshots (T20 gate: "4 fixture snapshots green") ---------- */

describe("renderDashboard snapshots", () => {
  it("renders the populated fixture", () => {
    expect(renderDashboard(populatedFixture)).toMatchSnapshot();
  });
  it("renders the all-clear fixture", () => {
    expect(renderDashboard(allClearFixture)).toMatchSnapshot();
  });
  it("renders the cold-start fixture", () => {
    expect(renderDashboard(coldStartFixture)).toMatchSnapshot();
  });
  it("renders the degenerate fixture", () => {
    expect(renderDashboard(degenerateFixture)).toMatchSnapshot();
  });
});

/* ---------- 2. thirteen-state reachability ---------- */

describe("thirteen-state reachability", () => {
  it("state 1: zero repos configured", () => {
    const input: DashboardInput = {
      generated_at: "2026-08-23 06:14",
      engine_version: "3.0.0-dev",
      today: TODAY,
      repos: [],
      digests: [],
      orphan_run_dirs: [],
    };
    expect(renderDashboard(input)).toContain("No repos configured. Add one to");
  });

  it("state 2: pack missing", () => {
    expect(renderDashboard(degenerateFixture)).toContain("Cannot read this repo.");
  });

  it("state 3: never run", () => {
    const html = renderDashboard(coldStartFixture);
    expect(html).toContain("not yet reviewed");
    // The verdict strip's meta line is esc()'d, not fmtCopy()'d, so the
    // backtick-quoted command survives as literal text.
    expect(html).toContain("run `ns run");
  });

  it("state 4: lane not ready", () => {
    const html = renderDashboard(coldStartFixture);
    expect(html).toContain("pack is not ready");
    expect(html).toContain("personas.yml");
  });

  it("state 5: lane disabled", () => {
    expect(renderDashboard(populatedFixture)).toContain("Lane not enabled for this repo.");
  });

  it("state 6: registry empty", () => {
    const input: DashboardInput = {
      generated_at: "2026-08-23 06:14",
      engine_version: "3.0.0-dev",
      today: TODAY,
      repos: [
        {
          name: "onlyrepo",
          pack_present: true,
          lanes: [{ lane: "security", state: "on", entries: [] }],
          findings: [],
          suppressions: [],
          run_records: [],
          daily: [],
          costs: [],
        },
      ],
      digests: [],
      orphan_run_dirs: [],
    };
    expect(renderDashboard(input)).toContain("Registry seeded but empty");
  });

  it("state 7: all clear", () => {
    expect(renderDashboard(allClearFixture)).toContain("Nothing needs you");
  });

  it("state 8: no digest", () => {
    expect(renderDashboard(coldStartFixture)).toContain(
      "first digest is written after the first run",
    );
  });

  it("state 9: digest stale", () => {
    expect(renderDashboard(degenerateFixture)).toContain(
      "runs ago). These decisions may already be resolved",
    );
  });

  it("state 10: one trend point", () => {
    expect(renderDashboard(degenerateFixture)).toContain(
      "1 of 2 runs — trend starts next run",
    );
  });

  it("state 11: zero trend points", () => {
    const cold = renderDashboard(coldStartFixture);
    expect(cold).toContain("no data");
    expect(cold).toContain("Starts after the first run.");

    const degenerate = renderDashboard(degenerateFixture);
    expect(degenerate).toContain("no data");
    expect(degenerate).toContain("No run in the window captured a cost envelope.");
  });

  it("state 12: evidence gone", () => {
    expect(renderDashboard(degenerateFixture)).toContain(
      "evidence no longer on disk (pruned or never copied)",
    );
  });

  it("state 13: failed run", () => {
    const populated = renderDashboard(populatedFixture);
    expect(populated).toContain("run failed");
    expect(populated).toContain("failed run kept for diagnosis");

    const degenerate = renderDashboard(degenerateFixture);
    expect(degenerate).toContain("incomplete —");
  });
});

/* ---------- 3. plan §15.9: never vs overdue, and the staleness boundary ---------- */

describe("plan §15.9: never is not overdue", () => {
  it("cold start never renders the word overdue, in a pill or a row class", () => {
    const html = renderDashboard(coldStartFixture);
    // The stylesheet itself defines .c-overdue as boilerplate for every
    // render; what must never appear is an *applied* c-overdue row class or
    // the rendered word "overdue" in the page body.
    const body = html.slice(html.indexOf("</style>"));
    expect(body).not.toContain("overdue");
    expect(body).not.toContain("c-overdue");
  });

  it("coverState(): null last_reviewed is always never, even with an ancient interval", () => {
    const entry: RegistryEntry = {
      id: "X-1",
      title: "ancient interval, never reviewed",
      kind: "vector",
      area: ["x/*"],
      weight: "low",
      interval_days: 1, // tiny interval would make any elapsed time read overdue
      owner: "security",
      // last_reviewed intentionally unset
    };
    expect(coverState(entry, TODAY)).toBe("never");
  });

  it("boundary: staleness exactly 1.0 -> due", () => {
    const entry: RegistryEntry = {
      id: "X-2",
      title: "boundary 1.0",
      kind: "vector",
      area: ["x/*"],
      weight: "high",
      interval_days: 100,
      owner: "security",
      last_reviewed: daysAgo(100),
    };
    expect(coverState(entry, TODAY)).toBe("due");
  });

  it("boundary: staleness exactly 2.0 -> due", () => {
    const entry: RegistryEntry = {
      id: "X-3",
      title: "boundary 2.0",
      kind: "vector",
      area: ["x/*"],
      weight: "high",
      interval_days: 100,
      owner: "security",
      last_reviewed: daysAgo(200),
    };
    expect(coverState(entry, TODAY)).toBe("due");
  });

  it("boundary: staleness 2.01 -> overdue", () => {
    const entry: RegistryEntry = {
      id: "X-4",
      title: "boundary 2.01",
      kind: "vector",
      area: ["x/*"],
      weight: "high",
      interval_days: 100,
      owner: "security",
      last_reviewed: daysAgo(201),
    };
    expect(coverState(entry, TODAY)).toBe("overdue");
  });

  it("boundary: staleness 0.99 -> current", () => {
    const entry: RegistryEntry = {
      id: "X-5",
      title: "boundary 0.99",
      kind: "vector",
      area: ["x/*"],
      weight: "high",
      interval_days: 100,
      owner: "security",
      last_reviewed: daysAgo(99),
    };
    expect(coverState(entry, TODAY)).toBe("current");
  });
});

/* ---------- 4. sparkline contract (plan §15.4) ---------- */

describe("sparkline contract", () => {
  it("flat series renders finite coordinates: no NaN, no Infinity", () => {
    const html = sparkline({
      samples: [
        { d: "2026-08-01", v: 50 },
        { d: "2026-08-11", v: 50 },
        { d: "2026-08-21", v: 50 },
      ],
      windowDays: 30,
      polarity: "up-good",
      unit: "pct",
      id: "flat",
    });
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("positions x by date, not by array index", () => {
    // Three samples at equal INDEX spacing but unequal DATE spacing: a 1-day
    // gap followed by a 12-day gap. If x were index-based the two gaps would
    // render identically; date-based positioning must make the second gap
    // far wider than the first.
    const html = sparkline({
      samples: [
        { d: "2026-08-01", v: 10 },
        { d: "2026-08-02", v: 20 },
        { d: "2026-08-14", v: 30 },
      ],
      windowDays: 30,
      polarity: "up-good",
      unit: "n",
      id: "bydate",
    });
    const cx = [...html.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(cx).toHaveLength(3);
    const gap1 = cx[1]! - cx[0]!; // 1 day
    const gap2 = cx[2]! - cx[1]!; // 12 days
    expect(gap2).toBeGreaterThan(gap1 * 5);
  });

  it("single sample renders the value as text", () => {
    const html = sparkline({
      samples: [{ d: "2026-08-01", v: 42 }],
      windowDays: 30,
      polarity: "up-good",
      unit: "pct",
      id: "single",
    });
    expect(html).toContain("42%");
    expect(html).toContain("1 of 2 runs — trend starts next run");
  });

  it("empty series renders no data", () => {
    const html = sparkline({
      samples: [],
      windowDays: 30,
      polarity: "up-good",
      unit: "pct",
      id: "empty",
    });
    expect(html).toContain("no data");
  });

  it("multi-point output carries role=img and a <title>", () => {
    const html = sparkline({
      samples: [
        { d: "2026-08-01", v: 10 },
        { d: "2026-08-15", v: 20 },
      ],
      windowDays: 30,
      polarity: "up-good",
      unit: "pct",
      id: "roleimg",
    });
    expect(html).toContain('role="img"');
    expect(html).toContain("<title");
  });
});

/* ---------- 5. T18: overdue-with-no-finding + coverage pill & CRIT chip ---------- */

describe("T18: coverage pills and severity chips coexist", () => {
  it("an overdue entry with no finding still shows the overdue pill", () => {
    const html = renderDashboard(populatedFixture);
    // QB-SEC-04 is overdue (57d/14d interval) and has no finding in the fixture.
    const rowMatch = html.match(
      /<tr class="c-overdue">[\s\S]*?QB-SEC-04[\s\S]*?<\/tr>/,
    );
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![0]).toContain('class="pill p-bad"');
    expect(rowMatch![0]).toContain("overdue");
  });

  it("QB-SEC-02's row shows both its coverage pill and its CRIT chip", () => {
    const html = renderDashboard(populatedFixture);
    const rowMatch = html.match(/<tr class="c-\w+">(?:(?!<\/tr>)[\s\S])*QB-SEC-02[\s\S]*?<\/tr>/);
    expect(rowMatch).not.toBeNull();
    const row = rowMatch![0];
    expect(row).toContain('class="pill p-');
    expect(row).toContain("CRIT");
  });
});

/* ---------- 6. T16: verdict strip precedes decisions; cost only in footer ---------- */

describe("T16: verdict strip ordering and cost isolation", () => {
  it("the verdict strip appears before the Decisions section", () => {
    const html = renderDashboard(populatedFixture);
    const verdictIdx = html.indexOf('class="verdict');
    const decisionsIdx = html.indexOf('id="decisions"');
    expect(verdictIdx).toBeGreaterThanOrEqual(0);
    expect(decisionsIdx).toBeGreaterThan(verdictIdx);
  });

  it("cost never appears in the verdict strip, only in the footer", () => {
    const html = renderDashboard(populatedFixture);
    const verdictSection = html.match(/<section class="verdict[\s\S]*?<\/section>/);
    expect(verdictSection).not.toBeNull();
    expect(verdictSection![0]).not.toContain("$");

    const footerSection = html.match(/<footer>[\s\S]*?<\/footer>/);
    expect(footerSection).not.toBeNull();
    expect(footerSection![0]).toContain("$");
  });
});

/* ---------- 7. verdict overflow ---------- */

describe("verdict overflow", () => {
  it("shows only 4 items and an 'and N more below' overflow line past 4", () => {
    const entries: RegistryEntry[] = Array.from({ length: 6 }, (_, i): RegistryEntry => ({
      id: `OVF-${i + 1}`,
      title: `overdue area ${i + 1}`,
      kind: "vector",
      area: [`x/${i + 1}/*`],
      weight: "low",
      interval_days: 10,
      owner: "security",
      last_reviewed: "2026-01-01", // very overdue by 2026-08-23
    }));
    const input: DashboardInput = {
      generated_at: "2026-08-23 06:14",
      engine_version: "3.0.0-dev",
      today: TODAY,
      repos: [
        {
          name: "overflowrepo",
          pack_present: true,
          lanes: [{ lane: "security", state: "on", entries }],
          findings: [],
          suppressions: [],
          run_records: [],
          daily: [],
          costs: [],
        },
      ],
      digests: [],
      orphan_run_dirs: [],
    };
    const html = renderDashboard(input);
    expect(html).toContain("and 2 more below");
  });
});

/* ---------- 8. worst-first ordering ---------- */

describe("worst-first ordering", () => {
  it("the first tbody row in quillbase security is the overdue entry, not alphabetical", () => {
    const html = renderDashboard(populatedFixture);
    // Alphabetically, ASVS-AUTH-01 would sort first; worst-first must put the
    // overdue QB-SEC-04 first instead.
    const firstRowMatch = html.match(/<tr class="c-\w+">[\s\S]*?<td class="id"><code>([^<]+)<\/code>/);
    expect(firstRowMatch).not.toBeNull();
    expect(firstRowMatch![1]).toBe("QB-SEC-04");
  });
});

/* ---------- 7. hardened state assertions (adversarial verify pass) ---------- */

/** Minimal repo with one on-lane; override anything per test. */
function miniInput(overrides: Partial<DashboardInput> = {}): DashboardInput {
  return {
    generated_at: "2026-08-23 06:14",
    engine_version: "3.0.0-dev",
    today: TODAY,
    repos: [],
    digests: [],
    orphan_run_dirs: [],
    ...overrides,
  };
}

function miniEntry(id: string, last_reviewed?: string): RegistryEntry {
  return {
    id,
    title: id,
    kind: "vector",
    area: [`app/${id}/*`],
    weight: "medium",
    interval_days: 30,
    owner: "security",
    ...(last_reviewed ? { last_reviewed } : {}),
  };
}

function miniRun(date: string, lane: "security" | "design" = "security") {
  return {
    run_id: `run-${date}-${lane}`,
    ts: `${date}T07:00:00Z`,
    date,
    lane,
    pack_sha: "abc",
    selected: 1,
    reviewed: 1,
    findings_created: 0,
    confirmed: 0,
    rejected_tier1: 0,
    rejected_tier2: 0,
    suppressed: 0,
    usage_by_model: {},
    usage_spent: 0,
    elapsed: 60,
  };
}

function miniRepo(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    path: `~/x/${name}`,
    pack_present: true,
    lanes: [
      { lane: "security" as const, state: "on" as const, entries: [miniEntry(`${name}-A`, daysAgo(3))] },
    ],
    findings: [],
    suppressions: [],
    run_records: [miniRun(daysAgo(1))],
    daily: [],
    costs: [],
    ...overrides,
  };
}

describe("state 9 boundary: banner fires strictly past 2 runs behind", () => {
  const digest = (runs_behind: number) => ({
    repo: "r1",
    generated_at: "2026-08-14 06:03",
    runs_behind,
    age_days: 9,
    items: [{ text: "Verify something.", repo: "r1" }],
  });
  it("runs_behind 2: item renders its run-distance, NO amber banner", () => {
    const html = renderDashboard(miniInput({ repos: [miniRepo("r1")], digests: [digest(2)] }));
    expect(html).toContain("(2 runs ago)");
    expect(html).not.toContain('class="stale-note"');
  });
  it("runs_behind 3: amber banner appears", () => {
    const html = renderDashboard(miniInput({ repos: [miniRepo("r1")], digests: [digest(3)] }));
    expect(html).toContain('class="stale-note"');
    expect(html).toContain("These decisions may already be resolved");
  });
});

describe("state 11: FPR empty-why is honest about runs", () => {
  it("runs exist but no findings created: names the real reason, not 'first run'", () => {
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            daily: [
              {
                date: daysAgo(2),
                lane: "security",
                ts: `${daysAgo(2)}T07:00:00Z`,
                runs: 1,
                surfaces_total: 1,
                surfaces_green: 1,
                surfaces_stale: 0,
                surfaces_overdue: 0,
                open_findings: 0,
                coverage_freshness_pct: 100,
                median_staleness_ratio: 0.1,
                fpr_7d: null,
                fpr_30d: null,
              },
            ],
          }),
        ],
      }),
    );
    expect(html).toContain("No findings created in the window — FPR is undefined.");
    // The false copy from the pre-fix renderer must be confined to the no-runs case.
    const fprCard = html.split("False-positive rate")[1]!.split('class="tr"')[0]!;
    expect(fprCard).not.toContain("Starts after the first run.");
  });
});

describe("state 4: single missing prerequisite says 'until it exists'", () => {
  it("one missing item", () => {
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            lanes: [
              { lane: "design", state: "not-ready", not_ready_reason: "`fixtures/personas.yml` is missing", entries: [] },
            ],
          }),
        ],
      }),
    );
    expect(html).toContain("until it exists");
    expect(html).not.toContain("until both exist");
  });
  it("both missing items keep 'until both exist' (cold-start fixture)", () => {
    expect(renderDashboard(coldStartFixture)).toContain("until both exist");
  });
});

describe("state 3 in a multi-repo ops home", () => {
  it("a fresh repo's first-run guidance is ranked after alarms, not suppressed", () => {
    const overdueRepo = miniRepo("busy", {
      lanes: [
        { lane: "security", state: "on", entries: [miniEntry("busy-OLD", daysAgo(90))] },
      ],
    });
    const freshRepo = miniRepo("fresh", {
      lanes: [{ lane: "security", state: "on", entries: [miniEntry("fresh-A")] }],
      run_records: [],
    });
    const html = renderDashboard(miniInput({ repos: [overdueRepo, freshRepo] }));
    expect(html).toContain("fresh is onboarded but has never been reviewed");
    const overdueIdx = html.indexOf("busy-OLD —");
    const firstRunIdx = html.indexOf("fresh is onboarded");
    expect(overdueIdx).toBeGreaterThan(-1);
    expect(firstRunIdx).toBeGreaterThan(overdueIdx);
  });
});

describe("state 8 copy names a real repo and respects run history", () => {
  it("no runs: 'written after the first run (ns digest <name>)'", () => {
    const html = renderDashboard(
      miniInput({ repos: [miniRepo("r1", { run_records: [] })] }),
    );
    expect(html).toContain("the first digest is written after the first run");
    expect(html).toContain("ns digest r1");
  });
  it("runs exist, digest absent: says to run the digest, not 'after the first run'", () => {
    const html = renderDashboard(miniInput({ repos: [miniRepo("r1")] }));
    expect(html).toContain("run <code>ns digest r1</code> to write the first one");
    expect(html).not.toContain("written after the first run");
  });
});

describe("trend empty-why axes are individually pinned", () => {
  it("runs exist but all outside the 30d window: 'No runs in the last 30 days.'", () => {
    const html = renderDashboard(
      miniInput({ repos: [miniRepo("r1", { run_records: [miniRun(daysAgo(60))], digests: [] })] }),
    );
    expect(html).toContain("No runs in the last 30 days.");
    expect(html).not.toContain("Starts after the first run.");
  });
  it("in-window runs with an empty freshness series name the rollup gap, not the first run", () => {
    const html = renderDashboard(miniInput({ repos: [miniRepo("r1")] }));
    expect(html).toContain("No daily rollup recorded in the window.");
    const freshCard = html.split("Coverage freshness")[1]!.split('class="tr"')[0]!;
    expect(freshCard).not.toContain("Starts after the first run.");
  });
});

describe("two stale digests render two per-repo banners", () => {
  it("each banner carries its own age, run-distance, and refresh command", () => {
    const digests = [
      { repo: "r1", generated_at: "2026-08-19 06:00", runs_behind: 3, age_days: 4, items: [{ text: "a", repo: "r1" }] },
      { repo: "r2", generated_at: "2026-07-14 06:00", runs_behind: 9, age_days: 40, items: [{ text: "b", repo: "r2" }] },
    ];
    const html = renderDashboard(
      miniInput({ repos: [miniRepo("r1"), miniRepo("r2")], digests }),
    );
    expect((html.match(/class="stale-note"/g) ?? []).length).toBe(2);
    expect(html).toContain("Digest is 4 days old (generated 2026-08-19 06:00, 3 runs ago)");
    expect(html).toContain("Digest is 40 days old (generated 2026-07-14 06:00, 9 runs ago)");
    expect(html).toContain("ns digest r1");
    expect(html).toContain("ns digest r2");
  });
});

/* ---------- maxTsDaily: the append-only reader contract ---------- */

// daily.jsonl is append-only, so the same (date, lane) legitimately appears more
// than once — a re-run of the rollup rewrites the day. Every trend the dashboard
// draws is built on this reduction picking the LAST write, so it is pinned
// directly here rather than only through renderDashboard.
describe("maxTsDaily", () => {
  const row = (date: string, lane: "security" | "design", ts: string, runs: number) =>
    ({
      date,
      lane,
      ts,
      runs,
      surfaces_total: 1,
      surfaces_green: 1,
      surfaces_stale: 0,
      surfaces_overdue: 0,
      open_findings: 0,
      coverage_freshness_pct: 100,
      median_staleness_ratio: 0,
      fpr_7d: null,
      fpr_30d: null,
    }) as const;

  it("keeps the max-ts line for a repeated (date, lane)", () => {
    const out = maxTsDaily([
      row("2026-08-20", "security", "2026-08-20T06:00:00Z", 1),
      row("2026-08-20", "security", "2026-08-20T18:00:00Z", 9),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.runs).toBe(9);
  });

  it("is order-independent — a later ts wins even when it arrives first", () => {
    const out = maxTsDaily([
      row("2026-08-20", "security", "2026-08-20T18:00:00Z", 9),
      row("2026-08-20", "security", "2026-08-20T06:00:00Z", 1),
    ]);
    expect(out.map((l) => l.runs)).toEqual([9]);
  });

  // The rollup that rewrites a day stamps toISOString() milliseconds; the line
  // it supersedes may sit at second precision. '.' sorts below 'Z', so a string
  // compare reads the rewrite as OLDER and every trend keeps the stale day.
  it("picks the later instant when the two lines differ in ts precision", () => {
    const out = maxTsDaily([
      row("2026-08-20", "security", "2026-08-20T18:00:00Z", 1),
      row("2026-08-20", "security", "2026-08-20T18:00:00.500Z", 9),
    ]);
    expect(out.map((l) => l.runs)).toEqual([9]);
  });

  it("keys on (date, lane) together — same date, different lane stays separate", () => {
    const out = maxTsDaily([
      row("2026-08-20", "security", "2026-08-20T06:00:00Z", 1),
      row("2026-08-20", "design", "2026-08-20T06:00:00Z", 2),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.lane).sort()).toEqual(["design", "security"]);
  });

  it("sorts the survivors by date ascending regardless of input order", () => {
    const out = maxTsDaily([
      row("2026-08-22", "security", "2026-08-22T06:00:00Z", 3),
      row("2026-08-20", "security", "2026-08-20T06:00:00Z", 1),
      row("2026-08-21", "security", "2026-08-21T06:00:00Z", 2),
    ]);
    expect(out.map((l) => l.date)).toEqual(["2026-08-20", "2026-08-21", "2026-08-22"]);
  });

  it("returns an empty array for empty input", () => {
    expect(maxTsDaily([])).toEqual([]);
  });
});

/* ---------- cross-repo trend reduction (the dashboard is multi-repo) ---------- */

// The trend series is documented as "one sample per date: mean across (repo,
// lane) rollups for that day". Reducing the FLATTENED list would collapse two
// repos' same-day rows for the same lane onto one `date|lane` key, so a single
// repo's number would stand in for every repo — silently, and worse the more
// repos are onboarded, which is exactly the direction this dashboard is built
// to grow. The reduction must therefore happen per repo, before flattening.
describe("cross-repo daily rows survive the trend reduction", () => {
  const dailyRow = (date: string, ts: string, freshness: number) => ({
    date,
    lane: "security" as const,
    ts,
    runs: 1,
    surfaces_total: 1,
    surfaces_green: 1,
    surfaces_stale: 0,
    surfaces_overdue: 0,
    open_findings: 0,
    coverage_freshness_pct: freshness,
    median_staleness_ratio: 0,
    fpr_7d: null,
    fpr_30d: null,
  });

  it("two repos on the same date and lane are averaged, not overwritten", () => {
    const day = daysAgo(1);
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", { daily: [dailyRow(day, `${day}T06:00:00Z`, 100)] }),
          // Later ts, and the value that would win outright under a flattened
          // reduction. The mean of 100 and 0 is 50 — that is the tell.
          miniRepo("r2", { daily: [dailyRow(day, `${day}T18:00:00Z`, 0)] }),
        ],
      }),
    );
    const freshCard = html.split("Coverage freshness")[1]!;
    expect(freshCard).toContain("50");
    expect(freshCard).not.toContain("No daily rollup recorded in the window.");
  });

  it("a repo's own same-day replay is still deduped to its max-ts row", () => {
    const day = daysAgo(1);
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            daily: [
              dailyRow(day, `${day}T06:00:00Z`, 100),
              dailyRow(day, `${day}T18:00:00Z`, 40),
            ],
          }),
        ],
      }),
    );
    // One repo, one date: the later row wins outright, so the mean is just 40.
    expect(html.split("Coverage freshness")[1]!).toContain("40");
  });
});

/* ---------- a replayed cost row must not inflate the dashboard ---------- */

// Codex flagged the concrete number: duplicating one $1.62 fixture row moved the
// displayed 30-day total from $7.13 to $8.75. The rollup already deduped, but the
// dashboard reads costs.jsonl itself in nine places, so the reduction has to
// happen on the way in or the footer lies while daily.jsonl is correct.
describe("duplicate cost rows (record-cost retry) do not inflate the dashboard", () => {
  const DAY = daysAgo(1);
  const costRow = (run_id: string, ts: string, usd: number) => ({
    run_id,
    lane: "security" as const,
    date: DAY,
    ts,
    usd,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    source: "cli-json" as const,
    status: "ok" as const,
  });
  // The footer only prints totals when every windowed run has a matching cost
  // row, so run_records and cost rows must share run_ids for this to exercise
  // the total at all.
  const runRow = (run_id: string) => ({ ...miniRun(DAY), run_id });
  const footer = (html: string) => html.match(/<footer>[\s\S]*?<\/footer>/)![0];

  it("renders the same total whether or not the run was replayed", () => {
    const once = footer(
      renderDashboard(
        miniInput({
          repos: [
            miniRepo("r1", {
              run_records: [runRow("A")],
              costs: [costRow("A", `${DAY}T06:00:00Z`, 1.62)],
            }),
          ],
        }),
      ),
    );
    const replayed = footer(
      renderDashboard(
        miniInput({
          repos: [
            miniRepo("r1", {
              run_records: [runRow("A")],
              costs: [
                costRow("A", `${DAY}T06:00:00Z`, 1.62),
                costRow("A", `${DAY}T07:00:00Z`, 1.62),
              ],
            }),
          ],
        }),
      ),
    );
    expect(once).toContain("$1.62");
    expect(replayed).toBe(once);
  });

  it("two genuinely distinct runs still both count", () => {
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            run_records: [runRow("A"), runRow("B")],
            costs: [
              costRow("A", `${DAY}T06:00:00Z`, 1.0),
              costRow("B", `${DAY}T07:00:00Z`, 2.0),
            ],
          }),
        ],
      }),
    );
    expect(footer(html)).toContain("$3.00");
  });
});

/* ---------- the verdict strip covers everything past interval_days ---------- */

// a6-dashboard.md defines source 2 of the strip as "registry entries past
// `interval_days`". coverState() splits that span into `due` (1x-2x) and
// `overdue` (>2x), and the strip used to take only the latter — so an entry one
// day past a 14-day interval was invisible on the page whose entire job is
// telling the operator what needs them.
describe("verdict strip: due entries are past interval, so they count", () => {
  const entryAt = (id: string, daysSince: number, interval: number): RegistryEntry => ({
    ...miniEntry(id, daysAgo(daysSince)),
    interval_days: interval,
  });
  const withEntries = (...entries: RegistryEntry[]) =>
    renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            lanes: [{ lane: "security" as const, state: "on" as const, entries }],
          }),
        ],
      }),
    );

  it("an entry exactly at its interval renders as due, not as nothing", () => {
    const html = withEntries(entryAt("E-DUE", 14, 14));
    expect(html).toContain("E-DUE");
    expect(html).not.toContain("Nothing needs you");
  });

  it("a due entry keeps the warn tone; an overdue one keeps bad", () => {
    const html = withEntries(entryAt("E-DUE", 14, 14), entryAt("E-OVER", 90, 30));
    expect(html).toMatch(/<span class="v-kind t-warn">due<\/span>/);
    expect(html).toMatch(/<span class="v-kind t-bad">overdue<\/span>/);
  });

  it("a current entry still stays out of the strip", () => {
    expect(withEntries(entryAt("E-FRESH", 1, 30))).toContain("Nothing needs you");
  });

  it("a never-reviewed entry stays out of the strip (plan §15.9)", () => {
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            lanes: [
              { lane: "security" as const, state: "on" as const, entries: [miniEntry("E-NEW")] },
            ],
          }),
        ],
      }),
    );
    expect(html).toContain("Nothing needs you");
  });

  it("only four items fit, and they are the four WORST — not the first four", () => {
    // Two due entries emitted BEFORE four overdue ones. Insertion order would
    // put the warn items above the fold and bury two real alarms.
    const html = withEntries(
      entryAt("E-DUE-1", 14, 14),
      entryAt("E-DUE-2", 15, 14),
      entryAt("E-OVER-1", 91, 30),
      entryAt("E-OVER-2", 92, 30),
      entryAt("E-OVER-3", 93, 30),
      entryAt("E-OVER-4", 94, 30),
    );
    const strip = html.split('class="v-list"')[1]!.split("</ul>")[0]!;
    expect(strip).not.toContain("E-DUE-1");
    expect(strip).not.toContain("E-DUE-2");
    for (const id of ["E-OVER-1", "E-OVER-2", "E-OVER-3", "E-OVER-4"]) {
      expect(strip).toContain(id);
    }
    expect(strip).toContain("and 2 more below");
  });
});

/* ---------- expired suppressions are not "active" ---------- */

describe("suppression expiry", () => {
  const supp = (surface: string, expires: string) => ({
    dedupe_key: { surface, symptom: "s", root_cause: "rc" },
    reason: "accepted risk",
    expires,
    approved_by: "adam",
  });

  it("an unexpired suppression renders", () => {
    const html = renderDashboard(
      miniInput({ repos: [miniRepo("r1", { suppressions: [supp("S-LIVE", daysAhead(5))] })] }),
    );
    expect(html).toContain("S-LIVE");
  });

  // The renderer trusts its input here; loadSuppressions() is the filter, and
  // dashboard-cli.test.ts covers the on-disk path. This pins the display half:
  // whatever survives the filter is what the operator is told is accepted risk.
  it("a suppression expiring today is still active (expires is inclusive)", () => {
    const html = renderDashboard(
      miniInput({ repos: [miniRepo("r1", { suppressions: [supp("S-TODAY", TODAY)] })] }),
    );
    expect(html).toContain("S-TODAY");
  });
});

/* ---------- finding anchors are unique across repos ---------- */

describe("finding anchors", () => {
  const finding = (repo: string, surface: string, symptom: string) => ({
    id: `${repo}-${surface}`,
    repo,
    lane: "security" as const,
    severity: "high" as const,
    confidence: "high" as const,
    title: symptom,
    dedupe_key: { surface, symptom, root_cause: "rc" },
    needs_human_verification: false,
    first_seen: daysAgo(2),
  });

  it("two repos sharing a taxonomy surface id get distinct anchors", () => {
    const a = findingAnchor(finding("repo-a", "QB-SEC-01", "same symptom"));
    const b = findingAnchor(finding("repo-b", "QB-SEC-01", "same symptom"));
    expect(a).not.toBe(b);
  });

  it("two findings on one surface in one repo get distinct anchors", () => {
    const a = findingAnchor(finding("repo-a", "QB-SEC-01", "symptom one"));
    const b = findingAnchor(finding("repo-a", "QB-SEC-01", "symptom two"));
    expect(a).not.toBe(b);
  });

  it("the anchor is a valid HTML id and stable across calls", () => {
    const f = finding("repo-a", "QB-SEC-01", "symptom one");
    expect(findingAnchor(f)).toBe(findingAnchor(f));
    expect(findingAnchor(f)).toMatch(/^[A-Za-z][A-Za-z0-9\-_]*$/);
  });

  it("every rendered card id is unique on the page", () => {
    const html = renderDashboard(populatedFixture);
    const ids = [...html.matchAll(/<div class="fd" id="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every finding link points at an id that exists on the page", () => {
    const html = renderDashboard(populatedFixture);
    const ids = new Set([...html.matchAll(/<div class="fd" id="([^"]+)"/g)].map((m) => m[1]!));
    const hrefs = [...html.matchAll(/href="#(f-[^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(ids.has(h), `dangling link #${h}`).toBe(true);
  });
});

/* ---------- a newer successful run clears an older failure ---------- */

describe("failed-run verdict is cleared by a later successful run", () => {
  const failedCost = (ts: string) => ({
    run_id: "failed-1",
    lane: "security" as const,
    date: daysAgo(3),
    ts,
    usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    source: "cli-json" as const,
    status: "error" as const,
    terminal_reason: "api_error",
  });

  it("a failure with no later run still raises the alarm", () => {
    const html = renderDashboard(
      miniInput({
        repos: [miniRepo("r1", { run_records: [], costs: [failedCost(`${daysAgo(3)}T07:00:00Z`)] })],
      }),
    );
    expect(html).not.toContain("Nothing needs you");
  });

  it("an interactive re-run with no cost capture clears the stale failure", () => {
    // The realistic recovery: `ns run --interactive` records a run but writes
    // no cost line, so a cost-rows-only check would keep screaming forever.
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            run_records: [miniRun(daysAgo(1))],
            costs: [failedCost(`${daysAgo(3)}T07:00:00Z`)],
          }),
        ],
      }),
    );
    expect(html).toContain("Nothing needs you");
  });

  it("a run OLDER than the failure does not clear it", () => {
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            run_records: [miniRun(daysAgo(9))],
            costs: [failedCost(`${daysAgo(3)}T07:00:00Z`)],
          }),
        ],
      }),
    );
    expect(html).not.toContain("Nothing needs you");
  });
});

/* ---------- a recorded run is not automatically a successful run ---------- */

describe("a run row that reviewed nothing renders as the failure it is", () => {
  /** The third real run's shape: both reviewers cut off before writing, so the
   *  chain completed, the row is honest, and nothing was stamped. */
  const nothingReviewed = (date: string) => ({
    ...miniRun(date),
    selected: 2,
    reviewed: 0,
  });

  const okCost = (run_id: string, ts: string, usd: number) => ({
    run_id,
    lane: "security" as const,
    date: ts.slice(0, 10),
    ts,
    usd,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    source: "cli-json" as const,
    status: "ok" as const,
  });

  it("says FAILED with the shortfall instead of 'security ok'", () => {
    const run = nothingReviewed(daysAgo(1));
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", { run_records: [run], costs: [okCost(run.run_id, run.ts, 1.24)] }),
        ],
      }),
    );
    expect(html).toContain("security FAILED");
    expect(html).toContain("reviewed 0 of 2 selected");
    expect(html).not.toContain("security ok");
    // The money stays on the line: a run that reviewed nothing still cost
    // something, and that is the most useful number on the row.
    expect(html).toContain("$1.24");
  });

  it("a normal run still renders ok with its cost", () => {
    const run = miniRun(daysAgo(1));
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", { run_records: [run], costs: [okCost(run.run_id, run.ts, 0.42)] }),
        ],
      }),
    );
    expect(html).toContain("security ok");
    expect(html).toContain("$0.42");
    expect(html).not.toContain("FAILED");
  });

  it("never fires alongside the cost-error branch — one lane, one failure line", () => {
    // An error cost row NEWER than the run takes the branch above; the run row's
    // own shortfall takes this one. They are mutually exclusive by construction,
    // and this pins that a lane can never print two failure spans.
    const run = nothingReviewed(daysAgo(2));
    const html = renderDashboard(
      miniInput({
        repos: [
          miniRepo("r1", {
            run_records: [run],
            costs: [
              {
                ...okCost(run.run_id, `${daysAgo(1)}T07:00:00Z`, 0),
                status: "error" as const,
                terminal_reason: "api_error",
              },
            ],
          }),
        ],
      }),
    );
    expect((html.match(/<span class="fail">/g) ?? []).length).toBe(1);
    expect(html).toContain("security FAILED");
  });
});
