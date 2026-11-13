// 0.8.0 PR D review fixes for the grouped-run supervisor and the lost-supervisor reaper (D3).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { backstopMs, findPs, GRACE_MS, groupOwner, PS_TIMEOUT_MS, run, SETTLE_MS } from "./proc.js";
import { put, running, tmp, until } from "./testkit.js";

let n = 0;
const cleanup = (mark: string) => spawnSync("pkill", ["-KILL", "-f", mark]);

describe("groupOwner (review fixes)", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  // Value: protects=a lost supervisor's own group being killed on Linux, where procps' lstart reads up to about 2 s
  // before the real start; fails_when=the slack is back under 2 s (verified red: 1 s slack read -1999 ms as "other");
  // why_new=the old unit test baked in macOS's under-1 s truncation; seam=a synthetic listing; no_claim=procps itself
  it("counts a group whose lstart reads up to about 2 s before startMs as ours, and one 2.6 s before as other", () => {
    const start = Date.UTC(2026, 10, 12, 10, 23, 45);
    const listing = "  100   100 Thu Nov 12 10:23:45 2026\n";
    expect(groupOwner(listing, 100, start + 1999, start + 2000)).toBe("ours");
    expect(groupOwner(listing, 100, start + 2600, start + 2600)).toBe("other");
  });

  // Value: protects=the start-time guard in a DST fall-back hour (a local lstart is ambiguous there, and V8 picks the
  // earlier instant); fails_when=the listing is parsed as local time (verified red: under America/New_York the UTC
  // listing parsed 5 h late and read "ours"); why_new=the parse was untested off UTC; seam=process.env.TZ;
  // no_claim=ps's own TZ handling (psStarts runs it with TZ=UTC0)
  it("parses the listing as UTC whatever this process's time zone", () => {
    process.env.TZ = "America/New_York";
    // 06:30Z is 01:30 EST, the second pass of the 2026-11-01 fall-back hour.
    const start = Date.UTC(2026, 10, 1, 6, 30);
    const listing = "  4242  4242 Sun Nov  1 06:30:00 2026\n";
    expect(groupOwner(listing, 4242, start, start)).toBe("ours");
    expect(groupOwner(listing, 4242, start + 10_000, start + 10_000)).toBe("other");
  });

  // Value: protects=an unrelated process group being SIGKILLed after a lost supervisor when the check's group ended and
  // its pgid was reused (every member of the new group starts after startMs, so a lower bound alone reads it as ours);
  // fails_when=ownership is a lower bound on member start times only (red on e55dc2f: the reused group read "ours");
  // why_new=PR #33 review (codex P2); seam=a synthetic listing; no_claim=how often a pgid is reused in practice
  it("reads a reused pgid (leader started after the spawn) as other, and a leaderless group as unknown", () => {
    const start = Date.UTC(2026, 10, 12, 10, 0, 0);
    const spawned = start + 30;
    const ours = "  500   500 Thu Nov 12 10:00:00 2026\n  501   500 Thu Nov 12 10:05:00 2026\n";
    expect(groupOwner(ours, 500, start, spawned)).toBe("ours");
    // The check's group is gone; a new group, leader and member, has pgid 500 ten minutes later.
    const reused = "  500   500 Thu Nov 12 10:10:00 2026\n  777   500 Thu Nov 12 10:10:01 2026\n";
    expect(groupOwner(reused, 500, start, spawned)).toBe("other");
    expect(groupOwner("  500   500 Thu Nov 12 10:00:03 2026\n", 500, start, spawned)).toBe("other");
    // Only members left: this run's group with its leader gone, or a newer one whose leader exited. Not provable.
    expect(groupOwner("  777   500 Thu Nov 12 10:10:01 2026\n", 500, start, spawned)).toBe("unknown");
  });
});

