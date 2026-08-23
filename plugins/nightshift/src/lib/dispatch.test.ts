import { describe, it, expect } from "vitest";
import { MODEL_BY_BAND, dispatchForBand } from "./dispatch.js";

describe("MODEL_BY_BAND", () => {
  it("pins the full band -> compute table (a tier change must be deliberate)", () => {
    expect(MODEL_BY_BAND).toMatchInlineSnapshot(`
      {
        "critical": {
          "effort": "high",
          "maxTurns": 80,
          "model": "opus",
        },
        "high": {
          "effort": "medium",
          "maxTurns": 64,
          "model": "opus",
        },
        "low": {
          "effort": "low",
          "maxTurns": 16,
          "model": "haiku",
        },
        "medium": {
          "effort": "medium",
          "maxTurns": 24,
          "model": "sonnet",
        },
      }
    `);
  });
});

describe("dispatchForBand", () => {
  it("returns the pinned entry for each band", () => {
    expect(dispatchForBand("critical")).toEqual({ model: "opus", effort: "high", maxTurns: 80 });
    expect(dispatchForBand("high")).toEqual({ model: "opus", effort: "medium", maxTurns: 64 });
    expect(dispatchForBand("medium")).toEqual({ model: "sonnet", effort: "medium", maxTurns: 24 });
    expect(dispatchForBand("low")).toEqual({ model: "haiku", effort: "low", maxTurns: 16 });
  });

  it("returns a fresh copy: mutating the result never changes MODEL_BY_BAND", () => {
    const d = dispatchForBand("critical");
    d.model = "haiku";
    d.effort = "low";
    d.maxTurns = 1;
    expect(MODEL_BY_BAND.critical).toEqual({ model: "opus", effort: "high", maxTurns: 80 });
  });
});
