// Pure guard decision logic for the nightshift PreToolUse hook.
// No I/O, no side effects — every branch is unit-testable.
//
// Enforces a read-only perimeter: ALLOW reads everywhere, ALLOW writes only
// inside the per-repo `.nightshift/` pack directory, DENY everything else.

export interface GuardInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd?: string;
}

export interface GuardDecision {
  allow: boolean;
  reason: string;
}

// Env var that arms the guard. The guard is defense-in-depth for a lane run —
// outside one it must be inert so normal interactive work is unaffected. A
// dedicated/overnight lane session exports this; the workflow self-arms it.
export const LANE_RUN_ENV = "NIGHTSHIFT_LANE_RUN";

// The guard only enforces while a lane run is active. Active = LANE_RUN_ENV set
// to any non-empty, non-"0"/"false" value. Fail-open by default (env absent →
// inert), consistent with the rest of the guard's malformed-input handling.
export function isGuardActive(env: Record<string, string | undefined>): boolean {
  const v = env[LANE_RUN_ENV];
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}

// Tools that can only read — always allowed.
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
]);

// Bash subcommands that mutate git state (must be blocked).
const GIT_MUTATING_SUBCOMMANDS = [
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
  "update-ref",
];

// Bash subcommands that are safe git reads (explicitly allowed).
const GIT_READ_SUBCOMMANDS = new Set([
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
  "name-rev",
]);

// Shell write primitives that could mutate files.
const SHELL_WRITE_TOKENS = [
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
  "touch",
];

/**
 * Returns true when a path string contains a `.nightshift/` segment.
 * Matches: `.nightshift/foo`, `repo/.nightshift/foo`, `.nightshift` at end.
 */
function isInPackDir(path: string, packDir: string): boolean {
  // Escape special regex chars in packDir (it may start with a dot).
  const escaped = packDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|/)${escaped}(/|$)`).test(path);
}

/**
 * Decide whether a Bash command should be allowed.
 * Returns null if undecided (caller should allow).
 */
function decideBash(command: string, packDir: string): GuardDecision | null {
  // Split compound command chains so each segment is checked.
  // We split on ; && || | but not inside quotes (heuristic: just split on the tokens).
  const segments = command.split(/;|&&|\|\||(?<!\|)\|(?!\|)/);

  let anyDenied: string | null = null;

  for (const rawSeg of segments) {
    const seg = rawSeg.trim();
    if (seg === "") continue;

    // --- git checks ---
    // Match: optional path/sudo, then "git", then subcommand.
    const gitMatch = seg.match(/(?:^|sudo\s+)(?:\S+\/)?git\s+(\S+)/);
    if (gitMatch !== null) {
      const sub = gitMatch[1];
      if (sub === undefined) continue;

      // "branch" is mutating only with -D/-d/-m flags
      if (sub === "branch") {
        if (/git\s+branch\s+.*(?:-[Ddm]\b|-[a-zA-Z]*[Ddm][a-zA-Z]*\b)/.test(seg)) {
          anyDenied = `git branch with mutating flag blocked`;
          break;
        }
        // branch without -D/-d/-m is read-only (list branches)
        continue;
      }

      if (GIT_READ_SUBCOMMANDS.has(sub)) {
        // Explicitly allowed — continue checking other segments.
        continue;
      }

      if (GIT_MUTATING_SUBCOMMANDS.includes(sub)) {
        anyDenied = `git ${sub} blocked`;
        break;
      }

      // Unknown git subcommand — allow (reads we haven't listed).
      continue;
    }

    // --- redirect check (> and >>) ---
    // A redirect outside .nightshift/ is denied.
    const redirectMatch = seg.match(/>{1,2}\s*(\S+)/);
    if (redirectMatch !== null) {
      const target = redirectMatch[1];
      if (target !== undefined && !isInPackDir(target, packDir)) {
        anyDenied = `write redirect to path outside .nightshift/ blocked: ${target}`;
        break;
      }
      // Redirect into .nightshift/ — allowed; continue.
      continue;
    }

    // --- shell write primitive check ---
    let foundWritePrimitive = false;
    for (const token of SHELL_WRITE_TOKENS) {
      if (!seg.includes(token)) continue;
      foundWritePrimitive = true;

      // tee, cp, mv, mkdir, touch, sed -i etc: look for any arg that's NOT in .nightshift/
      // Heuristic: tokenise the segment, skip flags (starting with -), check the rest.
      const words = seg.split(/\s+/);
      // Find the verb index.
      let verbIdx = -1;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w === undefined) continue;
        if (token.startsWith(w.split(" ")[0] ?? "")) { verbIdx = i; break; }
        if (w.includes(token.trimEnd())) { verbIdx = i; break; }
      }

      // Collect path-like arguments (non-flag words after the verb, skip 'sed' options like 's/a/b/').
      const pathArgs: string[] = [];
      const startIdx = verbIdx >= 0 ? verbIdx + 1 : 0;
      for (let i = startIdx; i < words.length; i++) {
        const w = words[i];
        if (w === undefined) continue;
        if (w.startsWith("-")) continue;
        if (/^s[/|,!@#%&][^/|,!@#%&]*[/|,!@#%&]/.test(w)) continue; // sed expression
        pathArgs.push(w);
      }

      // If ANY path arg is outside .nightshift/, deny.
      const outsidePaths = pathArgs.filter((p) => !isInPackDir(p, packDir));
      if (outsidePaths.length > 0) {
        anyDenied = `shell write command (${token.trim()}) outside .nightshift/ blocked: ${outsidePaths.join(", ")}`;
        break;
      }

      // All path args (if any) are in .nightshift/ — allowed.
      break;
    }

    if (anyDenied !== null) break;
    if (foundWritePrimitive) continue; // was in .nightshift/, move on

    // If no write pattern matched, segment is read-only → allowed.
  }

  if (anyDenied !== null) {
    return { allow: false, reason: anyDenied };
  }
  return null; // undecided → allow
}

/**
 * Main guard decision function.
 * Pure — no I/O, no side effects.
 */
export function guardDecision(input: GuardInput, packDir = ".nightshift"): GuardDecision {
  const { tool_name, tool_input } = input;

  // Read-only tools are always allowed.
  if (READ_ONLY_TOOLS.has(tool_name)) {
    return { allow: true, reason: `${tool_name} is read-only` };
  }

  // Write / Edit / MultiEdit / NotebookEdit — check the target path.
  if (
    tool_name === "Write" ||
    tool_name === "Edit" ||
    tool_name === "MultiEdit" ||
    tool_name === "NotebookEdit"
  ) {
    const path =
      typeof tool_input["file_path"] === "string"
        ? tool_input["file_path"]
        : typeof tool_input["notebook_path"] === "string"
          ? tool_input["notebook_path"]
          : null;

    if (path === null) {
      return {
        allow: false,
        reason: `${tool_name} with no file_path cannot be verified as in-bounds`,
      };
    }

    if (isInPackDir(path, packDir)) {
      return { allow: true, reason: `write inside ${packDir}/ allowed: ${path}` };
    }

    return {
      allow: false,
      reason: `write outside .nightshift/ blocked: ${path}`,
    };
  }

  // Bash — inspect the command.
  if (tool_name === "Bash") {
    const command = tool_input["command"];
    if (typeof command !== "string") {
      return { allow: false, reason: "Bash with non-string command blocked" };
    }

    const decision = decideBash(command, packDir);
    if (decision !== null) return decision;

    return { allow: true, reason: "bash command appears read-only" };
  }

  // Unknown tools — fail open.
  return { allow: true, reason: `unknown tool ${tool_name} allowed (fail-open)` };
}
