// `loops env-check`: run the repo's `.loops/env-check.toml` (built-in checks plus local checks) and
// report one line per result. Exit 0 = no FAIL, 1 = any FAIL, 2 = usage or config error.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isReserved, parseConfig, type Config } from "./env-config.js";
import { composeChecks, composeProject, harnessChecks, pinChecks, runLocal, sharedCheck, type Ctx, type Result } from "./env-checks.js";
import { git, gitEnv, isExecutable, parseFlags, redactHome, repoRoot, UsageError, type Deps } from "./proc.js";
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

/**
 * `--require-checks=<ids>`: comma-separated ids, whitespace around each ignored, deduped in the order written. Each is
 * <a-e or x>.<name> as a [[local]] id is, where `*` in the name matches any run of characters (dots included). An
 * empty item, any other shape, or a reserved id is a UsageError.
 */
function requiredIds(v: string): string[] {
  const out: string[] = [];
  for (const id of v.split(",").map((x) => x.trim())) {
    if (!id) throw new UsageError(`--require-checks: empty id in "${v}"`);
    if (!/^[a-ex]\.[\w.*-]+$/.test(id)) throw new UsageError(`--require-checks: id "${id}" must look like <a-e or x>.<name> ("*" in the name matches any run of characters)`);
    if (isReserved(id)) throw new UsageError(`--require-checks: ${id} is reserved for env-check's own row and cannot be required`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** An exact id matches only itself; a `*` in it matches any run of characters. */
function idMatcher(id: string): (s: string) => boolean {
  if (!id.includes("*")) return (s) => s === id;
  const re = new RegExp(`^${id.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "s");
  return (s) => re.test(s);
}

const skipped = (id: string): Result => ({ level: "SKIP", id, message: "not run in --static mode", source: "builtin" });
/** The built-in rows --static leaves out rather than SKIPs, as the SKIPs a required id can name. */
function staticSkips(cfg: Config): Result[] {
  return [
    ...cfg.pins.filter((p) => Object.values(p.local).some((s) => s !== "off")).map((p) => skipped(`a.local.${p.tool}`)),
    ...(cfg.compose?.mode === "test" && cfg.compose.inputs.length ? [skipped("b.containers")] : []),
    ...(cfg.harness.tools.length ? [skipped("d.tools")] : []),
    ...(cfg.harness.sparse ? [skipped("d.sparse")] : []),
  ];
}

/**
 * One FAIL x.required row per required id no PASS, WARN or FAIL row satisfies. Matching runs on the rows before
 * collapse(), so an id folded into another row's `also` still counts. An a-e id is satisfied only by built-in rows (a
 * [[local]] row with a lookalike id or output never counts); an x id only by [[local]] rows.
 */
function requiredRows(required: string[], rows: Result[], isStatic: boolean): Result[] {
  const counted = (r: Result): boolean => r.level === "PASS" || r.level === "WARN" || r.level === "FAIL";
  return required.flatMap((id): Result[] => {
    const m = idMatcher(id);
    const source = id.startsWith("x.") ? "local" : "builtin";
    const hits = rows.filter((r) => r.source === source && m(r.id));
    if (hits.some(counted)) return [];
    const drop = `drop ${id} from --require-checks`;
    if (hits.length) {
      const shown = hits.slice(0, 3).map((r) => `${r.level} ${r.id}: ${r.message}`).join("; ") + (hits.length > 3 ? `; and ${hits.length - 3} more` : "");
      // Under --static a built-in SKIP is one --static always leaves out; only a [[local]] can opt in with static = true.
      const fix = !isStatic
        ? `fix what keeps the check from running, or ${drop}`
        : source === "builtin"
          ? `${id} is a built-in check that --static does not run (run env-check without --static, outside CI, to see it), or ${drop}`
          : `make the check run under --static (a [[local]] needs static = true; CI=true implies --static), or ${drop}`;
      return [{ level: "FAIL", id: "x.required", message: `${id} produced only SKIP/INFO rows (${shown})`, fix, source: "builtin" }];
    }
    const lookalike = source === "builtin" && rows.some((r) => r.source === "local" && m(r.id));
    const what = id.includes("*") ? "an id matching it" : "this id";
    const fix = source === "builtin"
      ? `configure the built-in check that produces ${id} in .loops/env-check.toml, or ${drop}`
      : `add a [[local]] check that prints ${id} to .loops/env-check.toml, or ${drop}`;
    return [{ level: "FAIL", id: "x.required", message: `${id} not configured: no check produced ${what}${lookalike ? " (a [[local]] row with it does not count: a-e ids are satisfied only by built-in checks)" : ""}`, fix, source: "builtin" }];
  });
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
  const f = parseFlags(argv, { bool: ["static", "json", "quiet", "compose-project"], opt: ["require-checks"] });
  // --require-checks: bare makes x.none a FAIL; =<ids> also FAILs (x.required) each id no check satisfied.
  const req = f["require-checks"];
  if (req !== undefined && f["compose-project"]) throw new UsageError("--require-checks does not combine with --compose-project");
  const required = typeof req === "string" ? requiredIds(req) : [];
  // Every git spawn here runs on gitEnv: the checkout cwd is in, whatever GIT_DIR the shell or a hook set. Discovery
  // (this rev-parse and the git-dir pair) runs without the git-dir; later spawns pass it to keep a hook's own index.
  const root = repoRoot(d.run, d.cwd, gitEnv(d.env));
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
  // The rev-parse pair runs in every mode, so --static tells locals what full mode does (~12 ms, no network). A failed
  // rev-parse is no git-dir at all: c.shared FAILs on it rather than guess from two made-up paths.
  const dir = (flag: string): string | null => {
    const out = git(d.run, root, ["rev-parse", flag], gitEnv(d.env))?.trim();
    return out ? resolve(root, out) : null;
  };
  const [own, common] = [dir("--git-dir"), dir("--git-common-dir")];
  const gitDir = own && common ? own : null;
  const isWorktree = !!gitDir && own !== common;
  const ls = d.run("git", ["ls-files", "-z"], { cwd: root, env: gitEnv(d.env, { gitDir, root }) });
  if (ls.code !== 0) throw new UsageError(`git ls-files failed${ls.stderr.trim() ? `: ${ls.stderr.trim().split("\n")[0]}` : ""}`);
  const tracked = ls.stdout.split("\0").filter(Boolean);
  let worktrees: string[] = [];
  let worktreesRead = false;
  if (!isStatic) {
    const list = git(d.run, root, ["worktree", "list", "--porcelain"], gitEnv(d.env, { gitDir, root }));
    worktreesRead = list !== null;
    worktrees = (list ?? "").split("\n").flatMap((l) => (l.startsWith("worktree ") ? [l.slice(9)] : []));
  }
  const home = d.env.HOME || homedir();
  const redact = (s: string): string => redactHome(s, home);
  // Escape once, at the edges: a text row is redacted, then escaped, so a file name or relayed output can neither move
  // the cursor nor add a second fix; --json keeps values raw (redacted) and jsonText escapes them the JSON way.
  const showRow = (r: Result): Result => mapText(r, (s) => escapeCtl(redact(s)));
  const ctx: Ctx = { run: d.run, root, cwd: d.cwd, env: d.env, static: isStatic, cfg, tracked, isWorktree, gitDir, worktrees, worktreesRead, redact };

  if (f["compose-project"]) {
    if (cfg.compose?.mode !== "test") throw new UsageError("compose mode is not test; there is no project name");
    // Exit 0 and the name when it is kept: a FAIL that keeps it (a run without -p is unsafe, a stack of another answer
    // runs) leaves `-p <name>` safe, so print it and warn. Exit 1 when a FAIL withholds it or it is unknown. Without
    // Compose the name is what loops can vouch for: the shell's, else a worktree's derived one, else none. Peer WARNs
    // follow any FAIL lines and never change the exit.
    const { name, results, warnings } = composeProject(ctx);
    if (name) d.out(redact(name));
    const fails = results.filter((r) => r.level === "FAIL");
    for (const r of fails.map(showRow)) d.err(`env-check: ${name ? "warning: " : ""}${r.message} — fix: ${r.fix}`);
    for (const r of warnings.map(showRow)) d.err(`env-check: warning: ${r.message} — fix: ${r.fix}`);
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
  const missing = requiredRows(required, isStatic ? [...results, ...staticSkips(cfg)] : results, isStatic);
  // A run with no FAIL, WARN or PASS checked nothing (INFO is not counted, a SKIP is not a check); say so as a counted
  // WARN, last, exit unchanged; under --require-checks it is a FAIL. The x.required rows follow it.
  if (!results.some((r) => r.level !== "INFO" && r.level !== "SKIP")) {
    const level = req === undefined ? "WARN" : "FAIL";
    results.push(
      isStatic
        ? { level, id: "x.none", message: "no check ran under --static (CI=true implies it)", fix: "add checks that run under --static to .loops/env-check.toml ([[pins]], [harness] files, entrypoints or tracked, or a [[local]] with static = true)", source: "builtin" }
        : { level, id: "x.none", message: "no check ran", fix: "add checks to .loops/env-check.toml (see the loops README)", source: "builtin" },
    );
  }
  results.push(...missing);
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
