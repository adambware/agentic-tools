// 0.8.0 D3 coverage: a grouped run whose output passes MAX_BUFFER ends through terminate(SIGKILL) and settle.
import { describe, expect, it } from "vitest";
import { run } from "./proc.js";

// Value: protects=a [[local]] that floods stdout ending as "could not run (ENOBUFS)" promptly, not hanging; fails_when=the
// overflow path stops killing the group or settle never finishes (no backstop without a timeout), or the overflow is
// reported as an exit or a timeout; why_new=no test drives output past MAX_BUFFER through the 0.8.0 supervisor; seam=none;
// no_claim=a descendant that keeps the pipe open past SETTLE_MS (settle's timer path)
describe("run with group: output past MAX_BUFFER", () => {
  it("kills the check and returns ENOBUFS, with or without a timeout", () => {
    for (const timeoutMs of [undefined, 60_000]) {
      const t0 = Date.now();
      const r = run("/bin/sh", ["-c", "head -c 70000000 /dev/zero; sleep 30"], { group: true, timeoutMs });
      expect({ code: r.code, abend: r.abend, timedOut: r.timedOut, lost: r.lost }, String(timeoutMs)).toEqual({ code: null, abend: "ENOBUFS", timedOut: false, lost: false });
      expect(Date.now() - t0, String(timeoutMs)).toBeLessThan(15_000);
    }
  }, 40_000);
});
