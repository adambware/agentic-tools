const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { REQUIRED_HEADINGS } = require("../spec");

test("required headings match the canonical onboardme output template", () => {
  const templatePath = path.resolve(__dirname, "../../../../plugins/onboardme/skills/onboardme/reference/output-template.md");
  const template = fs.readFileSync(templatePath, "utf8");
  const fenced = template.match(/```markdown\n([\s\S]*?)\n```/);

  assert.ok(fenced, "template must include a markdown output fence");

  const headings = [...fenced[1].matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  assert.deepEqual(headings, REQUIRED_HEADINGS);
});
