// Launcher-side lane gate (A5). Turns "run lane L against pack P" into the exact
// control-plane data a run needs — the lane's registry file, its three agent
// types, and (design only) the browser adapter + seeded personas — or refuses
// with a reason an operator can act on. `ns` preflight calls bin/lane-plan.mjs
// and splices the result into the Workflow's args.
//
// WHY THIS MODULE EXISTS — the design lane used to promise that the orchestrator
// would hand the reviewer a concrete browser/MCP tool as it dispatched. That is
// impossible: NO dispatch API accepts a tools list. Workflow `agent()` takes
// (label, phase, schema, model, effort, isolation, agentType) and a subagent's
// tools come from its FRONTMATTER, nothing else. So the browser adapter cannot
// be a runtime grant — it must be a CHOICE OF AGENT FILE, made before the run
// starts. UX_REVIEWER_BY_ADAPTER is that choice, and an unknown adapter must
// REFUSE rather than fall back to the stack-agnostic `ux-reviewer` base spec,
// which grants no browser tool and would "review" flows it cannot drive.
//
// Same principle as MODEL_BY_BAND in dispatch.ts: the lane -> data lookup lives
// here, in vitest-covered code, never as a lookup table inside the Workflow
// sandbox (E4 thin shell). The workflow receives it as data and interpolates it.
//
// FAIL FAST, NEVER HALF-RUN — buildLanePlan READS ONLY. It creates nothing,
// mutates nothing, and throws for nothing an operator can fix: every such
// problem comes back as {ok:false, reason} naming what is missing AND how to fix
// it. Pure of process.argv so every branch is unit-testable (E7).
//
// WHAT "INSIDE THE PACK" MEANS HERE — and what it does not. Every path this
// module emits is join(packDir, <hardcoded relative literal>) and is checked by
// insidePack, which is LEXICAL only: path.resolve, no lstat, no realpath. So the
// guarantee is exactly this — the emitted STRING resolves under packDir, and
// neither a future table edit nor a crafted packDir can make an emitted path
// NAME a location outside the pack. It is NOT a guarantee about the bytes at the
// far end of that path: if the operator's own .nightshift/fixtures/personas.yml
// is a symlink to somewhere else on disk, this module follows it, reads it, and
// still emits the in-pack path for it. That provenance claim is lexical, not
// physical, and callers must not read it as "this file lives in the pack".
// Lexical is the RIGHT level for this module: the pack is operator-owned
// configuration that the operator is trusted to write (a symlink they put there
// is a choice, not an attack), and this code only READS it. Physical
// (lstat/realpath) containment is src/lib/contain.ts's job, guarding the per-run
// surface dirs that AGENTS write into — a different trust boundary, untouched by
// this lane.
import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Lane, RegistryEntry } from "./types.js";
import { readYaml } from "./io.js";
import { extractEntries } from "./registry.js";
import { isSafeId } from "./validate.js";

export interface LanePlan {
  lane: Lane;
  registry: string;
  agents: { reviewer: string; refuter_tier1: string; refuter_tier2: string };
  /** Design lane only — the adapter the ux-reviewer agent was chosen for. */
  browser?: { tool: string; base_url: string };
  /** Design lane only — path to the seeded personas the flows are driven as. */
  personas?: string;
}

export type LanePlanResult = { ok: true; plan: LanePlan } | { ok: false; reason: string };

export interface BuildLanePlanOpts {
  /**
   * The pack directory (e.g. "<repo>/.nightshift"). Every emitted path resolves
   * lexically under it — see the header for what that guarantees (the path
   * string) and what it does not (the file a symlink in the pack points at).
   */
  packDir: string;
  /** Unvalidated lane string from the launcher; gated here, not by the caller. */
  lane: string;
}

