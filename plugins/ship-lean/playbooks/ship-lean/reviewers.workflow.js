export const meta = {
  name: 'ship-lean-reviewers',
  description: 'Lean /ship review: parallel read-only reviewers over an out-of-repo patch file; optional adversarial refute. Applies zero fixes.',
  whenToUse: 'Invoked by the /ship overlay to run ship Step 9 (specialist dispatch) or Step 11 (adversarial pass) as a read-only fan-out while the working tree stays frozen.',
  phases: [
    { title: 'Review', detail: 'one read-only reviewer per lens over the patch' },
    { title: 'Verify', detail: 'adversarially refute surviving CRITICAL findings' },
    { title: 'Adversarial', detail: 'independent skeptic read of the whole diff' },
  ],
}

// ---- args contract (passed by the orchestrator running /ship) ----
// {
//   stage:     'review' | 'adversarial'      (required)
//   patchFile: '/abs/path/OUTSIDE/the/repo.patch'   (required; unified diff)
//   repoRoot:  '/abs/repo'                    (for context reads)
//   diffBase:  'origin/main' or merge-base sha (informational)
//   lenses:    ['correctness','security','tests-gates','contracts']  (review stage)
//   checklists:{ <lens>: '/abs/checklist.md' } (optional, per lens)
//   verify:    true|false                     (review stage; default true)
// }
const a = args || {}
const STAGE = a.stage || 'review'
const PATCH = a.patchFile
const ROOT = a.repoRoot || ''
const BASE = a.diffBase || ''
const CHECKLISTS = a.checklists || {}
const VERIFY = a.verify !== false

if (!PATCH) throw new Error('reviewers.workflow: args.patchFile (absolute path, OUTSIDE repo) is required')

