// nightshift.spike.workflow.js — one-off spike run against BearHost.
// Absolute paths (session cwd is agentic-tools, target repo is bearhost).
// Goal: generate real Workflow agent() turns to capture spike questions
//   #1 billing (user checks usage after), #3 guard-in-workflow, #7 per-agent cost.
// Driven "manually": this script stops after review; run.json + the
// validate→dedupe→record→rollup chain are done by hand afterward.

export const meta = {
  name: "nightshift-spike-bearhost",
  description:
    "Spike: probe PreToolUse guard inside a workflow agent(), then run the security lane (select → reviewer → Tier-1 refuter) against BearHost surface index 0.",
  phases: [
    { title: "select", detail: "bin/select → surfaces.json (free Bash)" },
    { title: "review", detail: "security-reviewer (sonnet) + Tier-1 refuter (haiku)" },
  ],
};

const ENGINE = "/Users/adamboulware/Developer/agentic-tools/plugins/nightshift";
const REPO = "/Users/adamboulware/Developer/bearhost";
const PACK = `${REPO}/.nightshift`;
const RUN = `${PACK}/.run`;

// ── select (plumbing) ────────────────────────────────────────────────────────
phase("select");
const sel = await agent(
  `Run exactly this command and nothing else, then return ONLY the process exit code and the last line of stderr:\n` +
    `node ${ENGINE}/bin/select.mjs --vectors ${PACK}/registries/vectors.yml ` +
    `--manifest ${PACK}/manifest.yml --lane security --repo ${REPO} --out ${RUN}/surfaces.json`,
  { label: "plumbing:select", phase: "select" },
);

// ── review (judgment) ────────────────────────────────────────────────────────
phase("review");
const REVIEWER_PROMPT =
  `You are the nightshift defensive security-reviewer. Assurance, not attack: ask ` +
  `"is this surface adequately protected against this vector, under the preconditions that would have to hold?"\n\n` +
  `DEFENSIVE BOUNDARY (non-negotiable): analyze whether a surface is adequately protected and reason about ` +
  `abusability UNDER STATED PRECONDITIONS. You MUST NOT produce exploit payloads, weaponized PoCs, offensive ` +
  `tooling, or detection-evasion. Only "here is the invariant that should hold and does not." Tools: Read, Grep, Glob only.\n\n` +
  `TASK:\n` +
  `1. Read ${RUN}/surfaces.json and take the surface at index 0 (its id, title, area globs, weight, asvs_ref).\n` +
  `2. Resolve the area globs to real code under ${REPO} and read the relevant middleware/services/repositories/policies/config.\n` +
  `3. For the vector in the title, find the protective invariant (authz check, tenant scope, signature verify, rate limit, ` +
  `input validation, secret handling). Is it present, correct, and reachable on EVERY path? Look for the gap, not the exploit.\n` +
  `4. Establish honest preconditions (role/session, tenant/account setup, affected path, impact). If you cannot state honest ` +
  `preconditions, you do not have a finding.\n` +
  `5. Write the proposed finding(s) as a JSON ARRAY to ${RUN}/candidates.json in this candidate-finding schema per element:\n` +
  `   { "dedupe_key": {"surface","symptom","root_cause"}, "severity": critical|high|medium|low, ` +
  `"confidence": low|medium|high, "needs_human_verification": bool (ALWAYS true for critical|high), ` +
  `"asvs_ref": string, "location": "file:line/symbol", "why_abusable_under_preconditions": string (reasoning, not a payload), ` +
  `"preconditions": {"required_role/session","tenant/account setup","affected path","impact","confidence"} }\n` +
  `   If you find nothing real, write an empty array []. A clean review is a valid, valuable result — optimize for coverage ` +
  `and confidence, not finding count.\n` +
  `Do NOT print the finding contents. Return ONLY a one-line summary: how many candidates you wrote and their dedupe_key surfaces.`;
const reviewer = await agent(REVIEWER_PROMPT, { label: "security-reviewer", phase: "review", model: "sonnet" });

const REFUTER_PROMPT =
  `You are the nightshift Tier-1 independent security-refuter — the cheap, always-on first pass. ` +
  `"No Tier-1 refute → no log." Reducing the false-positive rate is your north star. Tools: Read, Grep, Glob only. ` +
  `Defensive only — no exploits/payloads.\n\n` +
  `TASK: Read ${RUN}/candidates.json. For EACH candidate, independently RE-READ the actual code at its cited location under ` +
  `${REPO} (do not trust the reviewer's prose). Try in good faith to refute it:\n` +
  `- Is it actually reachable? Does the protective invariant the reviewer claims is missing actually exist somewhere ` +
  `(middleware, policy, global scope, guard, gateway)?\n` +
  `- Are the preconditions real and self-consistent?\n` +
  `- Already mitigated by an existing control the reviewer missed?\n` +
  `- False positive / out of scope / duplicate?\n\n` +
  `Then OVERWRITE ${RUN}/candidates.json with a JSON ARRAY of ONLY the candidates that SURVIVE refutation (empty array [] if ` +
  `none survive). For each survivor, ensure needs_human_verification:true when severity is critical|high; you may lower ` +
  `confidence with reason. Be decisive — a confident reject on a false positive is exactly your value.\n` +
  `Return ONLY a one-line summary: how many candidates survived, how many you rejected, and the rejection reasons.`;
const refuter = await agent(REFUTER_PROMPT, { label: "security-refuter", phase: "review", model: "haiku" });

return {
  status: "review-complete",
  selectNote: sel,
  reviewerNote: reviewer,
  refuterNote: refuter,
};
