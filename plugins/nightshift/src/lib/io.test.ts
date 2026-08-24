import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, appendJsonl, readJsonl, readYaml, readJson, writeJson } from "./io.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-io-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  it("writes the file and leaves no temp file behind", () => {
    const p = join(dir, "nested", "surfaces.json");
    atomicWrite(p, "hello");
    expect(readFileSync(p, "utf8")).toBe("hello");
    const leftovers = readdirSync(join(dir, "nested")).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("overwrites an existing file atomically", () => {
    const p = join(dir, "f.txt");
    atomicWrite(p, "v1");
    atomicWrite(p, "v2");
    expect(readFileSync(p, "utf8")).toBe("v2");
  });

});

// Two processes writing the same target with a shared temp name truncate each
// other's temp mid-write and both rename, publishing bytes that belong to
// neither writer (this is how a 753KB registry became 8KB of still-parseable
// YAML). Only real processes reproduce it, so bundle io.ts and spawn some.
describe("atomicWrite under real multiprocess contention", () => {
  const WRITERS = 6;
  const RUN_MS = 1200;
  const BASE_SIZE = 200_000;
  /** Each writer owns one character and one length, so any published file is
   * checkable against the set of legal payloads: a run of a single character
   * whose length is the one that goes with it. Anything else is a splice. */
  const SIZES: Record<string, number> = Object.fromEntries(
    Array.from({ length: WRITERS }, (_, i) => [String.fromCharCode(65 + i), BASE_SIZE + i * 1000]),
  );

  const DRIVER = `
import { readFileSync } from "node:fs";
import { atomicWrite } from "./io.mjs";

const [target, char, sizesRaw, endAtRaw] = process.argv.slice(2);
const sizes = JSON.parse(sizesRaw);
const endAt = Number(endAtRaw);
const payload = char.repeat(sizes[char]);

let writes = 0;
let spliced = 0;
while (Date.now() < endAt) {
  atomicWrite(target, payload);
  writes++;
  const seen = readFileSync(target, "utf8");
  const c = seen[0];
  const expected = sizes[c];
  if (expected === undefined || seen.length !== expected || !new RegExp("^" + c + "+$").test(seen)) {
    spliced++;
  }
}
process.stdout.write(JSON.stringify({ writes, spliced }));
`;

  let bundleDir: string;
  let driverPath: string;

  beforeAll(async () => {
    bundleDir = mkdtempSync(join(tmpdir(), "ns-io-stress-"));
    driverPath = join(bundleDir, "driver.mjs");
    await build({
      entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "io.ts")],
      outfile: join(bundleDir, "io.mjs"),
      bundle: true,
      format: "esm",
      platform: "node",
      // Same createRequire shim scripts/build.mjs ships with, so the children
      // run this module the way real bin/*.mjs artifacts do.
      banner: {
        js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);",
      },
    });
    writeFileSync(driverPath, DRIVER);
  });

  afterAll(() => {
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it("never publishes a file spliced from two writers", async () => {
    const target = join(bundleDir, "out", "registry.yml");
    const endAt = Date.now() + RUN_MS;

    const results = await Promise.all(
      Object.keys(SIZES).map(
        (char) =>
          new Promise<{ writes: number; spliced: number }>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [driverPath, target, char, JSON.stringify(SIZES), String(endAt)],
              { stdio: ["ignore", "pipe", "pipe"] },
            );
            let out = "";
            let err = "";
            child.stdout.on("data", (c) => (out += c));
            child.stderr.on("data", (c) => (err += c));
            child.on("error", reject);
            child.on("close", (code) => {
              if (code !== 0) return reject(new Error(`writer exited ${code}: ${err}`));
              try {
                resolve(JSON.parse(out) as { writes: number; spliced: number });
              } catch {
                reject(new Error(`unparseable writer output: ${out}\n${err}`));
              }
            });
          }),
      ),
    );

    const spliced = results.reduce((n, r) => n + r.spliced, 0);
    const writes = results.reduce((n, r) => n + r.writes, 0);
    expect(spliced).toBe(0);
    // Floor, not a throughput SLO: fsync-bound and typically ~200 alone, but
    // this file runs alongside two other multiprocess stress suites whose
    // children steal the machine — observed as low as ~90 under full-suite load.
    expect(writes).toBeGreaterThan(25);

    // And the final file is one writer's payload, whole.
    const final = readFileSync(target, "utf8");
    expect(final.length).toBe(SIZES[final[0] as string]);
    const leftovers = readdirSync(dirname(target)).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  }, 30_000);
});

describe("appendJsonl / readJsonl", () => {
  it("appends whole lines and reads them back", () => {
    const p = join(dir, "m", "runs.jsonl");
    appendJsonl(p, { a: 1 });
    appendJsonl(p, { a: 2 });
    expect(readJsonl(p)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("returns [] for a missing file", () => {
    expect(readJsonl(join(dir, "nope.jsonl"))).toEqual([]);
  });

  it("skips blank lines", () => {
    const p = join(dir, "x.jsonl");
    writeFileSync(p, '{"a":1}\n\n  \n{"a":2}\n');
    expect(readJsonl(p)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("readYaml / readJson / writeJson", () => {
  it("parses yaml and returns undefined for a missing file", () => {
    const p = join(dir, "c.yml");
    writeFileSync(p, "window_budget_k:\n  security: 6\n");
    expect(readYaml(p)).toEqual({ window_budget_k: { security: 6 } });
    expect(readYaml(join(dir, "missing.yml"))).toBeUndefined();
  });

  it("round-trips json", () => {
    const p = join(dir, "out.json");
    writeJson(p, [{ id: "A" }]);
    expect(readJson(p)).toEqual([{ id: "A" }]);
    expect(readJson(join(dir, "missing.json"))).toBeUndefined();
  });
});
