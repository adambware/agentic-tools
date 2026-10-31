// Built-in `loops env-check` checks (groups a, c, d, e) and the runner for `[[local]]` checks.
// Every check returns Results; a check that cannot decide fails or warns, never passes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { compileGlob } from "./glob.js";
import type { Config, LocalCheck } from "./env-config.js";
import { disagreement, localOk, pinOf, PinError, readSource, ver, type PinValue } from "./pins.js";
import { git, isExecutable, which, type Runner } from "./proc.js";

export type Level = "PASS" | "WARN" | "FAIL" | "SKIP" | "INFO";
export interface Result {
  level: Level;
  id: string;
  message: string;
  fix?: string;
  source: "builtin" | "local";
  /** Ids of later results with the same level and message, folded into this one. */
  also?: string[];
}
export interface Ctx {
  run: Runner;
  root: string;
  env: NodeJS.ProcessEnv;
  static: boolean;
  cfg: Config;
  /** `git ls-files`. */
  tracked: string[];
  /** Linked worktree? False in --static, where nothing probes worktrees. */
  isWorktree: boolean;
  /** `git worktree list` paths, the main checkout first. */
  worktrees: string[];
}

const res = (level: Level, id: string, message: string, fix?: string): Result => ({ level, id, message, fix, source: "builtin" });
const CFG = ".loops/env-check.toml";
const rp = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const short = (xs: string[], n = 5): string => xs.slice(0, n).join(", ") + (xs.length > n ? ` (+${xs.length - n} more)` : "");

const VERSION_CMD: Record<string, [string, string[]]> = { go: ["go", ["version"]], node: ["node", ["--version"]], python: ["python3", ["--version"]] };

export function pinChecks(c: Ctx): Result[] {
  const out: Result[] = [];
  for (const pin of c.cfg.pins) {
    const id = `a.pins.${pin.tool}`;
    let vals: PinValue[];
    try {
      vals = pin.sources.flatMap((s) => readSource(c.root, c.tracked, pin.tool, s));
    } catch (e) {
      if (!(e instanceof PinError)) throw e;
      out.push(res("FAIL", id, e.message, `fix the source file or the sources in ${CFG}`));
      continue;
    }
    const bad = disagreement(vals, pin.compare);
    if (bad) {
      out.push(res("FAIL", id, bad, `align the pinned versions, or loosen compare in ${CFG}`));
      continue;
    }
    const want = pinOf(vals, pin.compare);
    out.push(res("PASS", id, `${pin.tool} ${want} (${[...new Set(vals.map((v) => v.src))].join(", ")})`));
    if (c.static || pin.local === "off") continue;
    const [bin, args] = VERSION_CMD[pin.tool] ?? [pin.tool, ["--version"]];
    const r = c.run(bin, args, { cwd: c.root, env: { ...c.env, GOTOOLCHAIN: "local", GOPROXY: "off" } });
    const have = r.code === 0 ? ver(r.stdout + r.stderr) : null;
    const lid = `a.local.${pin.tool}`;
    const level = pin.local === "fail" ? "FAIL" : "WARN";
    const fix = `install ${pin.tool} ${want} (asdf install, mise install, or your package manager)`;
    if (have === null) out.push(res(level, lid, `${bin} not found or gave no version`, fix));
    else if (!localOk(have, want, pin.compare)) out.push(res(level, lid, `local ${pin.tool} ${have} does not match pin ${want}`, fix));
    else out.push(res("PASS", lid, `local ${pin.tool} ${have} matches pin ${want}`));
  }
  return out;
}

export function sharedCheck(c: Ctx): Result[] {
  if (c.cfg.sharedHint === null) return [];
  if (c.static) return [res("SKIP", "c.shared", "not checked in --static mode")];
  if (c.isWorktree) return [res("PASS", "c.shared", "in a linked worktree")];
  if (c.env.ENV_CHECK_ALLOW_MAIN) return [res("INFO", "c.shared", "shared checkout allowed by ENV_CHECK_ALLOW_MAIN")];
  return [res("FAIL", "c.shared", "this is the shared checkout; agents and branches belong in a worktree", c.cfg.sharedHint)];
}

/** Paths a CI workflow runs as `./something`. */
function autoEntrypoints(c: Ctx): string[] {
  const re = compileGlob(".github/workflows/*.{yml,yaml}");
  const found = new Set<string>();
  for (const f of c.tracked.filter((t) => re.some((r) => r.test(t)))) {
    for (const m of readFileSync(join(c.root, f), "utf8").matchAll(/^\s*(?:-\s+)?(?:run:\s+(?:[|>][+-]?\s*)?)?\.\/([\w./-]+)/gm)) found.add(m[1]!);
  }
  return [...found].sort();
}

