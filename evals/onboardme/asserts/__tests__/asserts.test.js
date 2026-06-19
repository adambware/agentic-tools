const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const banned = require("../banned");
const facts = require("../facts");
const structure = require("../structure");
const SavedOutputProvider = require("../../providers/saved-output");

const root = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(root, relativePath), "utf8");
}

function context(caseName) {
  return {
    vars: {
      case: caseName,
      expectedPath: `evals/onboardme/fixtures/repos/${caseName}/expected.json`,
    },
  };
}

function assertPass(result) {
  assert.equal(result.pass, true, result.reason);
}

function assertFail(result, expectedReason) {
  assert.equal(result.pass, false, "assertion should fail");
  assert.match(result.reason, expectedReason);
}

for (const caseName of ["http-simple", "stale-doc-clear", "ambiguous-owner"]) {
  test(`${caseName} golden output passes all deterministic assertions`, () => {
    const output = read(`evals/onboardme/fixtures/repos/${caseName}/golden.md`);

    assertPass(structure(output));
    assertPass(banned(output));
    assertPass(facts(output, context(caseName)));
  });
}

test("structure rejects wrong headings", () => {
  assertFail(structure(read("evals/onboardme/fixtures/outputs/adversarial/wrong-headings.md")), /H2 1/);
});

test("structure rejects extra appendix headings", () => {
  assertFail(structure(read("evals/onboardme/fixtures/outputs/adversarial/extra-appendix.md")), /expected exactly 5 H2/);
});

test("banned content rejects appendix and source lists", () => {
  assertFail(banned(read("evals/onboardme/fixtures/outputs/adversarial/extra-appendix.md")), /appendix-heading/);
});

test("banned content rejects recommendations without firing on seam language", () => {
  assertPass(banned(read("evals/onboardme/fixtures/repos/http-simple/golden.md")));
  assertFail(banned(read("evals/onboardme/fixtures/outputs/adversarial/recommendation.md")), /recommendation/);
});

test("facts reject missing store/writer relation", () => {
  const output = read("evals/onboardme/fixtures/outputs/adversarial/missing-store-writer.md");
  assertFail(facts(output, context("http-simple")), /store\/writer relation/);
});

test("facts reject vacuous or reordered journey checks", () => {
  const output = read("evals/onboardme/fixtures/outputs/adversarial/reordered-journey.md");
  assertFail(facts(output, context("http-simple")), /out of order/);
});

test("facts reject invented certainty where expected output must say unclear", () => {
  const output = read("evals/onboardme/fixtures/outputs/adversarial/invented-fact-no-unclear.md");
  assertFail(facts(output, context("ambiguous-owner")), /marked unclear|forbidden claim/);
});

test("saved-output provider returns the requested fixture and errors clearly when missing", async () => {
  const provider = new SavedOutputProvider();
  const result = await provider.callApi("", {
    vars: {
      outputPath: "evals/onboardme/fixtures/repos/http-simple/golden.md",
    },
  });

  assert.match(result.output, /HTTP Orders - Onboarding One-Pager/);

  await assert.rejects(
    () => provider.callApi("", { vars: { outputPath: "evals/onboardme/fixtures/repos/nope/golden.md" } }),
    /saved output fixture not found/
  );
});
