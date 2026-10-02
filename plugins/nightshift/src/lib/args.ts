// Tiny --flag value parser shared by the bin/ CLIs. No deps.
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

export function requireArg(args: Record<string, string>, key: string): string {
  const val = args[key];
  if (val === undefined) {
    process.stderr.write(`error: missing required --${key}\n`);
    process.exit(2);
  }
  return val;
}

/** Today as YYYY-MM-DD. Honors --today / NIGHTSHIFT_TODAY for deterministic runs. */
export function resolveToday(args: Record<string, string>): string {
  const explicit = args.today ?? process.env.NIGHTSHIFT_TODAY;
  if (explicit) return explicit;
  return new Date().toISOString().slice(0, 10);
}
