const fs = require("fs");
const path = require("path");

function repoRoot() {
  return path.resolve(__dirname, "../../..");
}

class SavedOutputProvider {
  id() {
    return "saved-output";
  }

  async callApi(_prompt, context = {}) {
    const vars = context.vars || {};
    const outputPath = vars.outputPath || `evals/onboardme/fixtures/repos/${vars.case}/golden.md`;

    if (!outputPath) {
      throw new Error("saved-output provider requires vars.outputPath or vars.case");
    }

    const absolutePath = path.resolve(repoRoot(), outputPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`saved output fixture not found: ${outputPath}`);
    }

    return {
      output: fs.readFileSync(absolutePath, "utf8"),
    };
  }
}

module.exports = SavedOutputProvider;
