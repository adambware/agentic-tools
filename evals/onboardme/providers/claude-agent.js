const path = require("path");

function claudeAgentProviderConfig({ workingDir, model = "claude-sonnet-4-6" }) {
  return {
    id: "anthropic:claude-agent-sdk",
    label: "claude-agent-sdk-fixed",
    config: {
      model,
      allowedTools: ["Read", "Glob", "Grep", "LS"],
      disallowedTools: ["Write", "Edit", "MultiEdit", "Bash"],
      skills: ["onboardme"],
      options: {
        cwd: path.resolve(workingDir),
      },
    },
  };
}

module.exports = {
  claudeAgentProviderConfig,
};
