# Test Quality Rubric

The standard a good automated test is held to. In the explorer skill this is the Phase 6 self-review of the *plan* (every planned test should plausibly satisfy these once written). The rubric extends Dave Farley's properties of good tests with three additions drawn from the wider craft.

## The properties

### 1. Understandable
The test shouts what it tests and asserts. Its name states *scenario → expected outcome* in plain language, not a method name. A reader grasps the case without reading the implementation.

### 2. Behavioral *(addition)*
The test exercises a **unit of behavior through a public contract**, not internal structure. It does not call private methods, does not assert on internal state a consumer can't see, and does not break when the code is refactored without behavior change. This is the property most often violated and the most expensive when it is — an implementation-coupled suite is a tax on every refactor. Prefer fakes (assert *state*) over mocks (assert *interactions*); a suite that mostly mocks your own code mostly tests that your code calls itself the way it currently does.

### 3. Maintainable
Easy to change, and makes the code under test easy to change too. Favors **DAMP over DRY** — Descriptive And Meaningful Phrases. A little duplication that keeps a test readable top-to-bottom beats a clever shared fixture that forces the reader to jump around. Production code is DRY; tests are documentation.

### 4. Repeatable / Deterministic
Same code version → same result, every run. No timezone, ordering, network, randomness, or concurrency dependence. Zero tolerance: a flaky test is worse than no test because it erodes trust in the whole suite. Every non-deterministic input must be controlled (injected clock, seeded RNG, faked boundary).

### 5. Atomic
Stands alone. Depends on nothing external it doesn't control, and on no other test having run first. Sets up and tears down its own state.

### 6. Necessary
Exists for a reason — it expresses a new, distinct perspective on the code. Not a duplicate of another test at a different layer, not a test of the language or the framework. Apply the **Beyoncé rule**: if you'd be upset when this behavior breaks silently, it earns a test; if not, it doesn't.

### 7. Granular
Asserts a **single outcome**. A failure points at exactly one thing. If the test name needs an "and," it is two tests.

### 8. Documentary *(addition)*
The test reads as an executable specification of the behavior. Someone can learn what the code *does* by reading its tests. This follows from Understandable + DAMP + Granular but is worth checking as its own lens: would a new teammate use this test as the explanation of the behavior?

### 9. Fast
Runs quickly enough that the team happily runs it after tiny changes. Slow tests get run rarely, and tests run rarely stop catching anything. Push behavior to the lowest layer that gives real confidence.

### 10. Simple
As well as one assertion, the test has **no logic** — no loops, no conditionals, no computed expected values. Jon Jagger's bar: *a good test has a cyclomatic complexity of 1.* Logic in a test means a second, untested implementation of the thing under test. Expected values are literals, written by a human.

## The layering principle

Orthogonal to per-test quality: the *suite* should not test the same behavior at multiple layers. Each layer answers a different question.

- **Unit** — is this logic correct? Fast, granular, many.
- **Integration** — do these pieces actually agree at their seam? Most real bugs live in the wiring; this layer earns its cost.
- **End-to-end** — does the critical path work at all? Slow, flaky, poor at localizing failure — keep very few, only for paths that would be catastrophic to break.

## Anti-patterns to flag

| Anti-pattern | Why it's bad |
|--------------|--------------|
| Assertion-free test ("it runs without throwing") | Covers lines, proves nothing |
| Mock-heavy test of your own code | Tests implementation, breaks on refactor |
| Multiple unrelated assertions | Failure doesn't localize |
| Logic in the test (loops, computed expectations) | Re-implements the code under test |
| Shared mutable fixture across tests | Breaks atomicity, causes order-dependence |
| Snapshot test as the only coverage of real logic | Pins output without expressing intent; rubber-stamped on update |
| Test named after a method, not a behavior | Hides what's actually verified |
| Real network / clock / filesystem in a unit test | Non-deterministic, slow |
| Same scenario duplicated at unit + integration + e2e | Slow suite, no extra confidence |

## On coverage and mutation

Line/branch coverage is a **diagnostic, not a target** — the moment a percentage is a goal it stops measuring anything (Goodhart). 100% coverage with weak assertions is achievable and worthless. **Mutation testing** is the real measure of whether a test would catch a bug: it changes the code and checks the suite notices. When judging whether code is "tested," ask whether a planted bug would be caught — not whether the line was executed.