describe("backstop and ps lookup (review fixes)", () => {
  // Value: protects=a timeout reported as a timeout, not a lost supervisor killed mid-terminate; fails_when=the
  // backstop is under the supervisor's worst case (two ps listings, grace, settle; red on base: no backstopMs, 10 s
  // fixed); why_new=the budget was only a comment; seam=none; no_claim=node start-up time
  it("leaves the supervisor its worst case to end a check past the timeout", () => {
    expect(backstopMs(1000) - 1000).toBeGreaterThanOrEqual(2 * PS_TIMEOUT_MS + GRACE_MS + SETTLE_MS + 1000);
  });

  // Value: protects=the descendant sweep and the lost-group kill on a host whose ps is not in /bin or /usr/bin;
  // fails_when=ps is looked up on a pinned /bin:/usr/bin only (red on base: no findPs); why_new=new lookup;
  // seam=injected system candidates and PATH; no_claim=NixOS itself
  it("finds ps in the system dirs first, then on PATH, else none", () => {
    const sys = tmp();
    const other = tmp();
    put(other, "ps", "#!/bin/sh\n", true);
    expect(findPs(other, [join(sys, "ps")])).toBe(join(other, "ps"));
    expect(findPs("", [join(sys, "ps")])).toBeNull();
    put(sys, "ps", "#!/bin/sh\n", true);
    expect(findPs(other, [join(sys, "ps")])).toBe(join(sys, "ps"));
    expect(findPs()).not.toBeNull();
  });

  // Value: protects=the supervisor running a ps it cannot find (it runs with cwd = repo root, not the engine's cwd);
  // fails_when=a relative PATH entry's ps is returned; why_new=the row above only uses absolute dirs; seam=injected
  // system candidates and PATH; no_claim=which() itself
  it("does not take a ps from a relative PATH entry", () => {
    const sys = tmp();
    const other = tmp();
    put(other, "ps", "#!/bin/sh\n", true);
    const rel = relative(process.cwd(), other);
    expect(isAbsolute(rel)).toBe(false);
    expect(findPs(rel, [join(sys, "ps")])).toBeNull();
  });
});

