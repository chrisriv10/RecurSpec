import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../helpers/acme.js";

const execFileAsync = promisify(execFile);
const cliJs = path.join(repoRoot, "dist", "cli.js");

// Note: dist is built once in tests/global-setup.ts before workers start.
// Test files must never rebuild/overwrite dist themselves: concurrent tsc
// writes while other workers spawn `node dist/cli.js` race on Windows file
// locking and produce flaky empty-stdout spawn failures.

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(cwd: string, args: string[], retries = 1): Promise<CliRun> {
  try {
    const res = await execFileAsync(process.execPath, [cliJs, ...args], { cwd, timeout: 120000 });
    return { code: 0, stdout: res.stdout, stderr: res.stderr };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; errno?: number | string; syscall?: string; message?: string };
    // A codeless spawn failure (e.g. transient EMFILE/EBUSY under parallel
    // load) is environmental, not a product result: retry once, then fail
    // loudly. Never synthesize {code: 1, stdout: "", stderr: ""} because that
    // masquerades as a product failure and trips output assertions.
    if (typeof e.code !== "number") {
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return runCli(cwd, args, retries - 1);
      }
      throw new Error(
        "runCli harness spawn failed for " + JSON.stringify(args) +
        " code=" + String(e.code) +
        " errno=" + String(e.errno ?? "?") +
        " syscall=" + String(e.syscall ?? "?") +
        " message=" + String(e.message ?? "?") +
        " stdout=" + JSON.stringify(e.stdout ?? "") +
        " stderr=" + JSON.stringify(String(e.stderr ?? "").slice(0, 2000))
      );
    }
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function makeProject(configYaml: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rs-cli-"));
  await mkdir(path.join(dir, "demo", "acme-cli"), { recursive: true });
  await cp(path.join(repoRoot, "demo", "acme-cli", "acme.mjs"), path.join(dir, "demo", "acme-cli", "acme.mjs"));
  await writeFile(path.join(dir, "recurspec.yml"), configYaml, "utf8");
  return dir;
}

const PASSING_CONFIG = [
  "version: 1",
  "cases:",
  "  - name: cli-pass",
  "    tags: [smoke]",
  "    workspace:",
  "      copy: [demo/acme-cli/**]",
  "    run:",
  "      command: node",
  "      args: [demo/acme-cli/acme.mjs, deploy]",
  "    failure:",
  "      exitCode: nonzero",
  "    recovery:",
  "      source: output",
  "    verify:",
  "      rerunOriginal: true",
  "      exitCode: 0",
  ""
].join("\n");

const FAILING_CONFIG = PASSING_CONFIG.replace("cli-pass", "cli-fail").replace("tags: [smoke]", "tags: [broken]").replace("exitCode: 0\n", "exitCode: 0\n      stdout:\n        contains: this-never-appears\n");

describe("recurspec CLI", () => {
  it("--version reports the package version", async () => {
    const res = await runCli(repoRoot, ["--version"]);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  it("test exits 0 when all contracts pass", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rs-cli-"));
    try {
      const project = await makeProject(PASSING_CONFIG);
      const res = await runCli(project, ["test"]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("1 passed");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("test exits 1 when a contract fails", async () => {
    const project = await makeProject(FAILING_CONFIG);
    try {
      const res = await runCli(project, ["test"]);
      expect(res.code).toBe(1);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("test exits 2 without a config and suggests init", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rs-cli-empty-"));
    try {
      const res = await runCli(dir, ["test"]);
      expect(res.code).toBe(2);
      expect(res.stderr).toContain("recurspec init");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports json and junit formats", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      const json = await runCli(project, ["test", "--format", "json"]);
      expect(json.code).toBe(0);
      const parsed = JSON.parse(json.stdout) as { cases: Array<{ status: string }> };
      expect(parsed.cases[0]?.status).toBe("PASS");
      const junit = await runCli(project, ["test", "--format", "junit"]);
      expect(junit.code).toBe(0);
      expect(junit.stdout).toContain("<testsuite");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("filters by case and tag", async () => {
    const project = await makeProject(PASSING_CONFIG + FAILING_CONFIG.replace("version: 1\ncases:\n", ""));
    try {
      const byCase = await runCli(project, ["test", "--case", "cli-pass", "--format", "json"]);
      expect(byCase.code).toBe(0);
      const byTag = await runCli(project, ["test", "--tag", "smoke", "--format", "json"]);
      expect(byTag.code).toBe(0);
      const parsed = JSON.parse(byTag.stdout) as { summary: { total: number } };
      expect(parsed.summary.total).toBe(1);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("validate accepts good configs and rejects bad ones", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      expect((await runCli(project, ["validate"])).code).toBe(0);
      await writeFile(path.join(project, "recurspec.yml"), "version: 1\ncases: []\n", "utf8");
      expect((await runCli(project, ["validate"])).code).toBe(2);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("init creates a config and refuses to overwrite without --force", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rs-cli-init-"));
    try {
      expect((await runCli(dir, ["init"])).code).toBe(0);
      expect((await runCli(dir, ["init"])).code).toBe(2);
      expect((await runCli(dir, ["init", "--force"])).code).toBe(0);
      const content = await readFile(path.join(dir, "recurspec.yml"), "utf8");
      expect(content).toContain("version: 1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("explain describes a case and errors on unknown names", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      const ok = await runCli(project, ["explain", "cli-pass"]);
      expect(ok.code).toBe(0);
      expect(ok.stdout).toContain("Original command");
      const missing = await runCli(project, ["explain", "nope"]);
      expect(missing.code).toBe(2);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
