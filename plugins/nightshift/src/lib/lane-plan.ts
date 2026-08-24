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
import { isSafeAgentType, isSafeId } from "./validate.js";

export interface LanePlan {
  lane: Lane;
  registry: string;
  agents: { reviewer: string; refuter_tier1: string; refuter_tier2: string };
  /**
   * Design lane only — the adapter the ux-reviewer agent was chosen for, plus
   * the environment assertion T8 gated on (normalized to lower case). `ns` echoes
   * `environment` into the run log so the record of WHAT WAS DRIVEN survives the
   * run, not just the fact that a gate passed.
   */
  browser?: { tool: string; base_url: string; environment: string };
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
 * The plugin the agent files ship in. Every agentType handed to the workflow is
 * qualified with it.
 *
 * `bin/ns` gives every session it starts `--plugin-dir $ENGINE`, so the agents
 * the workflow dispatches to come from the same tree as the bins — and a
 * plugin-supplied agent is addressable by its QUALIFIED name. The bare name
 * resolves only if something else in the session also provides an agent by that
 * name, which is not a thing to depend on: the first real run dispatched the
 * bare names, every reviewer came back "agent type not found", and the workflow
 * still returned `{"status":"complete"}` because the post-processing stages ran.
 *
 * The tables below stay BARE on purpose — those strings are also the agent FILE
 * names under agents/, and a test asserts each one exists on disk. Qualifying
 * happens once, here, on the way out.
 */
const AGENT_PLUGIN = "nightshift";

/** `security-reviewer` -> `nightshift:security-reviewer`. */
function qualify(agentType: string): string {
  return `${AGENT_PLUGIN}:${agentType}`;
}

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

/**
 * T8 (A7) — DESIGN-LANE ENVIRONMENT SAFETY. Two independent assertions, both
 * REQUIRED, both refusals (never a warn-and-proceed):
 *
 *   1. `base_url` names a LOOPBACK host.
 *   2. `environment` explicitly declares a non-production environment.
 *
 * WHY BOTH, AND WHY HERE. A curl reachability check proves something answers on
 * that URL; it proves nothing about whether it is safe to drive. The design
 * reviewer does not read a page — it SUBMITS FORMS AND CHANGES STATE as a seeded
 * persona, and browser actions never touch the read-only filesystem guard (the
 * guard gates Write/Edit/Bash, not an MCP browser click). So the only thing
 * standing between "design lane enabled" and "an agent filling in and submitting
 * forms against real customers" is this gate.
 *
 * Loopback alone is not enough: an operator can port-forward or /etc/hosts a
 * production database behind 127.0.0.1, and a tunnel makes `localhost:3000` a
 * remote environment. A machine-checkable network fact cannot answer "is this
 * data real?" — only a human can, so the manifest must SAY SO, in a field whose
 * only purpose is to say so. `environment` is that assertion.
 *
 * An explicit assertion alone is not enough either: it is one hand-typed line
 * that stays true only until the base_url beside it is edited. Loopback is the
 * mechanical check that catches the stale assertion.
 *
 * Neither check is a substitute for the other and neither is advisory. Missing
 * `environment` refuses (silence is not consent); `environment: staging` and
 * `environment: production` refuse BY NAME, because "staging" is the exact
 * failure mode in a7-ops-launcher.md's table — a dev server that is up, answers,
 * and holds data that is not yours to submit forms against.
 */
export const NON_PRODUCTION_ENVIRONMENTS: readonly string[] = ["local", "dev", "test"];

/** Environments named here refuse with a specific reason instead of the generic one. */
const NAMED_PRODUCTION_ENVIRONMENTS: readonly string[] = [
  "staging",
  "stage",
  "production",
  "prod",
  "live",
];

/**
 * True iff `host` is a loopback address by name or by literal.
 *
 * Accepts `localhost` and any `*.localhost` name (RFC 6761 reserves the whole
 * .localhost TLD to loopback), the IPv6 loopback in any spelling node's URL
 * parser can hand back, and the WHOLE 127.0.0.0/8 block (127.0.0.1 is the
 * convention, but a dev server bound to 127.0.0.2 is just as local).
 *
 * Deliberately NOT accepted: `0.0.0.0` and `[::]` — the unspecified address
 * means "bind every interface", i.e. the opposite of loopback; a browser
 * driving it reaches whatever that host is reachable as from the network.
 */
export function isLoopbackHost(host: string): boolean {
  // node's URL keeps IPv6 literals bracketed in `hostname`; strip for comparison.
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || /^(0*:)+0*1$/.test(h)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4 === null) return false;
  const octets = v4.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  return octets[0] === 127;
}

