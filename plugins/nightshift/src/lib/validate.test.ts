// Pure-validator tests (validate-cli.test.ts covers only the CLI/format layer).
// Focus: the A4/T6 id-sanitization gate and the optional Surface.dispatch shape.
import { describe, it, expect } from "vitest";
import {
  SAFE_ID_RE,
  isSafeId,
  validateRegistryEntry,
  validateSurface,
  validateCandidateFinding,
} from "./validate.js";

const VALID_ENTRY = {
  id: "ND-SEC-01",
  title: "Auth bypass check",
  kind: "vector",
  area: ["app/auth/*"],
  weight: "critical",
  interval_days: 7,
  owner: "security",
};

const VALID_SURFACE = {
  id: "ND-SEC-01",
  title: "Auth bypass check",
  weight: "critical",
  area: ["app/auth/*"],
  staleness: 1.5,
  change_flag: 0,
  score: 12,
  band: "critical",
};

const VALID_CANDIDATE = {
  dedupe_key: { surface: "ND-SEC-01", symptom: "sym", root_cause: "rc" },
  severity: "critical",
  confidence: "high",
  needs_human_verification: true,
};

// ---------------------------------------------------------------------------
// isSafeId / SAFE_ID_RE
// ---------------------------------------------------------------------------

describe("isSafeId", () => {
  it("accepts the alnum/underscore/dot/hyphen charset", () => {
    expect(isSafeId("ok-id_1.2")).toBe(true);
    expect(isSafeId("ND-SEC-01")).toBe(true);
    expect(isSafeId("a")).toBe(true);
  });

  it("rejects path separators and traversal", () => {
    expect(isSafeId("../../x")).toBe(false);
    expect(isSafeId("a/b")).toBe(false);
    expect(isSafeId("a\\b")).toBe(false);
    expect(isSafeId("/etc/passwd")).toBe(false);
  });

  it('rejects "." and ".." even though both match the charset', () => {
    expect(SAFE_ID_RE.test(".")).toBe(true);
    expect(SAFE_ID_RE.test("..")).toBe(true);
    expect(isSafeId(".")).toBe(false);
    expect(isSafeId("..")).toBe(false);
  });

  it("rejects the empty string and other metacharacters", () => {
    expect(isSafeId("")).toBe(false);
    expect(isSafeId("a b")).toBe(false);
    expect(isSafeId("a*b")).toBe(false);
    expect(isSafeId("a$b")).toBe(false);
    expect(isSafeId("a\0b")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRegistryEntry — id sanitization
// ---------------------------------------------------------------------------

describe("validateRegistryEntry: id sanitization", () => {
  it("accepts a safe id", () => {
    const r = validateRegistryEntry({ ...VALID_ENTRY, id: "ok-id_1.2" });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects id "../../x"', () => {
    const r = validateRegistryEntry({ ...VALID_ENTRY, id: "../../x" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("registry-entry: id") && e.includes("path segment"))).toBe(
      true,
    );
  });

  it('rejects id "a/b"', () => {
    const r = validateRegistryEntry({ ...VALID_ENTRY, id: "a/b" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it('rejects id "."', () => {
    const r = validateRegistryEntry({ ...VALID_ENTRY, id: "." });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('not be "." or ".."'))).toBe(true);
  });

  it('rejects id ".."', () => {
    const r = validateRegistryEntry({ ...VALID_ENTRY, id: ".." });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('not be "." or ".."'))).toBe(true);
  });

  it("reports the type error once (not also the charset error) for a non-string id", () => {
    const r = validateRegistryEntry({ ...VALID_ENTRY, id: 42 });
    expect(r.ok).toBe(false);
    const idErrors = r.errors.filter((e) => e.startsWith("registry-entry: id"));
    expect(idErrors).toHaveLength(1);
    expect(idErrors[0]).toContain("non-empty string");
  });

  it("reports the type error once for an empty-string id", () => {
    const r = validateRegistryEntry({ ...VALID_ENTRY, id: "" });
    expect(r.ok).toBe(false);
    const idErrors = r.errors.filter((e) => e.startsWith("registry-entry: id"));
    expect(idErrors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// validateSurface — id sanitization + dispatch
// ---------------------------------------------------------------------------

describe("validateSurface: id sanitization", () => {
  it("accepts a safe id", () => {
    const r = validateSurface({ ...VALID_SURFACE, id: "ok-id_1.2" });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects id "../../x"', () => {
    const r = validateSurface({ ...VALID_SURFACE, id: "../../x" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("surface: id"))).toBe(true);
  });

  it('rejects id "a/b"', () => {
    const r = validateSurface({ ...VALID_SURFACE, id: "a/b" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("surface: id"))).toBe(true);
  });

  it('rejects id "." and ".."', () => {
    expect(validateSurface({ ...VALID_SURFACE, id: "." }).ok).toBe(false);
    expect(validateSurface({ ...VALID_SURFACE, id: ".." }).ok).toBe(false);
  });
});

describe("validateSurface: dispatch", () => {
  it("absent dispatch stays valid (older artifacts)", () => {
    const r = validateSurface(VALID_SURFACE);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts a well-formed dispatch", () => {
    const r = validateSurface({
      ...VALID_SURFACE,
      dispatch: { model: "claude-opus-4-5", effort: "high", maxTurns: 40 },
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a non-object dispatch", () => {
    const r = validateSurface({ ...VALID_SURFACE, dispatch: "opus" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("dispatch must be an object"))).toBe(true);
  });

  it("rejects an array dispatch", () => {
    const r = validateSurface({ ...VALID_SURFACE, dispatch: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("dispatch must be an object"))).toBe(true);
  });

  it("rejects a null dispatch", () => {
    const r = validateSurface({ ...VALID_SURFACE, dispatch: null });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("dispatch must be an object"))).toBe(true);
  });

  it("rejects a missing model", () => {
    const r = validateSurface({ ...VALID_SURFACE, dispatch: { effort: "low", maxTurns: 10 } });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("surface.dispatch: model must be a non-empty string");
  });

  it("rejects an empty model", () => {
    const r = validateSurface({
      ...VALID_SURFACE,
      dispatch: { model: "", effort: "low", maxTurns: 10 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("surface.dispatch: model must be a non-empty string");
  });

  it("rejects an out-of-enum effort", () => {
    const r = validateSurface({
      ...VALID_SURFACE,
      dispatch: { model: "m", effort: "extreme", maxTurns: 10 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("surface.dispatch: effort must be one of low|medium|high");
  });

  it("rejects a missing effort", () => {
    const r = validateSurface({ ...VALID_SURFACE, dispatch: { model: "m", maxTurns: 10 } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("effort"))).toBe(true);
  });

  it("rejects a non-numeric maxTurns", () => {
    const r = validateSurface({
      ...VALID_SURFACE,
      dispatch: { model: "m", effort: "low", maxTurns: "40" },
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("surface.dispatch: maxTurns must be a finite number");
  });

  it("rejects a non-finite maxTurns", () => {
    const r = validateSurface({
      ...VALID_SURFACE,
      dispatch: { model: "m", effort: "low", maxTurns: Infinity },
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("surface.dispatch: maxTurns must be a finite number");
  });

  it("accepts each effort level", () => {
    for (const effort of ["low", "medium", "high"]) {
      const r = validateSurface({
        ...VALID_SURFACE,
        dispatch: { model: "m", effort, maxTurns: 1 },
      });
      expect(r.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateCandidateFinding — dedupe_key.surface sanitization
// ---------------------------------------------------------------------------

describe("validateCandidateFinding: dedupe_key.surface sanitization", () => {
  it("accepts a safe surface", () => {
    const r = validateCandidateFinding({
      ...VALID_CANDIDATE,
      dedupe_key: { ...VALID_CANDIDATE.dedupe_key, surface: "ok-id_1.2" },
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects surface "../../x"', () => {
    const r = validateCandidateFinding({
      ...VALID_CANDIDATE,
      dedupe_key: { ...VALID_CANDIDATE.dedupe_key, surface: "../../x" },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("finding.dedupe_key: surface"))).toBe(true);
  });

  it('rejects surface "a/b"', () => {
    const r = validateCandidateFinding({
      ...VALID_CANDIDATE,
      dedupe_key: { ...VALID_CANDIDATE.dedupe_key, surface: "a/b" },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("finding.dedupe_key: surface"))).toBe(true);
  });

  it('rejects surface "." and ".."', () => {
    for (const surface of [".", ".."]) {
      const r = validateCandidateFinding({
        ...VALID_CANDIDATE,
        dedupe_key: { ...VALID_CANDIDATE.dedupe_key, surface },
      });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.includes('not be "." or ".."'))).toBe(true);
    }
  });

  it("reports the type error once for a non-string surface", () => {
    const r = validateCandidateFinding({
      ...VALID_CANDIDATE,
      dedupe_key: { ...VALID_CANDIDATE.dedupe_key, surface: 7 },
    });
    expect(r.ok).toBe(false);
    const surfaceErrors = r.errors.filter((e) => e.startsWith("finding.dedupe_key: surface"));
    expect(surfaceErrors).toHaveLength(1);
    expect(surfaceErrors[0]).toContain("non-empty string");
  });

  it("does not report a surface charset error when dedupe_key is not an object", () => {
    const r = validateCandidateFinding({ ...VALID_CANDIDATE, dedupe_key: "nope" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("dedupe_key must be an object"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("finding.dedupe_key: surface"))).toBe(false);
  });
});
