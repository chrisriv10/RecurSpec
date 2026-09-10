#!/usr/bin/env node
// Packed-install smoke test: validates the exact tarball users would install.
// 1. builds, 2. packs, 3. asserts tarball contents, 4. installs into a fresh
//    project, 5. exercises the CLI (version/help/init/validate/test),
// 6. exercises the public API from the installed package.
// Cross-platform: pure Node, no shell assumptions.
// Usage: node ./scripts/smoke-pack.mjs   (run from the repo root)
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tscBin = path.join(root, "node_modules", "typescript", "bin", "tsc");
const isWin = process.platform === "win32";
const PNPM = isWin ? "pnpm.cmd" : "pnpm";
const NPM = isWin ? "npm.cmd" : "npm";
const NPX = isWin ? "npx.cmd" : "npx";

let step = "start";
async function run(cmd, args, opts = {}) {
  try {
    const res = await execFileAsync(cmd, args, { timeout: 300000, ...opts });
    return { code: 0, stdout: res.stdout, stderr: res.stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

async function runShell(cmd, args, opts = {}) {
  return run(cmd, args, { ...opts, shell: isWin });
}
function fail(message, detail = "") {
  console.error("SMOKE FAIL at step [" + step + "]: " + message);
  if (detail) console.error(detail.slice(0, 3000));
  process.exit(1);
}

// Minimal tar listing (names only): handles ustar/pax, skips pax headers,
// strips leading "./".
function listTarball(tgzPath) {
  const data = gunzipSync(readFileSync(tgzPath));
  const names = [];
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    let name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8);
    const typeflag = String.fromCharCode(header[156]);
    if (name.startsWith("./")) name = name.slice(2);
    if (name && name !== "./" && !name.includes("@PaxHeader") && typeflag !== "x" && typeflag !== "g") {
      names.push(name.replace(/\/$/, ""));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

const tmpBase = await mkdtemp(path.join(tmpdir(), "recurspec-smoke-"));
const packDir = path.join(tmpBase, "pack");
const projectDir = path.join(tmpBase, "project");
await mkdir(packDir, { recursive: true });
await mkdir(projectDir, { recursive: true });

try {
  step = "build";
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  let r = await run(process.execPath, [tsc, "-p", "tsconfig.build.json"], { cwd: root });
  if (r.code !== 0) fail("build failed", r.stderr);

  step = "pack";
  r = await runShell(PNPM, ["pack", "--pack-destination", packDir], { cwd: root });
  if (r.code !== 0) fail("pnpm pack failed", r.stderr + r.stdout);
  const packed = (r.stdout.match(/recurspec-[\d.]+\.tgz/) ?? [])[0];
  if (!packed) fail("could not find packed filename in pnpm output", r.stdout);
  const tgzPath = path.join(packDir, packed);
  console.log("packed: " + packed);

  step = "tarball-contents";
  const names = listTarball(tgzPath);
  console.log("tarball entries (" + names.length + "):");
  for (const n of names.slice(0, 40)) console.log("  " + n);
  const mustHave = ["package/package.json", "package/dist/cli.js", "package/dist/index.js", "package/dist/index.d.ts", "package/README.md", "package/LICENSE", "package/CHANGELOG.md", "package/assets/logo.png"];
  for (const m of mustHave) {
    if (!names.includes(m)) fail("tarball missing required entry: " + m, names.join("\n"));
  }
  const forbidden = names.filter(
    (n) => n === "package/recurspec.yml" || n.startsWith("package/src/") || n.startsWith("package/tests/") ||
      n.startsWith("package/demo/") || n.startsWith("package/scripts/") || n.startsWith("package/ci/") ||
      n.startsWith("package/.github/") || n.endsWith(".ts") && !n.endsWith(".d.ts")
  );
  if (forbidden.length > 0) fail("tarball contains development-only files", forbidden.join("\n"));
  console.log("tarball contents ok");

  step = "install";
  await writeFile(path.join(projectDir, "package.json"), JSON.stringify({ name: "smoke-proj", private: true, type: "module" }), "utf8");
  r = await runShell(NPM, ["install", tgzPath, "--no-audit", "--no-fund"], { cwd: projectDir });
  if (r.code !== 0) fail("installing the tarball failed", r.stderr);

  step = "cli-version";
  r = await runShell(NPX, ["recurspec", "--version"], { cwd: projectDir });
  if (r.code !== 0 || !/^\d+\.\d+\.\d+/.test(r.stdout.trim())) fail("--version failed", r.stdout + r.stderr);
  console.log("version: " + r.stdout.trim());

  step = "cli-help";
  r = await runShell(NPX, ["recurspec", "--help"], { cwd: projectDir });
  if (r.code !== 0 || !r.stdout.includes("test")) fail("--help failed", r.stdout + r.stderr);

  step = "cli-init";
  r = await runShell(NPX, ["recurspec", "init"], { cwd: projectDir });
  if (r.code !== 0) fail("init failed", r.stdout + r.stderr);

  step = "cli-validate";
  r = await runShell(NPX, ["recurspec", "validate"], { cwd: projectDir });
  if (r.code !== 0) fail("validate of the starter config failed", r.stdout + r.stderr);

  step = "cli-test";
  await copyFile(path.join(root, "ci", "recurspec.ci.yml"), path.join(projectDir, "recurspec.yml"));
  r = await runShell(NPX, ["recurspec", "test"], { cwd: projectDir });
  if (r.code !== 0 || !r.stdout.includes("passed")) fail("test of the CI fixture failed", r.stdout + r.stderr);

  step = "public-api";
  const dts = path.join(projectDir, "node_modules", "recurspec", "dist", "index.d.ts");
  let dtsText = "";
  try {
    dtsText = await readFile(dts, "utf8");
  } catch {
    fail("missing type declarations at " + dts);
  }
  if (!dtsText.includes("runRecurSpec")) fail("type declarations do not export runRecurSpec");
  await writeFile(
    path.join(projectDir, "api-check.mjs"),
    "import { runRecurSpec } from \"recurspec\";\n" +
      "const result = await runRecurSpec({ cwd: process.cwd() });\n" +
      "if (result.summary.failed > 0) { console.error(\"api run failed\"); process.exit(1); }\n" +
      "console.log(\"api-ok passed=\" + result.summary.passed);\n",
    "utf8"
  );
  await writeFile(
    path.join(projectDir, "api-check-types.ts"),
    "import { runRecurSpec, selectCases, resolveCompletionMode } from \"recurspec\";\n" +
      "import type { RunResult, CaseResult, RecurSpecConfig, VerifySpec, SafetyEvaluation } from \"recurspec\";\n" +
      "const mode = resolveCompletionMode({ mode: \"goal\", files: { exists: [\"a\"] } });\n" +
      "export async function check(cwd: string): Promise<RunResult> {\n" +
      "  const sel = await selectCases(cwd, {});\n" +
      "  void sel;\n" +
      "  const r: RunResult = await runRecurSpec({ cwd });\n" +
      "  const c: CaseResult | undefined = r.cases[0];\n" +
      "  void c;\n" +
      "  return r;\n" +
      "}\n" +
      "void mode;\n",
    "utf8"
  );
  r = await run(process.execPath, [tscBin, "--noEmit", "--strict", "--skipLibCheck", "--module", "nodenext", "--target", "es2022", "--moduleResolution", "nodenext", "api-check-types.ts"], { cwd: projectDir });
  if (r.code !== 0) fail("public type declarations do not typecheck", r.stdout + r.stderr);
  console.log("api types ok");
  r = await run(process.execPath, ["api-check.mjs"], { cwd: projectDir });
  if (r.code !== 0 || !r.stdout.includes("api-ok")) fail("public API check failed", r.stdout + r.stderr);
  console.log(r.stdout.trim());

  console.log("\npacked-install smoke test passed.");
} finally {
  await rm(tmpBase, { recursive: true, force: true }).catch(() => undefined);
}
