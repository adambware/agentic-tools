// nightshift.workflow.js — the security lane orchestrator (v2: dynamic full-K).
//
// THIN-SHELL RULE (E4): this file carries ZERO decision logic. No `if`, no
// ternary, no score, no threshold, no lookup table — every such branch lives in
// a vitest-covered bin/ command. The workflow only SEQUENCES: plumbing (free
// Bash → bin/*.mjs) and judgment (subscription agents). Any new conditional
// here must instead become a bin/ command with a test. Per-surface compute
// (model/effort/turns) is NOT decided here: bin/select derives it from `band`
// via the pinned MODEL_BY_BAND const and every surface arrives carrying its
// `dispatch` — this file spreads it into agent() verbatim.
//
// FILES-NOT-TEXT (E2/E3): plumbing agents only invoke a script and return its
// exit code / stderr tail. Judgment agents read/write schema'd files on disk —
// finding data never rides the model's text channel. The ONE sanctioned
// exception (CONTRACTS.md E2 amendment): control-plane id lists — here the
// gated surface ids from bin/tier2-gate — may ride structured output so the
// workflow knows which Tier-2 refuters to dispatch. bin/validate gates every
// model-written artifact before the stateful path; the record step is chained
// with `&&` so a validate failure ABORTS the run (no partial commit, E6).
//
// ARGS CONTRACT (launcher-side, A7/T11): select runs BEFORE Claude is invoked
// (`ns` calls bin/select --out .nightshift/.run/<run_id>/surfaces.json), then
// passes control-plane data in as args — the sandbox has no fs/process, so
// args is the sanctioned channel for the dispatch list:
//   args = {
//     run_id:  string            // filename-safe; bins re-assert (RUN_ID_RE)
//     lane:    string            // "security" (design lane lands in A5)
//     surface_chunks: Surface[][] // the selected surfaces (each carrying its
//                                 // dispatch), pre-chunked launcher-side per
//                                 // max_concurrent_reviewers; the workflow
//                                 // pipelines within a chunk and sequences
//                                 // across chunks (chunking is data shaping,
//                                 // not a decision here)
//   }
// The read-only guard is armed by the LAUNCHING session (NIGHTSHIFT_LANE_RUN=1
// in the env); the workflow cannot self-arm — `process` is undefined in the
// sandbox. Judgment agents carry Write ONLY for run artifacts; the armed guard
// denies any write outside .nightshift/. Two more launcher obligations (A7):
//   - export NIGHTSHIFT_TODAY once for the whole run: run-meta and dedupe
//     resolve "today" in SEPARATE agent turns, and a run straddling UTC
//     midnight would otherwise abort at record's provenance date assert;
//   - mint a FRESH run_id (and therefore run dir) for every attempt, retries
//     included: merge-candidates has no notion of artifact freshness, so a
//     reused run dir would resurrect a prior aborted attempt's artifacts as
//     this run's coverage.
export const meta = {
  name: "nightshift-security",
  description:
    "One bounded security review run: full-K fan-out of reviewer + Tier-1 refuter per selected surface, deterministic merge, conditional Tier-2 refute, then validate→dedupe→record→rollup.",
  phases: [
    { title: "review", detail: "per-surface reviewer + Tier-1 refuter (subscription, dispatch from bin/select)" },
    { title: "merge", detail: "bin/merge-candidates union of complete surface dirs + validate (free Bash)" },
    { title: "tier2", detail: "bin/tier2-gate → conditional Tier-2 refuters → assemble (predicate in code)" },
    { title: "record", detail: "run-meta --tier2 → validate → dedupe → record → rollup (abort on validate fail)" },
  ],
};

const ENGINE = "${CLAUDE_PLUGIN_ROOT}";
const PACK = ".nightshift";
const RUN = `${PACK}/.run/${args.run_id}`;
// A5 parameterizes the registry file per lane; the security registry is the
// only one this workflow touches today.
const REGISTRY = `${PACK}/registries/vectors.yml`;

// Control-plane id list riding structured output (E2 amendment): ids only,
// never finding data.
const TIER2_SURFACES_SCHEMA = {
  type: "object",
  properties: {
    surfaces: { type: "array", items: { type: "string" } },
  },
  required: ["surfaces"],
};

