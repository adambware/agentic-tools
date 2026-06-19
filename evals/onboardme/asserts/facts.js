const fs = require("fs");
const path = require("path");

function repoRoot() {
  return path.resolve(__dirname, "../../..");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRegExp(pattern) {
  if (pattern instanceof RegExp) {
    return pattern;
  }

  if (typeof pattern === "object" && pattern !== null && pattern.regex) {
    return new RegExp(pattern.regex, pattern.flags || "i");
  }

  return new RegExp(escapeRegExp(pattern), "i");
}

function matches(text, pattern) {
  return toRegExp(pattern).test(text);
}

function lineWith(text, first, second) {
  return String(text)
    .split(/\r?\n/)
    .find((line) => matches(line, first) && (!second || matches(line, second)));
}

function section(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return "";
  }

  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function loadExpected(context) {
  const vars = (context && context.vars) || {};
  if (vars.expected) {
    return vars.expected;
  }

  if (!vars.expectedPath) {
    throw new Error("facts assertion requires vars.expected or vars.expectedPath");
  }

  const expectedPath = path.resolve(repoRoot(), vars.expectedPath);
  return JSON.parse(fs.readFileSync(expectedPath, "utf8"));
}

function assertFacts(output, context = {}) {
  const text = String(output || "");
  const expected = loadExpected(context);
  const failures = [];

  const required = [
    ...(expected.requiredIdentifiers || []),
    ...(expected.tracedOperation ? [expected.tracedOperation] : []),
    ...(expected.majorComponents || []),
  ];

  for (const item of required) {
    if (!matches(text, item)) {
      failures.push(`missing required fact "${String(item)}"`);
    }
  }

  const truth = section(text, "Where the truth lives");
  for (const store of expected.stores || []) {
    const storePattern = store.pattern || store.name;
    const writerPattern = store.writerPattern || store.writer;
    if (!lineWith(truth, storePattern, writerPattern)) {
      failures.push(`missing store/writer relation "${store.name}" -> "${store.writer}"`);
    }
  }

  const seams = section(text, "The seams");
  for (const seam of expected.seams || []) {
    if (!matches(seams, seam)) {
      failures.push(`missing seam "${String(seam)}"`);
    }
  }

  for (const unclear of expected.unclear || []) {
    const target = typeof unclear === "string" ? unclear : unclear.target;
    const pattern = typeof unclear === "string" ? unclear : unclear.pattern || unclear.target;
    const unclearLine = lineWith(text, pattern, "unclear");
    if (!target || !unclearLine) {
      failures.push(`expected "${target || pattern}" to be marked unclear`);
    }
  }

  for (const claim of expected.forbiddenClaims || []) {
    if (matches(text, claim)) {
      failures.push(`forbidden claim present "${String(claim)}"`);
    }
  }

  const order = expected.journeyOrder || [];
  const missingOrderItems = order.filter((item) => !matches(text, item));
  for (const item of missingOrderItems) {
    failures.push(`missing journey item "${String(item)}"`);
  }

  if (missingOrderItems.length === 0 && order.length > 1) {
    let previous = -1;
    for (const item of order) {
      const index = text.search(toRegExp(item));
      if (index <= previous) {
        failures.push(`journey item "${String(item)}" appears out of order`);
        break;
      }
      previous = index;
    }
  }

  return {
    pass: failures.length === 0,
    score: failures.length === 0 ? 1 : 0,
    reason: failures.length === 0 ? "facts match expected oracle" : failures.join("; "),
  };
}

module.exports = assertFacts;
