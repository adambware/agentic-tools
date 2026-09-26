import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  collectFindings,
  formatReport,
  loadAnswerKey,
  parseLocations,
  runPlantedEval,
  scorePlanted,
  type AnswerKey,
  type ScoredFinding,
} from "./planted-eval.js";
import { runSelect } from "./select-run.js";
import { readYaml } from "./io.js";
import type { GitRunner } from "./git.js";

const PLUGIN_ROOT = join(__dirname, "..", "..");
const EVAL_DIR = join(PLUGIN_ROOT, "examples", "novudesk", "eval");
const KEY_PATH = join(EVAL_DIR, "answer-key.yml");
const TARGET = join(EVAL_DIR, "target");
const noGit: GitRunner = { changedFilesSince: () => [] };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-planted-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function finding(surface: string, location?: string, extra: Partial<ScoredFinding> = {}): Record<string, unknown> {
  return {
    dedupe_key: { surface, symptom: `s-${surface}-${location}`, root_cause: `r-${surface}-${location}` },
    severity: "high",
    confidence: "high",
    needs_human_verification: true,
    ...(location === undefined ? {} : { location }),
    ...extra,
  };
}

function asScored(raw: Record<string, unknown>[]): ScoredFinding[] {
  const p = join(dir, "c.json");
  writeFileSync(p, JSON.stringify(raw));
  return collectFindings(p);
}

function walk(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe("the shipped answer key and target stay in step", () => {
  const key = loadAnswerKey(KEY_PATH);

  it("points at the target directory next to it", () => {
    expect(key.target).toBe("target");
    expect(existsSync(TARGET)).toBe(true);
  });

  it("every planted line range lands on real, non-blank lines of an existing file", () => {
    for (const p of key.planted) {
      for (const loc of p.locations) {
        const file = join(TARGET, loc.file);
        expect(existsSync(file), `${p.id}: ${loc.file}`).toBe(true);
        const lines = readFileSync(file, "utf8").split("\n");
        expect(loc.lines[1], `${p.id}: ${loc.file} range past EOF`).toBeLessThanOrEqual(lines.length);
        const slice = lines.slice(loc.lines[0] - 1, loc.lines[1]);
        expect(slice.some((l) => l.trim() !== ""), `${p.id}: ${loc.file} range is blank`).toBe(true);
      }
    }
  });

  it("every clean file exists in the target", () => {
    for (const c of key.clean) for (const f of c.files) expect(existsSync(join(TARGET, f)), f).toBe(true);
  });

  it("every keyed vector is a security vector in the target registry, and every planted file is in its vector's area", () => {
    const doc = readYaml<{ vectors: { id: string; owner: string; area: string[] }[] }>(
      join(TARGET, ".nightshift", "registries", "vectors.yml"),
    )!;
    const byId = new Map(doc.vectors.map((v) => [v.id, v]));
    for (const v of [...key.planted.map((p) => p.vector), ...key.clean.map((c) => c.vector)]) {
      expect(byId.get(v)?.owner, v).toBe("security");
    }
    for (const p of key.planted) {
      const area = byId.get(p.vector)!.area;
      const primary = p.locations[0]!.file;
      const covered = area.some((g) =>
        g.endsWith("/**") ? primary.startsWith(g.slice(0, -2)) : g.endsWith("/*") ? primary.startsWith(g.slice(0, -1)) && !primary.slice(g.length - 1).includes("/") : g === primary,
      );
      expect(covered, `${p.id}: ${primary} not in ${p.vector} area`).toBe(true);
    }
  });

  it("the target never gives the answer away (no key, no eval vocabulary a reviewer could read)", () => {
    expect(existsSync(join(TARGET, "answer-key.yml"))).toBe(false);
    for (const file of walk(TARGET)) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const word of [/planted/, /answer.key/, /\bpv-\d/, /vulnerab/, /insecure/, /\beval/])
        expect(word.test(text), `${relative(TARGET, file)} matches ${word}`).toBe(false);
    }
  });

  it("one run reviews every keyed vector: bin/select picks all of them against the target pack", () => {
    const res = runSelect({
      vectorsPath: join(TARGET, ".nightshift", "registries", "vectors.yml"),
      manifestPath: join(TARGET, ".nightshift", "manifest.yml"),
      lane: "security",
      today: "2026-09-26",
      repo: TARGET,
      outPath: join(dir, "surfaces.json"),
      git: noGit,
    });
    const selected = new Set(res.surfaces.map((s) => s.id));
    for (const v of [...key.planted.map((p) => p.vector), ...key.clean.map((c) => c.vector)])
      expect(selected.has(v), v).toBe(true);
  });
});

