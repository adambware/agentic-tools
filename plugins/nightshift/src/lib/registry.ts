// Shape a parsed registry document into entries for one lane.
import type { RegistryEntry, Lane } from "./types.js";

/**
 * Extract this lane's entries from a parsed vectors.yml / flows.yml document.
 * Accepts `{vectors:[...]}`, `{flows:[...]}`, or a bare list. Empty/absent -> [].
 * Throws on a malformed shape (so bin/validate / the workflow can abort).
 */
export function extractEntries(doc: unknown, lane: Lane): RegistryEntry[] {
  if (doc === undefined || doc === null) return [];
  let list: unknown;
  if (Array.isArray(doc)) {
    list = doc;
  } else if (typeof doc === "object") {
    const o = doc as Record<string, unknown>;
    list = o.vectors ?? o.flows ?? o.entries;
    if (list === undefined) {
      throw new Error("malformed registry: expected vectors|flows|entries list");
    }
  } else {
    throw new Error("malformed registry: not a list or object");
  }
  if (!Array.isArray(list)) throw new Error("malformed registry: entries is not a list");
  return (list as RegistryEntry[]).filter((e) => !e.owner || e.owner === lane);
}
