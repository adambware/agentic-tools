# Test Design Techniques

Systematic ways to derive concrete test cases from a target. Used in Phase 4 of the planning workflow. Do not improvise cases — pick the technique(s) that fit the target and work through them. Most targets need two or three of these together.

## 1. Equivalence partitioning

Divide the input space into classes whose members should all be treated the same way. Test one representative per class instead of every value.

- Identify each distinct *handling path* the code has for its inputs.
- One case per class — valid classes and invalid classes both.
- Example: a function taking an age might partition into `<0` (invalid), `0–17` (minor), `18–64` (adult), `65+` (senior). Four cases, not a hundred.

The skill of partitioning is spotting classes that *look* the same but aren't — e.g. empty string vs whitespace-only string vs null are usually three classes, not one.

## 2. Boundary-value analysis

Bugs cluster at the edges of equivalence classes. For every boundary, test three points: **on it, just below, just above.**

- A check `if (x >= 100)` gets cases at `99`, `100`, `101`.
- Collection boundaries: empty, exactly one element, exactly the max, one over the max.
- Numeric boundaries: zero, negative, the largest representable value, off-by-one around limits.
- This is usually the **highest-yield technique** — off-by-one and inclusive/exclusive-comparison bugs are extremely common and boundary analysis catches them directly.

## 3. Branch / decision enumeration

Every decision point in the code needs a case that exercises each outcome.

- For each `if`, both true and false — including the *implicit* `else` when there is no explicit one.
- For each branch of a `switch`/`match`, including the default.
- For boolean compound conditions (`a && b`), consider which combinations the code actually distinguishes — full condition/decision coverage if the logic is critical, otherwise at least each operand flipping the result once.
- Loops: zero iterations, one iteration, many iterations.

This guarantees structural coverage *with intent* — each case exists because a branch demanded it, not to pad a number.

## 4. Decision tables

When behavior depends on a combination of several conditions, enumerate the combinations in a table: conditions as rows, rules as columns, with the expected action per column. Collapse impossible or don't-care combinations. Each surviving rule becomes one test. Best for business-rule-heavy code (pricing, eligibility, permissions).

## 5. State-transition testing

When the target is a state machine or stateful object, model states and transitions explicitly:

- One case per **valid transition** (state + event → new state).
- One case per **invalid transition** (event that should be rejected or ignored in a given state).
- Sequences that reach states by different paths, if path affects outcome.

## 6. Property-based testing

Instead of hand-picked examples, state an **invariant** and let a generator throw hundreds of inputs at it. Flag a target for property-based testing when you can articulate a property such as:

- **Round-trip**: `decode(encode(x)) == x`.
- **Idempotence**: `f(f(x)) == f(x)`.
- **Invariant preserved**: sorting preserves length and multiset of elements.
- **Oracle / equivalence**: a slow obvious implementation agrees with the fast one.
- **Commutativity / ordering independence**: `merge(a,b) == merge(b,a)`.

Property-based testing finds edge cases humans don't imagine. Tools: Hypothesis (Python), fast-check (TypeScript), Go's native fuzzing / `testing/quick`, Eris or `php-quickcheck` (PHP). Note in the plan the property and the suggested tool.

## 7. Error-path and resource enumeration

Happy-path-only suites are the norm and the weakness. Explicitly enumerate:

- Null / empty / missing inputs for every parameter.
- Each error return and each thrown exception — assert the failure mode, not just the success.
- Resource failure: dependency unavailable, timeout, partial result.
- Boundary of "too much": oversized input, unicode, injection-shaped strings (even if just to confirm graceful handling).

## 8. Regression cases

Every past bug in the target gets a dedicated test that fails against the buggy version and passes against the fix. If the target has a bug-fix history (`git log`, issue tracker), mine it — those are proven-valuable cases.

---

## Choosing techniques

| Target shape | Primary techniques |
|--------------|--------------------|
| Pure function over scalars | Equivalence partitioning + boundary analysis |
| Branchy logic / validation | Branch enumeration + boundary analysis |
| Business rules over many flags | Decision table |
| Stateful object / workflow | State-transition + invalid transitions |
| Encoders, parsers, serializers | Property-based (round-trip) + boundary |
| Anything with a known invariant | Property-based |
| Anything with a bug history | Regression cases (always) |

Always layer **error-path enumeration** on top — it applies to nearly everything.
