#!/usr/bin/env node
// Deterministic real-world compatibility suite.
// For each examples/real-world/<tool>/ with its tool binaries available,
// runs `recurspec test` and checks every case against expect.json.
// Missing tools are skipped with a clear reason; nothing here needs the
// network or touches global user configuration.
// Usage: node ./scripts/test-real-world.mjs   (run from the repo root)
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "dist", "cli.js");
const examplesDir = path.join(root, "examples", "real-world");

if (!existsSync(cli)) {
  console.error("dist/cli.js not found. Run `pnpm build` first.");
  process.exit(2);
}

async function binaryAvailable(name) {
  try {
    // shell:true on Windows so .cmd shims (npm, pnpm) resolve.
    await execFileAsync(name, ["--version"], { timeout: 60000, shell: process.platform === "win32" });
    return true;
  } catch {
    return false;
  }
}

async function runSuite(dir, configName) {
  try {
    const res = await execFileAsync(
      process.execPath,
      [cli, "test", configName, "--format", "json"],
      { cwd: dir, timeout: 600000 }
    );
    return { code: 0, result: JSON.parse(res.stdout) };
  } catch (err) {
    // Exit code 1 still carries the JSON report on stdout.
    try {
      return { code: err.code ?? 1, result: JSON.parse(err.stdout ?? "") };
    } catch {
      return { code: err.code ?? 1, result: null, raw: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
  }
}

const tools = (await readdir(examplesDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let failures = 0;
let skipped = 0;
for (const tool of tools) {
  const dir = path.join(examplesDir, tool);
  const manifest = JSON.parse(await readFile(path.join(dir, "expect.json"), "utf8"));
  const missing = [];
  for (const bin of manifest.requiredBinaries ?? []) {
    if (!(await binaryAvailable(bin))) missing.push(bin);
  }
  if (missing.length > 0) {
    skipped += 1;
    console.log("SKIP " + tool + ": missing " + missing.join(", "));
    continue;
  }
  const { code, result, raw, stderr } = await runSuite(dir, manifest.config);
  if (!result) {
    failures += 1;
    console.log("FAIL " + tool + ": no JSON report (exit " + code + ")");
    console.log((raw ?? "") + (stderr ?? ""));
    continue;
  }
  const actual = new Map(result.cases.map((c) => [c.name, c.status]));
  let ok = true;
  for (const [name, expected] of Object.entries(manifest.expected)) {
    const got = actual.get(name);
    if (got !== expected) {
      ok = false;
      console.log("FAIL " + tool + " / " + name + ": expected " + expected + ", got " + got);
    }
  }
  const unexpected = [...actual.keys()].filter((n) => !(n in manifest.expected));
  if (unexpected.length > 0) {
    ok = false;
    console.log("FAIL " + tool + ": unlisted cases ran: " + unexpected.join(", "));
  }
  if (ok) {
    console.log("ok - " + tool + " (" + actual.size + " cases match expectations)");
  } else {
    failures += 1;
  }
}

if (failures > 0) {
  console.log("\nreal-world suite FAILED (" + failures + " tool(s), " + skipped + " skipped).");
  process.exit(1);
}
console.log("\nreal-world suite passed (" + skipped + " tool(s) skipped).");