export function harnessChecks(c: Ctx): Result[] {
  const h = c.cfg.harness;
  const out: Result[] = [];
  if (h.tools.length && !c.static) {
    const missing = h.tools.filter((t) => !which(t, c.env.PATH));
    out.push(missing.length ? res("FAIL", "d.tools", `missing on PATH: ${missing.join(", ")}`, "install the missing tools") : res("PASS", "d.tools", `present: ${h.tools.join(", ")}`));
  }
  if (h.files.length) {
    const bad = h.files.filter((f) => !existsSync(join(c.root, f)) || statSync(join(c.root, f)).size === 0);
    out.push(bad.length ? res("FAIL", "d.files", `missing or empty: ${bad.join(", ")}`, "restore the files (git checkout) or fix [harness] files") : res("PASS", "d.files", `present: ${h.files.join(", ")}`));
  }
  const entries = h.entrypoints === "auto" ? autoEntrypoints(c) : h.entrypoints;
  if (entries.length) {
    const bad = entries.filter((e) => !isExecutable(join(c.root, e)));
    out.push(bad.length ? res("FAIL", "d.entrypoints", `missing or not executable: ${short(bad)}`, `chmod +x ${bad.slice(0, 3).join(" ")}`) : res("PASS", "d.entrypoints", `${entries.length} executable`));
  }
  if (h.tracked) {
    const deleted = (git(c.run, c.root, ["ls-files", "-d"]) ?? "").split("\n").filter(Boolean);
    const lost = (git(c.run, c.root, ["ls-files", "-s"]) ?? "")
      .split("\n")
      .flatMap((l) => (l.startsWith("100755 ") ? [l.split("\t")[1] ?? ""] : []))
      .filter((p) => p && existsSync(join(c.root, p)) && !isExecutable(join(c.root, p)));
    const parts = [deleted.length ? `deleted: ${short(deleted)}` : "", lost.length ? `exec bit lost: ${short(lost)}` : ""].filter(Boolean);
    out.push(parts.length ? res("FAIL", "d.tracked", parts.join("; "), "git checkout -- <path> to restore, chmod +x for exec bits") : res("PASS", "d.tracked", "no tracked file deleted, exec bits intact"));
  }
  if (h.sparse && !c.static && git(c.run, c.root, ["config", "--get", "core.sparseCheckout"])?.trim() === "true") {
    out.push(res("WARN", "d.sparse", "sparse checkout is enabled; tools may not see every file", "git sparse-checkout disable"));
  }
  return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "");
const COMPOSE_FILE = /(^|\/)(docker-)?compose(\.[\w.-]+)?\.ya?ml$/;

function derive(c: Ctx, root: string): string {
  if (c.cfg.compose?.derive === "dirname") return norm(basename(root));
  const main = c.worktrees[0] ?? c.root;
  const hash = createHash("sha1").update(rp(root)).digest("hex").slice(0, 6);
  return `${norm(basename(main))}-${norm(basename(root)).slice(0, 24)}-${hash}`;
}