// ── review (judgment, full-K fan-out) ───────────────────────────────────────
// One reviewer + one Tier-1 refuter PER SURFACE, pipelined (surface B's review
// starts while surface A refutes). Each surface's artifacts live in its own
// dir: .run/<id>/surfaces/<sid>/{reviewed.json, candidates.proposed.json,
// candidates.json}. A crashed stage drops its surface to null — that surface
// simply produces no complete dir and bin/merge-candidates leaves it out of
// the union (§9.16: it stays stale and is re-selected next run; no silent
// freshness corruption). Chunks run sequentially: the launcher sized them.
phase("review");
for (const chunk of args.surface_chunks) {
  await pipeline(
    chunk,
    (s) =>
      agent(
        `You are the nightshift security-reviewer. Your assigned surface (control-plane record): ` +
          `${JSON.stringify(s)}\n` +
          `Review ONLY this surface's mapped code in this repo (read-only) against the vector it names. ` +
          `Write your proposed finding(s) as a JSON array to ${RUN}/surfaces/${s.id}/candidates.proposed.json ` +
          `in the candidate-finding schema — every candidate's dedupe_key.surface MUST be exactly "${s.id}" ` +
          `(the engine aborts the run on any other value). Write an empty array if you found nothing. ` +
          `Then write ${RUN}/surfaces/${s.id}/reviewed.json: the JSON array ["${s.id}"] if you FULLY reviewed ` +
          `this surface, or [] if you could not — never list any other surface id, and never claim coverage ` +
          `you did not do (this file drives registry freshness stamps). Do NOT print any finding; return ` +
          `only "DONE" or a one-line error.`,
        { label: `review:${s.id}`, phase: "review", agentType: "security-reviewer", ...s.dispatch },
      ),
    (r, s) =>
      agent(
        `You are the nightshift Tier-1 security-refuter for surface "${s.id}". Independently re-read the ` +
          `code behind each candidate in ${RUN}/surfaces/${s.id}/candidates.proposed.json and try to REFUTE ` +
          `it. Write ${RUN}/surfaces/${s.id}/candidates.json containing only the candidates that survive, ` +
          `byte-identical per surviving candidate (never edit dedupe_key — the engine enforces remove-only ` +
          `identity and aborts on substitution); an empty array if none survive — no Tier-1 refute means no ` +
          `finding may be logged. Return only "DONE" or a one-line error.`,
        { label: `refute:${s.id}`, phase: "review", agentType: "security-refuter" },
      ),
  );
}

// ── merge (plumbing) ────────────────────────────────────────────────────────
// Deterministic union of the per-surface dirs that produced COMPLETE artifacts
// (all three files) into the run-level reviewed.json / candidates.proposed.json
// / candidates.json. Binding (candidate ↔ surface) and path containment are
// asserted inside the bin (exit 2 aborts). Both merged candidate artifacts are
// schema-gated before anything downstream reads them.
phase("merge");
await agent(
  `Run exactly this single chained command and return ONLY the final exit code and the last line of ` +
    `stderr (do not fix or retry on failure — a non-zero exit is the run aborting by design):\n` +
    `node ${ENGINE}/bin/merge-candidates.mjs --run-dir ${RUN} ` +
    `&& node ${ENGINE}/bin/validate.mjs --schema candidate-finding --file ${RUN}/candidates.proposed.json ` +
    `&& node ${ENGINE}/bin/validate.mjs --schema candidate-finding --file ${RUN}/candidates.json`,
  { label: "plumbing:merge", phase: "merge", model: "haiku", effort: "low" },
);

