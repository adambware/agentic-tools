import { describe, it, expect } from "vitest";
import {
  daysBetween,
  intervalDays,
  computeStaleness,
  computeBand,
  computeScore,
  selectSurfaces,
  MAX_STALENESS,
} from "./staleness.js";
import type { RegistryEntry } from "./types.js";
import { WEIGHT_MULTIPLIER } from "./types.js";

function entry(p: Partial<RegistryEntry> & { id: string }): RegistryEntry {
  return {
    title: p.title ?? p.id,
    kind: "vector",
    area: p.area ?? ["app/x/*"],
    weight: p.weight ?? "medium",
    interval_days: p.interval_days ?? 0,
    owner: "security",
    ...p,
  } as RegistryEntry;
}

describe("daysBetween", () => {
  it("counts whole days and goes negative", () => {
    expect(daysBetween("2026-06-01", "2026-06-08")).toBe(7);
    expect(daysBetween("2026-06-08", "2026-06-01")).toBe(-7);
    expect(daysBetween("2026-06-01", "2026-06-01")).toBe(0);
  });
});

describe("intervalDays", () => {
  it("uses an explicit positive interval", () => {
    expect(intervalDays(entry({ id: "A", interval_days: 14 }))).toBe(14);
  });
  it("derives from weight when interval is missing/zero/invalid", () => {
    expect(intervalDays(entry({ id: "A", weight: "critical", interval_days: 0 }))).toBe(7);
    expect(intervalDays(entry({ id: "A", weight: "high", interval_days: 0 }))).toBe(14);
    expect(intervalDays(entry({ id: "A", weight: "medium", interval_days: 0 }))).toBe(30);
    expect(intervalDays(entry({ id: "A", weight: "low", interval_days: 0 }))).toBe(90);
    expect(intervalDays(entry({ id: "A", weight: "high", interval_days: -3 }))).toBe(14);
  });
});

describe("computeStaleness", () => {
  it("returns MAX_STALENESS when last_reviewed is unset", () => {
    expect(computeStaleness(entry({ id: "A" }), "2026-06-21")).toBe(MAX_STALENESS);
  });
  it("is a ratio of elapsed days to interval", () => {
    const e = entry({ id: "A", weight: "critical", last_reviewed: "2026-06-14" });
    // 7 days elapsed / 7-day interval = 1.0
    expect(computeStaleness(e, "2026-06-21")).toBeCloseTo(1.0);
  });
});

describe("computeBand", () => {
  it("maps weight to band by default", () => {
    expect(computeBand("low", 0)).toBe("low");
    expect(computeBand("medium", 0)).toBe("medium");
    expect(computeBand("high", 0)).toBe("high");
    expect(computeBand("critical", 0)).toBe("critical");
  });
  it("upgrades changed critical/high entries to the critical band", () => {
    expect(computeBand("high", 1)).toBe("critical");
    expect(computeBand("critical", 1)).toBe("critical");
  });
  it("does not upgrade changed medium/low entries", () => {
    expect(computeBand("medium", 1)).toBe("medium");
    expect(computeBand("low", 1)).toBe("low");
  });
});

describe("computeScore", () => {
  it("is max(staleness, change_flag) * weight_multiplier", () => {
    expect(computeScore(0.5, 0, "medium")).toBe(0.5 * WEIGHT_MULTIPLIER.medium);
    // change_flag forces a floor of 1 even when staleness < 1
    expect(computeScore(0.2, 1, "high")).toBe(1 * WEIGHT_MULTIPLIER.high);
  });
});

describe("selectSurfaces", () => {
  const today = "2026-06-21";

  it("returns [] for an empty registry", () => {
    expect(selectSurfaces([], { today, k: 5 })).toEqual([]);
  });

  it("returns [] when K=0", () => {
    expect(selectSurfaces([entry({ id: "A" })], { today, k: 0 })).toEqual([]);
  });

  it("returns all when K>size", () => {
    const out = selectSurfaces([entry({ id: "A" }), entry({ id: "B" })], { today, k: 99 });
    expect(out).toHaveLength(2);
  });

  it("sorts never-reviewed (maximally stale) to the top", () => {
    const out = selectSurfaces(
      [
        entry({ id: "FRESH", weight: "critical", last_reviewed: "2026-06-20" }),
        entry({ id: "NEVER", weight: "low" }),
      ],
      { today, k: 1 },
    );
    expect(out[0]!.id).toBe("NEVER");
    expect(out[0]!.staleness).toBe(MAX_STALENESS);
  });

  it("breaks score ties by weight multiplier", () => {
    // Both never-reviewed => same MAX_STALENESS, weight breaks the tie.
    const out = selectSurfaces(
      [entry({ id: "LOW", weight: "low" }), entry({ id: "CRIT", weight: "critical" })],
      { today, k: 2 },
    );
    expect(out.map((s) => s.id)).toEqual(["CRIT", "LOW"]);
  });

  it("breaks weight ties by id for a total order", () => {
    const out = selectSurfaces(
      [entry({ id: "B", weight: "high" }), entry({ id: "A", weight: "high" })],
      { today, k: 2 },
    );
    expect(out.map((s) => s.id)).toEqual(["A", "B"]);
  });

  it("sets change_flag=1 on a glob hit and 0 on a miss", () => {
    const changed = entry({ id: "HIT", weight: "low", area: ["app/h/*"], last_reviewed: today });
    const clean = entry({ id: "MISS", weight: "low", area: ["app/c/*"], last_reviewed: today });
    const out = selectSurfaces([changed, clean], {
      today,
      k: 2,
      changedFilesFor: (e) => (e.id === "HIT" ? ["app/h/x.rb"] : []),
    });
    const byId = Object.fromEntries(out.map((s) => [s.id, s]));
    expect(byId.HIT!.change_flag).toBe(1);
    expect(byId.MISS!.change_flag).toBe(0);
    // a changed entry outscores a same-weight unchanged fresh entry
    expect(out[0]!.id).toBe("HIT");
  });

  it("no-git (changedFilesFor returns []) leaves change_flag=0", () => {
    const out = selectSurfaces([entry({ id: "A", last_reviewed: today, weight: "high" })], {
      today,
      k: 1,
      changedFilesFor: () => [],
    });
    expect(out[0]!.change_flag).toBe(0);
  });

  it("carries asvs_ref / persona through to the surface", () => {
    const out = selectSurfaces(
      [entry({ id: "A", asvs_ref: "ASVS 4.0.3 V4.2", persona: "support-agent" })],
      { today, k: 1 },
    );
    expect(out[0]!.asvs_ref).toBe("ASVS 4.0.3 V4.2");
    expect(out[0]!.persona).toBe("support-agent");
  });
});