const FINDING_PROPS = {
  severity: { enum: ['CRITICAL', 'INFORMATIONAL'] },
  confidence: { type: 'integer' },
  path: { type: 'string' },
  line: { type: 'integer' },
  category: { type: 'string' },
  summary: { type: 'string' },
  fix: { type: 'string' },
  fingerprint: { type: 'string' },
  specialist: { type: 'string' },
}
const FINDING_SCHEMA = { type: 'object', properties: FINDING_PROPS, required: ['severity', 'path', 'category', 'summary', 'specialist'] }
const LENS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    ok: { type: 'boolean' },
    rationale: { type: 'string' },
    findings: { type: 'array', items: FINDING_SCHEMA },
  },
  required: ['lens', 'ok', 'findings'],
}
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    confidence: { type: 'integer' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

function lensPrompt(lens) {
  const cl = CHECKLISTS[lens] ? `\nApply the specialist checklist at: ${CHECKLISTS[lens]} (Read it; do not paste it back).` : ''
  return `Lens: ${lens}
Patch file (unified diff, OUTSIDE the repo — read it): ${PATCH}
Repo root (read-only context only): ${ROOT}
Diff base: ${BASE}${cl}

Review the changed hunks for your lens only. You may Read/Grep/Glob the repo for
context, but apply NO fixes and change nothing. Return the structured object:
{lens, ok, rationale, findings[]}. Set ok=false ONLY if you could not complete
the review (could not read the patch / ran out of context) — never to signal
"found problems". Include a no-findings rationale when findings is empty.`
}

if (STAGE === 'review') {
  phase('Review')
  const LENSES = (a.lenses && a.lenses.length) ? a.lenses : ['correctness', 'security', 'tests-gates', 'contracts']

  const raw = await parallel(LENSES.map((lens, i) => () =>
    agent(lensPrompt(lens), {
      label: `review:${lens}`,
      phase: 'Review',
      agentType: 'ship-lean-reviewer',
      model: 'sonnet',
      schema: LENS_SCHEMA,
    }).then(r => r || { lens, ok: false, rationale: 'agent returned null / died', findings: [] })))

  // No silent lens drops: a null/dead agent is ok:false, surfaced below.
  const lenses = LENSES.map((lens, i) => {
    const r = raw[i] || { lens, ok: false, rationale: 'agent returned null / died', findings: [] }
    if (!r.lens) r.lens = lens
    if (typeof r.ok !== 'boolean') r.ok = false
    if (!Array.isArray(r.findings)) r.findings = []
    return r
  })
  const anyLensFailed = lenses.some(l => l.ok === false)
  let findings = lenses.flatMap(l => l.findings)

  // Optional adversarial verify of CRITICAL findings (read-only refuters).
  if (VERIFY && findings.some(f => f.severity === 'CRITICAL')) {
    phase('Verify')
    const crit = findings.filter(f => f.severity === 'CRITICAL')
    const verdicts = await parallel(crit.map((f, i) => () =>
      parallel([0, 1].map(k => () =>
        agent(`Adversarially REFUTE this candidate finding. Default refuted=true if uncertain.
Finding: [${f.severity}] ${f.specialist} ${f.path}:${f.line || '?'} — ${f.summary}
Patch file (read it): ${PATCH}
Repo root (read-only context): ${ROOT}
Is this a real, exploitable/relevant problem in THIS diff, or a false positive?`,
          { label: `verify:${f.fingerprint || f.path}#${k}`, phase: 'Verify', agentType: 'ship-lean-reviewer', model: 'opus', schema: VERDICT_SCHEMA })))
        .then(vs => {
          const live = vs.filter(Boolean)
          // Drop only on a confident majority refutation; keep when verifiers died (fail-safe toward reporting).
          const refutes = live.filter(v => v.refuted).length
          const kept = !(live.length >= 1 && refutes >= Math.ceil(live.length / 2))
          return { f, kept, verifiers: live.length, refutes }
        })))
    const dropped = verdicts.filter(v => !v.kept)
    if (dropped.length) log(`verify: dropped ${dropped.length} CRITICAL false-positive(s): ${dropped.map(v => v.f.fingerprint || v.f.path).join(', ')}`)
    const keep = new Set(verdicts.filter(v => v.kept).map(v => v.f))
    findings = findings.filter(f => f.severity !== 'CRITICAL' || keep.has(f))
  }

  return { stage: 'review', lenses, anyLensFailed, findings, patchFile: PATCH }
}

if (STAGE === 'adversarial') {
  phase('Adversarial')
  // Independent skeptic read of the whole diff — find what the review missed,
  // and anything that defeats a gate. Read-only; zero fixes.
  const skeptics = ['gate-integrity', 'missed-regression', 'scope-drift']
  const raw = await parallel(skeptics.map((angle, i) => () =>
    agent(`You are an adversarial reviewer. Angle: ${angle}.
Patch file (unified diff, OUTSIDE the repo — read it): ${PATCH}
Repo root (read-only context only): ${ROOT}
Diff base: ${BASE}

Try hard to find a real problem the first-pass review would miss, through your
angle. Apply NO fixes. Return {lens, ok, rationale, findings[]} with lens="${angle}".`,
      { label: `adversarial:${angle}`, phase: 'Adversarial', agentType: 'ship-lean-reviewer', model: 'opus', schema: LENS_SCHEMA })
      .then(r => r || { lens: angle, ok: false, rationale: 'agent returned null / died', findings: [] })))

  const lenses = skeptics.map((angle, i) => {
    const r = raw[i] || { lens: angle, ok: false, rationale: 'agent returned null / died', findings: [] }
    if (!r.lens) r.lens = angle
    if (typeof r.ok !== 'boolean') r.ok = false
    if (!Array.isArray(r.findings)) r.findings = []
    return r
  })
  const anyLensFailed = lenses.some(l => l.ok === false)
  const findings = lenses.flatMap(l => l.findings)
  return { stage: 'adversarial', lenses, anyLensFailed, findings, patchFile: PATCH }
}

throw new Error(`reviewers.workflow: unknown stage '${STAGE}' (expected 'review' or 'adversarial')`)
