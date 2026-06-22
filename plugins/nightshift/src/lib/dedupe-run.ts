// bin/dedupe logic (run-loop.md step 4). Partition validated candidate findings
// into new / recurring / suppressed against the open-findings log + active
// suppressions. Pure; the CLI shell handles file I/O. Output (decisions.json) is
// the files-not-text seam (E2) that bin/record consumes.
import type { CandidateFinding, Finding, Suppression, Lane } from "./types.js";
import { matchOpenFinding, activeSuppression } from "./dedupekey.js";

export type Decision =
  | { decision: "new"; finding: CandidateFinding }
  | { decision: "recurring"; finding: CandidateFinding; first_seen: string }
  | { decision: "suppressed"; finding: CandidateFinding };

export interface Decisions {
  run_id: string;
  lane: Lane;
  date: string;
  decisions: Decision[];
  counts: { confirmed: number; recurring: number; suppressed: number };
}

export interface DedupeInput {
  run_id: string;
  lane: Lane;
  today: string;
  candidates: CandidateFinding[];
  openFindings: Finding[];
  suppressions: Suppression[];
}

export function dedupe(input: DedupeInput): Decisions {
  const decisions: Decision[] = [];
  let confirmed = 0;
  let recurring = 0;
  let suppressed = 0;

  for (const finding of input.candidates) {
    const supp = activeSuppression(finding.dedupe_key, input.suppressions, input.today);
    if (supp) {
      decisions.push({ decision: "suppressed", finding });
      suppressed++;
      continue;
    }
    const open = matchOpenFinding(finding.dedupe_key, input.openFindings);
    if (open) {
      decisions.push({ decision: "recurring", finding, first_seen: open.first_seen });
      recurring++;
      continue;
    }
    decisions.push({ decision: "new", finding });
    confirmed++;
  }

  return {
    run_id: input.run_id,
    lane: input.lane,
    date: input.today,
    decisions,
    counts: { confirmed, recurring, suppressed },
  };
}
