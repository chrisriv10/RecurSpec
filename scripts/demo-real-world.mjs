#!/usr/bin/env node
// Short real-world showcase: runs the cargo dead-end case (or the git
// unmerged-branch case when cargo is unavailable) in human format.
// Usage: node ./scripts/demo-real-world.mjs   (run from the repo root)
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "dist", "cli.js");

if (!existsSync(cli)) {
  console.log("Building recurspec first...");
  await execFileAsync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"], { cwd: root });
}

async function available(bin) {
  try {
    await execFileAsync(bin, ["--version"], { timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}

let target = null;
if (await available("cargo")) {
  target = ["examples/real-world/cargo/recurspec.yml", "goal-verified recovery: cargo init initializes the project in place"];
} else {
  target = ["examples/real-world/git/recurspec.yml", "git cases"];
}

console.log("");
console.log("=== RecurSpec real-world demo: " + target[1] + " ===");
console.log("");
try {
  const res = await execFileAsync(process.execPath, [cli, "test", target[0]], { cwd: root, timeout: 600000 });
  console.log(res.stdout);
} catch (err) {
  console.log(err.stdout ?? "");
}
