import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { GRACE_MS, gitEnv, groupOwner, reapLost, redactHome, run, shimOf, type RunResult } from "./proc.js";
import { put, running, tmp, until } from "./testkit.js";

describe("shimOf", () => {
  it("reads an asdf shim's header and the asdf it execs, without running it", () => {
    const d = tmp();
    put(d, "byname", '#!/usr/bin/env bash\n# asdf-plugin: golang 1.26.6\nexec asdf exec "byname" "$@"\n', true);
    put(d, "bypath", '#!/usr/bin/env bash\n# asdf-plugin: nodejs 20.0.0\n# asdf-plugin: nodejs 22.1.0\nexec /home/u/.asdf/bin/asdf exec "bypath" "$@"\n', true);
    put(d, "quoted", '#!/usr/bin/env bash\n# asdf-plugin: x 1\nexec "/opt/asdf dir/bin/asdf" exec "quoted" "$@"\n', true);
    put(d, "varpath", '#!/usr/bin/env bash\n# asdf-plugin: x 1\nexec $ASDF_DIR/bin/asdf exec "varpath" "$@"\n', true);
    expect(shimOf(join(d, "byname"))).toEqual({ manager: "asdf", cmd: null, providers: [{ plugin: "golang", version: "1.26.6" }] });
    expect(shimOf(join(d, "bypath"))).toEqual({ manager: "asdf", cmd: "/home/u/.asdf/bin/asdf", providers: [{ plugin: "nodejs", version: "20.0.0" }, { plugin: "nodejs", version: "22.1.0" }] });
    expect(shimOf(join(d, "quoted"))).toEqual({ manager: "asdf", cmd: "/opt/asdf dir/bin/asdf", providers: [{ plugin: "x", version: "1" }] });
    expect(shimOf(join(d, "varpath"))).toEqual({ manager: "asdf", cmd: null, providers: [{ plugin: "x", version: "1" }] }); // not a plain absolute path: PATH lookup
  });

  // Value: protects=a shim over 1 MiB keeps only its 4 KiB head (providers and cmd from the head), never a full read;
  // fails_when=the size cap is dropped or inverted; why_new=only a 4 KiB to 1 MiB shim was tested; seam=none;
  // no_claim=memory use
  it("keeps only the head of an asdf shim larger than 1 MiB", () => {
    const d = tmp();
    const pad = `# ${"x".repeat(1022)}\n`.repeat(1100);
    put(d, "huge", `#!/usr/bin/env bash\n# asdf-plugin: golang 1.26.1\n${pad}# asdf-plugin: late 9\nexec /home/u/.asdf/bin/asdf exec "huge" "$@"\n`, true);
    expect(shimOf(join(d, "huge"))).toEqual({ manager: "asdf", cmd: null, providers: [{ plugin: "golang", version: "1.26.1" }] });
  });

  it("reads every header line and the exec line of an asdf shim longer than 4 KiB", () => {
    const d = tmp();
    const lines = Array.from({ length: 200 }, (_, i) => `# asdf-plugin: lint 1.${i}.0`).join("\n");
    put(d, "long", `#!/usr/bin/env bash\n${lines}\n# asdf-plugin: golang 1.26.1\nexec /home/u/.asdf/bin/asdf exec "long" "$@"\n`, true);
    const s = shimOf(join(d, "long"));
    expect(s?.providers.length).toBe(201);
    expect(s?.providers.at(-1)).toEqual({ plugin: "golang", version: "1.26.1" });
    expect(s?.cmd).toBe("/home/u/.asdf/bin/asdf");
  });

  it("never takes an exec'd program not named asdf as the asdf to ask, so a planted shim cannot pick what runs", () => {
    const d = tmp();
    put(d, "evil", '#!/usr/bin/env bash\n# asdf-plugin: x 1\nexec /tmp/payload exec "evil" "$@"\n', true);
    put(d, "lookalike", '#!/usr/bin/env bash\n# asdf-plugin: x 1\nexec "/opt/asdf/bin/asdf-wrapper" exec "lookalike" "$@"\n', true);
    expect(shimOf(join(d, "evil"))).toEqual({ manager: "asdf", cmd: null, providers: [{ plugin: "x", version: "1" }] });
    expect(shimOf(join(d, "lookalike"))).toEqual({ manager: "asdf", cmd: null, providers: [{ plugin: "x", version: "1" }] });
  });

  it("takes a symlink to the mise binary as a mise shim, but not mise itself", () => {
    const d = tmp();
    put(d, "mise", "#!/bin/sh\n", true);
    symlinkSync(join(d, "mise"), join(d, "tool"));
    symlinkSync(join(d, "mise"), join(d, "mise-link"));
    expect(shimOf(join(d, "tool"))).toEqual({ manager: "mise", cmd: join(d, "mise"), providers: [] });
    expect(shimOf(join(d, "mise-link"))).toEqual({ manager: "mise", cmd: join(d, "mise"), providers: [] });
    expect(shimOf(join(d, "mise"))).toBeNull();
  });

  it("is null for a plain script, a header past the first lines, an unreadable file or a missing one", () => {
    const d = tmp();
    put(d, "plain", "#!/bin/sh\necho hi\n", true);
    put(d, "late", `#!/bin/sh\n${"#\n".repeat(5000)}# asdf-plugin: x 1\n`, true);
    put(d, "inline", '#!/bin/sh\necho "# asdf-plugin: x 1"\n', true);
    put(d, "locked", "#!/usr/bin/env bash\n# asdf-plugin: x 1\n", true);
    chmodSync(join(d, "locked"), 0o111);
    expect(shimOf(join(d, "plain"))).toBeNull();
    expect(shimOf(join(d, "late"))).toBeNull();
    expect(shimOf(join(d, "inline"))).toBeNull();
    if (process.getuid?.() !== 0) expect(shimOf(join(d, "locked"))).toBeNull();
    expect(shimOf(join(d, "nope"))).toBeNull();
  });
});

