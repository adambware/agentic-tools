// Band -> compute allocation (run-loop.md fan-out). This is the ONLY place
// band -> compute is decided: a lookup table inside the workflow sandbox would
// be untestable decision logic (E4), so bin/select decides it here, once, and
// the workflow just passes Surface.dispatch verbatim to agent(). The snapshot
// test below pins the table so any tier change is a deliberate red-CI event,
// never a silent drift.
import type { Band, Dispatch } from "./types.js";

// maxTurns for the two opus bands was raised from 40/32 by the first real runs
// (v3 A7 Part 2). At 40, BOTH critical reviewers of a two-surface run were still
// reading when the budget ran out, and neither ever reached the Write that produces
// its artifacts. The run then completed correctly and recorded `reviewed: 0` — a
// chain that worked perfectly and reviewed nothing, for $4.12. A budget that cannot
// reach the write is not a cheaper review, it is a run with no output at all.
//
// critical is now an evidenced number rather than a doubling. On the run that passed
// the gate its two critical reviewers used 42 and 39 TOOL CALLS end to end; turns are
// the conservative proxy for that measurement, not the same unit. 56 is that observed
// ceiling of 42 plus headroom for a wider surface. high at 48 is NOT
// independently measured — no high-band surface has ever run. It is set below
// critical because a lower band must never out-spend a higher one, and it should be
// re-derived from the first real high-band run rather than trusted.
export const MODEL_BY_BAND: Record<Band, Dispatch> = {
  critical: { model: "opus", effort: "high", maxTurns: 56 },
  high: { model: "opus", effort: "medium", maxTurns: 48 },
  medium: { model: "sonnet", effort: "medium", maxTurns: 24 },
  low: { model: "haiku", effort: "low", maxTurns: 16 },
};

/** Pure lookup. Returns a fresh copy so callers can't mutate MODEL_BY_BAND. */
export function dispatchForBand(band: Band): Dispatch {
  return { ...MODEL_BY_BAND[band] };
}
