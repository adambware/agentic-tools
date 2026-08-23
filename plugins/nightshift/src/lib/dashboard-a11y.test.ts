// T21 (plan §15.7): the ENFORCED token + accessibility contract for the
// dashboard renderer. Everything the design pass promised is asserted here so a
// later token tweak or markup edit cannot quietly regress it.
//
// Six contracts:
//   1 CONTRAST      — WCAG 2.1 ratio >= 4.5 for every fg/bg token pair the page
//                     actually paints, in BOTH themes.
//   2 NON-COLOUR    — colour is never the only channel: glyph + text label,
//                     severity abbreviation, arrow + visually-hidden direction.
//   3 SEMANTICS     — caption/scope/role="img"/<title>, focus ring, scroll
//                     container, tabular numerals.
//   4 SELF-CONTAINED— the static half of T23: no script, no network, no assets.
//   5 TYPE FLOOR    — nothing below 10.5px; 10.5px only for uppercase micro-labels.
//   6 MOTION        — no animation, no transition (the page is a static report).
import { describe, expect, test } from "vitest";
import {
  COVER,
  DARK_TOKENS,
  LIGHT_TOKENS,
  SEV,
  buildCss,
  renderDashboard,
} from "./dashboard-run.js";
import {
  allClearFixture,
  coldStartFixture,
  degenerateFixture,
  populatedFixture,
} from "./dashboard-fixtures.js";

/* ------------------------------------------------------------------ *
 * WCAG 2.1 relative luminance + contrast ratio                        *
 * ------------------------------------------------------------------ */

/** sRGB -> linear-light channel (WCAG 2.1 relative luminance, step 1). */
export function srgbToLinear(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** #rrggbb -> WCAG relative luminance L. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const r = srgbToLinear((n >> 16) & 0xff);
  const g = srgbToLinear((n >> 8) & 0xff);
  const b = srgbToLinear(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** (L_lighter + 0.05) / (L_darker + 0.05). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ------------------------------------------------------------------ *
 * shared fixtures / helpers                                           *
 * ------------------------------------------------------------------ */

const CSS = buildCss();

const RENDERS = [
  ["populated", renderDashboard(populatedFixture)],
  ["all-clear", renderDashboard(allClearFixture)],
  ["cold-start", renderDashboard(coldStartFixture)],
  ["degenerate", renderDashboard(degenerateFixture)],
] as const;

const FIXTURES = {
  populated: populatedFixture,
  "all-clear": allClearFixture,
  "cold-start": coldStartFixture,
  degenerate: degenerateFixture,
} as const;

const html = (name: keyof typeof FIXTURES): string =>
  RENDERS.find(([n]) => n === name)![1];

/** Innermost `selector { declarations }` blocks. Nested @media resolves to the
 *  inner rule, which is what the per-rule checks below want. */
function cssRules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    out.push({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! });
  }
  return out;
}

/** Every px font size a rule sets, via `font-size:` or the `font:` shorthand.
 *  The shorthand scan takes every px length in the value — `font:600 8px/…`
 *  must not slip past a first-token-only regex. (A px line-height would also
 *  be captured; it can only ever ADD a value >= the size, never hide one.) */
function fontSizesIn(body: string): number[] {
  const sizes: number[] = [];
  for (const m of body.matchAll(/font-size:\s*([\d.]+)px/g)) sizes.push(Number(m[1]));
  for (const m of body.matchAll(/\bfont:([^;}]*)/g)) {
    for (const px of m[1]!.matchAll(/([\d.]+)px/g)) sizes.push(Number(px[1]));
  }
  return sizes;
}

function matchAll(s: string, re: RegExp): RegExpMatchArray[] {
  return [...s.matchAll(re)];
}

/* ================================================================== *
 * 1. CONTRAST — the gate                                              *
 * ================================================================== */

/** Every foreground/background token pair the page actually paints.
 *  Sources: .t-* tones on the page/card/inset grounds, the coverage and
 *  severity pills (.p-* / .s-*), and the amber verdict panel (--act-bg). */