describe("gitEnv", () => {
  it("drops git's repo-local variables but command-scope config, and keeps the rest, without changing its argument", () => {
    const cfg = { GIT_CONFIG_PARAMETERS: "'a.b'='c'", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };
    const env = { GIT_DIR: "/x/.git", GIT_INDEX_FILE: "/x/.git/index", GIT_CONFIG: "/x/c", GIT_COMMON_DIR: "/x", GIT_SSH_COMMAND: "ssh", GIT_CONFIG_GLOBAL: "/g", PATH: "/bin", ...cfg };
    expect(gitEnv(env)).toEqual({ GIT_SSH_COMMAND: "ssh", GIT_CONFIG_GLOBAL: "/g", PATH: "/bin", ...cfg });
    expect(gitEnv(env, { gitDir: null, root: "/x" })).toEqual(gitEnv(env));
    expect(env.GIT_DIR).toBe("/x/.git");
  });

  it("keeps GIT_INDEX_FILE only for an existing file directly in the checkout's own git-dir, relative to the root, through symlinks", () => {
    const d = tmp();
    const [root, gitDir] = [join(d, "r"), join(d, "r", ".git")];
    for (const p of [join(gitDir, "worktrees", "w"), join(gitDir, "modules", "m"), join(d, "o", ".git")]) mkdirSync(p, { recursive: true });
    for (const f of ["index.lock", "next-index-1.lock", "index"]) put(gitDir, f, "");
    symlinkSync(root, join(d, "link"));
    const own = { gitDir, root };
    const kept = (i: string, o: { gitDir: string | null; root: string } = own) => gitEnv({ GIT_INDEX_FILE: i }, o).GIT_INDEX_FILE ?? null;
    for (const i of [join(gitDir, "index.lock"), join(gitDir, "next-index-1.lock"), ".git/index", "./.git/../.git/index.lock", join(d, "link", ".git", "index.lock")]) expect(kept(i)).toBe(i);
    expect(kept(join(d, "link", ".git", "index"), { gitDir: join(d, "link", ".git"), root })).not.toBeNull();
    for (const i of [join(gitDir, "worktrees", "w", "index"), join(gitDir, "modules", "m", "index"), join(d, "o", ".git", "index"), join(d, "index"), join(root, "index"), gitDir, "", "../r/x/index"]) expect(kept(i)).toBeNull();
    // Absent, git reads an empty index, so d.tracked would see no tracked file at all: a stale or leftover one.
    for (const i of [".git/gone.lock", join(gitDir, "next-index-2.lock"), join(d, "link", ".git", "gone")]) expect(kept(i)).toBeNull();
    expect(kept(join(gitDir, "index"), { gitDir: null, root })).toBeNull();
  });
});

