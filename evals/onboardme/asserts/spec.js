const REQUIRED_HEADINGS = Object.freeze([
  "In one sentence",
  "The request's journey",
  "The major components",
  "Where the truth lives",
  "The seams",
]);

const BANNED_PATTERNS = Object.freeze([
  {
    id: "appendix-heading",
    re: /^#{1,6}\s+appendix\b/im,
    reason: "appendices are outside the onboardme artifact",
  },
  {
    id: "sources-heading",
    re: /^#{1,6}\s+(sources?|references?|citations?)\b/im,
    reason: "final output must not include citations or source lists",
  },
  {
    id: "todo",
    re: /\b(?:TODO|FIXME)\b/i,
    reason: "TODOs are outside the onboardme artifact",
  },
  {
    id: "recommendation",
    re: /\b(?:recommend|recommendation|recommended|suggest|next steps?)\b/i,
    reason: "recommendations are out of scope",
  },
  {
    id: "should",
    re: /\bshould\b/i,
    reason: "prescriptive language is out of scope",
  },
  {
    id: "risk-language",
    re: /\b(?:risk|risks|risky|risking|high risk|medium risk|low risk)\b/i,
    reason: "risk assessment is out of scope",
  },
]);

module.exports = {
  REQUIRED_HEADINGS,
  BANNED_PATTERNS,
};
