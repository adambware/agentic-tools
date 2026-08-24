// bin/dashboard render core (v3 A6 / T16–T21, T23). Pure: pack-shaped data in,
// one self-contained HTML string out. No I/O, no network, no JS in the output —
// inline CSS + inline SVG only. Structure, geometry, tokens, and state strings
// follow the approved reference prototype
// (~/.gstack/projects/adambware-agentic-tools/designs/nightshift-dashboard-20260823/gen.mjs).
//
// The verdict strip is computed HERE, deterministically, from pack data — never
// from the digest (plan §15.2). Its "needs you" items come from exactly three
// sources: open findings awaiting human verification, registry entries past
// interval, and failed runs (cost rows with status:"error"). Structural gaps
// (pack missing, never run) render as additional strip items per the prototype.
import type {
  CostRecord,
  DailyMetrics,
  Finding,
  Lane,
  RegistryEntry,
  RunMetrics,
  Severity,
  Suppression,
  Weight,
  DedupeKey,
} from "./types.js";
import { WEIGHT_MULTIPLIER } from "./types.js";
import { computeStaleness, daysBetween, intervalDays, tsNewer } from "./staleness.js";
import { runRowShortfall } from "./run-outcome.js";

/* ---------- input model (assembled by dashboard-cli, or a test fixture) ---------- */

export interface DigestItem {
  text: string; // may contain `code` spans via backticks; escaped + formatted here
  repo: string;
}

export interface DigestInput {
  repo: string;
  generated_at: string; // display timestamp, e.g. "2026-08-23 06:14"
  runs_behind: number; // runs recorded since the digest was generated
  age_days: number;
  items: DigestItem[];
}

export interface OpenFinding extends Finding {
  repo: string;
  lane: Lane;
  title: string;
  /** CLI stats the referenced evidence file at render time (T23). */
  evidence_present?: boolean;
  filed?: string; // e.g. a Linear id
  age_days?: number;
  no_movement?: boolean;
}

export interface LaneInput {
  lane: Lane;
  state: "on" | "disabled" | "not-ready";
  not_ready_reason?: string; // state 4: what is missing, verbatim
  entries: RegistryEntry[]; // [] with state "on" => state 6
}

export interface SuppressionView extends Suppression {
  filed?: string;
}

export interface RepoInput {
  name: string;
  path?: string; // configured path, for the state-2 message
  pack_present: boolean;
  // Set when the pack exists but could not be read (malformed YAML/JSONL).
  // Distinct from pack_present:false, which means "nothing is there".
  read_error?: string;
  lanes: LaneInput[];
  findings: OpenFinding[]; // open only (resolved_at unset)
  suppressions: SuppressionView[];
  run_records: RunMetrics[];
  daily: DailyMetrics[];
  costs: CostRecord[];
}

export interface EvidenceStats {
  files: number;
  bytes: number;
  unreferenced: number;
}

export interface DashboardInput {
  generated_at: string; // display, e.g. "2026-08-23 06:14"
  engine_version: string;
  today: string; // YYYY-MM-DD — staleness + window math
  repos: RepoInput[];
  digests: DigestInput[];
  orphan_run_dirs: { path: string; age_days: number }[];
  evidence_stats?: EvidenceStats;
}

/* ---------- design tokens (prototype palette, verified both themes) ---------- */

export const LIGHT_TOKENS: Record<string, string> = {
  bg: "#fbfbfa",
  surface: "#ffffff",
  surface2: "#f6f6f4",
  text: "#191918",
  muted: "#6c6c68",
  border: "#e4e4e0",
  "border-strong": "#c9c9c3",
  ok: "#15703f",
  "ok-bg": "#e8f5ed",
  warn: "#8a5a00",
  "warn-bg": "#fdf3e0",
  bad: "#a41c1c",
  "bad-bg": "#fdecec",
  neutral: "#5a5a75",
  "neutral-bg": "#eeeef4",
  "act-bg": "#fff8f0",
  "act-border": "#e8b981",
};

export const DARK_TOKENS: Record<string, string> = {
  bg: "#141519",
  surface: "#1c1e23",
  surface2: "#22252b",
  text: "#e9e9e6",
  muted: "#9b9b96",
  border: "#2d3037",
  "border-strong": "#454a54",
  ok: "#5fd08a",
  "ok-bg": "#12291d",
  warn: "#e8b055",
  "warn-bg": "#2c2213",
  bad: "#f28b8b",
  "bad-bg": "#301818",
  neutral: "#a9a9c4",
  "neutral-bg": "#232430",
  "act-bg": "#241c12",
  "act-border": "#7a5a2c",
};

/* ---------- primitives ---------- */

const escMap: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => escMap[c]!);
}

