// 0.8.0 D3: a [[local]] check whose supervisor is lost. A FAIL the check printed stands; otherwise one WARN says the
// supervisor was lost and whether the check's group was killed.
import { describe, expect, it } from "vitest";
import { main } from "./loops-cli.js";
import { run, type Runner, type RunResult } from "./proc.js";
import { deps, put, repo, tmp } from "./testkit.js";

const CFG = ".loops/env-check.toml";
// The check waits for its supervisor's pidfile, then names its run dir RUN.
const PIDFILE = `until [ -f "$TMPDIR"/loops-run-*/group.pid ]; do sleep 0.02; done; RUN=$(echo "$TMPDIR"/loops-run-*)`;

/** env-check on a repo with one [[local]] `x.sup` running `script`, with TMPDIR (the engine's and the check's) a fresh dir. */
function check(script: string, runner?: Runner) {
  const root = repo();
  put(root, ".loops/checks/x.sh", `#!/bin/sh\n${script}\n`, true);
  put(root, CFG, 'schema_version = 1\n\n[[local]]\nid = "x.sup"\nrun = ".loops/checks/x.sh"\ntimeout_s = 20\n');
  const dir = tmp();
  const t = deps(root, { TMPDIR: dir });
  if (runner) t.d.run = runner;
  const was = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    const code = main(["env-check"], t.d);
    return { code, err: t.err.join("\n"), rows: t.out.join("\n").split("\n").filter((l) => / x\.sup/.test(l)) };
  } finally {
    if (was === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = was;
  }
}
/** The real runner, but the grouped [[local]] run returns `r`. */
const lostWith = (r: Partial<RunResult>): Runner => (cmd, args, opts) => (opts?.group ? { code: null, stdout: "", stderr: "", timedOut: false, abend: "SIGKILL", lost: true, ...r } : run(cmd, args, opts));

// Value: protects=D3's lost-supervisor rows (a FAIL never downgraded; a loss never silent or a false FAIL);
// fails_when=runLocal ignores `lost` (verified: red on the 0.7 engine, which published no pidfile, dropped a lost run's
// output and printed `FAIL x.sup could not run (SIGKILL)`); why_new=no test lost a supervisor; seam=a real supervisor killed by its own check
// in the first two rows; no_claim=the kill itself (proc.test.ts)
describe("a [[local]] check whose supervisor is lost (D3)", () => {
  it("keeps a FAIL the check printed before the loss, with no WARN on top", () => {
    const r = check(`${PIDFILE}; echo "FAIL x.sup.early broke first"; until grep -q x.sup.early "$RUN/out"; do sleep 0.02; done; kill -9 $PPID; sleep 30`);
    expect([r.code, r.rows]).toEqual([1, ["FAIL x.sup.early  broke first — fix: address the message above and re-run"]]);
  }, 30_000);

  it("is one WARN, not a FAIL, when the check printed nothing, and says its group was killed", () => {
    const r = check(`${PIDFILE}; kill -9 $PPID; sleep 30`);
    expect([r.code, r.rows]).toEqual([0, ["WARN x.sup  supervisor lost; check group killed — fix: rerun once; report it if it repeats"]]);
  }, 30_000);

  it("keeps the PASS rows and adds the WARN", () => {
    const r = check("true", lostWith({ stdout: "PASS x.sup.a fine\n", cleaned: "yes" }));
    expect(r.rows).toEqual(["PASS x.sup.a  fine", "WARN x.sup  supervisor lost; check group killed — fix: rerun once; report it if it repeats"]);
  });

  it("says nothing was killed when the group could not be verified (no pidfile) or was not this run's", () => {
    for (const cleaned of ["unverified", "no"] as const) {
      const r = check("true", lostWith({ cleaned }));
      expect([r.code, r.err, r.rows]).toEqual([0, "", ["WARN x.sup  supervisor lost; check group could not be verified, nothing killed — fix: rerun once; report it if it repeats"]]);
    }
  });
});
