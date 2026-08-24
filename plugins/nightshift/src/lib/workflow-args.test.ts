// Full-branch tests for buildWorkflowArgs (A7 / T11), plus the invariant that
// actually matters at 3am: the object this module emits and the object
// nightshift.workflow.js reads are the SAME SHAPE, asserted by scanning the
// workflow's own source rather than by restating it here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkflowArgs, chunk, type WorkflowArgs } from "./workflow-args.js";
import type { LanePlan } from "./lane-plan.js";
import type { Lane, Surface } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..", "..");
const WORKFLOW_PATH = join(PLUGIN_ROOT, "nightshift.workflow.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function surface(id: string, over: Partial<Surface> = {}): Surface {
  return {
    id,
    title: `T ${id}`,
    weight: "high",
    area: [`app/${id}/*`],
    staleness: 2,
    change_flag: 0,
    score: 8,
    band: "high",
    dispatch: { model: "opus", effort: "high", maxTurns: 24 },
    ...over,
  };
}

const SECURITY_PLAN: LanePlan = {
  lane: "security",
  registry: ".nightshift/registries/vectors.yml",
  agents: {
    reviewer: "security-reviewer",
    refuter_tier1: "security-refuter",
    refuter_tier2: "security-refuter-2",
  },
};

const DESIGN_PLAN: LanePlan = {
  lane: "design",
  registry: ".nightshift/registries/flows.yml",
  agents: {
    reviewer: "ux-reviewer-playwright",
    refuter_tier1: "ux-refuter",
    refuter_tier2: "ux-refuter-2",
  },
  browser: { tool: "playwright-mcp", base_url: "http://localhost:3000", environment: "local" },
  personas: ".nightshift/fixtures/personas.yml",
};

const RUN_ID = "20260823T010203Z-security-deadbeef";

function build(over: Partial<Parameters<typeof buildWorkflowArgs>[0]> = {}) {
  return buildWorkflowArgs({
    runId: RUN_ID,
    lanePlan: SECURITY_PLAN,
    surfaces: [surface("V-01")],
    maxConcurrentReviewers: 3,
    ...over,
  });
}

/** Narrow to the ok case or fail the test with the reason. */
function okArgs(res: ReturnType<typeof buildWorkflowArgs>): WorkflowArgs {
  if (!res.ok) throw new Error(`expected ok, got refusal: ${res.reason}`);
  return res.args;
}

// ---------------------------------------------------------------------------
// chunk()
// ---------------------------------------------------------------------------

