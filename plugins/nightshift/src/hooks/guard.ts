// PreToolUse hook — nightshift read-only guard.
// Reads a JSON payload from stdin, decides allow/deny, prints hookSpecificOutput JSON.
// Always exits 0 (Claude Code hook contract). Fail-open on malformed input.
import { readFileSync } from "node:fs";
import { guardDecision, isGuardActive } from "../lib/guard.js";
import type { GuardInput } from "../lib/guard.js";

function main(): void {
  // Inert outside a lane run — defense-in-depth scoped to when it's needed, so
  // the plugin can stay enabled without blocking normal interactive work.
  if (!isGuardActive(process.env)) {
    printAllow("guard inert: no active lane run");
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    // stdin unreadable — fail open
    printAllow("stdin unreadable, fail-open");
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed JSON — fail open
    printAllow("malformed hook payload, fail-open");
    return;
  }

  if (typeof payload !== "object" || payload === null) {
    printAllow("non-object hook payload, fail-open");
    return;
  }

  const p = payload as Record<string, unknown>;
  const tool_name = typeof p["tool_name"] === "string" ? p["tool_name"] : "";
  const tool_input =
    typeof p["tool_input"] === "object" && p["tool_input"] !== null
      ? (p["tool_input"] as Record<string, unknown>)
      : {};
  const cwd = typeof p["cwd"] === "string" ? p["cwd"] : undefined;

  const input: GuardInput = { tool_name, tool_input, cwd };
  const decision = guardDecision(input);

  if (decision.allow) {
    printAllow(decision.reason);
  } else {
    printDeny(decision.reason);
  }
}

function hookOutput(permissionDecision: "allow" | "deny", reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: reason,
      },
    }) + "\n",
  );
}

function printAllow(reason: string): void {
  hookOutput("allow", reason);
  process.exit(0);
}

function printDeny(reason: string): void {
  hookOutput("deny", reason);
  process.exit(0);
}

main();
