// Invariant tests for A5 (nightshift v3): make two prose rules executable so
// they cannot silently regress.
//
//   (A) THIN SHELL (CONTRACTS.md E4) — nightshift.workflow.js carries zero
//       decision logic; every branch lives in a vitest-covered bin/ command.
//   (B) NO TOOLS-AT-DISPATCH + LANE PARAMETERIZATION (CONTRACTS.md E4 amendment
//       + src/lib/lane-plan.ts) — no dispatch API accepts a tools list, so a
//       subagent's tools come from its agent-file frontmatter ONLY; the lane
//       (registry file, three judgment agentTypes) is data threaded through
//       `args`, never a lane conditional baked into the shell.
//
// Everything here reads the repo's OWN source files off disk — it is not a
// unit test of a pure function, it is a structural assertion about the shell,
// the agent files, and the lane-plan tables staying honest with each other.
//
// A note on the scanners below: they are plain-text heuristics, not a real JS
// or YAML-frontmatter parser. Each one is deliberately verified against a
// synthetic snippet that SHOULD trip it, inline in this file, precisely so a
// scanner that can only ever pass (because it never actually matches
// anything) gets caught here instead of shipping silently green.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { AGENTS_BY_LANE, UX_REVIEWER_BY_ADAPTER } from "./lane-plan.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// <plugin-root>/src/lib -> <plugin-root>, same pattern as lane-plan.test.ts.
const PLUGIN_ROOT = join(__dirname, "..", "..");
const WORKFLOW_PATH = join(PLUGIN_ROOT, "nightshift.workflow.js");
const AGENTS_DIR = join(PLUGIN_ROOT, "agents");
const SRC_DIR = join(PLUGIN_ROOT, "src");

const workflowRaw = readFileSync(WORKFLOW_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────
// Shared helper: strip everything that is DATA, not CODE, out of the
// workflow source before scanning for control-flow keywords/operators.
//
// The workflow's job is to assemble prompt STRINGS for plumbing/judgment
// agents to run; those strings legitimately contain shell `&&`, the words
// "if"/"else"/"try", etc. (e.g. "Run exactly this... and nothing else",
// which contains the substring "else"; the chained bin/ commands joined with
// `&&`). None of that is JS control flow — it is a template-literal payload
// the sandbox never executes. The file's own header comments ALSO use words
// like "if"/"switch"/"try" to DESCRIBE the very rule this test enforces, so
// comments must go too, or the scanner would trip on its own documentation.
//
// This is a plain left-to-right character scanner, not a JS tokenizer: it
// only understands backtick/quote strings and `//` line comments (the only
// two things nightshift.workflow.js actually uses). It does not understand
// `/* */` block comments or regex literals — the workflow file contains
// neither, verified below by asserting stripCodeOnly is not a no-op AND that
// it removes every one of the raw file's control-flow-shaped substrings.
function stripCodeOnly(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === "`" || ch === '"' || ch === "'") {
      const quote = ch;
      out += quote + quote; // keep a token boundary; discard the payload
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++; // skip escaped char (don't misread \` as close)
        i++;
      }
      i++; // consume closing quote
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Detects a ternary `?:` while explicitly allowing `??` (nullish, separately
// banned below) and `?.` (optional chaining — not in the E4 ban list).
function hasBareTernaryQuestionMark(code: string): boolean {
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== "?") continue;
    if (code[i - 1] === "?") continue; // second char of a `??` already seen
    if (code[i + 1] === "?") continue; // first char of a `??`
    if (code[i + 1] === ".") continue; // optional chaining, not banned here
    return true;
  }
  return false;
}

const strippedWorkflow = stripCodeOnly(workflowRaw);

describe("scanner sanity (not vacuous)", () => {
  // Proves stripCodeOnly actually does something on THIS file, and that the
  // raw file really does contain the control-flow-shaped substrings the
  // stripper is responsible for removing — otherwise "zero matches after
  // stripping" would be true for the trivial, useless reason that there was
  // never anything to strip.
  it("the raw workflow file contains && (inside chained shell commands) that stripping removes", () => {
    expect(workflowRaw).toContain("&&");
    expect(strippedWorkflow).not.toContain("&&");
  });

  it('the raw workflow file contains the word "else" (inside prompt text / a comment) that stripping removes', () => {
    expect(/\belse\b/.test(workflowRaw)).toBe(true);
    expect(/\belse\b/.test(strippedWorkflow)).toBe(false);
  });

  it('the raw workflow file contains the word "if" (inside prompt text / a comment) that stripping removes', () => {
    expect(/\bif\b/.test(workflowRaw)).toBe(true);
    expect(/\bif\b/.test(strippedWorkflow)).toBe(false);
  });

  it("hasBareTernaryQuestionMark flags a synthetic ternary but not ?? or ?.", () => {
    expect(hasBareTernaryQuestionMark("const x = cond ? a : b;")).toBe(true);
    expect(hasBareTernaryQuestionMark("const x = a ?? b;")).toBe(false);
    expect(hasBareTernaryQuestionMark("const x = a?.b;")).toBe(false);
  });
});

