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
import { renderDashboard, coverState, sparkline, type DashboardInput } from "./dashboard-run.js";
import type { RegistryEntry } from "./types.js";

const TODAY = "2026-08-23";

/** today - n days, as YYYY-MM-DD. Deterministic: derived only from the fixed
 *  TODAY literal above, never from Date.now(). */
function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
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