/**
 * OWN-PROPERTY table read — the only way this module is allowed to index the
 * lane/adapter tables below with a runtime key.
 *
 * WHY: every key that reaches those tables is an OPERATOR-SUPPLIED STRING — the
 * manifest's `stack_adapter.browser.tool`, the launcher's `--lane` argv value.
 * The tables are plain object literals, so they inherit from Object.prototype,
 * and a bare `TABLE[key]` answers "constructor", "__proto__", "toString",
 * "valueOf" and "hasOwnProperty" with an INHERITED value instead of undefined.
 * That value is truthy, so it sails straight past the `=== undefined` refusals
 * that are supposed to catch an unsupported key, and the run dies much later at
 * the isSafeId backstop with a reason no operator can act on
 * (`agent id for reviewer ("function Object() { [native code] }") ...`).
 * Own-property lookup makes the SPECIFIC, actionable refusal fire first;
 * isSafeId stays exactly where it is, as the second layer.
 */
function tableGet<V>(table: Record<string, V>, key: string): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * Registry file each lane reads, relative to the pack dir.
 * Read it only through tableGet — the key is operator-supplied argv.
 */
export const REGISTRY_BY_LANE: Record<Lane, string> = {
  security: "registries/vectors.yml",
  design: "registries/flows.yml",
};

export interface LaneAgentTable {
  /**
   * Absent for design: the design reviewer is one agent PER BROWSER ADAPTER
   * (see UX_REVIEWER_BY_ADAPTER), so it cannot be resolved from the lane alone.
   * Deliberately not defaulted to `ux-reviewer` — that base spec grants no
   * browser tool, and a silent fallback to it is the exact false promise A5
   * exists to kill.
   */
  reviewer?: string;
  refuter_tier1: string;
  refuter_tier2: string;
}

// The security reviewer is fully determined by the lane (the security lane is
// stack-adapted through the manifest's `test` command, which is a prompt input,
// not a tool grant). Named once so the plan and the table cannot drift.
const SECURITY_REVIEWER = "security-reviewer";

/**
 * The three agent types each lane dispatches.
 * Read it only through tableGet — the key is operator-supplied argv.
 */
export const AGENTS_BY_LANE: Record<Lane, LaneAgentTable> = {
  security: {
    reviewer: SECURITY_REVIEWER,
    refuter_tier1: "security-refuter",
    refuter_tier2: "security-refuter-2",
  },
  design: {
    refuter_tier1: "ux-refuter",
    refuter_tier2: "ux-refuter-2",
  },
};

/**
 * Browser adapter id (manifest `stack_adapter.browser.tool`) -> the ux-reviewer
 * agent file whose FRONTMATTER grants that adapter's tools. One concrete agent
 * per adapter; adding an adapter means shipping an agent file and adding a row
 * here, in that order. An adapter absent from this table is a refusal, never a
 * fallback — see the module header.
 *
 * Read it only through tableGet. This is the table an operator string reaches
 * most directly (manifest `stack_adapter.browser.tool`), so a bare bracket read
 * here is the live prototype-chain hole, not a hypothetical one.
 */
export const UX_REVIEWER_BY_ADAPTER: Record<string, string> = {
  "playwright-mcp": "ux-reviewer-playwright",
  playwright: "ux-reviewer-playwright",
};

/** Seeded personas the design lane drives flows as, relative to the pack dir. */
const PERSONAS_REL = "fixtures/personas.yml";
/** The template shipped with the pack — its presence is the likeliest operator state. */
const PERSONAS_EXAMPLE_REL = "fixtures/personas.example.yml";

const MANIFEST_REL = "manifest.yml";

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isLane(x: string): x is Lane {
  return x === "security" || x === "design";
}

function refuse(reason: string): LanePlanResult {
  return { ok: false, reason };
}

/** A non-empty string after trimming — how "missing or blank" is decided. */
function filled(x: unknown): x is string {
  return typeof x === "string" && x.trim() !== "";
}

/**
 * Lexical containment: an emitted path STRING must resolve inside packDir. Every
 * path here is joined from a hardcoded literal, so this can only fire on a
 * future table edit or a crafted packDir — it is defense in depth, deliberately
 * cheap. It says nothing about what the path leads to: no lstat, no realpath, so
 * a symlink inside the pack still resolves clean here and is still followed on
 * read. See the module header for why lexical is the right (and only) level this
 * module owns, and why physical containment stays in src/lib/contain.ts.
 */