describe("loadAnswerKey validation", () => {
  function keyFile(body: string): string {
    const p = join(dir, "key.yml");
    writeFileSync(p, body);
    return p;
  }
  const PLANTED = `planted:
  - id: P1
    vector: V1
    class: c
    summary: s
    locations:
      - file: a.rb
        lines: [2, 3]
`;

  it("accepts a minimal key", () => {
    const k = loadAnswerKey(keyFile(`key_format: 1\ntarget: t\n${PLANTED}clean: []\n`));
    expect(k.planted[0]!.locations[0]!.lines).toEqual([2, 3]);
  });

  it.each([
    ["missing file", null],
    ["wrong format", `key_format: 2\ntarget: t\n${PLANTED}clean: []\n`],
    ["no planted", `key_format: 1\ntarget: t\nplanted: []\nclean: []\n`],
    ["inverted range", `key_format: 1\ntarget: t\n${PLANTED.replace("[2, 3]", "[3, 2]")}clean: []\n`],
    ["zero line", `key_format: 1\ntarget: t\n${PLANTED.replace("[2, 3]", "[0, 2]")}clean: []\n`],
    ["duplicate id", `key_format: 1\ntarget: t\n${PLANTED}${PLANTED.replace("planted:\n", "")}clean: []\n`],
    ["vector both planted and clean", `key_format: 1\ntarget: t\n${PLANTED}clean:\n  - vector: V1\n    files: [b.rb]\n`],
    ["file both planted and clean", `key_format: 1\ntarget: t\n${PLANTED}clean:\n  - vector: V2\n    files: [a.rb]\n`],
  ])("rejects %s", (_name, body) => {
    const p = body === null ? join(dir, "absent.yml") : keyFile(body);
    expect(() => loadAnswerKey(p)).toThrow(/answer key/);
  });
});

describe("parseLocations", () => {
  it("reads the shapes reviewers actually write", () => {
    expect(parseLocations("app/controllers/tickets_controller.rb:88 (GET /tickets/{id})")).toEqual([
      { file: "app/controllers/tickets_controller.rb", line: 88 },
    ]);
    expect(parseLocations("./app/a.rb:3, app/b.rb:9-12")).toEqual([
      { file: "app/a.rb", line: 3 },
      { file: "app/b.rb", line: 9, lineEnd: 12 },
    ]);
    expect(parseLocations("app/x.rb#show")).toEqual([{ file: "app/x.rb" }]);
    expect(parseLocations("ASVS 4.0.3 V4.2 — TicketsController#show")).toEqual([]);
    expect(parseLocations(undefined)).toEqual([]);
  });
});

