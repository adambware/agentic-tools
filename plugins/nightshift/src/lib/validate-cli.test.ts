import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runValidate } from "./validate-cli.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-validate-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const VALID_RUN_METRICS = {
  run_id: "run-001",
  ts: "2026-06-21T00:00:00Z",
  date: "2026-06-21",
  lane: "security",
  pack_sha: "abc123",
  selected: 5,
  reviewed: 5,
  findings_created: 2,
  confirmed: 1,
  rejected_tier1: 0,
  rejected_tier2: 1,
  suppressed: 0,
  usage_by_model: { "claude-sonnet-4-5": 1000 },
};

const VALID_REGISTRY_ENTRY = {
  id: "vec-001",
  title: "Auth bypass check",
  kind: "vector",
  area: ["app/auth/*"],
  weight: "critical",
  interval_days: 7,
  owner: "security",
};

const VALID_SUPPRESSION = {
  dedupe_key: {
    surface: "app/auth/login.ts",
    symptom: "SQL injection risk",
    root_cause: "user input not sanitized",
  },
  reason: "mitigated by WAF rule #42",
  expires: "2027-01-01",
  approved_by: "security-team",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runValidate — run-metrics jsonl", () => {
  it("valid jsonl file → ok=true, count matches line count", () => {
    const lines = [VALID_RUN_METRICS, { ...VALID_RUN_METRICS, run_id: "run-002" }]
      .map((r) => JSON.stringify(r))
      .join("\n");
    const p = write("runs.jsonl", lines + "\n");

    const res = runValidate({ schema: "run-metrics", filePath: p });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.count).toBe(2);
  });

  it("malformed record (missing required field) → ok=false, errors non-empty", () => {
    // Missing `lane` field — a required enum on run-metrics.
    const bad = { ...VALID_RUN_METRICS } as Record<string, unknown>;
    delete bad["lane"];
    const p = write("bad-runs.jsonl", JSON.stringify(bad) + "\n");

    const res = runValidate({ schema: "run-metrics", filePath: p });
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    // The error message should reference lane
    expect(res.errors.some((e) => e.includes("lane"))).toBe(true);
  });
});

describe("runValidate — registry-entry yaml with {vectors:[...]} wrapper", () => {
  it("unwraps {vectors:[...]} wrapper and validates each as registry-entry", () => {
    const doc = {
      vectors: [VALID_REGISTRY_ENTRY, { ...VALID_REGISTRY_ENTRY, id: "vec-002" }],
    };
    const yaml = `vectors:\n${doc.vectors
      .map(
        (e) =>
          `  - id: ${e.id}\n    title: ${e.title}\n    kind: ${e.kind}\n    area: ["${e.area[0]}"]\n    weight: ${e.weight}\n    interval_days: ${e.interval_days}\n    owner: ${e.owner}`,
      )
      .join("\n")}\n`;
    const p = write("vectors.yml", yaml);

    const res = runValidate({ schema: "registry-entry", filePath: p });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.count).toBe(2);
  });
});

describe("runValidate — suppression yaml with {suppressions:[...]} wrapper", () => {
  it("unwraps {suppressions:[...]} and validates each as suppression", () => {
    const yaml = `suppressions:\n  - dedupe_key:\n      surface: "app/auth/login.ts"\n      symptom: "SQL injection risk"\n      root_cause: "user input not sanitized"\n    reason: "mitigated by WAF rule #42"\n    expires: "2027-01-01"\n    approved_by: "security-team"\n`;
    const p = write("suppressions.yml", yaml);

    const res = runValidate({ schema: "suppression", filePath: p });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.count).toBe(1);
  });
});

describe("runValidate — missing file", () => {
  it("throws with 'file not found' when file does not exist", () => {
    const missing = join(dir, "does-not-exist.jsonl");
    expect(() => runValidate({ schema: "run-metrics", filePath: missing })).toThrow(
      /file not found/,
    );
  });
});

describe("runValidate — format inference and explicit override", () => {
  it("infers jsonl format from .jsonl extension", () => {
    const p = write("metrics.jsonl", JSON.stringify(VALID_RUN_METRICS) + "\n");
    const res = runValidate({ schema: "run-metrics", filePath: p });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(1);
  });

  it("infers yaml format from .yml extension", () => {
    const yaml = `id: vec-001\ntitle: Auth bypass check\nkind: vector\narea:\n  - app/auth/*\nweight: critical\ninterval_days: 7\nowner: security\n`;
    const p = write("entry.yml", yaml);
    const res = runValidate({ schema: "registry-entry", filePath: p });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(1);
  });

  it("explicit --format overrides extension (json content in a .dat file)", () => {
    // Write a valid run-metrics JSON to a file with a non-standard extension.
    const p = write("metrics.dat", JSON.stringify(VALID_RUN_METRICS));
    // Without explicit format the extension would default to json (the fallback),
    // but we explicitly pass format: "json" to confirm the override path is exercised.
    const res = runValidate({ schema: "run-metrics", filePath: p, format: "json" });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(1);
  });

  it("explicit format:jsonl on a .json-named file parses it as jsonl", () => {
    // A file named .json but containing NDJSON — explicit format wins.
    const p = write(
      "lines.json",
      JSON.stringify(VALID_RUN_METRICS) + "\n" + JSON.stringify({ ...VALID_RUN_METRICS, run_id: "run-003" }) + "\n",
    );
    const res = runValidate({ schema: "run-metrics", filePath: p, format: "jsonl" });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
  });
});