/** The Compose project name for this checkout (null in --static or on error) and its e.project result. */
export function composeProject(c: Ctx): { name: string | null; result: Result } {
  const id = "e.project";
  const { files, derive: how } = c.cfg.compose!;
  const present = files.filter((f) => existsSync(join(c.root, f)));
  if (!present.length) return { name: null, result: res("FAIL", id, `no compose file found (${files.join(", ")})`, `fix [compose] files in ${CFG}`) };
  const declared = /^name:\s*["']?([\w.-]+)/m.exec(readFileSync(join(c.root, present[0]!), "utf8"))?.[1] ?? null;
  if (c.static) return { name: null, result: res("PASS", id, `compose files present${declared ? `, name: ${declared}` : ""} (project name not resolved in --static)`) };
  const prod = declared ?? derive(c, c.worktrees[0] ?? c.root);
  const envName = c.env.COMPOSE_PROJECT_NAME || null;
  const name = envName ?? (c.isWorktree ? derive(c, c.root) : (declared ?? derive(c, c.root)));
  const source = envName ? "COMPOSE_PROJECT_NAME" : c.isWorktree || !declared ? `derived: ${how}` : "name: in compose file";
  const clash = c.worktrees.filter((w) => rp(w) !== rp(c.root) && derive(c, w) === name);
  if (c.isWorktree && name === prod) {
    return { name, result: res("FAIL", id, `worktree would use the main checkout's project name ${name}`, "set COMPOSE_PROJECT_NAME, or use derive = \"slug-hash\"") };
  }
  if (clash.length) return { name, result: res("FAIL", id, `project name ${name} also derives for worktree ${clash[0]}`, "rename a worktree, or use derive = \"slug-hash\"") };
  return { name, result: res("PASS", id, `${name} (${source})`) };
}

/**
 * b.containers: a running container of this checkout's Compose project that was created before the
 * newest commit touching a `[compose] inputs` glob is running stale code. Docker (via the injected
 * Runner) being absent or down, or the stack not running, is a SKIP, never a WARN.
 */
export function containersCheck(c: Ctx, project: string | null): Result[] {
  const cfg = c.cfg.compose!;
  const id = "b.containers";
  if (!cfg.inputs.length || !project) return [];
  const ids = c.run("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`], { cwd: c.root });
  if (ids.code !== 0) return [res("SKIP", id, "docker is not available (not installed, or the daemon is down)")];
  const running = ids.stdout.split("\n").filter(Boolean);
  if (!running.length) return [res("SKIP", id, `stack down (no running container for project ${project})`)];
  const matchers = cfg.inputs.flatMap((g) => compileGlob(g));
  const files = c.tracked.filter((f) => matchers.some((re) => re.test(f)));
  const ct = files.length ? Number(git(c.run, c.root, ["log", "-1", "--format=%ct", "--", ...files])?.trim()) : NaN;
  if (!ct) return [res("SKIP", id, "no commit touches the [compose] inputs")];
  const info = c.run("docker", ["inspect", "--format", "{{.Name}} {{.Created}}", ...running], { cwd: c.root });
  if (info.code !== 0) return [res("SKIP", id, "docker inspect failed")];
  const stale = info.stdout
    .split("\n")
    .map((l) => l.trim().split(" "))
    .filter(([name, created]) => name && Date.parse(created ?? "") < ct * 1000)
    .map(([name]) => name!.replace(/^\//, ""));
  const fix = `docker compose -p ${project} up -d --build`;
  const level = cfg.containers === "fail" ? "FAIL" : "WARN";
  return [stale.length ? res(level, id, `${short(stale)} created before the newest change to the compose inputs`, fix) : res("PASS", id, `${running.length} running container(s) are newer than the compose inputs`)];
}

export function composeChecks(c: Ctx): Result[] {
  if (!c.cfg.compose) return [];
  const { mode, files, allowContainerName } = c.cfg.compose;
  if (mode === "none") {
    const tracked = c.tracked.filter((f) => COMPOSE_FILE.test(f));
    return [tracked.length ? res("FAIL", "e.none", `config says compose mode none but ${short(tracked)} is tracked`, `set [compose] mode = "test" and list the files in ${CFG}`) : res("PASS", "e.none", "no compose file tracked")];
  }
  const names = files
    .filter((f) => existsSync(join(c.root, f)))
    .flatMap((f) => [...readFileSync(join(c.root, f), "utf8").matchAll(/^\s*container_name:\s*["']?([^\s"'#]+)/gm)].map((m) => m[1]!))
    .filter((n) => !allowContainerName.includes(n));
  const project = composeProject(c);
  return [
    project.result,
    ...(c.static ? [] : containersCheck(c, project.name)),
    names.length ? res("WARN", "e.container_name", `fixed container_name ${short([...new Set(names)])} collides across worktrees`, `drop container_name, or list it in allow_container_name in ${CFG}`) : res("PASS", "e.container_name", "no fixed container_name"),
  ];
}

const LINE = /^(PASS|WARN|FAIL|SKIP|INFO) (\S+) (.+?)(?: (?:—|--) fix: (.*))?$/;

/** Run one `[[local]]` check. Fail closed: bad lines, no lines, or a bad exit without a FAIL are FAILs. */
export function runLocal(c: Ctx, l: LocalCheck, project: string | null): Result[] {
  if (c.static && !l.static) return [{ ...res("SKIP", l.id, "not run in --static mode"), source: "local" }];
  const env: NodeJS.ProcessEnv = {
    ...c.env,
    ENV_CHECK_ROOT: c.root,
    ENV_CHECK_MODE: c.static ? "static" : "full",
    ENV_CHECK_WORKTREE: c.isWorktree ? "1" : "0",
    ENV_CHECK_PROJECT: project ?? "",
    ENV_CHECK_ID: l.id,
    GOPROXY: "off",
    GOTOOLCHAIN: "local",
    NO_COLOR: "1",
  };
  const r = c.run(join(c.root, l.run), [], { cwd: c.root, env, timeoutMs: l.timeoutS * 1000 });
  const mk = (level: Level, id: string, message: string, fix?: string): Result => ({ level, id, message, fix, source: "local" });
  if (r.timedOut) return [mk("WARN", l.id, `timed out after ${l.timeoutS}s (not a pass)`, `raise timeout_s or run ${l.run} by hand`)];
  const out: Result[] = [];
  for (const line of r.stdout.split("\n").map((s) => s.trimEnd()).filter(Boolean)) {
    const m = LINE.exec(line);
    if (m && m[2]!.startsWith(l.id)) out.push(mk(m[1] as Level, m[2]!, m[3]!, m[4]));
    else out.push(mk("FAIL", `${l.id}.protocol`, `unparseable line: ${line.slice(0, 80)}`, "emit `LEVEL id message [— fix: ...]`, one line per result, id starting with the configured id"));
  }
  const stderr = r.stderr.trim().split("\n")[0] ?? "";
  const why = stderr ? ` (${stderr.slice(0, 120)})` : "";
  if (!out.length) return [mk("FAIL", l.id, `printed no results${r.code ? `, exit ${r.code}` : ""}${why}`, `run ${l.run} by hand`)];
  if (r.code !== 0 && !out.some((x) => x.level === "FAIL")) out.push(mk("FAIL", l.id, `exited ${r.code ?? "abnormally"} without a FAIL line${why}`, `run ${l.run} by hand`));
  return out;
}
