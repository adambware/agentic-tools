// Update engine-managed (auto) state on registry entries in place, preserving the
// file's comments + ordering (humans hand-seed these files). Uses the yaml Document
// API and an atomic write.
import { readFileSync, existsSync } from "node:fs";
import { parseDocument, isMap, isSeq } from "yaml";
import { atomicWrite } from "./io.js";

export interface EntryState {
  last_reviewed?: string;
  status?: string;
}

export function updateRegistryState(path: string, updates: Map<string, EntryState>): void {
  if (!existsSync(path) || updates.size === 0) return;
  const doc = parseDocument(readFileSync(path, "utf8"));

  let seq: unknown = doc.get("vectors") ?? doc.get("flows") ?? doc.get("entries");
  if (!isSeq(seq) && isSeq(doc.contents)) seq = doc.contents;
  if (!isSeq(seq)) return;

  for (const item of (seq as { items: unknown[] }).items) {
    if (!isMap(item)) continue;
    const id = item.get("id");
    if (typeof id !== "string") continue;
    const upd = updates.get(id);
    if (!upd) continue;
    if (upd.last_reviewed !== undefined) item.set("last_reviewed", upd.last_reviewed);
    if (upd.status !== undefined) item.set("status", upd.status);
  }

  atomicWrite(path, String(doc));
}
