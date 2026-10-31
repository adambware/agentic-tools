// `loops env-check`: run the repo's `.loops/env-check.toml` (built-in checks plus local checks) and
// report one line per result. Exit 0 = no FAIL, 1 = any FAIL, 2 = usage or config error.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseConfig } from "./env-config.js";
import { composeChecks, composeProject, harnessChecks, pinChecks, runLocal, sharedCheck, type Ctx, type Result } from "./env-checks.js";
import { git, isExecutable, parseFlags, repoRoot, UsageError, type Deps } from "./proc.js";
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

export function envCheckMain(argv: string[], d: Deps): number {
  const f = parseFlags(argv, { bool: ["static", "json", "quiet", "compose-project"] });
  const root = repoRoot(d.run, d.cwd);
  if (!root) throw new UsageError("not a git repository");
  const cfgFile = join(root, ".loops", "env-check.toml");
  if (!existsSync(cfgFile)) throw new UsageError(`no ${cfgFile} (nothing to check)`);
  const cfg = parseConfig(readFileSync(cfgFile, "utf8"), ".loops/env-check.toml");
  for (const l of cfg.locals) {
    if (!isExecutable(resolve(root, l.run))) throw new UsageError(`local check ${l.id}: ${l.run} is missing or not executable`);
  }

  const isStatic = (f.static === true || d.env.CI === "true") && !f["compose-project"];
  const tracked = (git(d.run, root, ["ls-files", "-z"]) ?? "").split("\0").filter(Boolean);
  let isWorktree = false;
  let worktrees: string[] = [];
  if (!isStatic) {
    const dir = (flag: string): string => resolve(root, git(d.run, root, ["rev-parse", flag])?.trim() ?? flag);
    isWorktree = dir("--git-dir") !== dir("--git-common-dir");
    worktrees = (git(d.run, root, ["worktree", "list", "--porcelain"]) ?? "")
      .split("\n")
      .flatMap((l) => (l.startsWith("worktree ") ? [l.slice(9)] : []));
  }
  const ctx: Ctx = { run: d.run, root, env: d.env, static: isStatic, cfg, tracked, isWorktree, worktrees };

  const home = d.env.HOME || homedir();
  const redact = (s: string): string => (home.length > 1 ? s.split(home).join("~") : s);

  if (f["compose-project"]) {
    if (cfg.compose?.mode !== "test") throw new UsageError("compose mode is not test; there is no project name");
    const { name, result } = composeProject(ctx);
    if (name && result.level !== "FAIL") d.out(redact(name));
    else d.err(redact(`env-check: ${result.message}`));
    return name && result.level !== "FAIL" ? 0 : 1;
  }

  const project = cfg.compose?.mode === "test" ? composeProject(ctx).name : null;
  const results = [
    ...pinChecks(ctx),
    ...sharedCheck(ctx),
    ...harnessChecks(ctx),
    ...composeChecks(ctx),
    ...cfg.locals.flatMap((l) => runLocal(ctx, l, project)),
  ]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => group(a.r) - group(b.r) || a.i - b.i)
    .map(({ r }) => r);
  const shown = collapse(results).map((r) => ({
    ...r,
    id: redact(r.id),
    message: redact(r.message),
    fix: redact(r.fix ?? (r.level === "WARN" || r.level === "FAIL" ? "address the message above and re-run" : "")) || undefined,
  }));

  const n = (level: string): number => shown.filter((r) => r.level === level).length;
  const summary = { fail: n("FAIL"), warn: n("WARN"), pass: n("PASS"), skip: n("SKIP") };
  const exit = summary.fail ? 1 : 0;
  if (f.json) {
    const rs = shown.map((r) => ({ level: r.level, id: r.id, message: r.message, fix: r.fix ?? null, also: r.also ?? [], source: r.source }));
    d.out(JSON.stringify({ schema: 1, engine: VERSION, mode: isStatic ? "static" : "full", root: redact(root), results: rs, summary, exit }));
  } else {
    const lines = shown
      .filter((r) => !f.quiet || r.level === "WARN" || r.level === "FAIL")
      .map((r) => `${r.level} ${r.id}  ${r.message}${r.fix ? ` — fix: ${r.fix}` : ""}${r.also ? ` (also: ${r.also.join(", ")})` : ""}`);
    lines.push(`env-check: ${summary.fail} FAIL, ${summary.warn} WARN, ${summary.pass} PASS, ${summary.skip} SKIP`);
    d.out(lines.join("\n"));
  }
  return exit;
}