describe("run with group (review fixes)", () => {
  const proc = join(tmp(), "proc.mjs");
  buildSync({ entryPoints: [fileURLToPath(new URL("./proc.ts", import.meta.url))], bundle: true, format: "esm", platform: "node", outfile: proc, logLevel: "silent" });

  // Value: protects=$TMPDIR from a run dir (pidfile plus a copy of the check's stdout) per interrupted check;
  // fails_when=only the engine's finally removes it (verified red: an engine killed by SIGINT or SIGTERM left
  // loops-run-*/ with group.pid and out); why_new=no test interrupted the engine and looked at TMPDIR; seam=a real
  // engine process with TMPDIR set; no_claim=a supervisor SIGKILLed with its engine (nothing can clean up then)
  it.each(["SIGINT", "SIGTERM"] as const)("removes the run dir when the engine dies of %s", (sig) => {
    const mark = `loops-rundir-${process.pid}-${n++}`;
    const dir = tmp();
    const code = `import { run } from ${JSON.stringify(proc)};\nrun("sh", ["-c", process.env.LOOPS_TEST_SCRIPT], { group: true, timeoutMs: 60000 });`;
    const e = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "ignore", env: { ...process.env, TMPDIR: dir, LOOPS_TEST_SCRIPT: `echo hi; sh -c 'sleep 30; : ${mark}' & wait` } });
    try {
      expect(until(() => readdirSync(dir).some((d) => existsSync(join(dir, d, "group.pid"))) && running(mark) === true, 10_000)).toBe(true);
      process.kill(e.pid!, sig);
      expect(until(() => running(mark) === false, GRACE_MS + 3_000)).toBe(true);
      expect(until(() => readdirSync(dir).length === 0, 3_000)).toBe(true);
    } finally {
      try {
        process.kill(e.pid!, "SIGKILL");
      } catch {
        // already gone
      }
      cleanup(mark);
    }
  }, 20_000);

  // Value: protects=an unrelated process that reused a pid the supervisor once saw (it would be SIGKILLed at the
  // grace's end); fails_when=the final SIGKILL targets every pid ever seen, not only the ones still alive with the start
  // time they had (verified red: the descendant whose start time changed was SIGKILLed); why_new=no test changed a
  // seen pid's identity; seam=a fake ps that shifts every start time by a year after the first listing, standing in
  // for a pid reused; no_claim=a real pid wrap
  it("does not SIGKILL a seen pid whose start time changed since it was seen", () => {
    const mark = `loops-reuse-${process.pid}-${n++}`;
    const d = tmp();
    put(d, "ps", `#!/bin/sh\nif [ -f "${d}/once" ]; then /bin/ps "$@" | /usr/bin/awk '{ $NF = $NF + 1; print }'; else : > "${d}/once"; exec /bin/ps "$@"; fi\n`, true);
    put(d, "escape.cjs", `require("node:child_process").spawn("sh", ["-c", "trap '' TERM; sleep 30; : ${mark}"], { detached: true, stdio: "ignore" });\nsetInterval(() => {}, 1000);\n`);
    try {
      const r = run(process.execPath, [join(d, "escape.cjs")], { group: true, timeoutMs: 1500, ps: join(d, "ps") });
      expect(r.timedOut).toBe(true);
      expect(running(mark)).toBe(true);
      // The control: through a plain wrapper over the same ps, the sweep finds the descendant and SIGKILLs it.
      cleanup(mark);
      put(d, "ps", '#!/bin/sh\nexec /bin/ps "$@"\n', true);
      const c = run(process.execPath, [join(d, "escape.cjs")], { group: true, timeoutMs: 1500, ps: join(d, "ps") });
      expect(c.timedOut).toBe(true);
      expect(until(() => running(mark) === false, 1_000)).toBe(true);
    } finally {
      cleanup(mark);
    }
  }, 30_000);

  // Value: protects=an unrelated process that reused a seen pid within seconds (its lstart only 2 s off the one seen)
  // being SIGKILLed at the grace's end, while a real descendant whose lstart reads one second off between listings
  // (procps 4) is still killed; fails_when=the sweep keeps a pid whose start moved by more than one lstart step (red on
  // 29fa5be: the 2.5 s slack kept the 2 s shift and SIGKILLed it); why_new=PR #33 review (codex P2), the old test
  // shifted by a year; seam=a fake ps that shifts every start time by N s after the first listing; no_claim=a real pid wrap
  it("drops a seen pid whose start time moved by 2 s, and keeps one that moved by 1 s", () => {
    const mark = `loops-tick-${process.pid}-${n++}`;
    const d = tmp();
    const shifted = (secs: number) =>
      `#!/bin/sh\nif [ -f "${d}/once" ]; then /bin/ps "$@" | /usr/bin/awk '{ split($(NF-1), t, ":"); s = t[1] * 3600 + t[2] * 60 + t[3] + ${secs}; $(NF-1) = sprintf("%02d:%02d:%02d", int(s / 3600) % 24, int(s / 60) % 60, s % 60); print }'; else : > "${d}/once"; exec /bin/ps "$@"; fi\n`;
    put(d, "escape.cjs", `require("node:child_process").spawn("sh", ["-c", "trap '' TERM; sleep 30; : ${mark}"], { detached: true, stdio: "ignore" });\nsetInterval(() => {}, 1000);\n`);
    try {
      put(d, "ps", shifted(2), true);
      const r = run(process.execPath, [join(d, "escape.cjs")], { group: true, timeoutMs: 1500, ps: join(d, "ps") });
      expect(r.timedOut).toBe(true);
      expect(running(mark)).toBe(true);
      cleanup(mark);
      spawnSync("rm", ["-f", join(d, "once")]);
      put(d, "ps", shifted(1), true);
      const c = run(process.execPath, [join(d, "escape.cjs")], { group: true, timeoutMs: 1500, ps: join(d, "ps") });
      expect(c.timedOut).toBe(true);
      expect(until(() => running(mark) === false, 1_000)).toBe(true);
    } finally {
      cleanup(mark);
    }
  }, 30_000);
});
