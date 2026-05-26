# Language Tooling & Seam Patterns

Used in Phase 3 (Seam Survey). For each language: how to create a seam with the *smallest* refactor, and what test / coverage / mutation tooling to assume. Read only the section(s) matching the target's stack.

A reminder on philosophy: prefer **fakes** (in-memory implementations, assert state) over **mocks** (assert interactions, couple to *how*). Mock only true boundaries you don't own.

---

## Go

**Seam patterns (smallest first):**
- **Accept an interface, return a struct.** If a function reaches a dependency directly, change the parameter (or struct field) to a small interface the caller satisfies. Define the interface in the *consumer* package, keep it tiny (1–3 methods).
- **Inject the clock.** Replace `time.Now()` calls with a `func() time.Time` field or a `Clock` interface. This is the single most common determinism fix.
- **Function-value seams.** For one collaborator, a `var doThing = realDoThing` package variable or a function-typed field is lighter than an interface.
- **`httptest`** for HTTP boundaries — real server, no mock framework needed.

**Tooling:**
- Test runner: standard `go test`; table-driven tests are idiomatic — one table row per equivalence class/boundary.
- Fakes over mocks: hand-written fakes are idiomatic Go; avoid `gomock` unless the interaction genuinely matters.
- Coverage: `go test -cover` / `-coverprofile`.
- Mutation testing: `go-mutesting` or `gremlins`.
- Property/fuzz: native `go test -fuzz`, and `testing/quick`.

---

## TypeScript / Vue

**Seam patterns:**
- **Constructor / factory injection.** Pass collaborators in rather than importing-and-calling. A default argument keeps call sites unchanged: `function svc(deps = realDeps)`.
- **Module boundary** — keep side-effecting modules thin so the logic module can be imported and tested pure.
- **For Vue components:** test *behavior through the rendered output and emitted events*, not internal component state or method calls. Extract non-trivial logic out of components into plain functions/composables — those are far easier to test than components.
- **Injected clock / timers** — pass a now-provider, or use the test runner's fake timers.

**Tooling:**
- Test runner: Vitest (preferred for Vue/Vite projects) or Jest.
- Component testing: Vue Testing Library (encourages behavior-focused queries) over shallow-mount-everything approaches.
- Fakes over mocks: prefer in-memory fake implementations; reserve `vi.mock` for true module boundaries.
- Coverage: built into Vitest (`--coverage`, v8 or istanbul).
- Mutation testing: StrykerJS.
- Property: fast-check.

---

## PHP / Laravel

**Seam patterns:**
- **Constructor injection via the service container.** Laravel's container is itself the seam — bind a fake implementation in the test. Type-hint interfaces, not concretes, on constructors.
- **Avoid facades and `new` inside logic** — they are seam-killers. If logic calls a facade directly, either inject the underlying service or use the facade's built-in fake (`Mail::fake()`, `Queue::fake()`, `Event::fake()`).
- **Inject the clock** — use `Carbon::setTestNow()` to freeze time deterministically.
- **Extract domain logic out of Eloquent models and controllers** into plain services — those test without a database.

**Tooling:**
- Test runner: PHPUnit or Pest (Pest's expressive syntax suits DAMP, behavior-named tests).
- Database: prefer in-memory SQLite or transactional rollback for integration tests; avoid hitting a shared DB.
- Fakes: Laravel's first-party fakes for framework boundaries; hand-rolled fakes for your own interfaces.
- Coverage: PHPUnit with Xdebug or PCOV.
- Mutation testing: Infection.

---

## Python

**Seam patterns:**
- **Parameter injection / default arguments.** Pass collaborators as arguments with real defaults: `def svc(repo=Repo())`. Smallest possible seam.
- **Dependency as a class attribute** so a subclass or instance can override it.
- **Inject a clock** — pass a `now` callable; avoid patching `datetime` globally.
- **`unittest.mock.patch`** exists but prefer real fakes — patching couples tests to import paths and breaks on refactor. Patch only true externals.
- Protocol classes (`typing.Protocol`) give structural interfaces without inheritance — good lightweight seams.

**Tooling:**
- Test runner: pytest (fixtures map cleanly onto Arrange; parametrize maps onto equivalence classes/boundaries).
- Fakes over mocks: hand-written fakes or lightweight stub objects; `unittest.mock` for externals only.
- Coverage: `coverage.py` / `pytest-cov`.
- Mutation testing: `mutmut` or `cosmic-ray`.
- Property: Hypothesis (excellent — first choice for any invariant-bearing target).

---

## Cross-cutting determinism checklist

Regardless of language, any planned test touching these must name its control mechanism:

| Non-determinism | Control |
|-----------------|---------|
| Current time / dates | Injected clock or framework time-freeze |
| Randomness / UUIDs | Seeded RNG, or inject an ID generator |
| Network / external API | Fake at the boundary; never hit the real service in unit/integration |
| Filesystem | Temp dir fixture, cleaned up |
| Concurrency / ordering | Deterministic scheduling, or assert on sets not sequences |
| Environment / locale / timezone | Pin explicitly in the test |
| Test ordering / shared state | Each test sets up and tears down its own state (atomicity) |
