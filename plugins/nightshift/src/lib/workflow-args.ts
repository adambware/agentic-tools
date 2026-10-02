// Launcher-side assembly of the Workflow `args` object (A7 / T11).
//
// WHY THIS EXISTS. `nightshift.workflow.js` runs in a sandbox with no fs and no
// process, so everything it needs about THIS run has to arrive through `args`.
// The workflow is a thin shell (E4) and must stay at zero conditionals, so it
// cannot chunk, validate, or default anything itself — it does exactly two
// things with this object: `for (const chunk of args.surface_chunks)` and a
// handful of plain member reads. That makes this module the last place a bad
// value can be caught before it becomes an interpolated shell command or an
// agentType inside a headless run nobody is watching.
//
// CHUNKING IS DATA SHAPING, NOT A DECISION (T11). `max_concurrent_reviewers` is
// an operator knob in $OPS/config.yml; honoring it means deciding how many
// reviewer+refuter pairs may be in flight at once. Deciding that in the sandbox
// would be a conditional; deciding it here makes it a list-of-lists the workflow
// merely iterates. The workflow pipelines WITHIN a chunk (surface B reviews
// while surface A refutes) and sequences ACROSS chunks — so the shape of this
// array IS the concurrency policy.
//
// KEY-FOR-KEY WITH THE SHELL. Every key emitted here is read by
// nightshift.workflow.js and every key it reads is emitted here — asserted
// executably in workflow-args.test.ts by scanning the workflow's own source, so
// a rename on either side fails the build instead of failing at 3am inside a
// headless run. Deliberately NOT emitted: the design lane plan's `browser` and
// `personas`. The workflow's ARGS CONTRACT header states it consumes neither,
// and splicing them in would be dead payload today and an invitation to branch
// on `lane` tomorrow.
//
// WHAT THAT COSTS, STATED PLAINLY (open for A8): nothing carries the gated
// `base_url` into the run. The T8 preflight validates the manifest, and the
// ux-reviewer then re-reads that same manifest for itself — so the value that
// was checked and the value that gets driven are read at two different moments
// from a file the operator can edit in between. The launcher cannot close this
// by putting base_url in its own prompt: `ns` prompts the TOP-LEVEL session,
// while the reviewer's prompt is built inside the workflow, which must stay
// lane-agnostic. Closing it means either the reviewer treating the manifest as
// advisory, or a lane-neutral carrier for per-surface invocation context.
// A8 runs the design lane for real and is where that choice can be observed.
//
// EVERY FIELD IS CHECKED, NOT JUST THE SURFACES. `registry`, `lane` and the
// three `agents.*` come from bin/lane-plan and are therefore "trusted" — but
// `undefined` does not survive JSON.stringify, so an incomplete plan silently
// produces an args.json MISSING those keys, the workflow reads `undefined`, and
// it lands in a shell command as the literal text "undefined" or as an agentType
// nobody has. Validating them here is the difference between an exit 2 with a
// reason and a headless run that burns its budget writing garbage.
import type { Dispatch, Lane, Surface } from "./types.js";
import type { LanePlan } from "./lane-plan.js";
import { isSafeAgentType, isSafeId } from "./validate.js";

/** The exact object `nightshift.workflow.js` reads as its global `args`. */
export interface WorkflowArgs {
  run_id: string;
  lane: Lane;
  surface_chunks: Surface[][];
  registry: string;
  agents: { reviewer: string; refuter_tier1: string; refuter_tier2: string };
}

export interface BuildWorkflowArgsOpts {
  runId: string;
  lanePlan: LanePlan;
  surfaces: Surface[];
  /** `max_concurrent_reviewers` from $OPS/config.yml. */
  maxConcurrentReviewers: number;
}

export type BuildWorkflowArgsResult =
  | { ok: true; args: WorkflowArgs; chunks: number }
  | { ok: false; kind: "refuse"; reason: string }
  /**
   * Not an error: bin/select legitimately picks zero surfaces when nothing is
   * stale and nothing changed. `ns` maps this to "nothing to review" — it skips
   * the model call entirely, still regenerates the dashboard, and exits 0. It
   * must NOT be conflated with a refusal: an empty run that reported failure
   * would poison the cost/verdict strip every quiet night.
   */
  | { ok: false; kind: "nothing-to-review"; reason: string };

/**
 * Filename-safety rule for run_id. Byte-identical to the private constants in
 * record-run.ts and clean-run.ts ON PURPOSE: run_id becomes a directory name
 * (.nightshift/.run/<id>/), a claim filename, and an interpolated shell token.
 * Catching a bad id HERE means the operator sees it before a model is billed;
 * record's copy stays exactly where it is as the authoritative gate on durable
 * state. Any future loosening must happen in all three or in none.
 */