describe("nightshift.workflow.js is a thin shell (CONTRACTS.md E4)", () => {
  it("has no `if` statement", () => {
    expect(strippedWorkflow).not.toMatch(/\bif\s*\(/);
  });

  it("has no `else`", () => {
    expect(strippedWorkflow).not.toMatch(/\belse\b/);
  });

  it("has no `switch` statement", () => {
    expect(strippedWorkflow).not.toMatch(/\bswitch\s*\(/);
  });

  it("has no bare ternary `?:` (?? and ?. are checked separately)", () => {
    expect(hasBareTernaryQuestionMark(strippedWorkflow)).toBe(false);
  });

  it("has no `??` (nullish coalescing)", () => {
    expect(strippedWorkflow).not.toContain("??");
  });

  it("has no `&&` used as JS control flow (template-literal shell `&&` is stripped)", () => {
    expect(strippedWorkflow).not.toContain("&&");
  });

  it("has no `||` used as JS control flow", () => {
    expect(strippedWorkflow).not.toContain("||");
  });

  it("has no `try`/`catch`", () => {
    expect(strippedWorkflow).not.toMatch(/\btry\b/);
    expect(strippedWorkflow).not.toMatch(/\bcatch\b/);
  });

  it("has no `Math.random`", () => {
    expect(strippedWorkflow).not.toMatch(/Math\.random/);
  });

  it("has no `process.` (the sandbox has no process; a reference would be a lie)", () => {
    expect(strippedWorkflow).not.toMatch(/\bprocess\./);
  });

  it("has no `require(`", () => {
    expect(strippedWorkflow).not.toMatch(/\brequire\s*\(/);
  });

  it("has no dynamic `import(`", () => {
    expect(strippedWorkflow).not.toMatch(/\bimport\s*\(/);
  });

  it("has no `new Date()`", () => {
    expect(strippedWorkflow).not.toMatch(/\bnew\s+Date\s*\(/);
  });
});

describe("nightshift.workflow.js never carries a tools list (no dispatch API accepts one)", () => {
  it('has no "tools:" key', () => {
    expect(workflowRaw).not.toMatch(/\btools\s*:/);
  });

  it('has no "allowedTools"', () => {
    expect(workflowRaw).not.toContain("allowedTools");
  });

  it('has no "disallowedTools"', () => {
    expect(workflowRaw).not.toContain("disallowedTools");
  });
});

describe("nightshift.workflow.js never hardcodes an agentType (lane comes in as data)", () => {
  const matches = [...workflowRaw.matchAll(/agentType\s*:\s*([^,}]+)/g)].map((m) => m[1]!.trim());

  it("found at least one agentType: dispatch (sanity — the scan below is not vacuous)", () => {
    expect(matches.length).toBeGreaterThan(0);
  });

  it("every agentType: value is an args.agents.* member access, never a literal", () => {
    for (const value of matches) {
      expect(value).toMatch(/^args\.agents\.\w+$/);
    }
  });
});

describe("nightshift.workflow.js never hardcodes the registry filename (it comes from args.registry)", () => {
  it('has no literal "vectors.yml"', () => {
    expect(strippedWorkflow).not.toContain("vectors.yml");
  });

  it('has no literal "flows.yml"', () => {
    expect(strippedWorkflow).not.toContain("flows.yml");
  });

  it("reads the registry path from args.registry", () => {
    expect(workflowRaw).toMatch(/REGISTRY\s*=\s*args\.registry/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// "Injects a tool at dispatch" is a false promise (CONTRACTS.md E4 amendment,
// lane-plan.ts module header): no dispatch API accepts a tools list, so
// nothing is ever injected, scoped, or granted at dispatch time — a
// subagent's tools are fixed at authoring time in its own frontmatter. Scan
// every agent file and every non-test src/ file for wording that claims
// otherwise.
describe('no file claims a tool is "injected ... at dispatch" (the false promise A5 exists to kill)', () => {
  // Given verbatim by the task spec. Deliberately loose: it is meant to catch
  // prose variation ("injects", "injecting", "the concrete browser tool",
  // "the scoped MCP tool", ...), not one exact sentence.
  const TOOL_AT_DISPATCH_RE =
    /inject[a-z]*\s+(the\s+)?(concrete\s+)?(browser|scoped|MCP)?[^.]{0,40}tool[^.]{0,40}at dispatch/i;

  // A second, wording-independent net: "injects the" anywhere near "at
  // dispatch time" in the same file, catching phrasing the first regex's
  // required "tool" token would miss (e.g. "injects the X at dispatch time"
  // where X is described elsewhere in the sentence).
  function injectsNearDispatchTime(text: string): boolean {
    const injectsIdx = [...text.matchAll(/injects the/gi)].map((m) => m.index ?? -1);
    const dispatchIdx = [...text.matchAll(/at dispatch time/gi)].map((m) => m.index ?? -1);
    return injectsIdx.some((a) => dispatchIdx.some((b) => Math.abs(a - b) < 200));
  }

  it("TOOL_AT_DISPATCH_RE catches the known pre-A5 false-promise wording (sanity — not a vacuous regex)", () => {
    expect(
      TOOL_AT_DISPATCH_RE.test(
        "the orchestrator injects the concrete browser/MCP tool at dispatch time",
      ),
    ).toBe(true);
  });

  it('injectsNearDispatchTime catches "injects the ... at dispatch time" (sanity — not vacuous)', () => {
    expect(
      injectsNearDispatchTime(
        "The orchestrator injects the scoped test command at dispatch time from the manifest.",
      ),
    ).toBe(true);
    expect(injectsNearDispatchTime("Nothing is injected here at all.")).toBe(false);
  });

  function walk(dir: string, suffix: string, exclude: (name: string) => boolean): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walk(full, suffix, exclude));
      } else if (entry.name.endsWith(suffix) && !exclude(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  // Widened scan (coverage HOLE 3): the dispatch refuter confirmed the pre-A5
  // wording can survive outside agents/ and src/ — in the prose that explains
  // the engine to a human. Skip node_modules/.git (not source), bin/ (built
  // .mjs artifacts, not authored prose), docs/ (working-notes that legitimately
  // QUOTE the historical false sentence while explaining why it was killed —
  // see docs/local-first-v3-plan.md:401 and docs/v3/a5-design-lane-engine.md:13,
  // both out of scope for this repo-hygiene scan), and *.test.ts (this file
  // among them — its own fixture strings below must not self-trip the scan).
  const EXCLUDED_DIRS = new Set(["node_modules", ".git", "bin", "docs"]);

  /** Recursively collect files under `dir` whose basename passes `include`. */
  function walkTree(dir: string, include: (name: string) => boolean): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walkTree(full, include));
      } else if (!entry.name.endsWith(".test.ts") && include(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  const agentFiles = walk(AGENTS_DIR, ".md", () => false);
  const srcFiles = walk(SRC_DIR, ".ts", (name) => name.endsWith(".test.ts"));

  const README_PATH = join(PLUGIN_ROOT, "README.md");
  const CONTRACTS_PATH = join(PLUGIN_ROOT, "CONTRACTS.md");
  const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
  const SCHEMAS_DIR = join(PLUGIN_ROOT, "schemas");
  const TEMPLATES_DIR = join(PLUGIN_ROOT, "templates");
  const EXAMPLES_DIR = join(PLUGIN_ROOT, "examples");

  const skillFiles = walkTree(SKILLS_DIR, (name) => name.endsWith(".md"));
  // schemas/*.yml is a flat glob in the task spec, not schemas/**/*.yml — there
  // are no subdirectories under schemas/ today, so a top-level listing is exact.
  const schemaFiles = readdirSync(SCHEMAS_DIR)
    .filter((name) => name.endsWith(".yml"))
    .map((name) => join(SCHEMAS_DIR, name));
  const templateFiles = walkTree(TEMPLATES_DIR, () => true);
  // examples/ is walked in FULL, symmetrically with templates/: the worked pack
  // (examples/novudesk/.nightshift/manifest.yml and its registries/fixtures) is
  // exactly the prose-carrying surface a reader copies from, and a README-only
  // filter left 11 files unscanned — the re-verification round proved the false
  // sentence could be injected into manifest.yml and stay green.
  const exampleFiles = walkTree(EXAMPLES_DIR, () => true);

  const scanned = [
    WORKFLOW_PATH,
    README_PATH,
    CONTRACTS_PATH,
    ...agentFiles,
    ...srcFiles,
    ...skillFiles,
    ...schemaFiles,
    ...templateFiles,
    ...exampleFiles,
  ];

  it("scanned at least one agents/*.md and one src/**/*.ts file (sanity — not vacuous)", () => {
    expect(agentFiles.length).toBeGreaterThan(0);
    expect(srcFiles.length).toBeGreaterThan(0);
  });

  it("scanned at least one file from every widened location (sanity — not vacuous)", () => {
    expect(existsSync(README_PATH)).toBe(true);
    expect(existsSync(CONTRACTS_PATH)).toBe(true);
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    expect(skillFiles.length).toBeGreaterThan(0);
    expect(schemaFiles.length).toBeGreaterThan(0);
    expect(templateFiles.length).toBeGreaterThan(0);
    expect(exampleFiles.length).toBeGreaterThan(0);
  });

  for (const file of scanned) {
    const rel = file.slice(PLUGIN_ROOT.length + 1);
    it(`${rel} does not claim a tool is injected at dispatch`, () => {
      const text = readFileSync(file, "utf8");
      expect(TOOL_AT_DISPATCH_RE.test(text)).toBe(false);
      expect(injectsNearDispatchTime(text)).toBe(false);
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Direction proof (HOLE 3): the scan above only proves something for every
  // SCANNED file if the two predicates it uses actually discriminate the
  // historical false claim from the negations A5 deliberately wrote. Prove
  // both directions here, inline, against literal sentences — one table that
  // MUST be flagged (real pre-A5 promises, paraphrased so this table is not
  // itself grep-identical to any one file) and one table that MUST NOT be
  // flagged (the actual negation sentences shipped in this repo today, quoted
  // verbatim from agents/ux-reviewer.md, skills/security/reference/run-loop.md,
  // and CONTRACTS.md E4). A scanner that can only ever pass is worthless; a
  // scanner that fires on its own repo's negations is worse than none.
  describe("direction proof (table of known-true / known-false sentences)", () => {
    function flags(text: string): boolean {
      return TOOL_AT_DISPATCH_RE.test(text) || injectsNearDispatchTime(text);
    }

    const affirmativeFalseClaims: { label: string; text: string }[] = [
      {
        label: "the historical ux-reviewer.md promise (quoted in docs/local-first-v3-plan.md:401)",
        text: "The orchestrator injects the concrete browser/MCP tool at dispatch time.",
      },
      {
        label: "prose variant: different subject noun, non-gerund",
        text: "The launcher injects the scoped MCP tool at dispatch.",
      },
      {
        label: "prose variant: gerund form with a filler clause before the dispatch phrase",
        text: "the runtime is injecting a browser tool at dispatch time, chosen per pack",
      },
    ];

    const currentNegations: { label: string; text: string }[] = [
      {
        label: "agents/ux-reviewer.md:25 verbatim",
        text:
          "No dispatch API accepts a tools list — every subagent's tools come from its own " +
          "frontmatter, fixed at file-authoring time, never injected at dispatch.",
      },
      {
        label: "skills/security/reference/run-loop.md verbatim",
        text:
          "No dispatch API accepts a tools list; nothing is granted, scoped, or added at " +
          "dispatch (CONTRACTS.md E5).",
      },
      {
        label: "CONTRACTS.md E4 amendment verbatim",
        text:
          "Any wording anywhere in this repo that says the orchestrator injects, scopes, or " +
          "grants a tool at dispatch describes a capability that does not exist and is a bug " +
          "to be fixed.",
      },
    ];

    for (const { label, text } of affirmativeFalseClaims) {
      it(`flags an affirmative false claim: ${label}`, () => {
        expect(flags(text)).toBe(true);
      });
    }

    for (const { label, text } of currentNegations) {
      it(`does NOT flag a current A5 negation: ${label}`, () => {
        expect(flags(text)).toBe(false);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Part C — agent frontmatter contract.
type Frontmatter = { name?: unknown; tools?: unknown; [k: string]: unknown };

function readFrontmatter(path: string): Frontmatter {
  const text = readFileSync(path, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (m === null) {
    throw new Error(`${path}: no --- frontmatter block found`);
  }
  const doc = parseYaml(m[1]!);
  if (typeof doc !== "object" || doc === null) {
    throw new Error(`${path}: frontmatter did not parse to a mapping`);
  }
  return doc as Frontmatter;
}

/** `tools:` is a comma-joined plain scalar in every agent file, not a YAML list. */
function toolsList(fm: Frontmatter): string[] {
  if (typeof fm.tools === "string") {
    return fm.tools
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (Array.isArray(fm.tools)) return fm.tools as string[];
  return [];
}

const agentFileNames = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));

describe("agent frontmatter: name matches filename stem", () => {
  it("found at least one agent file (sanity — not vacuous)", () => {
    expect(agentFileNames.length).toBeGreaterThan(0);
  });

  for (const fileName of agentFileNames) {
    const stem = basename(fileName, ".md");
    it(`agents/${fileName} frontmatter name === "${stem}"`, () => {
      const fm = readFrontmatter(join(AGENTS_DIR, fileName));
      expect(fm.name).toBe(stem);
    });
  }
});

describe("agent frontmatter: judgment agents that WRITE an artifact grant Write", () => {
  // Named exactly as the task spec lists them: the three security roles, the
  // two design refuter tiers, and every ux-reviewer build (base spec +
  // per-adapter concretes) via the ux-reviewer / ux-reviewer-* prefix.
  const explicitWriters = [
    "security-reviewer",
    "security-refuter",
    "security-refuter-2",
    "ux-refuter",
    "ux-refuter-2",
  ];
  const uxReviewerBuilds = agentFileNames
    .map((f) => basename(f, ".md"))
    .filter((name) => name === "ux-reviewer" || name.startsWith("ux-reviewer-"));
  const writers = [...new Set([...explicitWriters, ...uxReviewerBuilds])];

  it("resolved at least the five explicit writer roles plus the ux-reviewer builds (sanity — not vacuous)", () => {
    expect(writers.length).toBeGreaterThanOrEqual(explicitWriters.length);
    expect(uxReviewerBuilds).toContain("ux-reviewer");
  });

  for (const name of writers) {
    it(`agents/${name}.md lists Write in tools`, () => {
      const path = join(AGENTS_DIR, `${name}.md`);
      expect(existsSync(path)).toBe(true);
      const fm = readFrontmatter(path);
      expect(toolsList(fm)).toContain("Write");
    });
  }
});

describe("every agentType lane-plan.ts can emit resolves to a real, matching agent file", () => {
  // Pulled from the vitest-covered tables themselves (never hardcoded here),
  // per the task spec: AGENTS_BY_LANE (reviewer is absent for design — the
  // base ux-reviewer spec is deliberately never dispatched directly) +
  // UX_REVIEWER_BY_ADAPTER (the concrete per-adapter reviewer builds).
  const emitted = new Set<string>();
  for (const table of Object.values(AGENTS_BY_LANE)) {
    if (table.reviewer !== undefined) emitted.add(table.reviewer);
    emitted.add(table.refuter_tier1);
    emitted.add(table.refuter_tier2);
  }
  for (const agentName of Object.values(UX_REVIEWER_BY_ADAPTER)) emitted.add(agentName);

  it("collected at least one emittable agentType from each table (sanity — not vacuous)", () => {
    expect(emitted.size).toBeGreaterThan(0);
    expect(Object.values(UX_REVIEWER_BY_ADAPTER).length).toBeGreaterThan(0);
  });

  for (const agentType of emitted) {
    it(`agentType "${agentType}" resolves to agents/${agentType}.md with matching frontmatter name`, () => {
      const path = join(AGENTS_DIR, `${agentType}.md`);
      expect(existsSync(path)).toBe(true);
      const fm = readFrontmatter(path);
      expect(fm.name).toBe(agentType);
    });
  }
});

describe("design lane: per-adapter reviewer grants a browser tool; the base spec grants none", () => {
  const adapterReviewers = [...new Set(Object.values(UX_REVIEWER_BY_ADAPTER))];

  it("resolved at least one per-adapter reviewer (sanity — not vacuous)", () => {
    expect(adapterReviewers.length).toBeGreaterThan(0);
  });

  for (const name of adapterReviewers) {
    it(`agents/${name}.md grants a concrete mcp__ browser tool`, () => {
      const fm = readFrontmatter(join(AGENTS_DIR, `${name}.md`));
      expect(toolsList(fm).some((t) => /^mcp__/.test(t))).toBe(true);
    });
  }

  it("agents/ux-reviewer.md (the base spec) grants NO browser tool — it is a spec, not a runnable reviewer", () => {
    const fm = readFrontmatter(join(AGENTS_DIR, "ux-reviewer.md"));
    expect(toolsList(fm).some((t) => /^mcp__/.test(t))).toBe(false);
  });
});

describe("no agent file grants a wildcard \"*\" tool", () => {
  for (const fileName of agentFileNames) {
    it(`agents/${fileName} tools does not include a bare "*"`, () => {
      const fm = readFrontmatter(join(AGENTS_DIR, fileName));
      expect(toolsList(fm)).not.toContain("*");
    });
  }
});