/**
 * The base_url half of the gate. Parses with node's URL so credentials and
 * other authority-section tricks resolve the way a browser would resolve them:
 * `http://localhost@prod.example/` has hostname `prod.example`, and is refused
 * on exactly that hostname rather than on the literal text "localhost" the
 * string appears to contain.
 */
function checkLoopbackBaseUrl(
  baseUrl: string,
  manifestPath: string,
): { ok: true } | { ok: false; reason: string; summary: string } {
  const advice =
    `the design lane SUBMITS FORMS AND CHANGES STATE as a seeded persona, and no ` +
    `filesystem guard can undo a browser action — point base_url at a local dev ` +
    `server (e.g. http://localhost:3000) and start it before the run`;

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser.base_url "${baseUrl}" in ${manifestPath} is not an ` +
        `absolute URL — ${advice}`,
      summary: "`stack_adapter.browser.base_url` is not an absolute URL",
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser.base_url "${baseUrl}" in ${manifestPath} uses ` +
        `scheme "${url.protocol}" — only http/https are drivable; ${advice}`,
      summary: `\`stack_adapter.browser.base_url\` uses scheme \`${url.protocol}\`, not http/https`,
    };
  }
  if (!isLoopbackHost(url.hostname)) {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser.base_url "${baseUrl}" in ${manifestPath} is not a ` +
        `LOOPBACK host (resolved host: "${url.hostname}") — the design lane refuses any ` +
        `remote environment, staging included; ${advice}`,
      summary: `\`stack_adapter.browser.base_url\` host \`${url.hostname}\` is not loopback`,
    };
  }
  return { ok: true };
}

/**
 * The explicit-assertion half of the gate. A missing field is a refusal, not a
 * default: nobody has stated that this environment is safe to mutate.
 */
function checkNonProductionAssertion(
  browser: Obj,
  manifestPath: string,
): { ok: true; environment: string } | { ok: false; reason: string; summary: string } {
  const supported = NON_PRODUCTION_ENVIRONMENTS.join(", ");
  const raw = browser.environment;
  if (!filled(raw)) {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser.environment is missing in ${manifestPath} — the ` +
        `design lane requires an EXPLICIT non-production assertion before it will drive a ` +
        `browser that submits forms (allowed: ${supported}). No default is inferred: a ` +
        `reachable server is not the same claim as a disposable one, and only a human can ` +
        `make it`,
      summary: "`stack_adapter.browser.environment` is unset",
    };
  }
  const env = raw.trim().toLowerCase();
  if (NON_PRODUCTION_ENVIRONMENTS.includes(env)) return { ok: true, environment: env };
  if (NAMED_PRODUCTION_ENVIRONMENTS.includes(env)) {
    return {
      ok: false,
      reason:
        `manifest.stack_adapter.browser.environment is "${raw}" in ${manifestPath} — the ` +
        `design lane refuses it. A shared environment answers, looks right, and holds data ` +
        `that is not yours to submit forms against; "up" is not "safe to mutate". Point the ` +
        `lane at a local dev server and set environment to one of: ${supported}`,
      summary: `\`stack_adapter.browser.environment\` is \`${env}\`, not a non-production environment`,
    };
  }
  return {
    ok: false,
    reason:
      `manifest.stack_adapter.browser.environment "${raw}" in ${manifestPath} is not a ` +
      `recognized non-production environment (allowed: ${supported}) — an unrecognized ` +
      `value asserts nothing, so it is refused rather than assumed safe`,
    summary:
      `\`stack_adapter.browser.environment\` \`${env}\` is not a recognized non-production ` +
      `environment (allowed: ${supported})`,
  };
}

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

/** One unmet design-lane prerequisite, in both of the voices it gets read in. */
export interface DesignPackProblem {
  /** The launcher's refusal: long, absolute-pathed, and says how to fix it. */
  reason: string;
  /** The dashboard's one clause, markdown-backticked for the page's fmtCopy(). */
  summary: string;
}

export type DesignPackCheck =
  | {
      ok: true;
      reviewer: string;
      browser: { tool: string; base_url: string; environment: string };
      personas: string;
      /** Persona ids a flow's `persona:` field is allowed to name. */
      seeded: Set<string>;
    }
  | { ok: false; problems: DesignPackProblem[] };