describe("scorePlanted against the shipped key", () => {
  const key: AnswerKey = loadAnswerKey(KEY_PATH);

  it("a run that logs nothing catches nothing and has no false positives", () => {
    const r = scorePlanted(key, []);
    expect(r).toMatchObject({ gating: false, planted_total: 4, caught: 0, false_positives_on_clean: 0, findings_scanned: 0 });
    expect(r.planted.every((p) => !p.caught)).toBe(true);
  });

  it("a perfect run catches 4/4 with zero false positives on clean", () => {
    const r = scorePlanted(
      key,
      asScored([
        finding("ASVS-INPV-04", "app/queries/ticket_search_query.rb:14"),
        finding("ND-SEC-03", "app/controllers/webhook_monitors_controller.rb:7 (POST /webhook_monitors)"),
        finding("ND-SEC-05", "app/controllers/tickets_controller.rb:7 (GET /tickets/{id})"),
        finding("ND-SEC-06", "app/controllers/concerns/verify_webhook_signature.rb:14"),
      ]),
    );
    expect(r.caught).toBe(4);
    expect(r.false_positives_on_clean).toBe(0);
    expect(r.other_findings).toBe(0);
  });

  it("a catch is by location, so a finding filed under a neighbouring vector still counts", () => {
    const r = scorePlanted(key, asScored([finding("ASVS-INPV-04", "app/controllers/tickets_controller.rb:7")]));
    expect(r.planted.find((p) => p.id === "PV-03")!.caught).toBe(true);
  });

  it("the right file but a line far from the planted range is not a catch", () => {
    const r = scorePlanted(key, asScored([finding("ND-SEC-05", "app/controllers/tickets_controller.rb:24")]));
    expect(r.caught).toBe(0);
    expect(r.other_findings).toBe(1);
  });

  it("line slack is honoured and configurable", () => {
    const f = asScored([finding("ND-SEC-05", "app/controllers/tickets_controller.rb:12")]); // range 6-9
    expect(scorePlanted(key, f).caught).toBe(1);
    expect(scorePlanted(key, f, { slack: 0 }).caught).toBe(0);
  });

  it("a line-less citation of the planted file counts only under the planted vector", () => {
    expect(scorePlanted(key, asScored([finding("ND-SEC-06", "app/controllers/concerns/verify_webhook_signature.rb")])).caught).toBe(1);
    expect(scorePlanted(key, asScored([finding("ASVS-INPV-04", "app/controllers/concerns/verify_webhook_signature.rb")])).caught).toBe(0);
  });

  it("the right vector with no usable location is not a catch", () => {
    const r = scorePlanted(key, asScored([finding("ND-SEC-03", "SSRF in the monitor fetcher")]));
    expect(r.caught).toBe(0);
  });

  it("counts false positives on clean by surface and by cited clean file", () => {
    const r = scorePlanted(
      key,
      asScored([
        finding("ND-SEC-01", "app/models/integration_token.rb:4"),
        finding("ND-SEC-07", undefined),
        finding("ASVS-INPV-04", "app/services/dispatch/command_signer.rb:22"),
      ]),
    );
    expect(r.false_positives_on_clean).toBe(3);
    expect(r.clean_controls_with_fp).toBe(3);
    expect(r.clean.map((c) => c.false_positives)).toEqual([1, 1, 1]);
    expect(r.caught).toBe(0);
  });

  it("duplicate records (a recurring finding logged twice) count once", () => {
    const f = finding("ND-SEC-01", "app/models/integration_token.rb:4");
    const r = scorePlanted(key, asScored([f, f]));
    expect(r.false_positives_on_clean).toBe(1);
    expect(r.findings_scanned).toBe(1);
  });

  it("--run-id scopes scoring to one run", () => {
    const all = asScored([
      finding("ND-SEC-05", "app/controllers/tickets_controller.rb:7", { run_id: "r1" }),
      finding("ND-SEC-01", "app/models/integration_token.rb:4", { run_id: "r2" }),
    ]);
    const r1 = scorePlanted(key, all, { runId: "r1" });
    expect(r1).toMatchObject({ caught: 1, false_positives_on_clean: 0, findings_scanned: 1 });
    const r2 = scorePlanted(key, all, { runId: "r2" });
    expect(r2).toMatchObject({ caught: 0, false_positives_on_clean: 1, findings_scanned: 1 });
  });

  it("formatReport names the misses and states it never gates", () => {
    const text = formatReport(scorePlanted(key, asScored([finding("ND-SEC-05", "app/controllers/tickets_controller.rb:7")])));
    expect(text).toContain("never gates");
    expect(text).toContain("caught: 1/4 planted");
    expect(text).toContain("[x] PV-03");
    expect(text).toMatch(/\[ \] PV-02 ND-SEC-03 ssrf\s+<- missed/);
    expect(text).toContain("false positives on clean: 0 finding(s) across 0/3 control(s)");
  });
});

