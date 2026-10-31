#!/usr/bin/env node
import { createRequire as __loops_createRequire } from 'node:module';
const require = __loops_createRequire(import.meta.url);

// src/lib/loops-cli.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/lib/proc.ts
import { spawnSync } from "node:child_process";
var UsageError = class extends Error {
};
var run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const timedOut = r.error?.code === "ETIMEDOUT";
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut };
};
function git(r, cwd, args) {
  const res = r("git", args, { cwd });
  return res.code === 0 ? res.stdout : null;
}
function repoRoot(r, cwd) {
  return git(r, cwd, ["rev-parse", "--show-toplevel"])?.trim() || null;
}
function parseFlags(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const m = /^--?([A-Za-z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!m) throw new UsageError(`unexpected argument ${arg}`);
    const [, name = "", inline] = m;
    if (spec.bool?.includes(name) && inline === void 0) out[name] = true;
    else if (spec.value?.includes(name)) {
      const v = inline ?? argv[++i];
      if (v === void 0) throw new UsageError(`--${name} needs a value`);
      out[name] = v;
    } else if (spec.list?.includes(name) && inline === void 0) {
      const items = [];
      while (i + 1 < argv.length) {
        const next = argv[i + 1];
        if (next === "--") {
          items.push(...argv.slice(i + 2));
          i = argv.length;
        } else if (next.startsWith("-") && next !== "-") break;
        else {
          items.push(next);
          i++;
        }
      }
      out[name] = items;
    } else throw new UsageError(`unknown flag ${arg}`);
  }
  return out;
}

// src/lib/version.ts
var VERSION = "0.4.0";

