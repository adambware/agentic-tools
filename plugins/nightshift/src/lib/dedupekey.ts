// Dedupe spine (run-loop.md step 4). A finding's identity is the composite
// {surface, symptom, root_cause}. Within-lane, strict equality.
import type { DedupeKey, Finding, Suppression } from "./types.js";

export function dedupeKeyString(k: DedupeKey): string {
  return JSON.stringify([k.surface, k.symptom, k.root_cause]);
}

export function dedupeKeyEquals(a: DedupeKey, b: DedupeKey): boolean {
  return a.surface === b.surface && a.symptom === b.symptom && a.root_cause === b.root_cause;
}

/** A finding is open while it has no resolved_at. */
export function isOpen(f: Pick<Finding, "resolved_at">): boolean {
  return !f.resolved_at;
}

/** The matching OPEN finding for this dedupe_key, if any (drives last_seen bump). */
export function matchOpenFinding(key: DedupeKey, openFindings: Finding[]): Finding | undefined {
  return openFindings.find((f) => isOpen(f) && dedupeKeyEquals(f.dedupe_key, key));
}

/** An UNEXPIRED suppression matching this dedupe_key, if any. `expires` is inclusive. */
export function activeSuppression(
  key: DedupeKey,
  suppressions: Suppression[],
  today: string,
): Suppression | undefined {
  return suppressions.find(
    (s) => dedupeKeyEquals(s.dedupe_key, key) && s.expires >= today,
  );
}