const PAIRS: [fg: string, bg: string][] = [
  // body + card + inset copy, plus the tinted grounds text sits on
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface2"],
  ["text", "act-bg"],
  ["text", "bad-bg"], // tbody tr.c-overdue tint
  ["text", "warn-bg"], // .stale-note
  // secondary copy (.t-neutral, .fd-meta, .v-meta, .tally, thead th, footer)
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surface2"], // .p-neutral / .s-neutral pill grounds
  ["muted", "act-bg"],
  ["muted", "bad-bg"],
  // ok tone: .p-ok pill + .t-ok inline
  ["ok", "ok-bg"],
  ["ok", "bg"],
  ["ok", "surface"],
  ["ok", "surface2"],
  // warn tone: .p-warn / .s-warn / .stale-note + .t-warn inline
  ["warn", "warn-bg"],
  ["warn", "bg"],
  ["warn", "surface"],
  ["warn", "surface2"],
  // bad tone: .p-bad / .s-bad + .t-bad inline + verdict mark on amber
  ["bad", "bad-bg"],
  ["bad", "act-bg"],
  ["bad", "bg"],
  ["bad", "surface"],
  ["bad", "surface2"],
  // neutral tone
  ["neutral", "neutral-bg"],
  ["neutral", "bg"],
  ["neutral", "surface"],
];

const THEMES: [name: string, tokens: Record<string, string>][] = [
  ["light", LIGHT_TOKENS],
  ["dark", DARK_TOKENS],
];

