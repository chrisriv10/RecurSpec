import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "../helpers/acme.js";

const execFileAsync = promisify(execFile);
const cliJs = path.join(repoRoot, "dist", "cli.js");

async function ensureBuilt(): Promise<void> {
  await execFileAsync(process.execPath, [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"], {
    cwd: repoRoot,
    timeout: 240000
  });
}

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
    const e = err as { code?: number; stdout?: string; stderr?: string };
    // A codeless spawn failure (e.g. transient EMFILE under parallel load)
    // is environmental, not a product result: retry once before giving up.
    if (typeof e.code !== "number" && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return runCli(cwd, args, retries - 1);
    }
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function makeProject(configYaml: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rs-cli-err-"));
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

function hasStackTrace(text: string): boolean {
  return /at .*\(.*:\d+:\d+\)/.test(text);
}

describe("recurspec CLI error paths", () => {
  beforeAll(ensureBuilt, 240000);

  it("rejects invalid YAML without a stack trace", async () => {
    const project = await makeProject("version: 1\ncases: [unclosed\n");
    try {
      const res = await runCli(project, ["validate"]);
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/could not parse/i);
      expect(hasStackTrace(res.stderr)).toBe(false);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("reports schema errors with the offending path", async () => {
    const bad = PASSING_CONFIG.replace("      source: output", "      source: output\n      maxHops: 20");
    const project = await makeProject(bad);
    try {
      const res = await runCli(project, ["validate"]);
      expect(res.code).toBe(2);
      expect(res.stderr).toContain("maxHops");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("exits 2 with available cases when filters match nothing", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      const byTag = await runCli(project, ["test", "--tag", "no-such-tag"]);
      expect(byTag.code).toBe(2);
      expect(byTag.stderr).toContain("No cases matched");
      expect(byTag.stderr).toContain("cli-pass");
      const byCase = await runCli(project, ["test", "--case", "no-such-case"]);
      expect(byCase.code).toBe(2);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("rejects unknown formats", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      const res = await runCli(project, ["test", "--format", "xml"]);
      expect(res.code).toBe(2);
      expect(res.stderr).toContain("Unknown format");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("survives invalid regexes as mismatches, not crashes", async () => {
    const bad = PASSING_CONFIG.replace("      exitCode: nonzero", "      exitCode: nonzero\n      stderr:\n        matches: \"([\"");
    const project = await makeProject(bad);
    try {
      const res = await runCli(project, ["test", "--format", "json"]);
      expect(res.code).toBe(1);
      const parsed = JSON.parse(res.stdout) as { cases: Array<{ status: string }> };
      expect(parsed.cases[0]?.status).toBe("FAILURE_MISMATCH");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("reports missing executables without a stack trace", async () => {
    const bad = PASSING_CONFIG.replace("      command: node", "      command: recurspec-definitely-not-a-real-binary");
    const project = await makeProject(bad);
    try {
      const res = await runCli(project, ["test"]);
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("INTERNAL_ERROR");
      expect(hasStackTrace(res.stdout + res.stderr)).toBe(false);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("emits a JSON error envelope for config errors in json mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rs-cli-empty-"));
    try {
      const res = await runCli(dir, ["test", "--format", "json"]);
      expect(res.code).toBe(2);
      const parsed = JSON.parse(res.stdout) as { error: string };
      expect(parsed.error).toContain("recurspec init");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prints the recovery trace with --verbose on failures", async () => {
    const bad = PASSING_CONFIG.replace("      exitCode: 0\n", "      exitCode: 0\n      stdout:\n        contains: this-never-appears\n");
    const project = await makeProject(bad);
    try {
      const res = await runCli(project, ["test", "--verbose"]);
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("Recovery path:");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("discover explains itself when no discover block exists", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      const res = await runCli(project, ["discover"]);
      expect(res.code).toBe(2);
      expect(res.stderr).toContain("discover:");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

describe("recurspec --dry-run", () => {
  beforeAll(ensureBuilt, 240000);

  it("prints the plan without executing anything", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      const res = await runCli(project, ["test", "--dry-run"]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("1. Create isolated workspace");
      expect(res.stdout).toContain("2. Run: node demo/acme-cli/acme.mjs deploy");
      expect(res.stdout).toContain("7. Retry original command");
      expect(res.stdout).toContain("Dry run: nothing was executed.");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("never resolves or runs the target command", async () => {
    const bad = PASSING_CONFIG.replace("      command: node", "      command: recurspec-definitely-not-a-real-binary");
    const project = await makeProject(bad);
    try {
      const res = await runCli(project, ["test", "--dry-run"]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("recurspec-definitely-not-a-real-binary");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("emits a versioned JSON plan", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      const res = await runCli(project, ["test", "--dry-run", "--format", "json"]);
      expect(res.code).toBe(0);
      const parsed = JSON.parse(res.stdout) as { version: number; plans: Array<{ name: string; completion: { mode: string } }> };
      expect(parsed.version).toBe(1);
      expect(parsed.plans[0]?.name).toBe("cli-pass");
      expect(parsed.plans[0]?.completion.mode).toBe("retry");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("rejects junit for dry runs", async () => {
    const project = await makeProject(PASSING_CONFIG);
    try {
      const res = await runCli(project, ["test", "--dry-run", "--format", "junit"]);
      expect(res.code).toBe(2);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
});
