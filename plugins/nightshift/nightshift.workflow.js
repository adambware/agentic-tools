// nightshift.workflow.js — the security lane orchestrator (spike shell).
//
// THIN-SHELL RULE (E4): this file carries ZERO decision logic. No `if`, no score,
// no threshold, no selection — every such branch lives in a vitest-covered bin/
// command. The workflow only SEQUENCES: plumbing (free Bash → bin/*.mjs) and
// judgment (subscription agents). LOC ceiling ~60; any new conditional here must
// instead become a bin/ command with a test.
//
// FILES-NOT-TEXT (E2/E3): plumbing agents only invoke a script and return its exit
// code / stderr tail. Judgment agents read/write schema'd files on disk
// (surfaces.json, candidates.json) — artifact data never rides the model's text
// channel. bin/validate gates every model-written artifact before the stateful
// path; the record step is chained with `&&` so a validate failure ABORTS the run
// (no partial commit, E6).
//
// Paths assume the cwd is the target repo (the pack lives at ./.nightshift). The
// engine bin/ is at ${CLAUDE_PLUGIN_ROOT}/bin. Run dir: .nightshift/.run/<run_id>.
export const meta = {
  name: "nightshift-security",
  description:
    "One bounded security review run: select stalest/changed vectors, fan out reviewer + Tier-1 refuter, then validate→dedupe→record→rollup deterministically.",
  phases: [
    { title: "select", detail: "bin/select → surfaces.json (free Bash)" },
    { title: "review", detail: "security-reviewer + Tier-1 refuter (subscription)" },
    { title: "record", detail: "validate→dedupe→record→rollup (free Bash, abort on validate fail)" },
  ],
};

const ENGINE = "${CLAUDE_PLUGIN_ROOT}";
const PACK = ".nightshift";
const RUN = `${PACK}/.run`;

// Self-arm the read-only guard for the duration of this run. The PreToolUse
// guard is inert unless NIGHTSHIFT_LANE_RUN is set, so it never blocks normal
// interactive work; arming it here gives in-session runs the defense-in-depth
// backstop on top of the agentType read-only restriction. Harmless if the env
// does not propagate to the hook subprocess — the agentType control still holds.
process.env.NIGHTSHIFT_LANE_RUN = "1";

// ── select (plumbing) ───────────────────────────────────────────────────────
phase("select");
await agent(
  `Run exactly this and nothing else, then return ONLY the process exit code and the last line of stderr:\n` +
    `node ${ENGINE}/bin/select.mjs --vectors ${PACK}/registries/vectors.yml ` +
    `--manifest ${PACK}/manifest.yml --lane security --repo . --out ${RUN}/surfaces.json`,
  { label: "plumbing:select", phase: "select" },
);

// ── review (judgment) ───────────────────────────────────────────────────────
// One reviewer + one Tier-1 refuter (spike scope). The reviewer reads the top
// surface from surfaces.json and writes its candidate; the refuter tries to kill
// it and rewrites the surviving candidates. Neither returns finding data as text.
phase("review");
await agent(
  `You are the nightshift security-reviewer. Read ${RUN}/surfaces.json and review the ` +
    `surface at index 0 against its mapped code (read-only). Write the proposed finding(s) ` +
    `as a JSON array to ${RUN}/candidates.json in the candidate-finding schema. Do NOT ` +
    `print the finding; return only "DONE" or a one-line error.`,
  { label: "security-reviewer", phase: "review", agentType: "security-reviewer" },
);
await agent(
  `You are the nightshift Tier-1 security-refuter. Independently re-read the code behind ` +
    `each candidate in ${RUN}/candidates.json and try to REFUTE it. Overwrite ` +
    `${RUN}/candidates.json with only the candidates that survive (an empty array if none ` +
    `survive — no Tier-1 refute means no finding may be logged). Return only "DONE" or a ` +
    `one-line error.`,
  { label: "security-refuter", phase: "review", agentType: "security-refuter" },
);

// ── record (plumbing) ───────────────────────────────────────────────────────
// validate gates the model-written artifact; `&&` chaining makes a validate
// failure abort before dedupe/record/rollup touch durable state.
phase("record");
await agent(
  `Run exactly this single chained command and return ONLY the final exit code and the ` +
    `last line of stderr (do not fix or retry on failure — a non-zero exit is the run ` +
    `aborting by design):\n` +
    `node ${ENGINE}/bin/validate.mjs --schema candidate-finding --file ${RUN}/candidates.json ` +
    `&& node ${ENGINE}/bin/dedupe.mjs --candidates ${RUN}/candidates.json ` +
    `--metrics-dir ${PACK}/metrics --suppressions ${PACK}/findings/suppressions.yml ` +
    `--out ${RUN}/decisions.json --run-id "$NIGHTSHIFT_RUN_ID" --lane security ` +
    `&& node ${ENGINE}/bin/record.mjs --decisions ${RUN}/decisions.json ` +
    `--run-meta ${RUN}/run.json --metrics-dir ${PACK}/metrics --registry ${PACK}/registries/vectors.yml ` +
    `&& node ${ENGINE}/bin/rollup.mjs --registry ${PACK}/registries/vectors.yml ` +
    `--metrics-dir ${PACK}/metrics --lane security`,
  { label: "plumbing:record", phase: "record" },
);

return { status: "complete" };
