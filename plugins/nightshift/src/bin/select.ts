// bin/select — read .nightshift registry + git diff, pick the K stalest/changed
// surfaces, write surfaces.json. Thin argv shell over lib/select-run (E4: zero
// decision logic here). Exit 0 on success, 2 on usage/IO error (workflow aborts).
//
// Usage:
//   node bin/select.mjs --vectors <vectors.yml> --manifest <manifest.yml> \
//     --lane security --repo <repo-root> --out <surfaces.json> [--today YYYY-MM-DD]
import { parseArgs, requireArg, resolveToday } from "../lib/args.js";
import { runSelect } from "../lib/select-run.js";
import type { Lane } from "../lib/types.js";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const lane = (args.lane ?? "security") as Lane;
  try {
    const res = runSelect({
      vectorsPath: requireArg(args, "vectors"),
      manifestPath: requireArg(args, "manifest"),
      lane,
      today: resolveToday(args),
      repo: args.repo ?? process.cwd(),
      outPath: requireArg(args, "out"),
    });
    process.stderr.write(
      `select: lane=${lane} K=${res.k} selected=${res.selected} -> ${requireArg(args, "out")}\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`select: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

main();