function insidePack(packDir: string, path: string): boolean {
  const root = resolve(packDir);
  const p = resolve(path);
  return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** readYaml, but a malformed file becomes a refusal reason instead of a throw. */
function readYamlSafe(
  path: string,
  what: string,
): { ok: true; doc: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, doc: readYaml(path) };
  } catch (err) {
    return {
      ok: false,
      reason: `${what} is not valid YAML: ${path} — ${(err as Error).message}`,
    };
  }
}

/** Display name for a registry entry in an error list (entries are operator YAML). */
function entryLabel(entry: RegistryEntry, index: number): string {
  return filled(entry?.id) ? entry.id : `<entry #${index}>`;
}

/**
 * Design-lane prerequisites, checked in the operator's order of discovery:
 * browser adapter, then personas, then the flow -> persona references that tie
 * the two together. Returns the extra plan fields or the first refusal.
 */
function resolveDesignLane(input: {
  packDir: string;
  manifest: Obj;
  manifestPath: string;
  registryPath: string;
  entries: RegistryEntry[];
}):
  | { ok: true; reviewer: string; browser: { tool: string; base_url: string }; personas: string }
  | { ok: false; reason: string } {
  const { packDir, manifest, manifestPath, registryPath, entries } = input;

  const stackAdapter = isObj(manifest.stack_adapter) ? manifest.stack_adapter : undefined;
  const browser = stackAdapter !== undefined && isObj(stackAdapter.browser)
    ? stackAdapter.browser
    : undefined;
  if (browser === undefined) {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser is missing in ${manifestPath} — the design lane ` +
        `drives real flows, so it needs a browser adapter: add ` +
        `stack_adapter.browser.tool and stack_adapter.browser.base_url (re-run ` +
        `/nightshift:onboard to fill them in)`,
    };
  }

  const tool = browser.tool;
  const supported = Object.keys(UX_REVIEWER_BY_ADAPTER).sort().join(", ");
  if (!filled(tool)) {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser.tool is missing or blank in ${manifestPath} — ` +
        `set it to the browser adapter this pack drives (supported: ${supported})`,
    };
  }

  // One agent per adapter, resolved from the pinned table. No fallback: an agent
  // without the adapter's tools in its frontmatter cannot drive the flow at all.
  // tableGet, never a bare bracket read: `tool` is operator YAML, so "constructor"
  // and friends must land in the refusal below, not on Object.prototype.
  const reviewer = tableGet(UX_REVIEWER_BY_ADAPTER, tool.trim());
  if (reviewer === undefined) {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser.tool "${tool}" has no ux-reviewer agent — ` +
        `supported adapters: ${supported}. Subagent tools come from agent-file ` +
        `frontmatter, so each adapter needs its own agent file; nothing is granted ` +
        `at dispatch time`,
    };
  }

  const baseUrl = browser.base_url;
  if (!filled(baseUrl)) {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser.base_url is missing or blank in ${manifestPath} — ` +
        `set it to the local dev / seeded staging URL the design lane should drive ` +
        `(never production)`,
    };
  }

  const personasPath = join(packDir, PERSONAS_REL);
  if (!insidePack(packDir, personasPath)) {
    return {
      ok: false,
      reason: `resolved personas path escapes the pack: ${personasPath} is not inside ${packDir}`,
    };
  }
  if (!existsSync(personasPath)) {
    // The single likeliest operator state is "template copied with the pack,
    // never filled in" — say so explicitly instead of a bare not-found.
    if (existsSync(join(packDir, PERSONAS_EXAMPLE_REL))) {
      return {
        ok: false,
        reason:
          `seeded personas not found: ${personasPath} — found the template ` +
          `personas.example.yml but not personas.yml — copy it and fill in seeded ` +
          `personas (cp ${PERSONAS_EXAMPLE_REL} ${PERSONAS_REL} inside ${packDir}), ` +
          `then re-run`,
      };
    }
    return {
      ok: false,
      reason:
        `seeded personas not found: ${personasPath} — the design lane drives every ` +
        `flow AS a seeded, non-production persona so it measures real friction and ` +
        `not environment drift; create ${PERSONAS_REL} (see the pack template's ` +
        `${PERSONAS_EXAMPLE_REL})`,
    };
  }

  const personasRead = readYamlSafe(personasPath, "personas file");
  if (!personasRead.ok) return personasRead;

  const personasList = isObj(personasRead.doc) ? personasRead.doc.personas : undefined;
  if (!Array.isArray(personasList)) {
    return {
      ok: false,
      reason:
        `${personasPath} has no \`personas:\` list — expected a top-level \`personas:\` ` +
        `array whose entries each carry a string \`id\` the flow registry can reference`,
    };
  }
  if (personasList.length === 0) {
    return {
      ok: false,
      reason:
        `${personasPath} has an empty \`personas:\` list — seed at least one persona ` +
        `(id, permissions, data_seed, credentials_ref, success_criteria) before the ` +
        `design lane can run`,
    };
  }

  // An id-less persona can never be referenced by a flow, so it is dead seed
  // data — name the exact indices rather than silently skipping them.
  const idless: number[] = [];
  const seeded = new Set<string>();
  personasList.forEach((p, i) => {
    const id = isObj(p) ? p.id : undefined;
    if (filled(id)) seeded.add(id.trim());
    else idless.push(i);
  });
  if (idless.length > 0) {
    return {
      ok: false,
      reason:
        `${personasPath}: persona entries at index ${idless.join(", ")} have no string ` +
        `\`id\` — every persona needs a unique string id, because flows select one by ` +
        `\`persona:\``,
    };
  }

  // Every flow must resolve to a seeded persona. A flow naming an unseeded
  // persona (or naming none at all) cannot be driven deterministically, and a
  // run that "reviews" it would report environment drift as UX friction.
  const unresolved: string[] = [];
  entries.forEach((entry, i) => {
    const persona = entry?.persona;
    if (filled(persona) && seeded.has(persona.trim())) return;
    unresolved.push(
      `${entryLabel(entry, i)} -> ${filled(persona) ? persona : "(no persona: set)"}`,
    );
  });
  if (unresolved.length > 0) {
    return {
      ok: false,
      reason:
        `${registryPath} references personas that are not seeded in ${personasPath}: ` +
        `${unresolved.join("; ")} — seed the missing personas or fix each flow's ` +
        `\`persona:\` field`,
    };
  }

  return {
    ok: true,
    reviewer,
    browser: { tool: tool.trim(), base_url: baseUrl.trim() },
    personas: personasPath,
  };
}