const RUN_ID_RE = /^[A-Za-z0-9_.-]+$/;

function refuse(reason: string): BuildWorkflowArgsResult {
  return { ok: false, kind: "refuse", reason };
}

/** A non-empty string after trimming. */
function filled(x: unknown): x is string {
  return typeof x === "string" && x.trim() !== "";
}

/**
 * Split `items` into consecutive runs of at most `size`, preserving order.
 * Order matters: bin/select emits surfaces sorted by score, so chunk 0 holds
 * the highest-priority surfaces and a run that dies partway through has still
 * covered the ones that mattered most.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Characters allowed in a value the workflow interpolates UNQUOTED into a shell
 * command line (`--registry ${REGISTRY}`, `--lane ${args.lane}`). Deliberately a
 * strict allow-list rather than a metacharacter deny-list: a deny-list has to be
 * right about every shell in every locale, an allow-list only has to be right
 * about what a path or a lane token actually needs.
 *
 * This is defense in depth, not the only defense. Through `ns` the registry can
 * only be `join(".nightshift", <hardcoded literal>)` because the launcher passes
 * `--pack .nightshift` verbatim — but `bin/workflow-args` is a command anyone can
 * call with a hand-written plan, and bin/lane-plan's own containment guarantee is
 * documented as LEXICAL: it will happily emit a registry path under a pack dir
 * whose NAME contains a semicolon.
 */
const SHELL_SAFE_PATH_RE = /^[A-Za-z0-9._/-]+$/;

/**
 * The ONLY keys a dispatch may carry.
 *
 * WHY AN EXACT SET AND NOT JUST "the three we need". The workflow spreads
 * dispatch LAST — `{ label, phase, agentType: args.agents.reviewer, ...s.dispatch }`
 * — so any extra key in a dispatch does not sit there harmlessly, it OVERRIDES
 * the option of the same name that the shell just set. A dispatch carrying
 * `agentType` silently replaces the lane's reviewer with something a registry
 * file chose; one carrying `label` or `phase` scrambles the progress tree.
 * bin/select cannot produce such a dispatch today (it copies a pinned const
 * table), which is exactly why this is cheap to guarantee and worth guaranteeing
 * before something upstream ever can.
 */
const DISPATCH_KEYS: readonly string[] = ["model", "effort", "maxTurns"];

/** Every field the workflow spreads into agent() must be present and sane. */
function checkDispatch(d: Dispatch | undefined, surfaceId: string): string | undefined {
  if (d === undefined) {
    return (
      `surface "${surfaceId}" has no \`dispatch\` — bin/select derives it from \`band\` via ` +
      `MODEL_BY_BAND and the workflow spreads it into agent() verbatim. A surface without ` +
      `one would review at whatever the harness defaults to, silently discarding the ` +
      `model/effort/turn budget this run was sized for. Re-run bin/select with the current ` +
      `engine build`
    );
  }
  if (!filled(d.model)) return `surface "${surfaceId}" has a dispatch with no \`model\``;
  if (d.effort !== "low" && d.effort !== "medium" && d.effort !== "high") {
    return `surface "${surfaceId}" has dispatch.effort "${String(d.effort)}" (expected low|medium|high)`;
  }
  if (!Number.isInteger(d.maxTurns) || d.maxTurns < 1) {
    return `surface "${surfaceId}" has dispatch.maxTurns "${String(d.maxTurns)}" (expected a positive integer)`;
  }
  const extra = Object.keys(d).filter((k) => !DISPATCH_KEYS.includes(k));
  if (extra.length > 0) {
    return (
      `surface "${surfaceId}" has dispatch key(s) ${extra.map((k) => `"${k}"`).join(", ")} ` +
      `outside {${DISPATCH_KEYS.join(", ")}} — the workflow spreads dispatch LAST into agent(), ` +
      `so an extra key OVERRIDES the option the shell just set (an "agentType" here would ` +
      `replace the lane's reviewer with whatever the registry chose)`
    );
  }
  return undefined;
}

/**
 * Build the Workflow args, or refuse with an operator-actionable reason.
 * Pure: no fs, no process, no clock — the CLI shell reads the files.
 */