describe("contrast (WCAG 2.1, AA body text)", () => {
  test("the luminance maths matches the WCAG reference values", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 10);
    // sRGB mid grey is well below perceptual mid-luminance — proves the
    // 2.4 gamma branch is applied, not a naive linear ramp.
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  test("both themes define every token named by the pair list", () => {
    const needed = new Set(PAIRS.flat());
    for (const [theme, tokens] of THEMES) {
      for (const t of needed) {
        expect(tokens[t], `${theme} token --${t}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  const cases = THEMES.flatMap(([theme, tokens]) =>
    PAIRS.map(([fg, bg]) => ({ theme, tokens, fg, bg })),
  );

  test.each(cases)("$theme: --$fg on --$bg is at least 4.5:1", ({ tokens, fg, bg }) => {
    const ratio = contrastRatio(tokens[fg]!, tokens[bg]!);
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(4.5);
  });

  test("the pair list covers both themes with at least 11 pairs each", () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(11);
    expect(cases.length).toBe(PAIRS.length * 2);
  });
});

/* ================================================================== *
 * 2. NON-COLOUR CHANNEL — colour is never load-bearing alone          *
 * ================================================================== */

describe("non-colour channel", () => {
  const populated = html("populated");
  const coldStart = html("cold-start");
  const coverageRenders = populated + "\n" + coldStart;

  test.each(Object.entries(COVER))(
    "coverage state %s renders its glyph and its text label together",
    (state, spec) => {
      // The pill couples them inside one element: glyph span (aria-hidden, so
      // it is decoration) immediately followed by the readable label.
      const coupled = new RegExp(
        `<span class="g" aria-hidden="true">${spec.glyph}</span>${spec.label}`,
      );
      expect(coupled.test(coverageRenders), `no coupled pill for "${state}"`).toBe(true);
    },
  );

  test("every coverage pill in every render pairs a known glyph with its own label", () => {
    const byGlyph = new Map(Object.values(COVER).map((c) => [c.glyph, c.label]));
    let pills = 0;
    for (const [name, out] of RENDERS) {
      const found = matchAll(
        out,
        /<span class="pill p-[a-z]+">\s*<span class="g" aria-hidden="true">(.)<\/span>([^<]*)<\/span>/g,
      );
      for (const m of found) {
        pills++;
        expect(byGlyph.get(m[1]!), `${name}: unknown coverage glyph ${m[1]}`).toBeDefined();
        expect(m[2]!.trim(), `${name}: glyph ${m[1]} mislabelled`).toBe(byGlyph.get(m[1]!));
      }
    }
    expect(pills).toBeGreaterThan(0);
  });

  test("the lane tally also pairs each glyph with its label", () => {
    const tallies = matchAll(
      coverageRenders,
      /<span class="t-[a-z]+"><span aria-hidden="true">(.)<\/span> \d+ ([^<]+)<\/span>/g,
    );
    const byGlyph = new Map(Object.values(COVER).map((c) => [c.glyph, c.label]));
    const seen = tallies.filter((m) => byGlyph.has(m[1]!));
    expect(seen.length).toBeGreaterThan(0);
    for (const m of seen) expect(m[2]!.trim()).toBe(byGlyph.get(m[1]!));
  });

  test.each(RENDERS)("%s: every severity chip carries its text abbreviation", (name, out) => {
    const fixture = FIXTURES[name];
    const used = new Set(fixture.repos.flatMap((r) => r.findings.map((f) => f.severity)));
    for (const sev of used) {
      expect(out, `${name}: missing ${SEV[sev].abbr} chip`).toContain(
        `<span class="sabbr">${SEV[sev].abbr}</span>`,
      );
    }
    // No chip may be rendered without one of the known abbreviations.
    for (const m of matchAll(out, /<span class="sabbr">([^<]*)<\/span>/g)) {
      expect(Object.values(SEV).map((s) => s.abbr)).toContain(m[1]);
    }
  });

  test("the four severity abbreviations are CRIT / HIGH / MED / LOW", () => {
    expect(SEV.critical.abbr).toBe("CRIT");
    expect(SEV.high.abbr).toBe("HIGH");
    expect(SEV.medium.abbr).toBe("MED");
    expect(SEV.low.abbr).toBe("LOW");
  });

  test.each(RENDERS)("%s: every trend delta pairs an arrow with a vh direction", (name, out) => {
    const deltas = matchAll(out, /<span class="delta /g).length;
    const coupled = matchAll(
      out,
      /<span class="delta t-[a-z]+"><span aria-hidden="true">([↑↓→])<\/span>\s*<span class="vh">(improving|worsening|unchanged): <\/span>/g,
    );
    expect(coupled.length, `${name}: ${deltas} deltas, ${coupled.length} coupled`).toBe(deltas);
    for (const m of coupled) {
      const [, arrow, word] = m;
      if (arrow === "→") expect(word).toBe("unchanged");
      else expect(["improving", "worsening"]).toContain(word);
    }
  });

  test("at least one render actually exercises a trend delta", () => {
    const total = RENDERS.reduce((a, [, out]) => a + matchAll(out, /class="delta /g).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  test("the vh class is a real visually-hidden rule, not a no-op", () => {
    const rule = cssRules(CSS).find((r) => r.selector === ".vh");
    expect(rule, "no .vh rule in the stylesheet").toBeDefined();
    expect(rule!.body).toContain("position:absolute");
    expect(rule!.body).toMatch(/clip:rect\(0 0 0 0\)/);
    expect(rule!.body).toContain("overflow:hidden");
    // Must not be display:none / visibility:hidden — screen readers skip those.
    expect(rule!.body).not.toMatch(/display:\s*none/);
    expect(rule!.body).not.toMatch(/visibility:\s*hidden/);
  });

  test("overdue rows carry the tint class AND the ▲ glyph", () => {
    const rows = matchAll(html("populated"), /<tr class="c-overdue">([\s\S]*?)<\/tr>/g);
    expect(rows.length, "populated fixture has no overdue row to check").toBeGreaterThan(0);
    for (const [, out] of RENDERS) {
      for (const m of matchAll(out, /<tr class="c-overdue">([\s\S]*?)<\/tr>/g)) {
        expect(m[1]).toContain(COVER.overdue.glyph);
        expect(m[1]).toContain(COVER.overdue.label);
      }
    }
    // The tint is the *second* channel, never the only one.
    const tint = cssRules(CSS).find((r) => r.selector === "tbody tr.c-overdue");
    expect(tint?.body).toContain("var(--bad-bg)");
  });
});

/* ================================================================== *
 * 3. SEMANTICS                                                        *
 * ================================================================== */

describe("semantics", () => {
  test.each(RENDERS)("%s: every table has a caption", (name, out) => {
    const tables = matchAll(out, /<table[\s\S]*?<\/table>/g);
    for (const t of tables) {
      // A .vh caption is the table's ONLY accessible name — it must have text.
      const cap = t[0].match(/<caption[^>]*>([\s\S]*?)<\/caption>/);
      expect(cap, `${name}: table without <caption>`).not.toBeNull();
      expect(cap![1]!.trim().length, `${name}: empty <caption>`).toBeGreaterThan(0);
      expect(cap![1]).toMatch(/coverage by registry area/);
    }
  });

  test("the fixtures do render tables (the caption check is not vacuous)", () => {
    const total = RENDERS.reduce((a, [, out]) => a + matchAll(out, /<table[\s>]/g).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  test.each(RENDERS)("%s: every th declares a scope", (name, out) => {
    const ths = matchAll(out, /<th\b([^>]*)>/g);
    for (const th of ths) {
      expect(th[1], `${name}: <th${th[1]}> has no scope`).toMatch(/scope="(col|row)"/);
    }
  });

  test.each(RENDERS)("%s: every svg is role=img with a title", (name, out) => {
    const svgs = matchAll(out, /<svg[\s\S]*?<\/svg>/g);
    for (const s of svgs) {
      expect(s[0], `${name}: svg without role="img"`).toMatch(/<svg[^>]*role="img"/);
      const title = s[0].match(/<title[^>]*>([\s\S]*?)<\/title>/);
      expect(title, `${name}: svg without <title>`).not.toBeNull();
      expect(title![1]!.trim().length, `${name}: empty svg <title>`).toBeGreaterThan(0);
    }
    // Opening tags and closing tags must balance — a truncated svg would make
    // the checks above silently skip content.
    expect(matchAll(out, /<svg[\s>]/g).length).toBe(svgs.length);
  });

  test("at least one render draws an svg (the role/title check is not vacuous)", () => {
    const total = RENDERS.reduce((a, [, out]) => a + matchAll(out, /<svg[\s>]/g).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  test("the stylesheet defines a :focus-visible ring", () => {
    expect(CSS).toContain(":focus-visible");
    const rule = cssRules(CSS).find((r) => r.selector.includes(":focus-visible"));
    expect(rule, "no :focus-visible rule").toBeDefined();
    // A ring must have a real width (outline:0px slips past a \b guard) and a
    // colour that tracks the text it wraps.
    const width = rule!.body.match(/outline:\s*([\d.]+)px/);
    expect(width, "outline must declare an explicit px width").not.toBeNull();
    expect(Number(width![1])).toBeGreaterThanOrEqual(1);
    expect(rule!.body).toMatch(/outline:[^;]*currentColor/);
    expect(rule!.body).not.toMatch(/outline:\s*none/);
  });

  test.each(RENDERS)("%s: every table sits in a .tbl-scroll container", (name, out) => {
    for (const t of matchAll(out, /<table[\s>]/g)) {
      const before = out.slice(0, t.index!);
      expect(
        before.lastIndexOf('<div class="tbl-scroll">'),
        `${name}: table not wrapped in .tbl-scroll`,
      ).toBeGreaterThan(before.lastIndexOf("</div>") - 1);
    }
    expect(matchAll(out, /<div class="tbl-scroll">/g).length).toBe(
      matchAll(out, /<table[\s>]/g).length,
    );
  });

  test(".tbl-scroll is the horizontal overflow container", () => {
    const rule = cssRules(CSS).find((r) => r.selector === ".tbl-scroll");
    expect(rule, "no .tbl-scroll rule").toBeDefined();
    expect(rule!.body).toMatch(/overflow-x:\s*auto/);
  });

  test("body uses tabular numerals", () => {
    const rule = cssRules(CSS).find((r) => r.selector === "body");
    expect(rule, "no body rule").toBeDefined();
    expect(rule!.body).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  test.each(RENDERS)("%s: the document declares a language", (name, out) => {
    expect(out).toMatch(/<html lang="[a-z]{2}"/);
  });
});

/* ================================================================== *
 * 4. SELF-CONTAINED (T23, static half)                                *
 * ================================================================== */

describe("self-contained", () => {
  const FORBIDDEN: [label: string, needle: string][] = [
    ["script tag", "<script"],
    ["insecure URL", "http://"],
    ["remote URL", "https://"],
    ["css import", "@import"],
    ["image tag", "<img"],
    ["link tag", "<link"],
    ["protocol-relative URL", 'src="//'],
    ["protocol-relative anchor", 'href="//'],
    ["inline event handler", " onclick="],
    ["iframe tag", "<iframe"],
    ["object tag", "<object"],
    ["embed tag", "<embed"],
    ["srcset attribute", "srcset="],
  ];

  test.each(RENDERS)("%s render carries nothing external", (name, out) => {
    for (const [label, needle] of FORBIDDEN) {
      expect(out.includes(needle), `${name}: contains ${label} (${needle})`).toBe(false);
    }
  });

  test.each(RENDERS)("%s render fetches no asset via css url()", (name, out) => {
    expect(out).not.toMatch(/\burl\(/);
  });

  test("the stylesheet references no external asset", () => {
    expect(CSS).not.toMatch(/\burl\(/);
    expect(CSS).not.toContain("@import");
    expect(CSS).not.toContain("//fonts.");
  });

  test("the stylesheet is inlined into every render", () => {
    for (const [name, out] of RENDERS) {
      expect(out, `${name}: stylesheet not inlined`).toContain(`<style>${CSS}</style>`);
    }
  });
});

/* ================================================================== *
 * 5. TYPE FLOOR                                                       *
 * ================================================================== */

describe("type floor", () => {
  const MIN_PX = 10.5;
  const rules = cssRules(CSS);
  const sized = rules
    .map((r) => ({ ...r, sizes: fontSizesIn(r.body) }))
    .filter((r) => r.sizes.length > 0);

  test("the stylesheet actually sets font sizes (the floor check is not vacuous)", () => {
    expect(sized.length).toBeGreaterThan(5);
  });

  test(`no rule sets a font size below ${MIN_PX}px`, () => {
    const offenders = sized
      .flatMap((r) => r.sizes.filter((s) => s < MIN_PX).map((s) => `${r.selector} -> ${s}px`))
      .sort();
    expect(offenders).toEqual([]);
  });

  test(`${MIN_PX}px is reserved for uppercase micro-labels`, () => {
    const atFloor = sized.filter((r) => r.sizes.some((s) => s === MIN_PX));
    expect(atFloor.length).toBeGreaterThan(0);
    for (const r of atFloor) {
      expect(r.body, `${r.selector} is ${MIN_PX}px but not an uppercase micro-label`).toMatch(
        /text-transform:\s*uppercase/,
      );
    }
  });

  test("body copy is at least 14px", () => {
    const body = rules.find((r) => r.selector === "body");
    expect(Math.min(...fontSizesIn(body!.body))).toBeGreaterThanOrEqual(14);
  });
});

/* ================================================================== *
 * 6. MOTION                                                           *
 * ================================================================== */

describe("motion", () => {
  test("the stylesheet declares no transition", () => {
    expect(CSS).not.toMatch(/\btransition(-[a-z]+)?\s*:/);
  });

  test("the stylesheet declares no animation", () => {
    expect(CSS).not.toMatch(/\banimation(-[a-z]+)?\s*:/);
    expect(CSS).not.toMatch(/@keyframes/);
    expect(CSS).not.toMatch(/\bwill-change\s*:/);
  });

  test("no render smuggles motion past the stylesheet", () => {
    for (const [name, out] of RENDERS) {
      expect(out, `${name}: inline transition`).not.toMatch(/\btransition\s*:/);
      expect(out, `${name}: inline animation`).not.toMatch(/\banimation\s*:/);
    }
  });
});

/* ================================================================== *
 * 7. HARDENED ASSERTIONS (from the adversarial verify pass)           *
 * ================================================================== */

// P1: the severity abbreviation must be coupled to EVERY severity chip, not
// merely present somewhere in the document — dropping the sabbr span from the
// coverage-table chip while the findings-card chip keeps it must FAIL here.
describe("every severity chip carries its text abbreviation", () => {
  test.each(RENDERS.map(([n]) => n))("%s: fpill count === sabbr count", (name) => {
    const out = html(name as keyof typeof FIXTURES);
    const chips = (out.match(/class="fpill/g) ?? []).length;
    const abbrs = (out.match(/<span class="sabbr">/g) ?? []).length;
    expect(abbrs).toBe(chips);
  });
  test("the populated render actually has severity chips (not vacuous)", () => {
    expect((html("populated").match(/class="fpill/g) ?? []).length).toBeGreaterThan(2);
  });
});

// P2: the three colour-scheme states are structural CSS, enforced here.
describe("three colour-scheme states (contract: enforced by vitest)", () => {
  test("light palette lives on bare :root", () => {
    const bare = CSS.match(/(?<!\S):root\{([^}]*)\}/);
    expect(bare).not.toBeNull();
    for (const [k, v] of Object.entries(LIGHT_TOKENS)) {
      expect(bare![1]).toContain(`--${k}:${v};`);
    }
  });
  test('dark palette redefined under @media (prefers-color-scheme: dark) guarded :root:not([data-theme="light"])', () => {
    const media = CSS.match(
      /@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{([^}]*)\}/,
    );
    expect(media).not.toBeNull();
    for (const [k, v] of Object.entries(DARK_TOKENS)) {
      expect(media![1]).toContain(`--${k}:${v};`);
    }
  });
  test('explicit :root[data-theme="dark"] override carries the full dark palette', () => {
    const explicit = CSS.match(/:root\[data-theme="dark"\]\{([^}]*)\}/);
    expect(explicit).not.toBeNull();
    for (const [k, v] of Object.entries(DARK_TOKENS)) {
      expect(explicit![1]).toContain(`--${k}:${v};`);
    }
  });
  test("body paints an explicit token background (no transparent body)", () => {
    const body = cssRules(CSS).find((r) => r.selector === "body");
    expect(body!.body).toMatch(/background:\s*var\(--bg\)/);
  });
});

// P3: the contract's real floor — nothing below 11px except uppercase
// micro-labels, which may go down to 10.5px (and no lower).
describe("type floor, contract-strict", () => {
  const rules = cssRules(CSS)
    .map((r) => ({ ...r, sizes: fontSizesIn(r.body) }))
    .filter((r) => r.sizes.length > 0);
  test("nothing below 10.5px at all", () => {
    const offenders = rules.flatMap((r) =>
      r.sizes.filter((s) => s < 10.5).map((s) => `${r.selector} -> ${s}px`),
    );
    expect(offenders).toEqual([]);
  });
  test("sizes in [10.5px, 11px) only on uppercase micro-labels", () => {
    for (const r of rules) {
      if (r.sizes.some((s) => s >= 10.5 && s < 11)) {
        expect(r.body, `${r.selector} is sub-11px but not an uppercase micro-label`).toMatch(
          /text-transform:\s*uppercase/,
        );
      }
    }
  });
  test("micro-labels clear 5:1 in both themes (muted on surface)", () => {
    // thead th and .tr-goal render var(--muted) on card surfaces.
    expect(contrastRatio(LIGHT_TOKENS.muted!, LIGHT_TOKENS.surface!)).toBeGreaterThanOrEqual(5);
    expect(contrastRatio(DARK_TOKENS.muted!, DARK_TOKENS.surface!)).toBeGreaterThanOrEqual(5);
  });
});

// P4: the left-border weight is a named coverage channel — its rules must exist.
describe("coverage row left-border channel", () => {
  test("base row reserves the border-left slot", () => {
    const row = cssRules(CSS).find((r) => r.selector === "tbody tr");
    expect(row!.body).toMatch(/border-left:\s*3px solid transparent/);
  });
  test.each([
    ["tbody tr.c-overdue", "--bad"],
    ["tbody tr.c-due", "--warn"],
    ["tbody tr.c-never", "--border-strong"],
  ])("%s colours its left border with %s", (selector, token) => {
    const rule = cssRules(CSS).find((r) => r.selector === selector);
    expect(rule).toBeDefined();
    expect(rule!.body).toContain(`border-left-color:var(${token})`);
  });
});

// P5a: the '·' separator is real text — it must use a passing token (.sep was
// originally --border-strong at ~1.6:1; the contract has no decorative carve-out).
describe("separator text contrast", () => {
  test(".sep uses --muted, and muted passes on every ground it appears on", () => {
    const sep = cssRules(CSS).find((r) => r.selector === ".sep");
    expect(sep!.body).toMatch(/color:\s*var\(--muted\)/);
    for (const T of [LIGHT_TOKENS, DARK_TOKENS]) {
      for (const ground of ["bg", "surface", "surface2"]) {
        expect(contrastRatio(T.muted!, T[ground]!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

/* ================================================================== *
 * 8. RULE→TOKEN BINDING + RENDERED-CSS FLOOR (2nd adversarial pass)   *
 * ================================================================== */

// Any `color:` painted with a border/decoration token fails 4.5:1 on every
// ground — bind the CSS rules to the token set proven to pass, so repainting
// one rule (.tr-sub, .fd-meta, .hyg .ok, ...) cannot slip past the PAIRS list.
describe("no text rule paints with a non-text token", () => {
  const TEXT_UNSAFE = ["--border", "--border-strong", "--act-border", "--bg", "--surface", "--surface2", "--ok-bg", "--warn-bg", "--bad-bg", "--neutral-bg", "--act-bg"];
  test("every color: declaration in buildCss() uses a text-safe token", () => {
    const offenders: string[] = [];
    for (const r of cssRules(CSS)) {
      for (const m of r.body.matchAll(/(?<![a-z-])color:\s*var\((--[a-z-]+)\)/g)) {
        if (TEXT_UNSAFE.includes(m[1]!)) offenders.push(`${r.selector} -> color:var(${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });
  test("the scan actually sees color declarations (not vacuous)", () => {
    let n = 0;
    for (const r of cssRules(CSS)) n += [...r.body.matchAll(/(?<![a-z-])color:\s*var\(/g)].length;
    expect(n).toBeGreaterThan(10);
  });
  test.each(RENDERS)("%s: no inline style paints text with a non-text token", (name, out) => {
    for (const m of out.matchAll(/style="([^"]*)"/g)) {
      for (const c of m[1]!.matchAll(/(?<![a-z-])color:\s*var\((--[a-z-]+)\)/g)) {
        expect(TEXT_UNSAFE.includes(c[1]!), `${name}: inline ${c[0]}`).toBe(false);
      }
    }
  });
});

// The type floor must hold over EVERYTHING a render ships, not just
// buildCss(): extra <style> blocks and inline style= attributes included.
describe("type floor over full rendered output", () => {
  test.each(RENDERS)("%s: every css source in the render obeys the floor", (name, out) => {
    const sources: string[] = [];
    for (const m of out.matchAll(/<style>([\s\S]*?)<\/style>/g)) sources.push(m[1]!);
    for (const m of out.matchAll(/style="([^"]*)"/g)) sources.push(`x{${m[1]}}`);
    const offenders: string[] = [];
    for (const src of sources) {
      for (const r of cssRules(src)) {
        for (const s of fontSizesIn(r.body)) {
          if (s < 10.5) offenders.push(`${name}: ${r.selector} -> ${s}px`);
          if (s >= 10.5 && s < 11 && !/text-transform:\s*uppercase/.test(r.body))
            offenders.push(`${name}: ${r.selector} -> ${s}px without uppercase`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
  test("the render-wide scan sees the main stylesheet (not vacuous)", () => {
    const styles = [...html("populated").matchAll(/<style>([\s\S]*?)<\/style>/g)];
    expect(styles.length).toBeGreaterThanOrEqual(1);
    expect(styles[0]![1]!.length).toBeGreaterThan(1000);
  });
});

// Pin the two fpill paths separately so the coverage-table chips cannot go
// vacuous while the findings-card chips keep the count balanced.
describe("both severity-chip paths present in populated", () => {
  test("coverage-table chips (<a class=\"fpill\") and card chips (<span class=\"fpill\")", () => {
    const out = html("populated");
    expect((out.match(/<a class="fpill/g) ?? []).length).toBeGreaterThan(0);
    expect((out.match(/<span class="fpill/g) ?? []).length).toBeGreaterThan(0);
  });
});