/**
 * THE design-lane readiness gate — everything the lane needs from the PACK
 * ITSELF: the browser adapter, T8's environment pair, and the seeded personas.
 *
 * WHY IT IS EXTRACTED. `ns` is not the only thing that answers "is this lane
 * ready?". bin/dashboard answers it too, on the page that is the operator's ONLY
 * view of the fleet, and it used to answer it with its own two-line guess:
 * fixtures/personas.yml exists AND stack_adapter.browser.base_url is set. That
 * guess printed the lane as "on" for a pack pointed at staging, for a pack with
 * no `environment` assertion at all, and for a pack naming a browser tool that
 * has no agent file — three packs the launcher refuses EVERY time. A living
 * document that advertises a lane `ns` will always refuse is worse than one that
 * says nothing, so both surfaces now derive readiness from this one function.
 *
 * IT DELIBERATELY DOES NOT READ THE FLOWS REGISTRY. The flow -> persona
 * cross-reference is the one prerequisite that needs the entries, and it stays
 * in resolveDesignLane below: the dashboard already loads the registry by its
 * own path, and having this re-read it would give the two surfaces two separate
 * reads of the same file at two different moments.
 *
 * PROBLEMS ARE A LIST, AND problems[0] IS LOAD-BEARING. The groups below run in
 * the exact order these checks ran when they were inline in resolveDesignLane,
 * and each group contributes AT MOST ONE problem, so problems[0] is the same
 * refusal, byte for byte, that the launcher produced before the extraction —
 * which is what lets the refusal-per-reason tests keep asserting on those
 * strings. The launcher takes only that first one, because one refusal per run
 * is what an operator can act on; the dashboard joins every `summary` with
 * " and " so a pack being set up shows all of its remaining work at once
 * instead of one item per fix-and-re-render cycle.
 */
