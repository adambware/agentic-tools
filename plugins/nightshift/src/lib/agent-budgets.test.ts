// Agent turn budgets are pinned here for the same reason MODEL_BY_BAND is
// (dispatch.test.ts): a change must be a deliberate red-CI event.
//
// WHY THIS FILE EXISTS. The reviewer's budget is overridden at dispatch
// (Surface.dispatch, from MODEL_BY_BAND) and so was already pinned. THE
// REFUTERS' IS NOT — the workflow dispatches them with `{ label, phase,
// agentType }` and nothing else, so a refuter runs on whatever its agent file
// says, and nothing tested that number.
//
// It was 10. On a real codebase both Tier-1 refuters spent all ten turns reading
// the surface and never reached the Write that produces candidates.json. Per
// §9.16 a surface dir without all three files is INCOMPLETE, so merge-candidates
// correctly dropped both surfaces, the chain completed, and the run recorded
// `reviewed: 0` — two genuine findings produced, refuted by nobody, and
// discarded, for $4.65. Nothing errored: an exhausted refuter returns "DONE".
//
// That is the failure this pins against. A budget too small to reach the write
// does not make a run cheaper; it makes the run produce nothing, at full price,
// silently.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");

function frontmatter(name: string): Record<string, string> {
  const text = readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (m === null) throw new Error(`agents/${name}.md has no frontmatter block`);
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const AGENTS = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));

describe("agent turn budgets", () => {
  it("pins every agent's maxTurns (a budget change must be deliberate)", () => {
    const budgets = Object.fromEntries(AGENTS.map((a) => [a, Number(frontmatter(a).maxTurns)]));
    expect(budgets).toMatchInlineSnapshot(`
      {
        "security-refuter": 40,
        "security-refuter-2": 56,
        "security-reviewer": 24,
        "ux-refuter": 40,
        "ux-refuter-2": 56,
        "ux-reviewer": 24,
        "ux-reviewer-playwright": 24,
      }
    `);
  });

  it("every agent declares a maxTurns at all — an absent one is an unbounded surprise", () => {
    for (const a of AGENTS) {
      expect(Number.isFinite(Number(frontmatter(a).maxTurns)), `agents/${a}.md`).toBe(true);
    }
  });

  it("the REFUTERS' budgets are the load-bearing ones: nothing overrides them at dispatch", () => {
    // The reviewer's frontmatter value is a floor the dispatch replaces
    // (MODEL_BY_BAND gives critical 56). A refuter gets exactly what its file
    // says, so its file has to be big enough to finish the job on a real repo.
    for (const refuter of ["security-refuter", "security-refuter-2", "ux-refuter", "ux-refuter-2"]) {
      expect(Number(frontmatter(refuter).maxTurns), refuter).toBeGreaterThanOrEqual(40);
    }
  });

  it("every agent that must write a run artifact is granted Write", () => {
    // The other half of the same failure: a refuter with the turns but no Write
    // produces the identical incomplete surface dir. Subagent tools come from
    // frontmatter ONLY — no dispatch API accepts a tools list — so this is the
    // only place the grant can be asserted.
    for (const a of AGENTS) {
      expect(frontmatter(a).tools, `agents/${a}.md`).toMatch(/\bWrite\b/);
    }
  });
});