export function buildWorkflowArgs(opts: BuildWorkflowArgsOpts): BuildWorkflowArgsResult {
  const { runId, lanePlan, surfaces, maxConcurrentReviewers } = opts;

  if (runId === "." || runId === ".." || !RUN_ID_RE.test(runId)) {
    return refuse(
      `run_id "${runId}" must be filename-safe (matches ${RUN_ID_RE} and is not "." or "..") — ` +
        `it becomes this run's scratch directory name and is interpolated into every bin/ ` +
        `command line the workflow issues`,
    );
  }

  if (!Number.isInteger(maxConcurrentReviewers) || maxConcurrentReviewers < 1) {
    return refuse(
      `max_concurrent_reviewers must be an integer >= 1, got "${String(maxConcurrentReviewers)}" — ` +
        `it caps how many reviewer+refuter pairs are in flight at once (set it in $OPS/config.yml)`,
    );
  }

  // ── the lane plan ────────────────────────────────────────────────────────
  if (lanePlan === null || typeof lanePlan !== "object") {
    return refuse(`lane plan did not parse to an object — bin/lane-plan writes a JSON object`);
  }
  if (lanePlan.lane !== "security" && lanePlan.lane !== "design") {
    return refuse(
      `lane plan has lane "${String(lanePlan.lane)}" (expected "security" or "design") — the ` +
        `workflow interpolates it into run-meta/dedupe/rollup command lines and into every ` +
        `judgment prompt, so an absent or unknown lane becomes the literal text there`,
    );
  }
  if (!filled(lanePlan.registry)) {
    return refuse(
      `lane plan has no \`registry\` — record and rollup stamp coverage freshness into exactly ` +
        `that file, and an absent value reaches them as "--registry undefined"`,
    );
  }
  if (!SHELL_SAFE_PATH_RE.test(lanePlan.registry)) {
    return refuse(
      `lane plan registry "${lanePlan.registry}" is not a plain path ` +
        `(allowed: letters, digits, "." "_" "-" "/") — the workflow interpolates it UNQUOTED ` +
        `into the record and rollup command lines, so a space, quote, newline or shell ` +
        `metacharacter there is command injection, not a bad path`,
    );
  }
  const agents = lanePlan.agents;
  if (agents === null || typeof agents !== "object") {
    return refuse(`lane plan has no \`agents\` object (reviewer, refuter_tier1, refuter_tier2)`);
  }
  for (const role of ["reviewer", "refuter_tier1", "refuter_tier2"] as const) {
    const value = agents[role];
    if (!filled(value)) {
      return refuse(
        `lane plan has no \`agents.${role}\` — the workflow passes it straight to agent() as ` +
          `agentType, and an absent value dispatches every ${role} to an agent that does not exist`,
      );
    }
    if (!isSafeAgentType(value.trim())) {
      return refuse(
        `lane plan agents.${role} "${value}" is not a safe agent id — agentTypes cross into the ` +
          `sandbox as control-plane data`,
      );
    }
  }

  // ── the surfaces ─────────────────────────────────────────────────────────
  if (!Array.isArray(surfaces)) {
    return refuse(`surfaces.json did not parse to an array — bin/select writes a JSON array`);
  }
  if (surfaces.length === 0) {
    return {
      ok: false,
      kind: "nothing-to-review",
      reason:
        `bin/select picked 0 surfaces for lane "${lanePlan.lane}" — nothing is stale enough ` +
        `or changed enough to review. This is a quiet night, not a failure`,
    };
  }

  // Surface ids become directory names under .run/<id>/surfaces/ AND are quoted
  // into the reviewer's prompt as the required dedupe_key.surface value. A bad
  // id here would either escape the run dir or make every candidate fail
  // merge-candidates' binding assert, mid-run, after the models were billed.
  const seen = new Set<string>();
  for (const s of surfaces) {
    if (s === null || typeof s !== "object") {
      return refuse(`surfaces.json contains a non-object entry — bin/select writes Surface records`);
    }
    if (!filled(s.id)) {
      return refuse(`a surface in surfaces.json has no \`id\` — every surface must name its registry entry`);
    }
    if (s.id === "." || s.id === ".." || !RUN_ID_RE.test(s.id)) {
      return refuse(
        `surface id "${s.id}" is not filename-safe (matches ${RUN_ID_RE} and is not "." or "..") — ` +
          `it becomes a directory name under the run dir and is quoted into the reviewer's prompt; ` +
          `fix the \`id\` of that entry in the lane registry`,
      );
    }
    if (seen.has(s.id)) {
      return refuse(
        `surface id "${s.id}" appears twice in surfaces.json — two reviewers would write the ` +
          `same artifact paths and race each other; fix the duplicate \`id\` in the lane registry`,
      );
    }
    seen.add(s.id);

    const dispatchProblem = checkDispatch(s.dispatch, s.id);
    if (dispatchProblem !== undefined) return refuse(dispatchProblem);
  }

  return {
    ok: true,
    args: {
      run_id: runId,
      lane: lanePlan.lane,
      surface_chunks: chunk(surfaces, maxConcurrentReviewers),
      registry: lanePlan.registry,
      agents: {
        reviewer: lanePlan.agents.reviewer,
        refuter_tier1: lanePlan.agents.refuter_tier1,
        refuter_tier2: lanePlan.agents.refuter_tier2,
      },
    },
    chunks: Math.ceil(surfaces.length / maxConcurrentReviewers),
  };
}
