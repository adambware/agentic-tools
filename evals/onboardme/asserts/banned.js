const { BANNED_PATTERNS } = require("./spec");

function assertBanned(output) {
  const text = String(output || "");
  const hits = BANNED_PATTERNS.filter(({ re }) => re.test(text));

  return {
    pass: hits.length === 0,
    score: hits.length === 0 ? 1 : 0,
    reason:
      hits.length === 0
        ? "no banned onboardme content found"
        : hits.map((hit) => `${hit.id}: ${hit.reason}`).join("; "),
  };
}

module.exports = assertBanned;
