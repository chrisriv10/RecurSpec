#!/usr/bin/env node
// Deterministic real-world compatibility suite.
// For each examples/real-world/<tool>/ with its tool binaries available,
// runs `recurspec test` and checks every case against expect.json.
// Missing tools are skipped with a clear reason; nothing here needs the
// network or touches global user configuration.
//
// Usage: node ./scripts/test-real-world.mjs [--require-all]
//   --require-all  Treat skipped tools (missing binaries) as failures. Use
//                  this on a runner that is expected to have every tool.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseReport, validateManifest } from "./lib/real-world-report.mjs";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "dist", "cli.js");
const examplesDir = path.join(root, "examples", "real-world");
const requireAll = process.argv.includes("--require-all");

if (!existsSync(cli)) {
  console.error("dist/cli.js not found. Run `pnpm build` first.");
  process.exit(2);
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/, 1)[0] || "unknown";
}

function displayVersion(bin, version) {
  if (!version) return bin + " unavailable";
  return version.toLowerCase().startsWith(bin.toLowerCase()) ? version : bin + " " + version;
}

async function binaryVersion(name) {
  try {
    // shell:true on Windows so .cmd shims (npm, pnpm) resolve.
    const res = await execFileAsync(name, ["--version"], {
      timeout: 60000,
      shell: process.platform === "win32"
    });
    return { available: true, version: firstLine(res.stdout) };
  } catch (err) {
    const out = err.stdout ? firstLine(err.stdout) : "";
    return { available: false, version: out || null, reason: err.code ?? "not runnable" };
  }
}

async function runSuite(dir, configName) {
  try {
    const res = await execFileAsync(
      process.execPath,
      [cli, "test", configName, "--format", "json"],
      { cwd: dir, timeout: 600000 }
    );
    const parsed = parseReport(res.stdout);
    return { code: 0, ...parsed, raw: res.stdout, stderr: res.stderr };
  } catch (err) {
    // Exit code 1 still carries the JSON report on stdout.
    const parsed = parseReport(err.stdout ?? "");
    return {
      code: err.code ?? 1,
      ...parsed,
      raw: err.stdout ?? "",
      stderr: err.stderr ?? ""
    };
  }
}

const tools = (await readdir(examplesDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let failures = 0;
let ranTools = 0;
let skippedTools = 0;
let checkedCases = 0;
let expectedNegatives = 0;
const skipNotes = [];
const versionNotes = [];

console.log("RecurSpec real-world compatibility suite");
console.log(
  "node " + process.version + " on " + process.platform + " (" + process.arch + ")" +
    (requireAll ? ", --require-all" : "")
);
console.log("");

for (const tool of tools) {
  const dir = path.join(examplesDir, tool);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, "expect.json"), "utf8"));
  } catch (err) {
    failures += 1;
    console.log("FAIL " + tool + ": cannot read expect.json (" + String(err.message) + ")");
    continue;
  }
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    failures += 1;
    console.log("FAIL " + tool + ": invalid expect.json (" + validation.reason + ")");
    continue;
  }

  const versions = [];
  const missing = [];
  for (const bin of manifest.requiredBinaries ?? []) {
    const info = await binaryVersion(bin);
    versions.push(displayVersion(bin, info.version));
    if (!info.available) missing.push(bin);
  }
  versionNotes.push(tool + ": " + (versions.length > 0 ? versions.join(", ") : "no required binaries"));
  console.log("tool " + tool + " [" + (versions.join(", ") || "no required binaries") + "]");

  if (missing.length > 0) {
    skippedTools += 1;
    const reason = "missing required binaries: " + missing.join(", ");
    skipNotes.push(tool + ": " + reason);
    console.log("SKIP " + tool + ": " + reason);
    console.log("");
    continue;
  }

  const { code, report, reason, raw, stderr } = await runSuite(dir, manifest.config);
  if (!report) {
    failures += 1;
    console.log("FAIL " + tool + ": no usable JSON report (exit " + code + ", " + reason + ")");
    console.log((raw ?? "") + (stderr ?? ""));
    console.log("");
    continue;
  }

  const actual = new Map(report.cases.map((c) => [c.name, c.status]));
  let ok = true;
  let toolCases = 0;
  let toolNegatives = 0;
  for (const [name, expected] of Object.entries(manifest.expected)) {
    const got = actual.get(name);
    toolCases += 1;
    if (expected !== "PASS") toolNegatives += 1;
    if (got === undefined) {
      ok = false;
      console.log("FAIL " + tool + " / " + name + ": case missing from report (expected " + expected + ")");
    } else if (got !== expected) {
      ok = false;
      console.log("FAIL " + tool + " / " + name + ": expected " + expected + ", got " + got);
    }
  }
  const unexpected = [...actual.keys()].filter((n) => !(n in manifest.expected));
  if (unexpected.length > 0) {
    ok = false;
    console.log("FAIL " + tool + ": unlisted cases ran: " + unexpected.join(", "));
  }
  checkedCases += toolCases;
  expectedNegatives += toolNegatives;
  if (ok) {
    ranTools += 1;
    console.log(
      "ok - " + tool + " (" + toolCases + " expected case(s) matched, " +
        toolNegatives + " expected negative outcome(s))"
    );
  } else {
    failures += 1;
    console.log("FAIL " + tool + ": expectations did not match");
  }
  console.log("");
}

console.log(
  "summary: " + ranTools + " tool(s) ran, " + skippedTools + " skipped, " +
    checkedCases + " expected case(s), " + expectedNegatives + " expected negative outcome(s)."
);
if (versionNotes.length > 0) {
  console.log("versions:");
  for (const note of versionNotes) console.log("  " + note);
}
if (skipNotes.length > 0) {
  console.log("skips:");
  for (const note of skipNotes) console.log("  " + note);
}

if (failures > 0) {
  console.log("\nreal-world suite FAILED (" + failures + " tool(s) failed, " + skippedTools + " skipped).");
  process.exit(1);
}
if (requireAll && skippedTools > 0) {
  console.log("\nreal-world suite FAILED: --require-all requires every tool, but " + skippedTools + " were skipped.");
  process.exit(1);
}
console.log("\nreal-world suite passed (" + skippedTools + " tool(s) skipped).");
