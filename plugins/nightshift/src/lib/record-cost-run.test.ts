// Unit tests for record-cost-run (v3 A2 / T7). The load-bearing contract:
// status gates on `is_error` ONLY — the committed fixture of a real failed-run
// envelope carries subtype:"success" next to is_error:true, and this suite is
// the regression test that we never key on subtype.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCostRecord,
  buildManualCostRecord,
  runRecordCost,
  COSTS_FILENAME,
  type CostMeta,
} from "./record-cost-run.js";
import { readJson, readJsonl } from "./io.js";
import { runRollup } from "./rollup-cli.js";
import { validateCostRecord } from "./validate.js";
import type { CostRecord } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..", "..");
const ERROR_ENVELOPE = join(PLUGIN_ROOT, "fixtures", "cli-envelope-error.json");
const SUCCESS_ENVELOPE = join(PLUGIN_ROOT, "fixtures", "cli-envelope-success.json");
const NOVUDESK_PACK = join(PLUGIN_ROOT, "examples", "novudesk", ".nightshift");

const META: CostMeta = {
  runId: "ns-2026-06-21-sec-01",
  lane: "security",
  date: "2026-06-21",
  ts: "2026-06-21T07:00:00Z",
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-recordcost-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildCostRecord", () => {
  it("REGRESSION: the real failed-run envelope (is_error:true, subtype:'success') writes status:'error'", () => {
    const envelope = readJson(ERROR_ENVELOPE);
    // The fixture is the exact live envelope shape — subtype:"success" must be present
    // next to is_error:true or this regression test is not testing the trap.
    expect((envelope as Record<string, unknown>).subtype).toBe("success");
    expect((envelope as Record<string, unknown>).is_error).toBe(true);

    const record = buildCostRecord(envelope, META);
    expect(record.status).toBe("error");
    expect(record.terminal_reason).toBe("api_error");
    expect(record.usd).toBe(0);
    expect(record.source).toBe("cli-json");
    expect(validateCostRecord(record).ok).toBe(true);
  });

  it("never keys on subtype: is_error:false with a scary subtype is still status:'ok'", () => {
    const record = buildCostRecord(
      { is_error: false, subtype: "error_during_execution", total_cost_usd: 0.5 },
      META,
    );
    expect(record.status).toBe("ok");
    expect(record.terminal_reason).toBeUndefined();
    expect(record.usd).toBe(0.5);
  });

  it("maps the success envelope's usage fields onto the record", () => {
    const record = buildCostRecord(readJson(SUCCESS_ENVELOPE), META);
    expect(record).toMatchObject({
      run_id: META.runId,
      lane: "security",
      date: "2026-06-21",
      usd: 1.8421,
      input_tokens: 182034,
      output_tokens: 24110,
      cache_read_tokens: 1204882,
      cache_creation_tokens: 88213,
      source: "cli-json",
      status: "ok",
    });
    expect(validateCostRecord(record).ok).toBe(true);
  });

  it("throws when is_error is missing or non-boolean (no subtype fallback)", () => {
    expect(() => buildCostRecord({ subtype: "success", total_cost_usd: 1 }, META)).toThrow(
      /is_error/,
    );
    expect(() => buildCostRecord({ is_error: "false" }, META)).toThrow(/is_error/);
    expect(() => buildCostRecord(null, META)).toThrow(/not an object/);
    expect(() => buildCostRecord([], META)).toThrow(/not an object/);
  });

  it("defaults missing usage/cost fields to 0 and missing terminal_reason to 'unknown'", () => {
    const record = buildCostRecord({ is_error: true }, META);
    expect(record.usd).toBe(0);
    expect(record.input_tokens).toBe(0);
    expect(record.output_tokens).toBe(0);
    expect(record.cache_read_tokens).toBe(0);
    expect(record.cache_creation_tokens).toBe(0);
    expect(record.terminal_reason).toBe("unknown");
  });
});

describe("buildManualCostRecord", () => {
  it("writes source:'manual', status:'ok', with optional token fields defaulting to 0", () => {
    const record = buildManualCostRecord(META, 2.5, { output_tokens: 100 });
    expect(record.source).toBe("manual");
    expect(record.status).toBe("ok");
    expect(record.usd).toBe(2.5);
    expect(record.output_tokens).toBe(100);
    expect(record.input_tokens).toBe(0);
    expect(validateCostRecord(record).ok).toBe(true);
  });
});

