// The four A6 snapshot fixtures (plan §15.6). Each lives in its own file; this
// index is what tests import. Together the four renders + two inline unit
// inputs (zero repos, empty registry) must reach all 13 states.
export { populatedFixture } from "./dashboard-fixture-populated.js";
export { allClearFixture } from "./dashboard-fixture-all-clear.js";
export { coldStartFixture } from "./dashboard-fixture-cold-start.js";
export { degenerateFixture } from "./dashboard-fixture-degenerate.js";