describe("redactHome", () => {
  const home = "/Users/bob";
  it.each([
    ["a longer name", "/Users/bob2/x", "/Users/bob2/x"],
    ["a dotted sibling", "/Users/bob.old/x and /Users/bob-x", "/Users/bob.old/x and /Users/bob-x"],
    ["home deeper in another path", "/x/Users/bob/y x@/Users/bob/y ./Users/bob", "/x/Users/bob/y x@/Users/bob/y ./Users/bob"],
    ["a sentence's end and trailing punctuation", "dir is /Users/bob. HOME=/Users/bob... /Users/bob- /Users/bob~ (/Users/bob.)", "dir is ~. HOME=~... ~- ~~ (~.)"],
    ["a PATH list", "a:/Users/bob:/Users/bobby:/Users/bob/bin", "a:~:/Users/bobby:~/bin"],
    ["prose and punctuation", "in /Users/bob/x, (/Users/bob) root=/Users/bob/y //Users/bob", "in ~/x, (~) root=~/y /~"],
    ["quoted words", "cd '/Users/bob' && cd '/Users/bob/x y' && cd '/Users/bob2'", "cd ~ && cd ~/'x y' && cd '/Users/bob2'"],
  ])("redacts only at a path-segment boundary on both sides: %s", (_n, s, want) => {
    expect(redactHome(s, home)).toBe(want);
    expect(redactHome(s, `${home}/`)).toBe(want);
  });

  it("matches HOME literally, with no pattern built from it", () => {
    for (const h of ["/h/a.b", "/h/a+b", "/h/a(b", "/h/a.b+c(d)"]) {
      const lookalike = h.replace(/[.+(]/g, "X");
      expect(redactHome(`${h}/x ${lookalike}/x ${h}`, h)).toBe(`~/x ${lookalike}/x ~`);
    }
  });

  it("redacts nothing when HOME is not an absolute path", () => {
    for (const h of ["build", "build/", "./build", "~", "", "/", "//"]) expect(redactHome("build/x /tmp/build/y ~/z", h)).toBe("build/x /tmp/build/y ~/z");
  });
});

describe("run with group", () => {
  let n = 0;
  // run() bundled to plain JS, so an engine runs on any node CI uses, with no TypeScript loader.
  const proc = join(tmp(), "proc.mjs");
  buildSync({ entryPoints: [fileURLToPath(new URL("./proc.ts", import.meta.url))], bundle: true, format: "esm", platform: "node", outfile: proc, logLevel: "silent" });
  /**
   * An engine: a node process blocked in run() on a grouped check that leaves a marked sleeper running beside it. With
   * `own`, the engine leads its own process group, as a foreground job does under a terminal. The script reaches it
   * through env, so only the check's shells carry the mark in their command line: one seen running is the check itself.
   */
  // `; :` keeps the child shell (and the mark in its argv) alive beside its sleep.
  const engine = (mark: string, own: boolean, script = `sh -c 'sleep 30; : ${mark}' &\nwait`) => {
    const code = `import { run } from ${JSON.stringify(proc)};\nrun("sh", ["-c", process.env.LOOPS_TEST_SCRIPT], { group: true, timeoutMs: 60000 });`;
    return spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "ignore", detached: own, env: { ...process.env, LOOPS_TEST_SCRIPT: script } });
  };

  // Value: protects=an interrupt reaching a grouped [[local]] (R20 runs it in its own session, which a terminal's Ctrl-C
  // and a dying engine never reach); fails_when=run spawns the check detached with nothing left to forward the signal
  // (verified: red at the T9 runner, the sleeper outlives the engine in all three rows); why_new=T9 tested the timeout
  // only; seam=a real engine process importing proc.ts; no_claim=a check that escapes its group with setsid
  it.each([
    ["SIGINT to the engine's process group, as a terminal's Ctrl-C sends it", "SIGINT", true],
    ["SIGINT to the engine alone", "SIGINT", false],
    ["SIGTERM to the engine alone", "SIGTERM", false],
    // Value: protects=a closed terminal (SIGHUP) ending a grouped [[local]]; fails_when=SIGHUP drops out of the supervisor's
    // handled signals; why_new=rows covered SIGINT/SIGTERM only; seam=none; no_claim=SIGHUP to the engine alone
    ["SIGHUP to the engine's process group, as a closing terminal sends it", "SIGHUP", true],
  ] as const)("ends the check's whole group on %s", (_name, sig, group) => {
    const mark = `loops-interrupt-${process.pid}-${n++}`;
    const e = engine(mark, group);
    try {
      expect(until(() => running(mark) === true, 10_000)).toBe(true);
      process.kill(group ? -e.pid! : e.pid!, sig);
      // A sleeper in an async list ignores SIGINT, so it can last the whole grace.
      expect(until(() => running(mark) === false, GRACE_MS + 3_000)).toBe(true);
    } finally {
      try {
        process.kill(group ? -e.pid! : e.pid!, "SIGKILL");
      } catch {
        // already gone
      }
      spawnSync("pkill", ["-KILL", "-f", mark]);
    }
  }, 20_000);

  // Value: protects=a chatty [[local]]'s result lines (the supervisor relays through pipes the engine drains while it
  // writes); fails_when=a relay write gives up on a full pipe, so stdout is lost behind >64 KB of stderr (verified: red
  // at the K-SIGINT supervisor, stdout came back empty with code 0); why_new=the K-SIGINT tests print nothing;
  // seam=run() with group, a real supervisor; no_claim=output past MAX_BUFFER (ENOBUFS, as before)
  it("relays all of a check's output, however much it writes to stderr before stdout", () => {
    const r = run("/bin/sh", ["-c", "echo 'FAIL x.bad early'; head -c 300000 /dev/zero | tr '\\0' e >&2; echo 'PASS x.ok late'"], { group: true, timeoutMs: 20_000 });
    expect({ code: r.code, abend: r.abend, stdout: r.stdout, stderr: r.stderr.length }).toEqual({ code: 0, abend: undefined, stdout: "FAIL x.bad early\nPASS x.ok late\n", stderr: 300_000 });
  });

  // 0.8.0 D3: one terminate(grace) for timeout, interrupt and orphan; a descendant sweep; the engine's kill after a lost
  // supervisor, behind a pidfile and a start-time guard.
  const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const cleanup = (...marks: string[]) => {
    for (const m of marks) spawnSync("pkill", ["-KILL", "-f", m]);
  };
  const read = (f: string) => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return "";
    }
  };
  /** run() with TMPDIR pointed at a fresh dir, so the check can find its run dir there (the check inherits TMPDIR too). */
  const inRunDir = (script: string, timeoutMs = 20_000): { r: RunResult; dir: string } => {
    const dir = tmp();
    const was = process.env.TMPDIR;
    process.env.TMPDIR = dir;
    try {
      return { r: run("/bin/sh", ["-c", script], { group: true, timeoutMs }), dir };
    } finally {
      if (was === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = was;
    }
  };
  // The check waits for its supervisor's pidfile, then names its run dir RUN.
  const PIDFILE = `until [ -f "$TMPDIR"/loops-run-*/group.pid ]; do sleep 0.02; done; RUN=$(echo "$TMPDIR"/loops-run-*)`;

  // Value: protects=a check that cleans up on SIGTERM getting the time to; fails_when=the timeout SIGKILLs at once, or the
  // supervisor exits when the leader does and leaves a SIGTERM-ignoring descendant (verified: red on the 0.7 supervisor,
  // which SIGKILLed at the timeout and returned at once); why_new=T9 tested a plain sleeper only; seam=run() with group, a real
  // supervisor; no_claim=the exact grace length beyond a lower bound
  it("at the timeout sends SIGTERM, outlives a leader that exits at once, and SIGKILLs a descendant ignoring it at the grace's end", () => {
    const mark = `loops-grace-${process.pid}-${n++}`;
    try {
      const t0 = Date.now();
      const r = run("/bin/sh", ["-c", `sh -c 'trap "" TERM; sleep 30; : ${mark}' & wait`], { group: true, timeoutMs: 1000 });
      expect({ timedOut: r.timedOut, lost: r.lost, cleaned: r.cleaned }).toEqual({ timedOut: true, lost: false, cleaned: "yes" });
      expect(Date.now() - t0).toBeGreaterThanOrEqual(1000 + GRACE_MS - 100);
      expect(running(mark)).toBe(false);
    } finally {
      cleanup(mark);
    }
  }, 20_000);

  it("ends the grace as soon as the check has exited", () => {
    const t0 = Date.now();
    const r = run("/bin/sh", ["-c", "sleep 30"], { group: true, timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(300 + GRACE_MS - 500);
  });

  // Value: protects=a setsid'd child (its own session, so not in the group) of a still-running parent; fails_when=the
  // supervisor kills only -pgid (verified: red on the 0.7 supervisor, the setsid sleeper outlived the run); why_new=no
  // test left the group; seam=a real node parent calling setsid via detached spawn; no_claim=a daemon already reparented to init
  it("kills a setsid child whose parent is still alive at the timeout", () => {
    const mark = `loops-setsid-${process.pid}-${n++}`;
    const d = tmp();
    put(d, "escape.cjs", 'require("node:child_process").spawn("sh", ["-c", `sleep 30; : ${process.argv[2]}`], { detached: true, stdio: "ignore" });\nsetInterval(() => {}, 1000);\n');
    try {
      const r = run(process.execPath, [join(d, "escape.cjs"), mark], { group: true, timeoutMs: 1500 });
      expect(r.timedOut).toBe(true);
      expect(until(() => running(mark) === false, 1_000)).toBe(true);
    } finally {
      cleanup(mark);
    }
  }, 20_000);

  // Value: protects=Ctrl-C reaching a check as SIGINT with its grace kept, though the same Ctrl-C kills the engine at once
  // (A-8: the orphan poll would cut the grace); fails_when=the supervisor SIGKILLs on the signal, maps SIGINT to SIGTERM,
  // or the orphan poll or the leader's exit ends it mid-grace (verified: red on the 0.7 supervisor, no INT logged and the
  // check gone at once); why_new=the SIGINT rows above only assert the group ends; seam=a real engine process in its own
  // group, as a foreground job; no_claim=a second Ctrl-C (ignored by design)
  it("forwards SIGINT to the check and keeps the grace after the engine died of the same Ctrl-C", async () => {
    const mark = `loops-sigint-${process.pid}-${n++}`;
    const log = join(tmp(), "log");
    const script = `trap 'echo INT >> "${log}"' INT; trap 'echo TERM >> "${log}"' TERM; echo ready >> "${log}"; while :; do sleep 0.05; done; : ${mark}`;
    const e = engine(mark, true, script);
    const exited = new Promise<NodeJS.Signals | null>((ok) => e.once("exit", (_c, sig) => ok(sig)));
    try {
      expect(until(() => read(log).includes("ready"), 10_000)).toBe(true);
      const t0 = Date.now();
      process.kill(-e.pid!, "SIGINT");
      expect(until(() => read(log).includes("INT"), 1_500)).toBe(true);
      sleepMs(Math.max(0, t0 + 1_000 - Date.now()));
      expect(running(mark)).toBe(true);
      expect(until(() => running(mark) === false, GRACE_MS + 3_000)).toBe(true);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(GRACE_MS - 200);
      expect(read(log)).not.toContain("TERM");
      expect(await exited).toBe("SIGINT");
    } finally {
      try {
        process.kill(-e.pid!, "SIGKILL");
      } catch {
        // already gone
      }
      cleanup(mark);
    }
  }, 20_000);

  // Value: protects=a check group outliving a supervisor that was SIGKILLed (the engine is the only one left to kill it),
  // and what the check printed first; fails_when=the engine does not read the pidfile and kill the group, or a lost run
  // drops stdout (verified: red on the 0.7 engine, which published no pidfile and dropped a lost run's stdout);
  // why_new=no test killed the supervisor; seam=a real supervisor killed by its own check; no_claim=a supervisor killed by the backstop (same path)
  it("after the supervisor is SIGKILLed past its pidfile, kills the check's group and returns the lines it printed", () => {
    const mark = `loops-lost-${process.pid}-${n++}`;
    try {
      const { r, dir } = inRunDir(`${PIDFILE}; sh -c 'sleep 30; : ${mark}' & echo "FAIL x.early first"; printf 'cut'; until grep -q x.early "$RUN/out"; do sleep 0.02; done; kill -9 $PPID; wait`);
      expect({ code: r.code, lost: r.lost, cleaned: r.cleaned, stdout: r.stdout, abend: r.abend }).toEqual({ code: null, lost: true, cleaned: "yes", stdout: "FAIL x.early first\n", abend: "SIGKILL" });
      expect(until(() => running(mark) === false, 1_000)).toBe(true);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      cleanup(mark);
    }
  }, 20_000);

  // Value: protects=a lost supervisor that never published its pidfile (died first, or the file is gone): the engine
  // must kill nothing it cannot identify and still return; fails_when=a missing pidfile throws, or the engine kills on a
  // guess; why_new=new path; seam=a real supervisor killed by its own check; no_claim=what the check left running (it is
  // reported as unverified, by design)
  it("after the supervisor is lost before its pidfile exists, kills nothing and says it could not verify", () => {
    const mark = `loops-nopid-${process.pid}-${n++}`;
    try {
      const { r } = inRunDir(`${PIDFILE}; rm "$RUN/group.pid"; sh -c 'sleep 30; : ${mark}' & kill -9 $PPID; wait`);
      expect({ lost: r.lost, cleaned: r.cleaned, stdout: r.stdout }).toEqual({ lost: true, cleaned: "unverified", stdout: "" });
      expect(running(mark)).toBe(true);
    } finally {
      cleanup(mark);
    }
  }, 20_000);

  // Value: protects=an unrelated process group whose id a pidfile names (a reused pid, a pidfile not from this run);
  // fails_when=the start-time guard is dropped and the engine kills -pgid on the pidfile's word alone; why_new=new
  // guard; seam=a real victim group started before the run; no_claim=lstart in other locales (ps runs with LC_ALL=C)
  it("does not kill a group a stale pidfile names when it started before the run", () => {
    const mark = `loops-victim-${process.pid}-${n++}`;
    const victim = spawn("sh", ["-c", `sleep 30; : ${mark}`], { detached: true, stdio: "ignore" });
    try {
      expect(until(() => running(mark) === true, 5_000)).toBe(true);
      const forged = JSON.stringify({ pgid: victim.pid, startMs: Date.now() + 60_000 });
      const { r } = inRunDir(`${PIDFILE}; printf '%s' '${forged}' > "$RUN/group.pid"; kill -9 $PPID`);
      expect({ lost: r.lost, cleaned: r.cleaned }).toEqual({ lost: true, cleaned: "no" });
      expect(running(mark)).toBe(true);
    } finally {
      cleanup(mark);
    }
  }, 20_000);

  it("reads a ps start listing: whose group a pgid is, under whole-second start times and padded days", () => {
    const at = (s: string) => Date.parse(s);
    const listing = ["  100   100 Thu Nov 12 10:23:45 2026", "  101   100 Thu Nov 12 10:23:46 2026", "  200   200 Mon Nov  2 09:00:00 2026", "  300   300 not a date", ""].join("\n");
    // startMs is taken before the spawn, so a leader's whole-second lstart is at most 999 ms under it.
    expect(groupOwner(listing, 100, at("Thu Nov 12 10:23:45 2026") + 999)).toBe("ours");
    expect(groupOwner(listing, 100, at("Thu Nov 12 10:23:47 2026"))).toBe("other");
    expect(groupOwner(listing, 200, at("Mon Nov 2 09:00:00 2026"))).toBe("ours");
    expect(groupOwner(listing, 300, 0)).toBe("unknown");
    expect(groupOwner(listing, 400, 0)).toBe("gone");
  });

  it("reaps nothing on a missing, malformed or dangerous pidfile, or without ps", () => {
    const d = tmp();
    const ps = () => {
      throw new Error("ps must not run");
    };
    expect(reapLost(join(d, "none"), ps)).toBe("unverified");
    for (const [f, body] of [["junk", "{"], ["one", '{"pgid":1,"startMs":0}'], ["neg", '{"pgid":-5,"startMs":0}'], ["self", `{"pgid":${process.pid},"startMs":0}`], ["nostart", '{"pgid":12345}']]) {
      put(d, f!, body!);
      expect(reapLost(join(d, f!), ps)).toBe("unverified");
    }
    put(d, "ok", '{"pgid":999999,"startMs":0}');
    expect(reapLost(join(d, "ok"), () => null)).toBe("unverified");
    expect(reapLost(join(d, "ok"), () => "")).toBe("yes");
  });
});