/** Escape, then turn `backtick` spans into <code> (digest/decision copy). */
function fmtCopy(s: string): string {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

const usdFmt = (n: number | null | undefined): string => (n == null ? "—" : "$" + n.toFixed(2));

// Coverage freshness state — ONE axis: how long since this area was reviewed.
// `never` is FIRST-CLASS and distinct from `overdue` (plan §15.9): a null
// last_reviewed must never render as overdue.
export type CoverState = "current" | "due" | "overdue" | "never";

export const COVER: Record<CoverState, { glyph: string; label: string; tone: string }> = {
  current: { glyph: "✓", label: "current", tone: "ok" },
  due: { glyph: "◐", label: "due", tone: "warn" },
  overdue: { glyph: "▲", label: "overdue", tone: "bad" },
  never: { glyph: "◇", label: "not yet reviewed", tone: "neutral" },
};

export const SEV: Record<Severity, { abbr: string; tone: string }> = {
  critical: { abbr: "CRIT", tone: "bad" },
  high: { abbr: "HIGH", tone: "bad" },
  medium: { abbr: "MED", tone: "warn" },
  low: { abbr: "LOW", tone: "neutral" },
};

/** Freshness state from last_reviewed + interval_days (never touches findings).
 *  current < 1.0 <= due <= 2.0 < overdue; null last_reviewed => never.
 *  ("due" starts the day the interval lapses — the prototype's reading; the
 *  rollup's green/stale metric axis is unchanged and unrelated.) */
export function coverState(entry: RegistryEntry, today: string): CoverState {
  if (!entry.last_reviewed) return "never";
  const s = computeStaleness(entry, today);
  if (s < 1.0) return "current";
  if (s <= 2.0) return "due";
  return "overdue";
}

/* ---------- sparkline (prototype contract, plan §15.4) ----------
   96x24. Samples carry their real date, so a manual cadence renders gaps as
   gaps: x is positioned by date across the window, never by array index.
   Always paired with the current value as TEXT — the shape is context, the
   number is the fact. Polarity says which direction is good.               */

export interface SparkSample {
  d: string; // YYYY-MM-DD
  v: number;
}

export interface SparkOpts {
  samples: SparkSample[];
  windowDays: number;
  polarity: "up-good" | "down-good";
  unit: "pct" | "usd" | "n";
  id: string;
  emptyWhy?: string; // zero-point state: why there is no data (rendered by caller)
}

function fmtVal(v: number, unit: SparkOpts["unit"]): string {
  if (unit === "pct") return v.toFixed(0) + "%";
  if (unit === "usd") return "$" + v.toFixed(2);
  return String(v);
}

function fmtDelta(d: number, unit: SparkOpts["unit"]): string {
  const s = d > 0 ? "+" : "";
  if (unit === "pct") return s + d.toFixed(0) + "pp";
  if (unit === "usd") return (d < 0 ? "-" : s) + "$" + Math.abs(d).toFixed(2);
  return s + d;
}

export function sparkline({ samples, windowDays, polarity, unit, id }: SparkOpts): string {
  const W = 96,
    H = 24,
    PAD = 3;
  if (!samples.length) {
    return `<div class="spark-wrap"><span class="spark-none">no data</span></div>`;
  }
  if (samples.length < 2) {
    const only = samples[0]!;
    return `<div class="spark-wrap">
      <span class="spark-val">${esc(fmtVal(only.v, unit))}</span>
      <span class="spark-none">1 of 2 runs — trend starts next run</span>
    </div>`;
  }
  const t0 = Date.parse(samples[0]!.d);
  const tN = Date.parse(samples[samples.length - 1]!.d);
  const span = Math.max(1, tN - t0);
  const vals = samples.map((s) => s.v);
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  if (hi === lo) {
    // flat series: centre it — min === max must not divide by zero
    hi = lo + 1;
    lo = lo - 1;
  }
  const x = (s: SparkSample) => PAD + ((Date.parse(s.d) - t0) / span) * (W - PAD * 2);
  const y = (s: SparkSample) => H - PAD - ((s.v - lo) / (hi - lo)) * (H - PAD * 2);
  const pts = samples.map((s) => `${x(s).toFixed(1)},${y(s).toFixed(1)}`).join(" ");
  const dots = samples
    .map((s) => `<circle cx="${x(s).toFixed(1)}" cy="${y(s).toFixed(1)}" r="1.4"/>`)
    .join("");
  const last = samples[samples.length - 1]!,
    prev = samples[samples.length - 2]!;
  const delta = last.v - prev.v;
  const rising = delta > 0;
  const good = delta === 0 ? null : polarity === "up-good" ? rising : !rising;
  const arrow = delta === 0 ? "→" : rising ? "↑" : "↓";
  const tone = good === null ? "neutral" : good ? "ok" : "bad";
  const desc =
    `${samples.length} samples over ${windowDays} days, ` +
    `${fmtVal(samples[0]!.v, unit)} to ${fmtVal(last.v, unit)}`;
  return `<div class="spark-wrap">
    <svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
         role="img" aria-labelledby="sl-${esc(id)}" preserveAspectRatio="none">
      <title id="sl-${esc(id)}">${esc(desc)}</title>
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.25"
                stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <g fill="currentColor">${dots}</g>
    </svg>
    <span class="spark-val">${esc(fmtVal(last.v, unit))}</span>
    <span class="delta t-${tone}"><span aria-hidden="true">${arrow}</span>
      <span class="vh">${good === null ? "unchanged" : good ? "improving" : "worsening"}: </span>${esc(fmtDelta(delta, unit))}</span>
  </div>`;
}

/** Threshold for the hygiene strip's orphaned-run-dir rows. The CLI scans
 *  with the same constant so the copy ("older than N days") stays true. */
export const ORPHAN_AGE_DAYS = 7;

/** A DOM id for one finding card, unique across repos AND across findings that
 *  share a surface. `dedupe_key.surface` alone is not unique twice over: the
 *  full key is {surface, symptom, root_cause}, so one surface can carry several
 *  findings, and taxonomy ids (QB-SEC-01) are meant to repeat across repos. A
 *  bare id="<surface>" therefore produced duplicate ids, and every verdict and
 *  coverage link jumped to whichever card the first repo happened to render. */
export function findingAnchor(f: { repo?: string; dedupe_key: DedupeKey }): string {
  const slug = (x: unknown) =>
    String(x ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const key = [f.repo, f.dedupe_key.surface, f.dedupe_key.symptom, f.dedupe_key.root_cause]
    .map(slug)
    .join("--");
  // Keep it bounded and collision-resistant: a readable prefix plus a short
  // digest of the whole key, so two long symptoms that share a prefix differ.
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `f-${key.slice(0, 60)}-${h.toString(36)}`;
}

/* ---------- verdict strip: the five-second answer ---------- */

interface VerdictItem {
  kind: string;
  tone: string;
  text: string;
  href: string;
  meta: string;
}

function verdictHtml(items: VerdictItem[], meta: string): string {
  if (!items.length) {
    return `<section class="verdict clear" aria-labelledby="v-h">
      <h1 id="v-h"><span class="v-mark" aria-hidden="true">✓</span>Nothing needs you</h1>
      <p class="v-sub">${esc(meta)}</p>
    </section>`;
  }
  // The strip is the alarm, and only four items fit above the fold, so the four
  // shown must be the four WORST — not the first four the sources happened to
  // emit. Sort is stable, so insertion order still breaks ties within a tone.
  const TONE_ORDER: Record<string, number> = { bad: 0, warn: 1, neutral: 2, ok: 3 };
  const ranked = [...items].sort(
    (a, b) => (TONE_ORDER[a.tone] ?? 9) - (TONE_ORDER[b.tone] ?? 9),
  );
  const shown = ranked.slice(0, 4),
    rest = ranked.length - shown.length;
  return `<section class="verdict act" aria-labelledby="v-h">
    <h1 id="v-h"><span class="v-mark" aria-hidden="true">▲</span>${items.length} ${items.length === 1 ? "thing needs" : "things need"} you</h1>
    <ul class="v-list">
      ${shown
        .map(
          (i) => `<li>
        <span class="v-kind t-${i.tone}">${esc(i.kind)}</span>
        <a href="#${esc(i.href)}">${esc(i.text)}</a>
        <span class="v-meta">${esc(i.meta)}</span>
      </li>`,
        )
        .join("")}
      ${rest > 0 ? `<li class="v-more"><a href="#decisions">and ${rest} more below</a></li>` : ""}
    </ul>
    <p class="v-sub">${esc(meta)}</p>
  </section>`;
}

/** Latest cost row per (repo, lane) that is an error and not yet followed by a
 *  successful run — the strip's third source.
 *
 *  Run records count as evidence of recovery, not just cost rows. An interactive
 *  re-run records a run but no cost line (that is the documented `source:manual`
 *  gap), so keying on cost rows alone would leave the strip screaming about a
 *  failure the operator already fixed, while the repo header two sections down
 *  reports the newer run as successful. */
function latestFailedRuns(repo: RepoInput): CostRecord[] {
  const byLane = new Map<Lane, CostRecord>();
  for (const c of repo.costs) {
    const cur = byLane.get(c.lane);
    if (!cur || tsNewer(c.ts, cur.ts)) byLane.set(c.lane, c);
  }
  const newestRunByLane = new Map<Lane, string>();
  for (const r of repo.run_records) {
    const cur = newestRunByLane.get(r.lane);
    if (!cur || tsNewer(r.ts, cur)) newestRunByLane.set(r.lane, r.ts);
  }
  return [...byLane.values()].filter((c) => {
    if (c.status !== "error") return false;
    const newestRun = newestRunByLane.get(c.lane);
    return !(newestRun && tsNewer(newestRun, c.ts));
  });
}

function computeVerdict(input: DashboardInput): VerdictItem[] {
  const items: VerdictItem[] = [];
  // Structural: configured repo whose pack cannot be read (state 2).
  for (const repo of input.repos) {
    if (!repo.pack_present) {
      items.push({
        kind: "config gap",
        tone: "bad",
        text: `${repo.name} is configured but its .nightshift/ pack is missing`,
        href: `gap-${repo.name}`,
        meta: `${repo.path ? `path ${repo.path} · ` : ""}nothing can be reviewed until it is onboarded`,
      });
    }
  }
  // Source 1: open findings awaiting human verification.
  for (const repo of input.repos) {
    for (const f of repo.findings) {
      if (f.needs_human_verification && !f.resolved_at) {
        items.push({
          kind: "verify",
          tone: "bad",
          text: `${f.dedupe_key.surface} — ${f.title}`,
          href: findingAnchor(f),
          meta: `${repo.name} · ${f.severity} · awaiting your verification${f.age_days != null ? ` · ${f.age_days}d open` : ""}`,
        });
      }
    }
  }
  // Source 3 (before overdue, per the prototype's order): failed runs.
  for (const repo of input.repos) {
    for (const c of latestFailedRuns(repo)) {
      items.push({
        kind: "run failed",
        tone: "bad",
        text: `${repo.name} ${c.lane} run failed ${c.date}`,
        href: "hygiene",
        meta: `${c.terminal_reason ?? "unknown"} · coverage did not advance`,
      });
    }
  }
  // Source 2: registry entries past interval. `due` (1x-2x interval) counts —
  // a6-dashboard.md defines this source as "registry entries past
  // `interval_days`", and a due entry is past its interval by definition.
  // `current` and `never` stay out: one is not due, the other has never been
  // reviewed and is first-class-distinct from rotting (plan §15.9).
  for (const repo of input.repos) {
    for (const lane of repo.lanes) {
      if (lane.state !== "on") continue;
      for (const e of lane.entries) {
        const cs = coverState(e, input.today);
        if (cs === "overdue" || cs === "due") {
          const ago = daysBetween(e.last_reviewed!, input.today);
          items.push({
            kind: cs,
            // due and overdue are both actionable but not equally urgent;
            // reuse the coverage tones so the strip does not flatten them.
            tone: COVER[cs].tone,
            text: `${e.id} — ${e.title}`,
            href: repo.name,
            meta: `${repo.name} · ${e.weight} weight · ${ago}d since review (interval ${intervalDays(e)}d)`,
          });
        }
      }
    }
  }
  // Structural: onboarded but never run (state 3). Ranked LAST, never
  // suppressed — another repo's alarms must not hide "run `ns run <repo>`"
  // (the strip overflows into "and N more below" if needed).
  for (const repo of input.repos) {
    if (!repo.pack_present || repo.run_records.length > 0) continue;
    const onLanes = repo.lanes.filter((l) => l.state === "on");
    const areas = onLanes.reduce((a, l) => a + l.entries.length, 0);
    const allNever = onLanes.every((l) =>
      l.entries.every((e) => coverState(e, input.today) === "never"),
    );
    if (areas > 0 && allNever) {
      const lane = onLanes[0]!.lane;
      items.push({
        kind: "first run",
        tone: "neutral",
        text: `${repo.name} is onboarded but has never been reviewed`,
        href: repo.name,
        meta: `${areas} ${onLanes.length === 1 ? `${lane} areas` : "areas"} registered · run \`ns run ${repo.name} ${lane}\` to start`,
      });
    }
  }
  return items;
}

/* ---------- coverage table ---------- */

const COVER_ORDER: Record<CoverState, number> = { overdue: 0, due: 1, never: 2, current: 3 };

interface LaneRow {
  entry: RegistryEntry;
  cover: CoverState;
  findings: OpenFinding[];
}

function laneRows(repo: RepoInput, lane: LaneInput, today: string): LaneRow[] {
  const bySurface = new Map<string, OpenFinding[]>();
  for (const f of repo.findings) {
    if (f.lane !== lane.lane) continue;
    const k = f.dedupe_key.surface;
    bySurface.set(k, [...(bySurface.get(k) ?? []), f]);
  }
  const rows = lane.entries.map((entry) => ({
    entry,
    cover: coverState(entry, today),
    findings: bySurface.get(entry.id) ?? [],
  }));
  // No JS on the page, so default ordering does the work: worst-first within a
  // lane, never alphabetical. Weight then id break ties (total order).
  rows.sort((a, b) => {
    const c = COVER_ORDER[a.cover] - COVER_ORDER[b.cover];
    if (c !== 0) return c;
    const w = WEIGHT_MULTIPLIER[b.entry.weight] - WEIGHT_MULTIPLIER[a.entry.weight];
    if (w !== 0) return w;
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });
  return rows;
}

function laneTableHtml(repo: RepoInput, lane: LaneInput, today: string): string {
  const laneName = `${lane.lane} lane`;
  if (lane.state === "disabled") {
    return `<div class="lane"><h4>${esc(laneName)}</h4>
      <p class="lane-off">Lane not enabled for this repo. Turn it on in <code>config.yml</code>.</p></div>`;
  }
  if (lane.state === "not-ready") {
    const reason = lane.not_ready_reason ?? "prerequisites missing";
    // "both" only when the reason actually names two missing prerequisites.
    const tail = reason.includes(" and ") ? "until both exist" : "until it exists";
    return `<div class="lane"><h4>${esc(laneName)}</h4>
      <p class="lane-off">Enabled in <code>config.yml</code>, but the pack is not ready: ${fmtCopy(reason)}. <code>ns</code> will refuse this lane ${tail}.</p></div>`;
  }
  if (!lane.entries.length) {
    return `<div class="lane"><h4>${esc(laneName)}</h4>
      <p class="lane-off">Registry seeded but empty — no areas registered yet. Run <code>/nightshift:garden</code> to propose entries.</p></div>`;
  }
  const rows = laneRows(repo, lane, today);
  const tally = rows.reduce<Partial<Record<CoverState, number>>>(
    (a, r) => ((a[r.cover] = (a[r.cover] ?? 0) + 1), a),
    {},
  );
  const openTotal = rows.reduce((a, r) => a + r.findings.length, 0);
  const tallyHtml = (Object.keys(COVER) as CoverState[])
    .filter((k) => tally[k])
    .map(
      (k) =>
        `<span class="t-${COVER[k].tone}"><span aria-hidden="true">${COVER[k].glyph}</span> ${tally[k]} ${esc(COVER[k].label)}</span>`,
    )
    .join('<span class="sep">·</span>');
  return `<div class="lane">
    <h4>${esc(laneName)}
      <span class="tally">${tallyHtml}
        ${openTotal ? `<span class="sep">·</span><span class="t-bad">● ${openTotal} open finding${openTotal === 1 ? "" : "s"}</span>` : ""}
      </span>
    </h4>
    <div class="tbl-scroll">
    <table>
      <caption class="vh">${esc(repo.name)} ${esc(laneName)} coverage by registry area</caption>
      <thead><tr>
        <th scope="col">Area</th><th scope="col">Id</th><th scope="col">Weight</th>
        <th scope="col">Coverage</th><th scope="col">Last reviewed</th><th scope="col">Open findings</th>
      </tr></thead>
      <tbody>
      ${rows
        .map((r) => {
          const c = COVER[r.cover];
          const last = r.entry.last_reviewed;
          const ago = last ? `${daysBetween(last, today)}d` : "";
          return `<tr class="c-${r.cover}">
        <th scope="row" class="area"><code>${esc(r.entry.area.join(", "))}</code></th>
        <td class="id"><code>${esc(r.entry.id)}</code></td>
        <td class="wt">${esc(r.entry.weight)}</td>
        <td class="cov"><span class="pill p-${c.tone}">
          <span class="g" aria-hidden="true">${c.glyph}</span>${esc(c.label)}</span></td>
        <td class="when">${last ? `${esc(last)} <span class="ago">${esc(ago)}</span>` : '<span class="ago">never</span>'}</td>
        <td class="find">${
          r.findings.length
            ? r.findings
                .map(
                  (f) => `<a class="fpill s-${SEV[f.severity].tone}" href="#${esc(findingAnchor(f))}">
            <span class="sabbr">${SEV[f.severity].abbr}</span>${esc(f.dedupe_key.surface)}${f.needs_human_verification ? '<span class="verify" title="needs human verification">✋</span>' : ""}</a>`,
                )
                .join("")
            : '<span class="none">—</span>'
        }</td>
      </tr>`;
        })
        .join("")}
      </tbody>
    </table>
    </div>
  </div>`;
}

/* ---------- repo header: last run per lane + result ---------- */

/** "2026-08-23 06:12" from an ISO ts — the time distinguishes a same-day
 *  success from a same-day failure (prototype artboard 1). */
function fmtTs(ts: string): string {
  return ts.slice(0, 16).replace("T", " ");
}

function repoRunLine(repo: RepoInput): string {
  // A repo with no runs and no cost rows has ONE state, not one per lane.
  if (repo.run_records.length === 0 && repo.costs.length === 0) return "never run";
  const parts: string[] = [];
  for (const lane of repo.lanes) {
    if (lane.state === "disabled") {
      parts.push(`${esc(lane.lane)} lane off`);
      continue;
    }
    const laneCosts = repo.costs.filter((c) => c.lane === lane.lane);
    const latest = laneCosts.reduce<CostRecord | null>(
      (a, c) => (!a || tsNewer(c.ts, a.ts) ? c : a),
      null,
    );
    const laneRuns = repo.run_records.filter((r) => r.lane === lane.lane);
    const latestRun = laneRuns.reduce<RunMetrics | null>(
      (a, r) => (!a || tsNewer(r.ts, a.ts) ? r : a),
      null,
    );
    if (latest && latest.status === "error" && (!latestRun || tsNewer(latest.ts, latestRun.ts))) {
      parts.push(
        `<span class="fail">${esc(lane.lane)} FAILED ${esc(fmtTs(latest.ts))} (${esc(latest.terminal_reason ?? "unknown")})</span>`,
      );
    } else if (latestRun) {
      const costPart =
        latest && latest.status === "ok" && latest.run_id === latestRun.run_id
          ? ` · ${usdFmt(latest.usd)}`
          : ' · <span class="t-warn">cost not captured</span>';
      // THE ROW EXISTING IS NOT THE SAME CLAIM AS THE RUN SUCCEEDING. This
      // branch used to print "<lane> ok <ts>" for any run row at all, plus the
      // dollar amount whenever a matching cost row said status:"ok" — including
      // for the run run-outcome.ts declares a FAILURE (a row that reviewed 0 of
      // N selected, which makes `ns` exit non-zero and keep the run dir). The
      // launcher reported failure, the living document reported success and a
      // price, and the operator only ever reads the second one.
      //
      // The two failure paths cannot collide: the cost-error branch above fires
      // only when the error cost row is NEWER than this run (or there is no run
      // at all), so a lane never renders both. The cost part stays on either
      // label deliberately — money spent on a run that reviewed nothing is the
      // most useful number on the line.
      const shortfall = runRowShortfall(latestRun);
      if (shortfall !== undefined) {
        parts.push(
          `<span class="fail">${esc(lane.lane)} FAILED ${esc(fmtTs(latestRun.ts))} (${esc(shortfall)})</span>${costPart}`,
        );
      } else {
        parts.push(`${esc(lane.lane)} ok ${esc(fmtTs(latestRun.ts))}${costPart}`);
      }
    } else {
      parts.push(`${esc(lane.lane)}: never run`);
    }
  }
  if (!parts.length) return "never run";
  return parts.join(" &nbsp;·&nbsp; ");
}

/* ---------- trends (computed from daily.jsonl max-ts lines + costs) ---------- */

const TREND_WINDOW_DAYS = 30;

/** daily.jsonl is append-only; the reader takes the max-ts line per (date, lane). */
export function maxTsDaily(lines: DailyMetrics[]): DailyMetrics[] {
  const best = new Map<string, DailyMetrics>();
  for (const l of lines) {
    const k = `${l.date}|${l.lane}`;
    const cur = best.get(k);
    if (!cur || tsNewer(l.ts, cur.ts)) best.set(k, l);
  }
  return [...best.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function inTrendWindow(date: string, today: string): boolean {
  const d = daysBetween(date, today);
  return d >= 0 && d < TREND_WINDOW_DAYS;
}

interface TrendSeries {
  freshness: SparkSample[];
  fpr: SparkSample[];
  cost: SparkSample[];
  runCount: number;
  costTotal30d: number; // same scope as the footer's 30d figure — all cost rows
}

function computeTrends(input: DashboardInput): TrendSeries {
  // Reduce per repo, THEN flatten. Flattening first would let two repos'
  // same-day rows for the same lane collide on the `date|lane` key, so one
  // repo's numbers would silently stand in for every repo — the opposite of
  // the per-date mean across (repo, lane) this function goes on to compute.
  const daily = input.repos
    .flatMap((r) => maxTsDaily(r.daily))
    .filter((l) => inTrendWindow(l.date, input.today));
  const byDate = new Map<string, DailyMetrics[]>();
  for (const l of daily) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  const dates = [...byDate.keys()].sort();
  const freshness: SparkSample[] = [];
  const fpr: SparkSample[] = [];
  for (const d of dates) {
    const ls = byDate.get(d)!;
    // One sample per date: mean across (repo, lane) rollups for that day.
    freshness.push({
      d,
      v: Math.round(ls.reduce((a, l) => a + l.coverage_freshness_pct, 0) / ls.length),
    });
    const withFpr = ls.filter((l) => l.fpr_7d != null);
    if (withFpr.length) {
      fpr.push({ d, v: Math.round(withFpr.reduce((a, l) => a + l.fpr_7d!, 0) / withFpr.length) });
    }
  }
  // Cost per run: ok cost rows, mean per date.
  const okCosts = input.repos
    .flatMap((r) => r.costs)
    .filter((c) => c.status === "ok" && inTrendWindow(c.date, input.today));
  const costByDate = new Map<string, number[]>();
  for (const c of okCosts) costByDate.set(c.date, [...(costByDate.get(c.date) ?? []), c.usd]);
  const cost: SparkSample[] = [...costByDate.keys()]
    .sort()
    .map((d) => {
      const vs = costByDate.get(d)!;
      return { d, v: Math.round((vs.reduce((a, v) => a + v, 0) / vs.length) * 100) / 100 };
    });
  const runCount = input.repos
    .flatMap((r) => r.run_records)
    .filter((r) => inTrendWindow(r.date, input.today)).length;
  // The stated 30d total must agree with the footer: ALL cost rows in window.
  const costTotal30d = input.repos
    .flatMap((r) => r.costs)
    .filter((c) => inTrendWindow(c.date, input.today))
    .reduce((a, c) => a + c.usd, 0);
  return { freshness, fpr, cost, runCount, costTotal30d };
}

function trendCard(name: string, goal: string, sub: string, spark: string): string {
  return `<div class="tr">
  <div class="tr-hd"><span class="tr-name">${esc(name)}</span><span class="tr-goal">${esc(goal)}</span></div>
  ${spark}<p class="tr-sub">${esc(sub)}</p></div>`;
}

function trendsHtml(input: DashboardInput, t: TrendSeries): string {
  const windowRuns = t.runCount > 0;
  const heading = windowRuns
    ? `Trends <span style="font-weight:400;text-transform:none;letter-spacing:0">· last ${TREND_WINDOW_DAYS} days, ${t.runCount} run${t.runCount === 1 ? "" : "s"}</span>`
    : "Trends";
  // Zero-point states name why (state 11), on two honest axes: never run AT
  // ALL vs no runs in the trend window vs runs present but this series empty.
  const everRan = input.repos.some((r) => r.run_records.length > 0);
  const whyFor = (seriesWhy: string): string => {
    if (!everRan) return "Starts after the first run.";
    if (!windowRuns) return `No runs in the last ${TREND_WINDOW_DAYS} days.`;
    return seriesWhy;
  };
  return `<section class="blk">
  <h2>${heading}</h2>
  <div class="trends">
    ${trendCard(
      "Coverage freshness",
      "higher is better",
      t.freshness.length
        ? "Share of registry areas reviewed within their interval."
        : whyFor("No daily rollup recorded in the window."),
      sparkline({ samples: t.freshness, windowDays: TREND_WINDOW_DAYS, polarity: "up-good", unit: "pct", id: "fresh" }),
    )}
    ${trendCard(
      "False-positive rate (7d)",
      "lower is better",
      t.fpr.length
        ? "Candidates refuted by Tier-1 + Tier-2, over findings created."
        : whyFor("No findings created in the window — FPR is undefined."),
      sparkline({ samples: t.fpr, windowDays: TREND_WINDOW_DAYS, polarity: "down-good", unit: "pct", id: "fpr" }),
    )}
    ${trendCard(
      "Cost per run",
      "lower is better",
      t.cost.length
        ? `${TREND_WINDOW_DAYS}d total ${usdFmt(t.costTotal30d)}.`
        : whyFor("No run in the window captured a cost envelope."),
      sparkline({ samples: t.cost, windowDays: TREND_WINDOW_DAYS, polarity: "down-good", unit: "usd", id: "cost" }),
    )}
  </div>
</section>`;
}
/* ---------- decisions (the digest's narrative queue) ---------- */

function decisionsHtml(input: DashboardInput): string {
  const anyRuns = input.repos.some((r) => r.run_records.length > 0);
  if (!input.digests.length) {
    // states 8 / 3: no digest yet. Name a real repo in the command.
    const repoName = input.repos.find((r) => r.pack_present)?.name;
    const cmd = `<code>ns digest ${esc(repoName ?? "<repo>")}</code>`;
    const copy = anyRuns
      ? `No digest yet — run ${cmd} to write the first one.`
      : `No digest yet — the first digest is written after the first run (${cmd}).`;
    return `<section class="blk" id="decisions">
  <h2>Decisions needed</h2>
  <p class="lane-off">${copy}</p>
</section>`;
  }
  // Amber banner once a digest is MORE than 2 runs behind (plan §15.1); items
  // always carry their own run-distance regardless.
  const stale = input.digests.filter((d) => d.runs_behind > 2);
  // One banner PER stale digest — aggregating would attribute one repo's
  // age/run-distance to another repo's timestamp and refresh command.
  const banner = stale
    .map(
      (d) =>
        `<p class="stale-note">⚠ Digest is ${d.age_days} days old (generated ${esc(d.generated_at)}, ${d.runs_behind} runs ago). These decisions may already be resolved — run <code>ns digest ${esc(d.repo)}</code> to refresh.</p>`,
    )
    .join("");
  const items = input.digests.flatMap((d) =>
    d.items.map(
      (i) => `<li>${fmtCopy(i.text)}
      <span class="d-src">from digest · ${esc(i.repo)} · generated ${esc(d.generated_at)} (${d.runs_behind === 0 ? "this run" : `${d.runs_behind} run${d.runs_behind === 1 ? "" : "s"} ago`})</span></li>`,
    ),
  );
  const body = items.length
    ? `<ol class="dec">${items.join("")}</ol>`
    : `<ol class="dec"><li style="padding-left:14px" class="t-neutral">No decisions pending.
      <span class="d-src">from digest · generated ${esc(input.digests[0]!.generated_at)}</span></li></ol>
  <style>.dec li:only-child::before{display:none}</style>`;
  return `<section class="blk" id="decisions">
  <h2>Decisions needed</h2>
  ${banner}
  ${body}
</section>`;
}

/* ---------- open findings ---------- */

function findingsHtml(input: DashboardInput): string {
  const all = input.repos.flatMap((r) => r.findings.map((f) => ({ repo: r.name, f })));
  const supp = input.repos.flatMap((r) => r.suppressions);
  if (!all.length && !supp.length) return "";
  all.sort(
    (a, b) => WEIGHT_MULTIPLIER[b.f.severity as Weight] - WEIGHT_MULTIPLIER[a.f.severity as Weight],
  );
  const cards = all
    .map(({ repo, f }) => {
      const sev = SEV[f.severity];
      const metaBits = [
        `${repo} · ${f.lane}`,
        f.anchor ? `anchor: ${f.anchor}${f.measured ? ` ${f.measured}` : ""}` : `${f.confidence} confidence`,
        f.filed ? `filed ${f.filed}` : null,
        f.first_seen
          ? `first seen ${f.first_seen}${f.age_days != null ? ` (${f.age_days}d${f.no_movement ? ", no movement" : ""})` : ""}`
          : null,
      ].filter(Boolean);
      // Evidence (T23): the CLI stats each referenced file at render time. A
      // missing file is an explicit state, never a dead link (state 12).
      let evidence = "";
      if (f.evidence) {
        evidence =
          f.evidence_present === false
            ? `<span class="ev ev-gone">📎 evidence no longer on disk (pruned or never copied) — the anchor value above still stands</span>`
            : `<a class="ev" href="${esc(f.evidence)}">📎 evidence: ${esc(f.evidence.split("/").pop())}</a>`;
      }
      const verifyLine =
        f.needs_human_verification && !f.filed
          ? `<p class="fd-meta">✋ Needs human verification · not yet filed to Linear</p>`
          : "";
      return `<div class="fd" id="${esc(findingAnchor(f))}">
    <div class="fd-hd"><span class="fpill s-${sev.tone}"><span class="sabbr">${sev.abbr}</span>${esc(f.dedupe_key.surface)}</span>
      <strong>${esc(f.title)}</strong>
      <span class="fd-meta">${esc(metaBits.join(" · "))}</span></div>
    ${verifyLine}${evidence}
  </div>`;
    })
    .join("");
  const suppLine = supp.length
    ? `<p class="fd-meta" style="margin-top:10px">${supp.length} active suppression${supp.length === 1 ? "" : "s"}: ${supp
        .map(
          (s) =>
            `<code>${esc(s.dedupe_key.surface)}</code> ${esc(s.reason)}, expires ${esc(s.expires)}${s.filed ? ` (${esc(s.filed)})` : ""}`,
        )
        .join(" · ")}</p>`
    : "";
  return `<section class="blk">
  <h2>Open findings</h2>
  ${cards}${suppLine}
</section>`;
}

/* ---------- hygiene strip: the ledger (the verdict strip is the alarm) ---------- */

interface HygieneRow {
  tone: "bad" | "warn";
  html: string;
}

function computeHygiene(input: DashboardInput): { rows: HygieneRow[]; okLines: string[] } {
  const rows: HygieneRow[] = [];
  for (const repo of input.repos) {
    if (!repo.pack_present) {
      rows.push({
        tone: "bad",
        html: `1 configured repo unreadable — <code>${esc(repo.name)}</code> (pack missing)`,
      });
    }
  }
  // Failed runs kept for diagnosis (from error cost rows).
  for (const repo of input.repos) {
    const failed = repo.costs.filter((c) => c.status === "error");
    for (const c of failed) {
      rows.push({
        tone: "bad",
        html: `1 failed run kept for diagnosis — <code>${esc(repo.name)}/.nightshift/.run/${esc(c.run_id)}/</code> (${esc(c.terminal_reason ?? "unknown")}, ${esc(c.date)})`,
      });
    }
  }
  // Cost-capture gaps: recorded runs with no cost line (state 13).
  for (const repo of input.repos) {
    const covered = new Set(repo.costs.map((c) => c.run_id));
    const gaps = repo.run_records.filter(
      (r) => !covered.has(r.run_id) && inTrendWindow(r.date, input.today),
    );
    if (gaps.length) {
      rows.push({
        tone: "warn",
        html: `${gaps.length} run${gaps.length === 1 ? "" : "s"} missing cost capture — <code>${esc(repo.name)}</code> ${gaps.map((g) => esc(g.date)).join(", ")} (source: interactive, no JSON envelope)`,
      });
    }
  }
  // Orphaned run dirs (CLI-scanned; listed once past the threshold age).
  for (const o of input.orphan_run_dirs) {
    rows.push({
      tone: "warn",
      html: `1 orphaned run dir older than ${ORPHAN_AGE_DAYS} days — <code>${esc(o.path)}</code>`,
    });
  }
  // Missing evidence on open findings.
  const gone = input.repos.flatMap((r) =>
    r.findings.filter((f) => f.evidence && f.evidence_present === false),
  );
  if (gone.length) {
    rows.push({
      tone: "warn",
      html: `${gone.length} open finding${gone.length === 1 ? "" : "s"} with missing evidence — ${gone.map((f) => `<code>${esc(f.dedupe_key.surface)}</code>`).join(", ")}`,
    });
  }
  const okLines: string[] = [];
  const anyRuns = input.repos.some((r) => r.run_records.length > 0 || r.costs.length > 0);
  if (!anyRuns) {
    okLines.push("No runs yet.");
  } else if (!rows.length) {
    okLines.push("No orphaned run dirs, no failed runs, every run has a cost line.");
  }
  if (input.evidence_stats) {
    const e = input.evidence_stats;
    okLines.push(
      e.files === 0
        ? "Evidence store: 0 files — no open findings reference evidence."
        : `Evidence store: ${e.files} file${e.files === 1 ? "" : "s"}, ${(e.bytes / 1048576).toFixed(1)} MB${e.unreferenced === 0 ? ", all referenced by open findings" : `, ${e.unreferenced} unreferenced`}.`,
    );
  }
  return { rows, okLines };
}

function hygieneHtml(h: { rows: HygieneRow[]; okLines: string[] }): string {
  const head = h.rows.length
    ? `<strong class="t-bad">${h.rows.length} item${h.rows.length === 1 ? "" : "s"} need${h.rows.length === 1 ? "s" : ""} cleanup</strong>`
    : `<strong class="t-ok">✓ Nothing to clean up</strong>`;
  const lis = [
    ...h.rows.map((r) => `<li class="t-${r.tone}">${r.html}</li>`),
    ...h.okLines.map((l) => `<li class="ok">${esc(l)}</li>`),
  ];
  return `<section class="blk" id="hygiene">
  <h2>Hygiene</h2>
  <div class="hyg">
    ${head}
    <ul>${lis.join("\n      ")}</ul>
  </div>
</section>`;
}

/* ---------- footer: cost never competes with the alarm ---------- */

function footerHtml(input: DashboardInput): string {
  const costs = input.repos.flatMap((r) => r.costs);
  const runs = input.repos.flatMap((r) => r.run_records);
  let costPart: string;
  if (!costs.length && !runs.length) {
    costPart = "Cost: no runs recorded";
  } else {
    const sum = (days: number) =>
      costs
        .filter((c) => {
          const d = daysBetween(c.date, input.today);
          return d >= 0 && d < days;
        })
        .reduce((a, c) => a + c.usd, 0);
    const covered = new Set(costs.map((c) => c.run_id));
    const windowRuns = runs.filter((r) => inTrendWindow(r.date, input.today));
    const missing = windowRuns.filter((r) => !covered.has(r.run_id)).length;
    costPart =
      missing > 0
        ? `Cost: <span class="t-warn">incomplete — ${missing} of ${windowRuns.length} runs missing capture</span>`
        : `Cost: ${usdFmt(sum(7))} (7d) · ${usdFmt(sum(30))} (30d)`;
  }
  return `<footer>
  <span>Generated ${esc(input.generated_at)} by <code>bin/dashboard</code> · nightshift ${esc(input.engine_version)} · disposable projection, never committed</span>
  <span>${costPart}</span>
</footer>`;
}

/* ---------- page (CSS: prototype verbatim, minus artboard scaffolding) ---------- */

function tokenBlock(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `--${k}:${v};`)
    .join(" ");
}

export function buildCss(): string {
  return `
:root{ ${tokenBlock(LIGHT_TOKENS)} }
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){ ${tokenBlock(DARK_TOKENS)} }
}
:root[data-theme="dark"]{ ${tokenBlock(DARK_TOKENS)} }
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-variant-numeric:tabular-nums;}
.page{max-width:1080px;margin:0 auto;padding:28px 20px 64px}
code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
a{color:inherit;text-decoration:none;border-bottom:1px solid var(--border-strong)}
a:hover{border-bottom-color:currentColor}
a:focus-visible,summary:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:3px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.t-ok{color:var(--ok)} .t-warn{color:var(--warn)} .t-bad{color:var(--bad)} .t-neutral{color:var(--muted)}
.sep{color:var(--muted);margin:0 7px}

/* verdict */
.verdict{border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin:0 0 26px;background:var(--surface)}
.verdict.act{background:var(--act-bg);border-color:var(--act-border);border-left-width:4px}
.verdict.clear{border-left:4px solid var(--ok)}
.verdict h1{margin:0;font-size:21px;line-height:1.25;letter-spacing:-.01em;display:flex;align-items:center;gap:9px}
.v-mark{font-size:16px}
.verdict.act .v-mark{color:var(--bad)} .verdict.clear .v-mark{color:var(--ok)}
.v-list{list-style:none;margin:13px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}
.v-list li{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
.v-kind{font-size:11px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;min-width:92px}
.v-meta{color:var(--muted);font-size:12.5px}
.v-more{padding-left:101px;font-size:12.5px;color:var(--muted)}
.v-sub{margin:14px 0 0;padding-top:11px;border-top:1px solid var(--border);color:var(--muted);font-size:12.5px}

/* sections */
section.blk{margin:0 0 30px}
h2{font-size:12px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);
   margin:0 0 12px;padding-bottom:7px;border-bottom:1px solid var(--border)}
h3{font-size:16px;margin:0;letter-spacing:-.01em}
h4{font-size:13px;margin:0 0 8px;display:flex;align-items:baseline;gap:11px;flex-wrap:wrap}

/* decisions */
.dec{list-style:none;margin:0;padding:0;counter-reset:d}
.dec li{counter-increment:d;background:var(--surface);border:1px solid var(--border);border-radius:8px;
  padding:12px 14px 12px 44px;margin-bottom:8px;position:relative}
.dec li::before{content:counter(d);position:absolute;left:14px;top:12px;width:20px;height:20px;
  border-radius:50%;background:var(--surface2);border:1px solid var(--border-strong);
  display:grid;place-items:center;font-size:11px;font-weight:650;color:var(--muted)}
.dec .d-src{display:block;margin-top:5px;color:var(--muted);font-size:12px}
.stale-note{background:var(--warn-bg);border:1px solid var(--warn);color:var(--warn);
  border-radius:7px;padding:9px 12px;margin:0 0 10px;font-size:12.5px}

/* repo */
.repo{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:14px}
.repo-hd{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;
  padding-bottom:12px;margin-bottom:14px;border-bottom:1px solid var(--border)}
.repo-run{color:var(--muted);font-size:12.5px}
.repo-run .fail{color:var(--bad);font-weight:600}
.lane + .lane{margin-top:18px;padding-top:16px;border-top:1px dashed var(--border)}
.lane-off{color:var(--muted);font-size:12.5px;margin:0;padding:9px 11px;background:var(--surface2);border-radius:6px}
.tally{font-size:11.5px;font-weight:400;color:var(--muted)}

.tbl-scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;padding:6px 9px;border-bottom:1px solid var(--border);vertical-align:top}
thead th{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:600;
  border-bottom:1px solid var(--border-strong)}
tbody tr{border-left:3px solid transparent}
tbody tr.c-overdue{border-left-color:var(--bad);background:var(--bad-bg)}
tbody tr.c-due{border-left-color:var(--warn)}
tbody tr.c-never{border-left-color:var(--border-strong)}
.area code{color:var(--text)} .id code,.wt{color:var(--muted)}
.when .ago{color:var(--muted)}
.none{color:var(--muted)}
.pill{display:inline-flex;align-items:center;gap:5px;padding:1px 8px 1px 6px;border-radius:20px;
  font-size:11.5px;font-weight:600;border:1px solid currentColor}
.pill .g{font-size:11px}
.p-ok{color:var(--ok);background:var(--ok-bg)} .p-warn{color:var(--warn);background:var(--warn-bg)}
.p-bad{color:var(--bad);background:var(--bad-bg)} .p-neutral{color:var(--muted);background:var(--surface2)}
.fpill{display:inline-flex;align-items:center;gap:5px;margin:0 5px 3px 0;padding:1px 7px;border-radius:5px;
  font-size:11px;border:1px solid currentColor;border-bottom-width:1px}
.fpill .sabbr{font-weight:700;font-size:11px;letter-spacing:.04em}
.s-bad{color:var(--bad);background:var(--bad-bg)} .s-warn{color:var(--warn);background:var(--warn-bg)}
.s-neutral{color:var(--muted);background:var(--surface2)}
.verify{font-size:11px}

/* findings detail */
.fd{border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:12px 14px;margin-bottom:8px}
.fd-hd{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px}
.fd-meta{color:var(--muted);font-size:12px}
.ev{display:inline-flex;gap:5px;align-items:center;font-size:12px;margin-top:7px}
.ev-gone{color:var(--muted);font-style:italic;border-bottom:0}

/* trends */
.trends{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.tr{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
.tr-hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:9px}
.tr-name{font-size:12.5px;font-weight:600}
.tr-goal{font-size:10.5px;color:var(--muted);letter-spacing:.03em;text-transform:uppercase}
.spark-wrap{display:flex;align-items:center;gap:10px;min-height:26px}
.spark{color:var(--muted);flex:0 0 auto}
.spark-val{font-size:19px;font-weight:600;letter-spacing:-.02em}
.spark-none{color:var(--muted);font-size:12px;font-style:italic}
.delta{font-size:12px;font-weight:600}
.tr-sub{margin:8px 0 0;color:var(--muted);font-size:11.5px}

/* hygiene */
.hyg{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:12.5px}
.hyg ul{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.hyg .ok{color:var(--muted)}
footer{margin-top:34px;padding-top:14px;border-top:1px solid var(--border);color:var(--muted);font-size:12px;
  display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between}
`;
}

/* ---------- top-level render ---------- */

function coverageHtml(input: DashboardInput): string {
  if (!input.repos.length) {
    // state 1: zero repos configured
    return `<section class="blk">
  <h2>Coverage</h2>
  <p class="lane-off">No repos configured. Add one to <code>config.yml</code>.</p>
</section>`;
  }
  const articles = input.repos
    .map((repo) => {
      if (repo.read_error) {
        // The pack is there but unreadable. Naming the parse error beats the
        // "not there" copy, which would send the operator to re-onboard a repo
        // that is actually onboarded and merely has one corrupt line.
        return `<article class="repo" id="gap-${esc(repo.name)}">
    <div class="repo-hd"><h3>${esc(repo.name)}</h3><span class="repo-run fail">unreadable</span></div>
    <p class="lane-off"><strong class="t-bad">Cannot read this repo.</strong> <code>.nightshift/</code> is present at <code>${esc(repo.path ?? "?")}</code> but could not be parsed: <code>${esc(repo.read_error)}</code>. Every other repo on this page is unaffected.</p>
  </article>`;
      }
      if (!repo.pack_present) {
        // state 2: configured but pack missing
        return `<article class="repo" id="gap-${esc(repo.name)}">
    <div class="repo-hd"><h3>${esc(repo.name)}</h3><span class="repo-run fail">pack missing</span></div>
    <p class="lane-off"><strong class="t-bad">Cannot read this repo.</strong> <code>config.yml</code> points at <code>${esc(repo.path ?? "?")}</code>, but <code>.nightshift/</code> is not there. Either run <code>/nightshift:onboard</code> in that repo, or set <code>enabled: false</code> to stop showing this row.</p>
  </article>`;
      }
      return `<article class="repo" id="${esc(repo.name)}">
    <div class="repo-hd"><h3>${esc(repo.name)}</h3>
      <span class="repo-run">${repoRunLine(repo)}</span></div>
    ${repo.lanes.map((lane) => laneTableHtml(repo, lane, input.today)).join("\n    ")}
  </article>`;
    })
    .join("\n\n  ");
  return `<section class="blk">
  <h2>Coverage</h2>

  ${articles}
</section>`;
}

function verdictMeta(input: DashboardInput): string {
  const repoCount = input.repos.length;
  const laneCount = input.repos
    .filter((r) => r.pack_present)
    .reduce((a, r) => a + r.lanes.filter((l) => l.state === "on").length, 0);
  const anyRuns = input.repos.some((r) => r.run_records.length > 0);
  const readable = input.repos.filter((r) => r.pack_present).length;
  const base = `Dashboard rebuilt ${input.generated_at}`;
  if (repoCount && readable < repoCount) {
    return `${base} · ${repoCount} repo${repoCount === 1 ? "" : "s"} configured, ${readable} readable`;
  }
  const cover = `covering ${repoCount} repo${repoCount === 1 ? "" : "s"}, ${laneCount} lane${laneCount === 1 ? "" : "s"}`;
  if (!anyRuns) return `${base} · ${cover} · no runs recorded yet`;
  return `${base} · ${cover}`;
}

/** costs.jsonl is append-only, so a retried `record-cost` legitimately leaves two
 *  rows for one run. Nine separate places in this file aggregate `repo.costs`
 *  (trends, footer totals, hygiene coverage, per-lane last-run, failure rows),
 *  so the reduction happens ONCE here on the way in — patching the call sites
 *  individually would leave the next one added silently double-counting. */
function dedupeCostsByRunId(input: DashboardInput): DashboardInput {
  return {
    ...input,
    repos: input.repos.map((r) => {
      const best = new Map<string, (typeof r.costs)[number]>();
      for (const c of r.costs) {
        const cur = best.get(c.run_id);
        if (!cur || tsNewer(c.ts, cur.ts)) best.set(c.run_id, c);
      }
      return { ...r, costs: [...best.values()] };
    }),
  };
}

export function renderDashboard(rawInput: DashboardInput): string {
  const input = dedupeCostsByRunId(rawInput);
  const items = computeVerdict(input);
  const trends = computeTrends(input);
  const body = [
    verdictHtml(items, verdictMeta(input)),
    decisionsHtml(input),
    coverageHtml(input),
    findingsHtml(input),
    trendsHtml(input, trends),
    hygieneHtml(computeHygiene(input)),
    footerHtml(input),
  ]
    .filter(Boolean)
    .join("\n\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>nightshift — dashboard</title>
<style>${buildCss()}</style></head>
<body><div class="page">${body}</div></body></html>`;
}