export function checkDesignPack(input: {
  packDir: string;
  /** The parsed manifest.yml. A missing file or a non-mapping reads as empty. */
  manifest: unknown;
  manifestPath: string;
}): DesignPackCheck {
  const { packDir, manifestPath } = input;
  const manifest = isObj(input.manifest) ? input.manifest : {};
  const problems: DesignPackProblem[] = [];

  const stackAdapter = isObj(manifest.stack_adapter) ? manifest.stack_adapter : undefined;
  const browser = stackAdapter !== undefined && isObj(stackAdapter.browser)
    ? stackAdapter.browser
    : undefined;

  const supported = Object.keys(UX_REVIEWER_BY_ADAPTER).sort().join(", ");
  let reviewer: string | undefined;
  let toolId: string | undefined;
  let resolvedBaseUrl: string | undefined;
  let environment: string | undefined;

  if (browser === undefined) {
    // Every group up to the personas one reads a field off `browser`, so a
    // missing browser block collapses them all into this single problem. The
    // personas group below still runs: it never touches the manifest, and an
    // operator fixing one of these will want to know about the other.
    problems.push({
      reason:
        `manifest.stack_adapter.browser is missing in ${manifestPath} — the design lane ` +
        `drives real flows, so it needs a browser adapter: add ` +
        `stack_adapter.browser.tool and stack_adapter.browser.base_url (re-run ` +
        `/nightshift:onboard to fill them in)`,
      summary: "`stack_adapter.browser` is missing",
    });
  } else {
    const tool = browser.tool;
    if (!filled(tool)) {
      problems.push({
        reason:
          `manifest.stack_adapter.browser.tool is missing or blank in ${manifestPath} — ` +
          `set it to the browser adapter this pack drives (supported: ${supported})`,
        summary: "`stack_adapter.browser.tool` is unset",
      });
    } else {
      // One agent per adapter, resolved from the pinned table. No fallback: an
      // agent without the adapter's tools in its frontmatter cannot drive the
      // flow at all.
      // tableGet, never a bare bracket read: `tool` is operator YAML, so
      // "constructor" and friends must land in the refusal below, not on
      // Object.prototype.
      const found = tableGet(UX_REVIEWER_BY_ADAPTER, tool.trim());
      if (found === undefined) {
        problems.push({
          reason:
            `manifest.stack_adapter.browser.tool "${tool}" has no ux-reviewer agent — ` +
            `supported adapters: ${supported}. Subagent tools come from agent-file ` +
            `frontmatter, so each adapter needs its own agent file; nothing is granted ` +
            `at dispatch time`,
          summary:
            `\`stack_adapter.browser.tool\` \`${tool.trim()}\` has no ux-reviewer agent ` +
            `(supported: ${supported})`,
        });
      } else {
        reviewer = found;
        toolId = tool.trim();
      }
    }

    const baseUrl = browser.base_url;
    if (!filled(baseUrl)) {
      problems.push({
        reason:
          `manifest.stack_adapter.browser.base_url is missing or blank in ${manifestPath} — ` +
          `set it to the LOCAL dev server URL the design lane should drive ` +
          `(loopback only — never staging, never production)`,
        summary: "`stack_adapter.browser.base_url` is unset",
      });
    } else {
      // T8 — environment safety. Both halves are required and both are refusals;
      // see the NON_PRODUCTION_ENVIRONMENTS header for why neither substitutes for
      // the other. Placed before the PERSONAS checks, so an operator who has pointed
      // the lane somewhere unsafe is not first sent off to seed fixtures for an
      // environment the lane will refuse anyway.
      //
      // It is NOT first overall, and that is worth being honest about: buildLanePlan
      // reads the registry and resolveDesignLane resolves the adapter before it gets
      // here, so a pack that is BOTH missing its flows registry AND pointed at
      // production hears about the registry. Every path still refuses and nothing
      // runs — the cost is an operator doing one round of setup work before learning
      // about the second problem. Reordering means moving the whole design branch
      // ahead of the shared registry read, which changes A5's refusal ordering for
      // every lane to fix an ergonomic wrinkle in one.
      const loopback = checkLoopbackBaseUrl(baseUrl.trim(), manifestPath);
      if (loopback.ok) resolvedBaseUrl = baseUrl.trim();
      else problems.push({ reason: loopback.reason, summary: loopback.summary });
    }
    const nonProd = checkNonProductionAssertion(browser, manifestPath);
    if (nonProd.ok) environment = nonProd.environment;
    else problems.push({ reason: nonProd.reason, summary: nonProd.summary });
  }

  const personasPath = join(packDir, PERSONAS_REL);
  let seeded: Set<string> | undefined;
  if (!insidePack(packDir, personasPath)) {
    problems.push({
      reason: `resolved personas path escapes the pack: ${personasPath} is not inside ${packDir}`,
      summary: `\`${PERSONAS_REL}\` resolves outside the pack`,
    });
  } else if (!existsSync(personasPath)) {
    // The single likeliest operator state is "template copied with the pack,
    // never filled in" — say so explicitly instead of a bare not-found.
    if (existsSync(join(packDir, PERSONAS_EXAMPLE_REL))) {
      problems.push({
        reason:
          `seeded personas not found: ${personasPath} — found the template ` +
          `personas.example.yml but not personas.yml — copy it and fill in seeded ` +
          `personas (cp ${PERSONAS_EXAMPLE_REL} ${PERSONAS_REL} inside ${packDir}), ` +
          `then re-run`,
        summary: `\`${PERSONAS_REL}\` is missing (copy \`${PERSONAS_EXAMPLE_REL}\`)`,
      });
    } else {
      problems.push({
        reason:
          `seeded personas not found: ${personasPath} — the design lane drives every ` +
          `flow AS a seeded, non-production persona so it measures real friction and ` +
          `not environment drift; create ${PERSONAS_REL} (see the pack template's ` +
          `${PERSONAS_EXAMPLE_REL})`,
        summary: `\`${PERSONAS_REL}\` is missing`,
      });
    }
  } else {
    const personasRead = readYamlSafe(personasPath, "personas file");
    if (!personasRead.ok) {
      problems.push({
        reason: personasRead.reason,
        summary: `\`${PERSONAS_REL}\` is not valid YAML`,
      });
    } else {
      const personasList = isObj(personasRead.doc) ? personasRead.doc.personas : undefined;
      if (!Array.isArray(personasList)) {
        problems.push({
          reason:
            `${personasPath} has no \`personas:\` list — expected a top-level \`personas:\` ` +
            `array whose entries each carry a string \`id\` the flow registry can reference`,
          summary: `\`${PERSONAS_REL}\` has no \`personas:\` list`,
        });
      } else if (personasList.length === 0) {
        problems.push({
          reason:
            `${personasPath} has an empty \`personas:\` list — seed at least one persona ` +
            `(id, permissions, data_seed, credentials_ref, success_criteria) before the ` +
            `design lane can run`,
          summary: `\`${PERSONAS_REL}\` seeds no personas`,
        });
      } else {
        // An id-less persona can never be referenced by a flow, so it is dead
        // seed data — name the exact indices rather than silently skipping them.
        const idless: number[] = [];
        const ids = new Set<string>();
        personasList.forEach((p, i) => {
          const id = isObj(p) ? p.id : undefined;
          if (filled(id)) ids.add(id.trim());
          else idless.push(i);
        });
        if (idless.length > 0) {
          problems.push({
            reason:
              `${personasPath}: persona entries at index ${idless.join(", ")} have no string ` +
              `\`id\` — every persona needs a unique string id, because flows select one by ` +
              `\`persona:\``,
            summary: `\`${PERSONAS_REL}\` has persona entries with no \`id\` (index ${idless.join(", ")})`,
          });
        } else {
          seeded = ids;
        }
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  if (
    reviewer === undefined ||
    toolId === undefined ||
    resolvedBaseUrl === undefined ||
    environment === undefined ||
    seeded === undefined
  ) {
    // Narrowing, not defense in depth: an empty problems list means every group
    // above took its success branch, so all five are set. The compiler cannot
    // see that through the pushes, and one guard reads better than five `!`s —
    // with the side benefit that a future edit which breaks the
    // problem/value pairing refuses instead of emitting a plan with holes.
    return {
      ok: false,
      problems: [
        {
          reason:
            `design-pack check finished with no problem to report and an unresolved ` +
            `prerequisite (${manifestPath}) — that is a bug in src/lib/lane-plan.ts, ` +
            `not something the pack can fix`,
          summary: "`manifest.yml` could not be evaluated",
        },
      ],
    };
  }
  return {
    ok: true,
    reviewer,
    browser: { tool: toolId, base_url: resolvedBaseUrl, environment },
    personas: personasPath,
    seeded,
  };
}

/**
 * Design-lane prerequisites, checked in the operator's order of discovery:
 * browser adapter, then personas, then the flow -> persona references that tie
 * the two together. Returns the extra plan fields or the first refusal.
 *
 * The first two groups live in checkDesignPack above, which bin/dashboard shares
 * so the page and the launcher cannot disagree about what "ready" means. Only
 * the registry cross-reference is left here, because only it needs the entries.
 */
function resolveDesignLane(input: {
  packDir: string;
  manifest: Obj;
  manifestPath: string;
  registryPath: string;
  entries: RegistryEntry[];
}):
  | {
      ok: true;
      reviewer: string;
      browser: { tool: string; base_url: string; environment: string };
      personas: string;
    }
  | { ok: false; reason: string } {
  const { packDir, manifest, manifestPath, registryPath, entries } = input;

  const pack = checkDesignPack({ packDir, manifest, manifestPath });
  // FIRST problem only — see checkDesignPack's header for why that one is the
  // same string, in the same order, this function returned before the split.
  if (!pack.ok) return { ok: false, reason: pack.problems[0]!.reason };

  // Every flow must resolve to a seeded persona. A flow naming an unseeded
  // persona (or naming none at all) cannot be driven deterministically, and a
  // run that "reviews" it would report environment drift as UX friction.
  const unresolved: string[] = [];
  entries.forEach((entry, i) => {
    const persona = entry?.persona;
    if (filled(persona) && pack.seeded.has(persona.trim())) return;
    unresolved.push(
      `${entryLabel(entry, i)} -> ${filled(persona) ? persona : "(no persona: set)"}`,
    );
  });
  if (unresolved.length > 0) {
    return {
      ok: false,
      reason:
        `${registryPath} references personas that are not seeded in ${pack.personas}: ` +
        `${unresolved.join("; ")} — seed the missing personas or fix each flow's ` +
        `\`persona:\` field`,
    };
  }

  return {
    ok: true,
    reviewer: pack.reviewer,
    browser: pack.browser,
    personas: pack.personas,
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
        reviewer: qualify(design.reviewer),
        refuter_tier1: qualify(laneAgents.refuter_tier1),
        refuter_tier2: qualify(laneAgents.refuter_tier2),
      },
      browser: design.browser,
      personas: design.personas,
    };
  } else {
    plan = {
      lane,
      registry: registryPath,
      agents: {
        reviewer: qualify(SECURITY_REVIEWER),
        refuter_tier1: qualify(laneAgents.refuter_tier1),
        refuter_tier2: qualify(laneAgents.refuter_tier2),
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
    if (!isSafeAgentType(agentType)) {
      return refuse(
        `agent id for ${role} ("${agentType}") is not path-segment safe — agent types ` +
          `cross into args as control-plane data`,
      );
    }
  }

  return { ok: true, plan };
}
