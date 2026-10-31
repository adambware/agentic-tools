// `loops zone`: classify a change's paths against the repo's risk-zones.md. Exit 0 whenever the
// change classified (the zone is never in the exit code; read --json), 2 for usage/parse/git errors.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { git, parseFlags, repoRoot, UsageError, type Deps } from "./proc.js";
import { classifyPath, parseRiskZones, summarize, type PathInfo, type RiskZones, type Summary } from "./zone.js";

/** Paths out of `git diff --name-status -M -z`: renames contribute both sides. */
export function parseNameStatus(z: string): string[] {
  const t = z.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < t.length && t[i]; ) {
    const n = t[i]!.startsWith("R") || t[i]!.startsWith("C") ? 2 : 1;
    paths.push(...t.slice(i + 1, i + 1 + n).filter(Boolean));
    i += 1 + n;
  }
  return paths;
}

function gitPaths(d: Deps, root: string, base: string | undefined, committed: boolean): string[] {
  const g = (args: string[]): string => {
    const r = d.run("git", args, { cwd: root });
    if (r.code !== 0) throw new UsageError(`git ${args[0]} failed: ${r.stderr.trim().split("\n")[0] ?? ""}`);
    return r.stdout;
  };
  const tried = base ? [base] : ["origin/HEAD", "origin/main", "main"];
  const ref = tried.find((x) => git(d.run, root, ["rev-parse", "--verify", "--quiet", `${x}^{commit}`]) !== null);
  if (!ref) throw new UsageError(`no base ref found (tried ${tried.join(", ")}); pass --base`);
  const mergeBase = g(["merge-base", ref, "HEAD"]).trim();
  const paths = parseNameStatus(g(["diff", "--name-status", "-M", "-z", mergeBase, "HEAD"]));
  if (!committed) {
    paths.push(...parseNameStatus(g(["diff", "--name-status", "-M", "-z", "HEAD"])));
    // staged paths count even when the working copy was restored to HEAD (index != HEAD == worktree)
    paths.push(...parseNameStatus(g(["diff", "--cached", "--name-status", "-M", "-z"])));
    paths.push(...g(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"));
  }
  return paths;
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
const LIST_CAP = 8;

function renderText(rz: RiskZones, ship: string, infos: PathInfo[], s: Summary, explain: boolean): string[] {
  if (s.zone === "none") return ["zone: none"];
  const lines = [`zone: ${s.zone}`];
  const note = s.unmatched ? `; ${s.unmatched} unmatched (counted as no)` : "";
  lines.push(
    `prod: ${s.prodPaths ? "yes" : "no"} (l7: ${s.prodPaths ? "required" : "not required"}; prod-touching: ${plural(s.prodPaths, "path")}${note})`,
    `evidence: ${s.evidence.join(", ") || "none"}`,
    "driving rows:",
  );
  for (const { row, paths } of s.drivers) {
    const shown = paths.slice(0, LIST_CAP).join(", ") + (paths.length > LIST_CAP ? `, (+${paths.length - LIST_CAP} more)` : "");
    lines.push(`  ${s.zone}  ${row ? `\`${row.glob}\`` : "(no row: default yellow)"}  ${plural(paths.length, "path")}: ${shown}`);
  }
  const inc = s.unmatched ? ` incl. ${s.unmatched} unmatched` : "";
  lines.push(`paths: ${infos.length} (red ${s.counts.red}, yellow ${s.counts.yellow}${inc}, green ${s.counts.green})`);
  lines.push(`ship: ${ship}`);
  if (s.zone === "green") {
    const alt = ["docs-only", "trivial S0"].flatMap((k) => (rz.ship[k] ? [`${k}: ${rz.ship[k]}`] : []));
    if (alt.length) lines.push(`alt: ${alt.join(" | ")}`);
  }
  lines.push(
    "judgment left to L0: <category>, <one extra review chosen at L0>; docs-only / trivial S0 rows;",
    "  one-way changes (migration, deleted history, published release, public post) are red regardless",
  );
  if (explain) {
    lines.push("explain:");
    for (const p of infos) {
      const rows = p.unmatched ? "(no row: default yellow)" : p.rows.map((r) => `\`${r.glob}\``).join(" ");
      lines.push(`  ${p.zone.padEnd(6)} ${p.prod ? "prod" : "-   "}  ${p.path}  <- ${rows}`);
    }
  }
  return lines;
}

export function zoneMain(argv: string[], d: Deps): number {
  const f = parseFlags(argv, {
    bool: ["committed", "stdin", "z", "json", "explain"],
    value: ["base", "file"],
    list: ["paths"],
  });
  if (f.paths && f.stdin) throw new UsageError("--paths and --stdin are mutually exclusive");
  const root = repoRoot(d.run, d.cwd) ?? d.cwd;
  const filePath = typeof f.file === "string" ? resolve(d.cwd, f.file) : join(root, "risk-zones.md");
  if (!existsSync(filePath)) throw new UsageError(`cannot read ${filePath}`);
  const shown = relative(d.cwd, filePath).startsWith("..") ? filePath : relative(d.cwd, filePath);
  const rz = parseRiskZones(readFileSync(filePath, "utf8"), shown);

  let raw: string[];
  if (Array.isArray(f.paths)) raw = f.paths;
  else if (f.stdin) raw = d.readStdin().split(f.z ? "\0" : "\n");
  else if (repoRoot(d.run, d.cwd) === null) throw new UsageError("not a git repository; pass --paths or --stdin");
  else raw = gitPaths(d, root, typeof f.base === "string" ? f.base : undefined, f.committed === true);
  const paths = [...new Set(raw.map((p) => p.replace(/^\.\//, "").trim()).filter(Boolean))].sort();

  const infos = paths.map((p) => classifyPath(rz, p));
  const s = summarize(infos);
  // validated before choosing the output format so --json and text agree on exit 2
  const ship = s.zone === "none" ? null : (rz.ship[s.zone] ?? null);
  if (s.zone !== "none" && ship === null) throw new UsageError(`${shown}: no "- ${s.zone}:" bullet under "## Ship prefix"`);
  if (f.json) {
    d.out(
      JSON.stringify({
        schema: 1,
        zone: s.zone,
        prod: s.prodPaths > 0,
        prod_paths: s.prodPaths,
        unmatched: s.unmatched,
        evidence: s.evidence,
        counts: s.counts,
        driving_rows: s.drivers.map((x) => ({ glob: x.row?.glob ?? null, line: x.row?.line ?? null, paths: x.paths })),
        paths: infos.map((p) => ({ path: p.path, zone: p.zone, prod: p.prod, unmatched: p.unmatched, evidence: p.evidence, globs: p.rows.map((r) => r.glob) })),
        ship,
      }),
    );
  } else d.out(renderText(rz, ship ?? "", infos, s, f.explain === true).join("\n"));
  return 0;
}
