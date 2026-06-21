#!/usr/bin/env node
import { createRequire as __ns_createRequire } from 'node:module';
const require = __ns_createRequire(import.meta.url);

// src/hooks/guard.ts
import { readFileSync } from "node:fs";

// src/lib/guard.ts
var LANE_RUN_ENV = "NIGHTSHIFT_LANE_RUN";
function isGuardActive(env) {
  const v = env[LANE_RUN_ENV];
  if (v === void 0) return false;
  const t = v.trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}
var READ_ONLY_TOOLS = /* @__PURE__ */ new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite"
]);
var GIT_MUTATING_SUBCOMMANDS = [
  "commit",
  "push",
  "reset",
  "checkout",
  "rebase",
  "merge",
  "add",
  "rm",
  "stash",
  "tag",
  "apply",
  "cherry-pick",
  "clean",
  "restore",
  "mv",
  "config",
  "filter-repo",
  "update-ref"
];
var GIT_READ_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "diff",
  "status",
  "log",
  "show",
  "rev-list",
  "rev-parse",
  "ls-files",
  "blame",
  "cat-file",
  "for-each-ref",
  "name-rev"
]);
var SHELL_WRITE_TOKENS = [
  "sed -i",
  "rm ",
  "mv ",
  "cp ",
  "tee ",
  "truncate",
  "dd ",
  "chmod",
  "chown",
  "mkdir",
  "touch"
];
function isInPackDir(path, packDir) {
  const escaped = packDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|/)${escaped}(/|$)`).test(path);
}
function decideBash(command, packDir) {
  const segments = command.split(/;|&&|\|\||(?<!\|)\|(?!\|)/);
  let anyDenied = null;
  for (const rawSeg of segments) {
    const seg = rawSeg.trim();
    if (seg === "") continue;
    const gitMatch = seg.match(/(?:^|sudo\s+)(?:\S+\/)?git\s+(\S+)/);
    if (gitMatch !== null) {
      const sub = gitMatch[1];
      if (sub === void 0) continue;
      if (sub === "branch") {
        if (/git\s+branch\s+.*(?:-[Ddm]\b|-[a-zA-Z]*[Ddm][a-zA-Z]*\b)/.test(seg)) {
          anyDenied = `git branch with mutating flag blocked`;
          break;
        }
        continue;
      }
      if (GIT_READ_SUBCOMMANDS.has(sub)) {
        continue;
      }
      if (GIT_MUTATING_SUBCOMMANDS.includes(sub)) {
        anyDenied = `git ${sub} blocked`;
        break;
      }
      continue;
    }
    const redirectMatch = seg.match(/>{1,2}\s*(\S+)/);
    if (redirectMatch !== null) {
      const target = redirectMatch[1];
      if (target !== void 0 && !isInPackDir(target, packDir)) {
        anyDenied = `write redirect to path outside .nightshift/ blocked: ${target}`;
        break;
      }
      continue;
    }
    let foundWritePrimitive = false;
    for (const token of SHELL_WRITE_TOKENS) {
      if (!seg.includes(token)) continue;
      foundWritePrimitive = true;
      const words = seg.split(/\s+/);
      let verbIdx = -1;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w === void 0) continue;
        if (token.startsWith(w.split(" ")[0] ?? "")) {
          verbIdx = i;
          break;
        }
        if (w.includes(token.trimEnd())) {
          verbIdx = i;
          break;
        }
      }
      const pathArgs = [];
      const startIdx = verbIdx >= 0 ? verbIdx + 1 : 0;
      for (let i = startIdx; i < words.length; i++) {
        const w = words[i];
        if (w === void 0) continue;
        if (w.startsWith("-")) continue;
        if (/^s[/|,!@#%&][^/|,!@#%&]*[/|,!@#%&]/.test(w)) continue;
        pathArgs.push(w);
      }
      const outsidePaths = pathArgs.filter((p) => !isInPackDir(p, packDir));
      if (outsidePaths.length > 0) {
        anyDenied = `shell write command (${token.trim()}) outside .nightshift/ blocked: ${outsidePaths.join(", ")}`;
        break;
      }
      break;
    }
    if (anyDenied !== null) break;
    if (foundWritePrimitive) continue;
  }
  if (anyDenied !== null) {
    return { allow: false, reason: anyDenied };
  }
  return null;
}
function guardDecision(input, packDir = ".nightshift") {
  const { tool_name, tool_input } = input;
  if (READ_ONLY_TOOLS.has(tool_name)) {
    return { allow: true, reason: `${tool_name} is read-only` };
  }
  if (tool_name === "Write" || tool_name === "Edit" || tool_name === "MultiEdit" || tool_name === "NotebookEdit") {
    const path = typeof tool_input["file_path"] === "string" ? tool_input["file_path"] : typeof tool_input["notebook_path"] === "string" ? tool_input["notebook_path"] : null;
    if (path === null) {
      return {
        allow: false,
        reason: `${tool_name} with no file_path cannot be verified as in-bounds`
      };
    }
    if (isInPackDir(path, packDir)) {
      return { allow: true, reason: `write inside ${packDir}/ allowed: ${path}` };
    }
    return {
      allow: false,
      reason: `write outside .nightshift/ blocked: ${path}`
    };
  }
  if (tool_name === "Bash") {
    const command = tool_input["command"];
    if (typeof command !== "string") {
      return { allow: false, reason: "Bash with non-string command blocked" };
    }
    const decision = decideBash(command, packDir);
    if (decision !== null) return decision;
    return { allow: true, reason: "bash command appears read-only" };
  }
  return { allow: true, reason: `unknown tool ${tool_name} allowed (fail-open)` };
}

// src/hooks/guard.ts
function main() {
  if (!isGuardActive(process.env)) {
    printAllow("guard inert: no active lane run");
    return;
  }
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    printAllow("stdin unreadable, fail-open");
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    printAllow("malformed hook payload, fail-open");
    return;
  }
  if (typeof payload !== "object" || payload === null) {
    printAllow("non-object hook payload, fail-open");
    return;
  }
  const p = payload;
  const tool_name = typeof p["tool_name"] === "string" ? p["tool_name"] : "";
  const tool_input = typeof p["tool_input"] === "object" && p["tool_input"] !== null ? p["tool_input"] : {};
  const cwd = typeof p["cwd"] === "string" ? p["cwd"] : void 0;
  const input = { tool_name, tool_input, cwd };
  const decision = guardDecision(input);
  if (decision.allow) {
    printAllow(decision.reason);
  } else {
    printDeny(decision.reason);
  }
}
function hookOutput(permissionDecision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: reason
      }
    }) + "\n"
  );
}
function printAllow(reason) {
  hookOutput("allow", reason);
  process.exit(0);
}
function printDeny(reason) {
  hookOutput("deny", reason);
  process.exit(0);
}
main();