describe("runRecordCost", () => {
  it("appends one validated line per call to metrics/costs.jsonl", () => {
    runRecordCost({ metricsDir: dir, meta: META, envelope: readJson(SUCCESS_ENVELOPE) });
    runRecordCost({
      metricsDir: dir,
      meta: { ...META, runId: "ns-2026-06-21-sec-02" },
      envelope: readJson(ERROR_ENVELOPE),
    });
    const lines = readJsonl<CostRecord>(join(dir, COSTS_FILENAME));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.status).toBe("ok");
    expect(lines[1]!.status).toBe("error");
    expect(lines.map((l) => validateCostRecord(l).ok)).toEqual([true, true]);
  });

  it("throws when given neither an envelope nor a manual usd", () => {
    expect(() => runRecordCost({ metricsDir: dir, meta: META })).toThrow(/envelope or a manual/);
  });
});

// ---------------------------------------------------------------------------
// A2 gate: round-trip on a NovuDesk copy including the cost join.
// Copy the example pack, append a fresh cost line via runRecordCost, run the
// real rollup, and assert the daily line carries cost fields joined from
// costs.jsonl (error row excluded from the per-run average).
// ---------------------------------------------------------------------------

describe("NovuDesk round-trip (cost join)", () => {
  it("rollup on the copied pack joins costs.jsonl into the daily line", () => {
    const pack = join(dir, ".nightshift");
    cpSync(NOVUDESK_PACK, pack, { recursive: true });
    const metricsDir = join(pack, "metrics");

    // Example costs.jsonl (security, as of 2026-06-18):
    //   06-10 ok 1.62 · 06-11 ok 1.91 · 06-16 ERROR 0 · 06-18 ok 1.44
    // Append today's run on top via the real writer.
    runRecordCost({
      metricsDir,
      meta: { runId: "ns-2026-06-18-sec-02", lane: "security", date: "2026-06-18", ts: "2026-06-18T09:00:00Z" },
      envelope: { is_error: false, subtype: "success", total_cost_usd: 0.53 },
    });

    const rollup = runRollup({
      registryPath: join(pack, "registries", "vectors.yml"),
      metricsDir,
      lane: "security",
      today: "2026-06-18",
      date: "2026-06-18",
      ts: "2026-06-18T09:00:01Z",
    });

    // 7d window 06-12..06-18: 0 (error) + 1.44 + 0.53
    expect(rollup.cost_usd_7d).toBeCloseTo(1.97, 4);
    // 30d window: all six security rows
    expect(rollup.cost_usd_30d).toBeCloseTo(1.62 + 1.91 + 0 + 1.44 + 0.53, 4);
    // avg excludes the 06-16 error row: (1.62+1.91+1.44+0.53)/4
    expect(rollup.cost_usd_avg_per_run_30d).toBeCloseTo(5.5 / 4, 4);

    // The appended daily line round-trips with the cost fields on disk.
    const daily = readJsonl<Record<string, unknown>>(join(metricsDir, "daily.jsonl"));
    const last = daily[daily.length - 1]!;
    expect(last.cost_usd_7d).toBeCloseTo(1.97, 4);
    expect(last.cost_usd_30d).toBeCloseTo(5.5, 4);
    expect(last.cost_usd_avg_per_run_30d).toBeCloseTo(1.375, 4);
  });

  it("design lane joins only design cost rows", () => {
    const pack = join(dir, ".nightshift");
    cpSync(NOVUDESK_PACK, pack, { recursive: true });
    const rollup = runRollup({
      registryPath: join(pack, "registries", "flows.yml"),
      metricsDir: join(pack, "metrics"),
      lane: "design",
      today: "2026-06-18",
      date: "2026-06-18",
      ts: "2026-06-18T09:00:01Z",
    });
    // design rows: 06-13 ok 1.14 (cli-json), 06-17 ok 1.02 (manual)
    expect(rollup.cost_usd_7d).toBeCloseTo(1.14 + 1.02, 4);
    expect(rollup.cost_usd_30d).toBeCloseTo(2.16, 4);
    expect(rollup.cost_usd_avg_per_run_30d).toBeCloseTo(1.08, 4);
  });
});