// ── tier2 (gate in code, judgment fan-out, assemble in code) ────────────────
// bin/tier2-gate applies the union predicate (critical/high severity OR low
// confidence) to the Tier-1 survivors — the ONLY thing that comes back through
// the model is the gated surface id list (control-plane). One Tier-2 refuter
// per gated surface reads its tier2.pending.json and writes its
// tier2.survivors.json (files-not-text). Assemble refuses to proceed if any
// gated surface is missing its survivors file (a crashed Tier-2 refuter aborts
// the run BEFORE run-meta — nothing gets stamped, no accounting corrupts).
phase("tier2");
const gate = await agent(
  `Run exactly this and nothing else:\n` +
    `node ${ENGINE}/bin/tier2-gate.mjs --run-dir ${RUN}\n` +
    `If the exit code is non-zero, fail with the last line of stderr. Otherwise read ${RUN}/tier2.json ` +
    `(a JSON array of surface id strings — control-plane ids only) and return it via structured output ` +
    `as {"surfaces": [...]}.`,
  { label: "plumbing:tier2-gate", phase: "tier2", model: "haiku", effort: "low", schema: TIER2_SURFACES_SCHEMA },
);
await pipeline(gate.surfaces, (sid) =>
  agent(
    `You are the nightshift Tier-2 security-refuter (the conditional deeper second stage) for surface ` +
      `"${sid}". Read ${RUN}/surfaces/${sid}/tier2.pending.json — Tier-1 survivors gated to you because ` +
      `they are critical/high severity or low confidence. Independently re-derive each from source at ` +
      `depth per your instructions, then write ${RUN}/surfaces/${sid}/tier2.survivors.json: a JSON array ` +
      `of ONLY the candidates that survive your deeper re-read, byte-identical per surviving candidate ` +
      `except you may lower confidence and must set needs_human_verification true on critical/high ` +
      `(never edit dedupe_key — the engine enforces remove-only identity and aborts on substitution). ` +
      `An empty array is a valid, complete answer. Do NOT print any finding; return only "DONE" or a ` +
      `one-line error.`,
    { label: `tier2:${sid}`, phase: "tier2", agentType: "security-refuter-2", effort: "high" },
  ),
);
await agent(
  `Run exactly this and nothing else, then return ONLY the process exit code and the last line of stderr:\n` +
    `node ${ENGINE}/bin/tier2-gate.mjs --run-dir ${RUN} --assemble`,
  { label: "plumbing:tier2-assemble", phase: "tier2", model: "haiku", effort: "low" },
);

// ── record (plumbing) ───────────────────────────────────────────────────────
// run-meta runs first (it only writes the disposable run.json) and computes the
// REAL rejected_tier2 from candidates.tier2.json under the same canonical
// dedupe_key identity gate as Tier-1. Then the stateful chain: validate the
// post-Tier-2 survivor set, dedupe it, record, rollup — `&&`-chained so any
// failure aborts before durable state is touched (E6). dedupe/record consume
// candidates.tier2.json: a finding is logged only if it survived BOTH tiers.
phase("record");
await agent(
  `Run exactly this and nothing else, then return ONLY the process exit code and the last line of stderr:\n` +
    `node ${ENGINE}/bin/run-meta.mjs --surfaces ${RUN}/surfaces.json ` +
    `--proposed ${RUN}/candidates.proposed.json --survivors ${RUN}/candidates.json ` +
    `--reviewed ${RUN}/reviewed.json --tier2 ${RUN}/candidates.tier2.json ` +
    `--run-id "${args.run_id}" --lane ${args.lane} --pack ${PACK} --repo . --out ${RUN}/run.json`,
  { label: "plumbing:run-meta", phase: "record", model: "haiku", effort: "low" },
);
await agent(
  `Run exactly this single chained command and return ONLY the final exit code and the last line of ` +
    `stderr (do not fix or retry on failure — a non-zero exit is the run aborting by design):\n` +
    `node ${ENGINE}/bin/validate.mjs --schema candidate-finding --file ${RUN}/candidates.tier2.json ` +
    `&& node ${ENGINE}/bin/dedupe.mjs --candidates ${RUN}/candidates.tier2.json ` +
    `--metrics-dir ${PACK}/metrics --suppressions ${PACK}/findings/suppressions.yml ` +
    `--out ${RUN}/decisions.json --run-id "${args.run_id}" --lane ${args.lane} ` +
    `&& node ${ENGINE}/bin/record.mjs --decisions ${RUN}/decisions.json ` +
    `--run-meta ${RUN}/run.json --metrics-dir ${PACK}/metrics --registry ${REGISTRY} ` +
    `&& node ${ENGINE}/bin/rollup.mjs --registry ${REGISTRY} ` +
    `--metrics-dir ${PACK}/metrics --lane ${args.lane}`,
  { label: "plumbing:record", phase: "record", model: "haiku", effort: "low" },
);

return { status: "complete" };
