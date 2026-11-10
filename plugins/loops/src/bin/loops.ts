// loops: `zone` and `env-check`. See plugins/loops/README.md; the logic lives in src/lib/loops-cli.ts.
import { main } from "../lib/loops-cli.js";

process.exitCode = main(process.argv.slice(2));
