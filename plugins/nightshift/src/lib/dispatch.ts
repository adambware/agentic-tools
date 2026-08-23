// Band -> compute allocation (run-loop.md fan-out). This is the ONLY place
// band -> compute is decided: a lookup table inside the workflow sandbox would
// be untestable decision logic (E4), so bin/select decides it here, once, and
// the workflow just passes Surface.dispatch verbatim to agent(). The snapshot
// test below pins the table so any tier change is a deliberate red-CI event,
// never a silent drift.
import type { Band, Dispatch } from "./types.js";

// maxTurns for the two opus bands was raised from 40/32 by the first real runs
// (v3 A7 Part 2). A critical surface on a real codebase is 7-10 area globs across
// services, middleware, repositories and SQL migrations; at 40 turns BOTH
// reviewers of a two-surface run were still reading when the budget ran out, and
// neither ever reached the Write that produces its artifacts. The run then
// completed correctly and recorded `reviewed: 0` — a chain that worked perfectly
// and reviewed nothing, for $4.12. A budget that cannot reach the write is not a
// cheaper review, it is a run with no output at all.
export const MODEL_BY_BAND: Record<Band, Dispatch> = {
  critical: { model: "opus", effort: "high", maxTurns: 80 },
  high: { model: "opus", effort: "medium", maxTurns: 64 },
  medium: { model: "sonnet", effort: "medium", maxTurns: 24 },
  low: { model: "haiku", effort: "low", maxTurns: 16 },
};

/** Pure lookup. Returns a fresh copy so callers can't mutate MODEL_BY_BAND. */
export function dispatchForBand(band: Band): Dispatch {
  return { ...MODEL_BY_BAND[band] };
}
