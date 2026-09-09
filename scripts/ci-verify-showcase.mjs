#!/usr/bin/env node
// Verifies the deliberately broken showcase (recurspec.yml at the repo root).
// The showcase must fail in exactly the expected way: exit code 1 with a
// fixed set of recovery statuses. Any deviation is a genuine failure.
// Usage: node ./scripts/ci-verify-showcase.mjs   (run from the repo root)
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "dist", "cli.js");

// Update these expectations if recurspec.yml changes.
const EXPECTED_EXIT = 1;
const EXPECTED_TOTAL = 8;
const EXPECTED_BY_STATUS = {
  PASS: 4,
  PARTIAL_RECOVERY: 1,
  RECOVERY_COMMAND_FAILED: 1,
  BLOCKED_RECOVERY: 1,
  RECOVERY_LOOP: 1
};

let failures = 0;
function check(label, cond, detail = "") {
  if (cond) {
    console.log("ok - " + label);
  } else {
    failures += 1;
    console.log("FAIL - " + label + (detail ? ": " + detail : ""));
  }
}

async function runCli(args) {
  try {
    const res = await execFileAsync(process.execPath, [cli, ...args], { cwd: root, timeout: 300000 });
    return { code: 0, stdout: res.stdout, stderr: res.stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const json = await runCli(["test", "--format", "json"]);
check("showcase exits with code " + EXPECTED_EXIT, json.code === EXPECTED_EXIT, "got " + json.code);

let result = null;
try {
  result = JSON.parse(json.stdout);
  check("showcase json parses", true);
} catch (err) {
  check("showcase json parses", false, String(err.message));
}

if (result) {
  check("showcase has " + EXPECTED_TOTAL + " cases", result.summary.total === EXPECTED_TOTAL, "got " + result.summary.total);
  for (const [status, count] of Object.entries(EXPECTED_BY_STATUS)) {
    const actual = result.summary.byStatus[status] ?? 0;
    check("showcase has " + count + "x " + status, actual === count, "got " + actual);
  }
  const unexpected = Object.keys(result.summary.byStatus).filter((s) => !(s in EXPECTED_BY_STATUS));
  check("showcase has no unexpected statuses", unexpected.length === 0, unexpected.join(", "));
}

const junit = await runCli(["test", "--format", "junit"]);
const junitOut = junit.stdout;
check(
  "showcase junit is well-formed",
  junitOut.startsWith("<?xml") &&
    junitOut.trimEnd().endsWith("</testsuite>") &&
    (junitOut.match(/<testcase /g) ?? []).length === EXPECTED_TOTAL &&
    (junitOut.match(/<failure /g) ?? []).length === EXPECTED_TOTAL - EXPECTED_BY_STATUS.PASS
);

const markdown = await runCli(["test", "--format", "markdown"]);
const mdRows = markdown.stdout.split("\n").filter((l) => l.startsWith("| ✅") || l.startsWith("| ❌"));
check("showcase markdown has one row per case", mdRows.length === EXPECTED_TOTAL, "got " + mdRows.length);

if (failures > 0) {
  console.log("\nshowcase verification FAILED (" + failures + " check(s)).");
  process.exit(1);
}
console.log("\nshowcase verification passed: the demo fails exactly as designed.");
