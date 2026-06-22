// Plugin build step (E5): author TS in src/, ship bundled node-runnable artifacts.
// Each entrypoint is bundled into a single self-contained .mjs (yaml etc. inlined)
// so an onboarded repo runs `node bin/select.mjs` with ZERO extra install.
//
// Outputs are committed:
//   src/bin/<name>.ts   -> bin/<name>.mjs
//   src/hooks/<name>.ts -> hooks/<name>.mjs
import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const targets = [
  { srcDir: join(root, "src", "bin"), outDir: join(root, "bin") },
  { srcDir: join(root, "src", "hooks"), outDir: join(root, "hooks") },
];

// createRequire shim: lets esbuild's CJS->ESM `__require` resolve bundled
// dependencies' `require('node:*')` calls at runtime. Keeps the artifact
// zero-install (createRequire is a node built-in).
const banner = {
  js: [
    "#!/usr/bin/env node",
    "import { createRequire as __ns_createRequire } from 'node:module';",
    "const require = __ns_createRequire(import.meta.url);",
  ].join("\n"),
};

for (const { srcDir, outDir } of targets) {
  let entries;
  try {
    entries = readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  } catch {
    continue; // dir may not exist yet
  }
  if (entries.length === 0) continue;
  mkdirSync(outDir, { recursive: true });
  for (const entry of entries) {
    const name = entry.replace(/\.ts$/, "");
    await build({
      entryPoints: [join(srcDir, entry)],
      outfile: join(outDir, `${name}.mjs`),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node18",
      banner,
      legalComments: "none",
      minify: false,
    });
    console.log(`built ${name}.mjs`);
  }
}
