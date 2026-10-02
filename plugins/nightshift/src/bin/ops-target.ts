// bin/ops-target — read $OPS/config.yml and resolve ONE repo+lane into every
// path and knob `ns` needs, or refuse (exit 2) with a reason. Thin argv shell
// over lib/ops-config (E4: zero decision logic here).
//
// WHY `--format sh` EXISTS. `ns` is POSIX shell with no YAML parser and no jq
// dependency. Emitting sourceable `KEY='value'` assignments — single-quoted,
// with embedded quotes escaped — lets the shell consume a fully validated
// result without parsing anything itself, which is the whole point of keeping
// the decisions in tested TS. Sourcing (not eval) means a malformed line is a
// shell syntax error at a known place, not arbitrary execution.
//
// Usage:
//   node bin/ops-target.mjs --config $OPS/config.yml --repo novudesk --lane security
//   node bin/ops-target.mjs --config $OPS/config.yml --repo novudesk --lane design --format sh
//   node bin/ops-target.mjs --config $OPS/config.yml --list        # every enabled repo/lane
import { parseArgs, requireArg } from "../lib/args.js";
import { readOpsConfig, resolveTarget } from "../lib/ops-config.js";

/** POSIX single-quoted shell literal: 'it'\''s safe'. Total for any string. */
function shq(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const configPath = requireArg(args, "config");

  const cfg = readOpsConfig(configPath);
  if (!cfg.ok) {
    process.stderr.write(`ops-target: ${cfg.reason}\n`);
    process.exitCode = 2;
    return;
  }

  // --dashboard-out answers one question the finalizer needs BEFORE it knows
  // (or fails to resolve) a target: what is the living document called?
  if (args["dashboard-out"] !== undefined) {
    process.stdout.write(cfg.config.dashboard.out + "\n");
    return;
  }

  // --list is the machine-readable half of `ns status`: one "<repo> <lane>" per
  // line for every enabled pair, so the shell can loop without knowing the YAML.
  if (args.list !== undefined) {
    for (const repo of cfg.config.repos) {
      if (!repo.enabled) continue;
      for (const lane of repo.lanes) process.stdout.write(`${repo.name} ${lane}\n`);
    }
    return;
  }

  const res = resolveTarget(cfg.config, requireArg(args, "repo"), requireArg(args, "lane"));
  if (!res.ok) {
    process.stderr.write(`ops-target: ${res.reason}\n`);
    process.exitCode = 2;
    return;
  }
  const t = res.target;

  if (args.format === "sh") {
    const lines = [
      `NS_REPO_NAME=${shq(t.repo.name)}`,
      `NS_REPO_PATH=${shq(t.repo.path)}`,
      `NS_LANE=${shq(t.lane)}`,
      `NS_PACK_DIR=${shq(t.packDir)}`,
      `NS_METRICS_DIR=${shq(t.metricsDir)}`,
      `NS_RUN_ROOT=${shq(t.runRoot)}`,
      `NS_MAX_CONCURRENT=${shq(String(t.max_concurrent_reviewers))}`,
      `NS_DASHBOARD_OUT=${shq(cfg.config.dashboard.out)}`,
      `NS_DASHBOARD_OPEN=${shq(cfg.config.dashboard.open_after_run ? "1" : "0")}`,
    ];
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  process.stdout.write(JSON.stringify({ ...t, dashboard: cfg.config.dashboard }, null, 2) + "\n");
}

main();
