#!/usr/bin/env node
// Showcase demo: builds (if needed) and runs RecurSpec against recurspec.yml,
// which deliberately mixes passing and failing recovery contracts.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "dist", "cli.js");

if (!existsSync(cli)) {
  console.log("Building recurspec first...");
  const build = spawnSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log("");
console.log("=== RecurSpec demo: do these error messages actually get users unstuck? ===");
console.log("");
const run = spawnSync(process.execPath, [cli, "test"], { cwd: root, stdio: "inherit" });
console.log("");
console.log("Demo finished with exit code " + String(run.status) + " (1 means broken recovery paths were caught, by design).");