describe("collectFindings / runPlantedEval", () => {
  it("reads a findings dir recursively, mixing jsonl + json and skipping non-finding JSON", () => {
    const findingsDir = join(dir, "metrics", "findings");
    mkdirSync(join(dir, "run"), { recursive: true });
    mkdirSync(findingsDir, { recursive: true });
    writeFileSync(
      join(findingsDir, "2026-09.jsonl"),
      `${JSON.stringify(finding("ND-SEC-05", "app/controllers/tickets_controller.rb:7"))}\n\n`,
    );
    writeFileSync(join(dir, "run", "reviewed.json"), JSON.stringify(["ND-SEC-05"]));
    writeFileSync(join(dir, "run", "surfaces.json"), JSON.stringify([{ id: "ND-SEC-05", band: "critical" }]));
    writeFileSync(join(dir, "run", "candidates.tier2.json"), JSON.stringify([finding("ASVS-INPV-04", "app/queries/ticket_search_query.rb:14")]));
    writeFileSync(join(dir, "notes.txt"), "not json");
    const r = runPlantedEval({ keyPath: KEY_PATH, findingsPath: dir });
    expect(r.caught).toBe(2);
    expect(r.findings_scanned).toBe(2);
  });

  it("a run dir scores only what survived both refuter tiers, never pre-refutation candidates", () => {
    const run = join(dir, "run");
    mkdirSync(join(run, "surfaces", "ND-SEC-03"), { recursive: true });
    const ssrf = finding("ND-SEC-03", "app/services/webhooks/url_fetcher.rb:12");
    const webhook = finding("ND-SEC-06", "app/controllers/concerns/verify_webhook_signature.rb:14");
    // The reviewer proposed both; Tier-1 kept both; Tier-2 killed the SSRF.
    writeFileSync(join(run, "candidates.proposed.json"), JSON.stringify([ssrf, webhook]));
    writeFileSync(join(run, "candidates.json"), JSON.stringify([ssrf, webhook]));
    writeFileSync(join(run, "surfaces", "ND-SEC-03", "candidates.proposed.json"), JSON.stringify([ssrf]));
    writeFileSync(join(run, "surfaces", "ND-SEC-03", "candidates.json"), JSON.stringify([ssrf]));
    writeFileSync(join(run, "surfaces", "ND-SEC-03", "tier2.pending.json"), JSON.stringify([ssrf]));
    writeFileSync(join(run, "surfaces", "ND-SEC-03", "tier2.survivors.json"), JSON.stringify([]));
    writeFileSync(join(run, "candidates.tier2.json"), JSON.stringify([webhook]));
    const r = runPlantedEval({ keyPath: KEY_PATH, findingsPath: run });
    expect(r.planted.filter((p) => p.caught).map((p) => p.id)).toEqual(["PV-04"]);
    expect(r.findings_scanned).toBe(1);
    // Naming a pre-final file explicitly still reads it.
    expect(runPlantedEval({ keyPath: KEY_PATH, findingsPath: join(run, "candidates.proposed.json") }).caught).toBe(2);
  });

  it("an empty findings dir (a clean run) scores 0/4, it does not error", () => {
    mkdirSync(join(dir, "empty"));
    expect(runPlantedEval({ keyPath: KEY_PATH, findingsPath: join(dir, "empty") }).caught).toBe(0);
  });

  it("errors on a missing path or malformed JSONL rather than reporting a silent 0", () => {
    expect(() => collectFindings(join(dir, "nope"))).toThrow(/not found/);
    const bad = join(dir, "bad.jsonl");
    writeFileSync(bad, "{not json}\n");
    expect(() => collectFindings(bad)).toThrow(/malformed JSONL/);
  });
});
