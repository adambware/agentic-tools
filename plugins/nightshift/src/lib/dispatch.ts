// Band -> compute allocation (run-loop.md fan-out). This is the ONLY place
// band -> compute is decided: a lookup table inside the workflow sandbox would
// be untestable decision logic (E4), so bin/select decides it here, once, and
// the workflow just passes Surface.dispatch verbatim to agent(). The snapshot
// test below pins the table so any tier change is a deliberate red-CI event,
// never a silent drift.
import type { Band, Dispatch } from "./types.js";

export const MODEL_BY_BAND: Record<Band, Dispatch> = {
  critical: { model: "opus", effort: "high", maxTurns: 40 },
  high: { model: "opus", effort: "medium", maxTurns: 32 },
  medium: { model: "sonnet", effort: "medium", maxTurns: 24 },
  low: { model: "haiku", effort: "low", maxTurns: 16 },
};

/** Pure lookup. Returns a fresh copy so callers can't mutate MODEL_BY_BAND. */
export function dispatchForBand(band: Band): Dispatch {
  return { ...MODEL_BY_BAND[band] };
}