/**
 * Resolve the lane plan for `packDir` + `lane`, or refuse with a reason.
 * Read-only and total: the only throws that escape are genuine programmer/host
 * faults (an unreadable directory), never an operator-fixable pack problem.
 */
export function buildLanePlan(opts: BuildLanePlanOpts): LanePlanResult {
  const { packDir } = opts;

  if (!isLane(opts.lane)) {
    return refuse(
      `unknown lane "${opts.lane}" — expected "security" or "design" (--lane selects ` +
        `the registry, the agent types, and the design-lane prerequisites)`,
    );
  }
  const lane: Lane = opts.lane;

  if (!existsSync(packDir)) {
    return refuse(
      `pack directory not found: ${packDir} — run /nightshift:onboard in the target ` +
        `repo to create the .nightshift pack`,
    );
  }
  if (!statSync(packDir).isDirectory()) {
    return refuse(`pack path is not a directory: ${packDir} — --pack must name the .nightshift pack dir`);
  }

  // The manifest is the portability layer for BOTH lanes: security reads its
  // stack adapter downstream, design reads the browser adapter below. A pack
  // without a readable manifest is not a pack, whichever lane asked.
  const manifestPath = join(packDir, MANIFEST_REL);
  if (!existsSync(manifestPath)) {
    return refuse(
      `manifest not found: ${manifestPath} — every pack needs a manifest.yml ` +
        `(re-run /nightshift:onboard, which writes it from the template)`,
    );
  }
  const manifestRead = readYamlSafe(manifestPath, "manifest");
  if (!manifestRead.ok) return refuse(manifestRead.reason);
  if (!isObj(manifestRead.doc)) {
    return refuse(
      `manifest is not a YAML mapping: ${manifestPath} — expected top-level keys ` +
        `(pack_format, project, repos, stack_adapter, ...)`,
    );
  }
  const manifest = manifestRead.doc;

  // Both tables read through tableGet even though isLane already whitelisted
  // `lane`: the whitelist is the first layer, own-property access is the second,
  // and neither is allowed to be the only one (a hypothetical third lane added
  // to the Lane union but not to a table must refuse here, not emit a plan with
  // an inherited Object.prototype value spliced into the Workflow's args).
  const registryRel = tableGet(REGISTRY_BY_LANE, lane);
  const laneAgents = tableGet(AGENTS_BY_LANE, lane);
  if (registryRel === undefined || laneAgents === undefined) {
    return refuse(
      `lane "${lane}" has no complete row in the lane tables ` +
        `(REGISTRY_BY_LANE: ${registryRel === undefined ? "missing" : "ok"}, ` +
        `AGENTS_BY_LANE: ${laneAgents === undefined ? "missing" : "ok"}) — every lane ` +
        `needs a row in both tables in src/lib/lane-plan.ts`,
    );
  }
  const registryPath = join(packDir, registryRel);
  if (!insidePack(packDir, registryPath)) {
    return refuse(`resolved registry path escapes the pack: ${registryPath} is not inside ${packDir}`);
  }
  if (!existsSync(registryPath)) {
    return refuse(
      `registry not found: ${registryPath} — lane "${lane}" reads ${registryRel}; ` +
        `seed it (or re-run /nightshift:onboard, which writes it from the template)`,
    );
  }
  const registryRead = readYamlSafe(registryPath, "registry");
  if (!registryRead.ok) return refuse(registryRead.reason);

  let entries: RegistryEntry[];
  try {
    entries = extractEntries(registryRead.doc, lane);
  } catch (err) {
    return refuse(`registry ${registryPath} is malformed: ${(err as Error).message}`);
  }
  if (entries.length === 0) {
    // Not a no-op: a run that would review nothing still burns a run id, stamps
    // metrics, and reports "all clear" for coverage nobody wrote. Operator error.
    return refuse(
      `registry ${registryPath} has no entries for lane "${lane}" — a run that would ` +
        `review nothing is an operator error; add at least one entry with owner: ${lane}`,
    );
  }

  let plan: LanePlan;
  if (lane === "design") {
    const design = resolveDesignLane({ packDir, manifest, manifestPath, registryPath, entries });
    if (!design.ok) return refuse(design.reason);
    plan = {
      lane,
      registry: registryPath,
      agents: {
        reviewer: design.reviewer,
        refuter_tier1: laneAgents.refuter_tier1,
        refuter_tier2: laneAgents.refuter_tier2,
      },
      browser: design.browser,
      personas: design.personas,
    };
  } else {
    plan = {
      lane,
      registry: registryPath,
      agents: {
        reviewer: SECURITY_REVIEWER,
        refuter_tier1: laneAgents.refuter_tier1,
        refuter_tier2: laneAgents.refuter_tier2,
      },
    };
  }

  // Everything above rides into the Workflow's args as control-plane data: the
  // agent types become `agentType` arguments and the registry file name becomes
  // a path segment the workflow interpolates into shell commands. The tables are
  // pinned literals today, so these gates guard against a FUTURE table edit
  // (or an adapter row) smuggling a separator or a shell metacharacter through.
  const registryFile = registryRel.slice(registryRel.lastIndexOf("/") + 1);
  if (!isSafeId(registryFile)) {
    return refuse(`registry file name "${registryFile}" is not path-segment safe (lane "${lane}")`);
  }
  for (const [role, agentType] of Object.entries(plan.agents)) {
    if (!isSafeId(agentType)) {
      return refuse(
        `agent id for ${role} ("${agentType}") is not path-segment safe — agent types ` +
          `cross into args as control-plane data`,
      );
    }
  }

  return { ok: true, plan };
}
