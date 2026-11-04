// `loops env-check`: run the repo's `.loops/env-check.toml` (built-in checks plus local checks) and
// report one line per result. Exit 0 = no FAIL, 1 = any FAIL, 2 = usage or config error.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseConfig } from "./env-config.js";
import { composeChecks, composeProject, harnessChecks, pinChecks, runLocal, sharedCheck, type Ctx, type Result } from "./env-checks.js";
import { git, isExecutable, parseFlags, redactHome, repoRoot, UsageError, type Deps } from "./proc.js";
import { escapeCtl, jsonText } from "./text.js";
import { VERSION } from "./version.js";

const GROUPS = "abcdex";
const group = (r: Result): number => GROUPS.indexOf(r.id[0] ?? "x");

/** Fold results with identical (level, message) into the first, noting the others' ids. */
function collapse(rs: Result[]): Result[] {
  const seen = new Map<string, Result>();
  const out: Result[] = [];
  for (const r of rs) {
    const first = seen.get(`${r.level}\0${r.message}`);
    if (first) first.also = [...(first.also ?? []), r.id];
    else {
      const copy = { ...r };
      seen.set(`${r.level}\0${r.message}`, copy);
      out.push(copy);
    }
  }
  return out;
}

/** `r` with `f` applied to every text it shows: id, message, fix and each `also` id. */
const mapText = (r: Result, f: (s: string) => string): Result => ({
  ...r,
  id: f(r.id),
  message: f(r.message),
  fix: r.fix === undefined ? undefined : f(r.fix),
  ...(r.also ? { also: r.also.map(f) } : {}),
});

export function envCheckMain(argv: string[], d: Deps): number {
  const f = parseFlags(argv, { bool: ["static", "json", "quiet", "compose-project"] });
  const root = repoRoot(d.run, d.cwd);
  if (!root) throw new UsageError("not a git repository");
  const cfgFile = join(root, ".loops", "env-check.toml");
  if (!existsSync(cfgFile)) throw new UsageError(`no ${cfgFile} (nothing to check)`);
  let text: string;
  try {
    text = readFileSync(cfgFile, "utf8");
  } catch (e) {
    throw new UsageError(`cannot read ${cfgFile}: ${(e as Error).message}`);
  }
  const cfg = parseConfig(text, ".loops/env-check.toml");
  for (const l of cfg.locals) {
    if (!isExecutable(resolve(root, l.run))) throw new UsageError(`local check ${l.id}: ${l.run} is missing or not executable`);
  }

  const isStatic = (f.static === true || d.env.CI === "true") && !f["compose-project"];
  const ls = d.run("git", ["ls-files", "-z"], { cwd: root });
  if (ls.code !== 0) throw new UsageError(`git ls-files failed${ls.stderr.trim() ? `: ${ls.stderr.trim().split("\n")[0]}` : ""}`);
  const tracked = ls.stdout.split("\0").filter(Boolean);
  let isWorktree = false;
  let worktrees: string[] = [];
  if (!isStatic) {
    const dir = (flag: string): string => resolve(root, git(d.run, root, ["rev-parse", flag])?.trim() ?? flag);
    isWorktree = dir("--git-dir") !== dir("--git-common-dir");
    worktrees = (git(d.run, root, ["worktree", "list", "--porcelain"]) ?? "")
      .split("\n")
      .flatMap((l) => (l.startsWith("worktree ") ? [l.slice(9)] : []));
  }
  const home = d.env.HOME || homedir();
  const redact = (s: string): string => redactHome(s, home);
  // Escape once, at the edges: a text row is redacted, then escaped, so a file name or relayed output can neither move
  // the cursor nor add a second fix; --json keeps values raw (redacted) and jsonText escapes them the JSON way.
  const showRow = (r: Result): Result => mapText(r, (s) => escapeCtl(redact(s)));
  const ctx: Ctx = { run: d.run, root, env: d.env, static: isStatic, cfg, tracked, isWorktree, worktrees, redact };

  if (f["compose-project"]) {
    if (cfg.compose?.mode !== "test") throw new UsageError("compose mode is not test; there is no project name");
    // Exit 0 and the name when it is kept: a FAIL that keeps it (a run without -p is unsafe, a stack of another answer
    // runs) leaves `-p <name>` safe, so print it and warn. Exit 1 when a FAIL withholds it or it is unknown. Without
    // Compose the name is what loops can vouch for: the shell's, else a worktree's derived one, else none.
    const { name, results } = composeProject(ctx);
    if (name) d.out(redact(name));
    const fails = results.filter((r) => r.level === "FAIL");
    for (const r of fails.map(showRow)) d.err(`env-check: ${name ? "warning: " : ""}${r.message} — fix: ${r.fix}`);
    if (!fails.length && !name) d.err(`env-check: ${showRow(results[0]!).message}`);
    return name ? 0 : 1;
  }

  const compose = cfg.compose?.mode === "test" ? composeProject(ctx) : null;
  // Local checks get the name --compose-project would print: kept, else empty.
  const project = compose?.name ?? null;
  const results = [
    ...pinChecks(ctx),
    ...sharedCheck(ctx),
    ...harnessChecks(ctx),
    ...composeChecks(ctx, compose),
    ...cfg.locals.flatMap((l) => runLocal(ctx, l, project)),
  ]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => group(a.r) - group(b.r) || a.i - b.i)
    .map(({ r }) => r);
  // A run with no counted row (INFO is not counted) checked nothing; say so as a counted WARN, last, exit unchanged.
  if (!results.some((r) => r.level !== "INFO")) {
    results.push(
      isStatic
        ? { level: "WARN", id: "x.none", message: "no check ran under --static (CI=true implies it)", fix: "add checks that run under --static to .loops/env-check.toml ([[pins]], [harness] files, entrypoints or tracked, or a [[local]] with static = true)", source: "builtin" }
        : { level: "WARN", id: "x.none", message: "no check ran", fix: "add checks to .loops/env-check.toml (see the loops README)", source: "builtin" },
    );
  }
  // Redacted for both outputs; the text lines are then escaped as showRow does.
  const shown = collapse(results).map((r) => {
    const x = mapText({ ...r, fix: r.fix ?? (r.level === "WARN" || r.level === "FAIL" ? "address the message above and re-run" : "") }, redact);
    return { ...x, fix: x.fix || undefined };
  });

  const n = (level: string): number => shown.filter((r) => r.level === level).length;
  const summary = { fail: n("FAIL"), warn: n("WARN"), pass: n("PASS"), skip: n("SKIP") };
  const exit = summary.fail ? 1 : 0;
  if (f.json) {
    const rs = shown.map((r) => ({ level: r.level, id: r.id, message: r.message, fix: r.fix ?? null, also: r.also ?? [], source: r.source }));
    d.out(jsonText({ schema: 1, engine: VERSION, mode: isStatic ? "static" : "full", root: redact(root), results: rs, summary, exit }));
  } else {
    const lines = shown
      .filter((r) => !f.quiet || r.level === "WARN" || r.level === "FAIL")
      .map((r) => mapText(r, escapeCtl))
      .map((r) => `${r.level} ${r.id}  ${r.message}${r.fix ? ` — fix: ${r.fix}` : ""}${r.also ? ` (also: ${r.also.join(", ")})` : ""}`);
    lines.push(`env-check: ${summary.fail} FAIL, ${summary.warn} WARN, ${summary.pass} PASS, ${summary.skip} SKIP`);
    d.out(lines.join("\n"));
  }
  return exit;
}
