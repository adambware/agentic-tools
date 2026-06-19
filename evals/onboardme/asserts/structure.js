const { REQUIRED_HEADINGS } = require("./spec");

function headingLines(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /^#{1,6}\s+/.test(line));
}

function assertStructure(output) {
  const text = String(output || "").trim();
  const headings = headingLines(text);
  const h1s = headings.filter(({ line }) => /^#\s+/.test(line));
  const h2s = headings.filter(({ line }) => /^##\s+/.test(line));
  const h3Plus = headings.filter(({ line }) => /^#{3,6}\s+/.test(line));
  const failures = [];

  if (!text) {
    failures.push("output is empty");
  }

  if (h1s.length !== 1) {
    failures.push(`expected exactly 1 H1, found ${h1s.length}`);
  }

  if (!h1s[0] || !/Onboarding One-Pager\b/.test(h1s[0].line)) {
    failures.push("H1 must name an Onboarding One-Pager");
  }

  if (h2s.length !== REQUIRED_HEADINGS.length) {
    failures.push(`expected exactly ${REQUIRED_HEADINGS.length} H2 headings, found ${h2s.length}`);
  }

  const actualH2s = h2s.map(({ line }) => line.replace(/^##\s+/, "").trim());
  REQUIRED_HEADINGS.forEach((expected, index) => {
    if (actualH2s[index] !== expected) {
      failures.push(`H2 ${index + 1} must be "${expected}", found "${actualH2s[index] || "<missing>"}"`);
    }
  });

  if (h3Plus.length > 0) {
    failures.push(`unexpected nested headings at lines ${h3Plus.map(({ index }) => index).join(", ")}`);
  }

  if (headings[0] && headings[0] !== h1s[0]) {
    failures.push("first heading must be the H1");
  }

  return {
    pass: failures.length === 0,
    score: failures.length === 0 ? 1 : 0,
    reason: failures.length === 0 ? "structure matches onboardme template" : failures.join("; "),
  };
}

module.exports = assertStructure;