// src/lib/zone-cli.ts
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// src/lib/glob.ts
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  return [...parts, cur];
}
function expandBraces(g) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}") {
      if (depth === 0) throw new UsageError(`unbalanced "}" in ${g}`);
      if (--depth === 0) {
        const parts = splitTop(g.slice(start + 1, i));
        if (parts.length < 2) throw new UsageError(`brace group without a comma in ${g} ({a..b} is not supported)`);
        return parts.flatMap((p) => expandBraces(g.slice(0, start) + p + g.slice(i + 1)));
      }
    }
  }
  if (depth !== 0) throw new UsageError(`unbalanced "{" in ${g}`);
  return [g];
}
function globToRegExp(g) {
  if (/[[!]/.test(g) || g.startsWith("/")) {
    throw new UsageError(`unsupported glob ${g} ("[", "!" and a leading "/" are not allowed)`);
  }
  let r = "";
  for (let i = 0; i < g.length; ) {
    if (g.startsWith("**/", i)) {
      r += "(?:.*/)?";
      i += 3;
    } else if (g.startsWith("**", i)) {
      r += ".*";
      i += 2;
    } else if (g[i] === "*") {
      r += "[^/]*";
      i++;
    } else if (g[i] === "?") {
      r += "[^/]";
      i++;
    } else {
      r += g[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${r}$`);
}
function compileGlob(token) {
  return expandBraces(token).map(globToRegExp);
}

// src/lib/zone.ts
var RANK = { green: 0, yellow: 1, red: 2 };
var SUPPORTED_SCHEMA = 1;
var COLUMNS = ["glob", "zone", "prod", "evidence class", "why"];
var splitCells = (line) => line.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
function parseRiskZones(text, file) {
  const lines = text.split(/\r?\n/);
  const fail = (n, msg) => {
    throw new UsageError(`${file}:${n}: ${msg}`);
  };
  const zonesAt = lines.findIndex((l) => /^## Zones\s*$/.test(l));
  if (zonesAt < 0) fail(1, "no `## Zones` section");
  const sectionEnd = (from) => {
    const i = lines.findIndex((l, n) => n > from && /^## /.test(l));
    return i < 0 ? lines.length : i;
  };
  let schema = null;
  for (let i = 0; i < zonesAt && !schema; i++) {
    const m = lines[i].startsWith(">") ? /Schema version (\d+)/.exec(lines[i]) : null;
    if (m) schema = { n: Number(m[1]), line: i + 1 };
  }
  if (!schema) fail(1, 'missing "Schema version N" in the header blockquote');
  else if (schema.n !== SUPPORTED_SCHEMA) fail(schema.line, `schema ${schema.n} unsupported by loops ${VERSION}`);
  const rows = [];
  let cols = null;
  let width = 0;
  for (let i = zonesAt + 1; i < sectionEnd(zonesAt); i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|") || /^\|[\s:|-]+$/.test(line)) continue;
    const cells = splitCells(line);
    if (!cols) {
      width = cells.length;
      cols = COLUMNS.map((name) => cells.findIndex((c) => c.toLowerCase().startsWith(name)));
      const missing = COLUMNS.filter((_, k) => cols[k] === -1);
      if (missing.length) fail(i + 1, `table header lacks column(s): ${missing.join(", ")}`);
      continue;
    }
    if (cells.length !== width) fail(i + 1, `expected ${width} columns, found ${cells.length}`);
    const cell = (k) => cells[cols[k]];
    const zone = cell(1).toLowerCase();
    if (!(zone in RANK)) fail(i + 1, `unknown zone "${cell(1)}" (green, yellow or red)`);
    const prod = cell(2).toLowerCase();
    if (prod !== "yes" && prod !== "no" && prod !== "?") fail(i + 1, `Prod must be yes, no or ?, found "${cell(2)}"`);
    const tokens = [...cell(0).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (!tokens.length) fail(i + 1, "Glob cell has no backticked glob");
    const evidence = cell(3).split(",").map((e) => e.trim().toLowerCase()).filter((e) => e && e !== "none");
    for (const glob of tokens) {
      let matchers = [];
      try {
        matchers = compileGlob(glob);
      } catch (e) {
        fail(i + 1, e.message);
      }
      rows.push({ line: i + 1, glob, zone, prod, evidence, matchers });
    }
  }
  if (!rows.length) fail(zonesAt + 1, "`## Zones` table has no rows");
  const ship = {};
  const shipAt = lines.findIndex((l) => /^## Ship prefix\s*$/.test(l));
  for (let i = shipAt + 1; shipAt >= 0 && i < sectionEnd(shipAt); i++) {
    const m = /^- ([^:]+):\s*(.*?)\s*$/.exec(lines[i]);
    if (m) ship[m[1].trim()] = /^"[^"]*"$/.test(m[2]) ? m[2].slice(1, -1) : m[2];
  }
  return { rows, ship };
}
function classifyPath(rz, path) {
  const rows = rz.rows.filter((r) => r.matchers.some((re) => re.test(path)));
  if (!rows.length) return { path, zone: "yellow", prod: false, evidence: [], rows, unmatched: true };
  const zone = rows.reduce((z, r) => RANK[r.zone] > RANK[z] ? r.zone : z, "green");
  const evidence = [...new Set(rows.flatMap((r) => r.evidence))].sort();
  return { path, zone, prod: rows.some((r) => r.prod !== "no"), evidence, rows, unmatched: false };
}
function summarize(infos) {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const p of infos) counts[p.zone]++;
  const zone = infos.reduce((z, p) => z === "none" || RANK[p.zone] > RANK[z] ? p.zone : z, "none");
  const drivers = [];
  const byRow = /* @__PURE__ */ new Map();
  const loose = [];
  for (const p of infos) {
    if (p.zone !== zone) continue;
    if (p.unmatched) loose.push(p.path);
    for (const r of p.rows) if (r.zone === zone) byRow.set(r, [...byRow.get(r) ?? [], p.path]);
  }
  for (const [row, paths] of byRow) drivers.push({ row, paths });
  if (loose.length) drivers.push({ row: null, paths: loose });
  return {
    zone,
    prodPaths: infos.filter((p) => p.prod).length,
    unmatched: infos.filter((p) => p.unmatched).length,
    evidence: [...new Set(infos.flatMap((p) => p.evidence))].sort(),
    counts,
    drivers
  };
}

// src/lib/zone-cli.ts
function parseNameStatus(z) {
  const t = z.split("\0");
  const paths = [];
  for (let i = 0; i < t.length && t[i]; ) {
    const n = t[i].startsWith("R") || t[i].startsWith("C") ? 2 : 1;
    paths.push(...t.slice(i + 1, i + 1 + n).filter(Boolean));
    i += 1 + n;
  }
  return paths;
}
function gitPaths(d, root, base, committed) {
  const g = (args) => {
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
    paths.push(...g(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"));
  }
  return paths;
}
var plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
var LIST_CAP = 8;
function renderText(rz, file, infos, s, explain) {
  if (s.zone === "none") return ["zone: none"];
  const lines = [`zone: ${s.zone}`];
  const note = s.unmatched ? `; ${s.unmatched} unmatched (counted as no)` : "";
  lines.push(
    `prod: ${s.prodPaths ? "yes" : "no"} (l7: ${s.prodPaths ? "required" : "not required"}; prod-touching: ${plural(s.prodPaths, "path")}${note})`,
    `evidence: ${s.evidence.join(", ") || "none"}`,
    "driving rows:"
  );
  for (const { row, paths } of s.drivers) {
    const shown = paths.slice(0, LIST_CAP).join(", ") + (paths.length > LIST_CAP ? `, (+${paths.length - LIST_CAP} more)` : "");
    lines.push(`  ${s.zone}  ${row ? `\`${row.glob}\`` : "(no row: default yellow)"}  ${plural(paths.length, "path")}: ${shown}`);
  }
  const inc = s.unmatched ? ` incl. ${s.unmatched} unmatched` : "";
  lines.push(`paths: ${infos.length} (red ${s.counts.red}, yellow ${s.counts.yellow}${inc}, green ${s.counts.green})`);
  const ship = rz.ship[s.zone];
  if (ship === void 0) throw new UsageError(`${file}: no "- ${s.zone}:" bullet under "## Ship prefix"`);
  lines.push(`ship: ${ship}`);
  if (s.zone === "green") {
    const alt = ["docs-only", "trivial S0"].flatMap((k) => rz.ship[k] ? [`${k}: ${rz.ship[k]}`] : []);
    if (alt.length) lines.push(`alt: ${alt.join(" | ")}`);
  }
  lines.push(
    "judgment left to L0: <category>, <one extra review chosen at L0>; docs-only / trivial S0 rows;",
    "  one-way changes (migration, deleted history, published release, public post) are red regardless"
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
function zoneMain(argv, d) {
  const f = parseFlags(argv, {
    bool: ["committed", "stdin", "z", "json", "explain"],
    value: ["base", "file"],
    list: ["paths"]
  });
  if (f.paths && f.stdin) throw new UsageError("--paths and --stdin are mutually exclusive");
  const root = repoRoot(d.run, d.cwd) ?? d.cwd;
  const filePath = typeof f.file === "string" ? resolve(d.cwd, f.file) : join(root, "risk-zones.md");
  if (!existsSync(filePath)) throw new UsageError(`cannot read ${filePath}`);
  const shown = relative(d.cwd, filePath).startsWith("..") ? filePath : relative(d.cwd, filePath);
  const rz = parseRiskZones(readFileSync(filePath, "utf8"), shown);
  let raw;
  if (Array.isArray(f.paths)) raw = f.paths;
  else if (f.stdin) raw = d.readStdin().split(f.z ? "\0" : "\n");
  else if (repoRoot(d.run, d.cwd) === null) throw new UsageError("not a git repository; pass --paths or --stdin");
  else raw = gitPaths(d, root, typeof f.base === "string" ? f.base : void 0, f.committed === true);
  const paths = [...new Set(raw.map((p) => p.replace(/^\.\//, "").trim()).filter(Boolean))].sort();
  const infos = paths.map((p) => classifyPath(rz, p));
  const s = summarize(infos);
  if (f.json) {
    const ship = s.zone === "none" ? null : rz.ship[s.zone] ?? null;
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
        ship
      })
    );
  } else d.out(renderText(rz, shown, infos, s, f.explain === true).join("\n"));
  return 0;
}

// src/lib/loops-cli.ts
var USAGE = `loops ${VERSION}
usage: loops <command> [options]
  zone       [--base REF] [--committed] [--paths P... | --stdin [-z]] [--file F] [--json] [--explain]
  --version`;
function realDeps() {
  return {
    run,
    cwd: process.cwd(),
    env: process.env,
    readStdin: () => readFileSync2(0, "utf8"),
    out: (s) => process.stdout.write(`${s}
`),
    err: (s) => process.stderr.write(`${s}
`)
  };
}
function main(argv, d = realDeps()) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "--version" || cmd === "-V") d.out(`loops ${VERSION}`);
    else if (cmd === "-h" || cmd === "--help") d.out(USAGE);
    else if (cmd === "zone") return zoneMain(rest, d);
    else throw new UsageError(cmd ? `unknown command ${cmd}
${USAGE}` : USAGE);
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    d.err(`${cmd ?? "loops"}: ${e.message}`);
    return 2;
  }
}

// src/bin/loops.ts
process.exitCode = main(process.argv.slice(2));