describe("chunk", () => {
  it("K=6 with cap 3 produces exactly two chunks of three (T11's stated verify)", () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("leaves a short final chunk rather than padding or dropping", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("cap >= size is a single chunk", () => {
    expect(chunk([1, 2], 9)).toEqual([[1, 2]]);
  });

  it("cap 1 serializes completely", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("empty input yields no chunks (never one empty chunk)", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("preserves order — chunk 0 holds the highest-scoring surfaces", () => {
    const flat = chunk(["a", "b", "c", "d", "e"], 2).flat();
    expect(flat).toEqual(["a", "b", "c", "d", "e"]);
  });
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("buildWorkflowArgs happy paths", () => {
  it("emits exactly the five keys the workflow reads, and nothing else", () => {
    const args = okArgs(build());
    expect(Object.keys(args).sort()).toEqual([
      "agents",
      "lane",
      "registry",
      "run_id",
      "surface_chunks",
    ]);
  });

  it("carries run_id, lane, registry and the three agentTypes through verbatim", () => {
    const args = okArgs(build());
    expect(args.run_id).toBe(RUN_ID);
    expect(args.lane).toBe("security");
    expect(args.registry).toBe(".nightshift/registries/vectors.yml");
    expect(args.agents).toEqual({
      reviewer: "security-reviewer",
      refuter_tier1: "security-refuter",
      refuter_tier2: "security-refuter-2",
    });
  });

  it("chunks 6 surfaces at cap 3 into 2 chunks, order preserved", () => {
    const surfaces = ["V-01", "V-02", "V-03", "V-04", "V-05", "V-06"].map((id) => surface(id));
    const res = build({ surfaces, maxConcurrentReviewers: 3 });
    const args = okArgs(res);
    expect(args.surface_chunks).toHaveLength(2);
    expect(args.surface_chunks[0]!.map((s) => s.id)).toEqual(["V-01", "V-02", "V-03"]);
    expect(args.surface_chunks[1]!.map((s) => s.id)).toEqual(["V-04", "V-05", "V-06"]);
    if (res.ok) expect(res.chunks).toBe(2);
  });

  it("every chunked surface still carries the id and dispatch the workflow spreads", () => {
    const args = okArgs(build({ surfaces: [surface("V-01"), surface("V-02")] }));
    for (const s of args.surface_chunks.flat()) {
      expect(typeof s.id).toBe("string");
      expect(s.dispatch).toEqual({ model: "opus", effort: "high", maxTurns: 24 });
    }
  });

  it("the design lane's browser/personas are NOT spliced in (the workflow consumes neither)", () => {
    const args = okArgs(build({ lanePlan: DESIGN_PLAN }));
    expect(args).not.toHaveProperty("browser");
    expect(args).not.toHaveProperty("personas");
    expect(args.lane).toBe("design");
    expect(args.agents.reviewer).toBe("ux-reviewer-playwright");
    expect(args.registry).toBe(".nightshift/registries/flows.yml");
  });
});

// ---------------------------------------------------------------------------
// "Nothing to review" is its own outcome, not a failure
// ---------------------------------------------------------------------------

describe("buildWorkflowArgs: zero surfaces", () => {
  it("returns kind:'nothing-to-review', never a refusal", () => {
    const res = build({ surfaces: [] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("nothing-to-review");
    expect(res.reason).toMatch(/quiet night, not a failure/);
  });
});

// ---------------------------------------------------------------------------
// Refusals — one per branch
// ---------------------------------------------------------------------------

describe("buildWorkflowArgs refuses an incomplete or unsafe lane plan", () => {
  // These matter because `undefined` does not survive JSON.stringify: an
  // unvalidated plan does not produce a broken args.json, it produces one that
  // is silently MISSING keys — and the workflow then interpolates the literal
  // text "undefined" into a record/rollup command line, or dispatches every
  // reviewer to an agentType nobody has, mid-run, after the models were billed.

  function planWithout(key: keyof LanePlan): LanePlan {
    const plan = JSON.parse(JSON.stringify(SECURITY_PLAN)) as LanePlan;
    delete (plan as unknown as Record<string, unknown>)[key];
    return plan;
  }

  it("refuses a plan that is not an object", () => {
    const res = build({ lanePlan: null as unknown as LanePlan });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/did not parse to an object/);
  });

  it("refuses a plan with no lane (the workflow would run `--lane undefined`)", () => {
    const res = build({ lanePlan: planWithout("lane") });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/expected "security" or "design"/);
  });

  it("refuses an unknown lane", () => {
    const res = build({ lanePlan: { ...SECURITY_PLAN, lane: "opportunities" as Lane } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/expected "security" or "design"/);
  });

  it("refuses a plan with no registry (record/rollup would stamp `--registry undefined`)", () => {
    const res = build({ lanePlan: planWithout("registry") });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/has no `registry`/);
  });

  for (const bad of [
    ".nightshift; touch /tmp/pwned/registries/vectors.yml",
    ".nightshift/$(id)/registries/vectors.yml",
    ".nightshift/reg istries/vectors.yml",
    ".nightshift/registries/vectors.yml\nrm -rf /",
    '.nightshift/"x"/vectors.yml',
    ".nightshift/`id`/vectors.yml",
  ]) {
    it(`refuses a registry carrying shell syntax: ${JSON.stringify(bad)}`, () => {
      // The workflow interpolates the registry UNQUOTED into the record and
      // rollup command lines, so this is command injection, not a bad path.
      const res = build({ lanePlan: { ...SECURITY_PLAN, registry: bad } });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/is not a plain path/);
    });
  }

  it("still accepts the ordinary repo-root-relative registry `ns` produces", () => {
    expect(build({ lanePlan: { ...SECURITY_PLAN, registry: ".nightshift/registries/flows.yml" } }).ok)
      .toBe(true);
  });

  it("refuses a plan with no agents object", () => {
    const res = build({ lanePlan: planWithout("agents") });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no `agents` object/);
  });

  for (const role of ["reviewer", "refuter_tier1", "refuter_tier2"] as const) {
    it(`refuses a plan missing agents.${role}`, () => {
      const agents = { ...SECURITY_PLAN.agents };
      delete (agents as unknown as Record<string, unknown>)[role];
      const res = build({ lanePlan: { ...SECURITY_PLAN, agents: agents as LanePlan["agents"] } });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(new RegExp(`no \\\`agents\\.${role}\\\``));
    });

    it(`refuses an unsafe agent id in agents.${role}`, () => {
      const res = build({
        lanePlan: {
          ...SECURITY_PLAN,
          agents: { ...SECURITY_PLAN.agents, [role]: "../../etc/passwd" } as LanePlan["agents"],
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/is not a safe agent id/);
    });
  }
});

describe("buildWorkflowArgs refusals", () => {
  for (const bad of ["", "..", ".", "a/b", "a b", "run id", "../escape"]) {
    it(`refuses run_id ${JSON.stringify(bad)}`, () => {
      const res = build({ runId: bad });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe("refuse");
    });
  }

  it("accepts the run id shape `ns` actually mints", () => {
    expect(build({ runId: "20260823T010203Z-design-0a1b2c3d" }).ok).toBe(true);
  });

  for (const bad of [0, -1, 1.5, Number.NaN]) {
    it(`refuses max_concurrent_reviewers ${String(bad)}`, () => {
      const res = build({ maxConcurrentReviewers: bad });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/max_concurrent_reviewers must be an integer >= 1/);
    });
  }

  it("refuses a surfaces value that is not an array", () => {
    const res = build({ surfaces: { id: "V-01" } as unknown as Surface[] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/did not parse to an array/);
  });

  it("refuses a non-object surface entry", () => {
    const res = build({ surfaces: ["V-01"] as unknown as Surface[] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/non-object entry/);
  });

  it("refuses a surface with no id", () => {
    const s = surface("V-01");
    delete (s as Partial<Surface>).id;
    const res = build({ surfaces: [s] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/has no `id`/);
  });

  it("refuses a surface id that would escape the run dir", () => {
    const res = build({ surfaces: [surface("../../etc")] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not filename-safe/);
  });

  it("refuses duplicate surface ids — two reviewers would race on one artifact path", () => {
    const res = build({ surfaces: [surface("V-01"), surface("V-01")] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/appears twice/);
  });

  it("refuses a surface with no dispatch rather than silently reviewing at harness defaults", () => {
    const s = surface("V-01");
    delete s.dispatch;
    const res = build({ surfaces: [s] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/has no `dispatch`/);
  });

  it("refuses a dispatch with a blank model", () => {
    const res = build({
      surfaces: [surface("V-01", { dispatch: { model: "", effort: "high", maxTurns: 8 } })],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no `model`/);
  });

  it("refuses a dispatch with an out-of-enum effort", () => {
    const res = build({
      surfaces: [
        surface("V-01", {
          dispatch: { model: "opus", effort: "max" as unknown as "high", maxTurns: 8 },
        }),
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/dispatch\.effort/);
  });

  for (const key of ["agentType", "label", "phase", "isolation"]) {
    it(`refuses a dispatch carrying "${key}" — spread LAST, it would override the shell's own option`, () => {
      const res = build({
        surfaces: [
          surface("V-01", {
            dispatch: {
              model: "opus",
              effort: "high",
              maxTurns: 8,
              [key]: "hijacked",
            } as unknown as Surface["dispatch"],
          }),
        ],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/outside \{model, effort, maxTurns\}/);
    });
  }

  for (const turns of [0, -3, 2.5]) {
    it(`refuses maxTurns ${turns}`, () => {
      const res = build({
        surfaces: [surface("V-01", { dispatch: { model: "opus", effort: "high", maxTurns: turns } })],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/dispatch\.maxTurns/);
    });
  }
});

// ---------------------------------------------------------------------------
// KEY PARITY WITH THE SHELL — the invariant this module exists to protect.
//
// The workflow can never validate its own args (no fs, no process, no
// conditionals), so a renamed key does not fail there: it evaluates to
// `undefined` and silently becomes the string "undefined" inside an
// interpolated shell command, or an agentType nobody has, MID-RUN, after the
// models are billed. These tests read nightshift.workflow.js off disk and match
// the two sides against each other, so the rename fails at `npm test` instead.
// ---------------------------------------------------------------------------

describe("emitted args match nightshift.workflow.js key-for-key", () => {
  const workflowRaw = readFileSync(WORKFLOW_PATH, "utf8");

  // Scan CODE only, never comments or literal text: the file's ARGS CONTRACT
  // header spells out `args = { run_id: ..., lane: ... }` in PROSE, so a raw
  // scan would "find" keys the shell does not actually read and pass vacuously.
  //
  // Template literals are the subtle part. `${args.run_id}` inside a backtick
  // string IS code — it is how the run id reaches every interpolated bin/
  // command — while the surrounding prompt text is not. So backticks keep their
  // ${...} expressions (brace-depth tracked, nested quotes skipped) and drop
  // everything else; plain quotes are dropped whole.
  function stripCommentsAndStrings(src: string): string {
    let out = "";
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      // Block comments must be skipped BEFORE the quote branch. The workflow
      // uses none today, but one ordinary `/* it's fine */` would otherwise open
      // a bogus single-quote scan that swallows the following code — deleting a
      // real args read from the scan and reddening the build with a message
      // blaming this module instead of the comment.
      if (ch === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i += 2;
        out += " ";
        continue;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === "\\") i++;
          i++;
        }
        i++;
        out += " ";
        continue;
      }
      if (ch === "`") {
        i++;
        while (i < src.length && src[i] !== "`") {
          if (src[i] === "\\") {
            i += 2;
            continue;
          }
          if (src[i] === "$" && src[i + 1] === "{") {
            i += 2;
            let depth = 1;
            while (i < src.length && depth > 0) {
              const c = src[i];
              if (c === "{") depth++;
              else if (c === "}") depth--;
              else if (c === '"' || c === "'" || c === "`") {
                const q = c;
                i++;
                while (i < src.length && src[i] !== q) {
                  if (src[i] === "\\") i++;
                  i++;
                }
              }
              if (depth > 0) out += src[i];
              i++;
            }
            out += " ";
            continue;
          }
          i++;
        }
        i++;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  const code = stripCommentsAndStrings(workflowRaw);
  const topLevelKeys = new Set([...code.matchAll(/\bargs\.([A-Za-z_]\w*)/g)].map((m) => m[1]!));
  const agentKeys = new Set(
    [...code.matchAll(/\bargs\.agents\.([A-Za-z_]\w*)/g)].map((m) => m[1]!),
  );

  it("the scan is not vacuous — it found args reads in the workflow's CODE", () => {
    expect(topLevelKeys.size).toBeGreaterThan(0);
    expect(agentKeys.size).toBeGreaterThan(0);
    // And it is really scanning code: the prose header mentions `browser` and
    // `personas` as args the workflow deliberately does NOT consume, so those
    // must be absent from a code-only scan.
    expect(workflowRaw).toContain("personas");
    expect(topLevelKeys.has("personas")).toBe(false);
    expect(topLevelKeys.has("browser")).toBe(false);
  });

  it("every top-level key the workflow reads is emitted", () => {
    const args = okArgs(build()) as unknown as Record<string, unknown>;
    // `agents` is read both bare and as args.agents.<role>; both resolve here.
    for (const key of topLevelKeys) {
      expect(Object.hasOwn(args, key)).toBe(true);
    }
  });

  it("every key emitted is one the workflow actually reads (no dead payload)", () => {
    const args = okArgs(build());
    for (const key of Object.keys(args)) {
      expect([...topLevelKeys]).toContain(key);
    }
  });

  it("every args.agents.<role> the workflow dispatches is emitted", () => {
    const args = okArgs(build());
    for (const role of agentKeys) {
      expect(Object.hasOwn(args.agents, role)).toBe(true);
      expect(typeof (args.agents as Record<string, unknown>)[role]).toBe("string");
    }
  });

  it("emits no agents role the workflow never dispatches", () => {
    const args = okArgs(build());
    for (const role of Object.keys(args.agents)) {
      expect([...agentKeys]).toContain(role);
    }
  });

  // The scanner only sees `args.<name>`. A workflow that read its args by
  // DESTRUCTURING, by bracket access, or through a computed key would be
  // invisible to it — and every assertion above would pass while the shell read
  // three keys nobody emits. The real file uses none of those today; this test
  // is what makes that a checked fact rather than a lucky one, and it fails the
  // build the moment somebody introduces one.
  it("the workflow does not read args in a form the scanner cannot see", () => {
    const patterns: { label: string; re: RegExp }[] = [
      { label: 'bracket access, e.g. args["run_id"]', re: /\bargs\s*\[/ },
      { label: "destructuring, e.g. const { run_id } = args", re: /\{[^}]*\}\s*=\s*args\b/ },
      { label: "aliasing, e.g. const a = args", re: /=\s*args\s*[;,)]/ },
    ];
    for (const { label, re } of patterns) {
      expect(
        re.test(code),
        `nightshift.workflow.js reads args via ${label}, which the key-parity scan above ` +
          `cannot see — either rewrite it as a plain args.<name> read, or teach the scanner ` +
          `this form before relying on it`,
      ).toBe(false);
    }
  });

  it("the stripper skips block comments (a `/* it's fine */` must not swallow the code after it)", () => {
    const snippet = "const A = args.alpha;\n/* it's a note */\nconst B = args.beta;";
    const stripped = stripCommentsAndStrings(snippet);
    expect(stripped).toContain("args.alpha");
    expect(stripped).toContain("args.beta");
    expect(stripped).not.toContain("note");
  });

  it("those blind-spot patterns really do match the forms they name (sanity — not vacuous)", () => {
    expect(/\bargs\s*\[/.test('const x = args["run_id"];')).toBe(true);
    expect(/\{[^}]*\}\s*=\s*args\b/.test("const { run_id, lane } = args;")).toBe(true);
    expect(/=\s*args\s*[;,)]/.test("const a = args;")).toBe(true);
    // ...and do NOT match the plain form the workflow actually uses.
    expect(/\bargs\s*\[/.test("const r = args.registry;")).toBe(false);
    expect(/\{[^}]*\}\s*=\s*args\b/.test("const r = args.registry;")).toBe(false);
    expect(/=\s*args\s*[;,)]/.test("const r = args.registry;")).toBe(false);
  });

  it("the workflow iterates surface_chunks (so chunking really is the concurrency policy)", () => {
    expect(code).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+args\.surface_chunks\s*\)/);
  });

  it("the workflow spreads each surface's dispatch, which is why a missing one is refused here", () => {
    expect(code).toMatch(/\.\.\.\w+\.dispatch/);
  });
});
