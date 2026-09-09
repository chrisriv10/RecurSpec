import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acmeArgs, baseConfig, repoRoot, runSingleCase } from "../helpers/acme.js";
import { runCase } from "../../src/runner/runner.js";

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("workspace, timeouts, verification, and hooks", () => {
  it("times out hanging commands and reports TIMEOUT", async () => {
    const result = await runSingleCase({
      name: "timeout",
      timeout: "500ms",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("hang") },
      failure: { exitCode: "nonzero" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("TIMEOUT");
  });

  it("never modifies the source directory", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "rs-source-"));
    try {
      await writeFile(path.join(projectDir, "marker.txt"), "do not touch", "utf8");
      const kase = {
        name: "isolation",
        workspace: { copy: ["demo/acme-cli/**"] },
        run: { command: process.execPath, args: acmeArgs("deploy") },
        failure: { exitCode: "nonzero" as const },
        recovery: { source: "output" as const },
        verify: { rerunOriginal: true, exitCode: 0 as const }
      };
      const result = await runCase(baseConfig([kase]), kase, { configDir: repoRoot });
      expect(result.status).toBe("PASS");
      expect(await fileExists(path.join(projectDir, "marker.txt"))).toBe(true);
      expect(await fileExists(path.join(projectDir, ".acme", "initialized"))).toBe(false);
      expect(await fileExists(path.join(repoRoot, ".acme"))).toBe(false);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("rejects workspace paths that escape isolation", async () => {
    const result = await runSingleCase({
      name: "traversal",
      workspace: { copy: ["demo/acme-cli/**"], write: { "../../escape.txt": "nope" } },
      run: { command: process.execPath, args: acmeArgs("deploy") }
    });
    expect(result.status).toBe("INTERNAL_ERROR");
    expect(result.error ?? "").toMatch(/outside the isolated workspace/);
  });

  it("checks file and JSON postconditions", async () => {
    const result = await runSingleCase({
      name: "postconditions",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      verify: {
        rerunOriginal: true,
        exitCode: 0 as const,
        files: { exists: [".acme/config.json"], notExists: [".acme/error.lock"] },
        json: { path: ".acme/config.json", assertions: { initialized: true, project: "test" } }
      }
    });
    expect(result.status).toBe("PASS");
  });

  it("reports VERIFY_FAILED when postconditions fail after a good rerun", async () => {
    const result = await runSingleCase({
      name: "verify-failed",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      verify: {
        rerunOriginal: true,
        exitCode: 0 as const,
        json: { path: ".acme/config.json", assertions: { project: "wrong-value" } }
      }
    });
    expect(result.status).toBe("VERIFY_FAILED");
  });

  it("supports scripted stdin for explicit recovery steps", async () => {
    const result = await runSingleCase({
      name: "stdin",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("publish") },
      failure: { exitCode: "nonzero" as const },
      recovery: {
        steps: [
          { command: process.execPath, args: acmeArgs("login-prompt"), stdin: ["dev@example.com", "s3cret"] }
        ]
      },
      verify: { rerunOriginal: true, stdout: { contains: "Published successfully" } }
    });
    expect(result.status).toBe("PASS");
  });

  it("runs teardown even when verification fails and can preserve the workspace", async () => {
    const result = await runSingleCase({
      name: "teardown",
      workspace: { copy: ["demo/acme-cli/**"], preserve: true },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      teardown: [
        {
          command: process.execPath,
          args: ["-e", "require(\u0027fs\u0027).writeFileSync(\u0027torn-down.txt\u0027,\u0027yes\u0027)"]
        }
      ],
      verify: {
        rerunOriginal: true,
        exitCode: 0 as const,
        json: { path: ".acme/config.json", assertions: { project: "wrong-value" } }
      }
    });
    try {
      expect(result.status).toBe("VERIFY_FAILED");
      expect(result.workspace).toBeDefined();
      const content = await readFile(path.join(result.workspace as string, "torn-down.txt"), "utf8");
      expect(content).toBe("yes");
    } finally {
      if (result.workspace) await rm(result.workspace, { recursive: true, force: true });
    }
  });

  it("masks configured secrets in stored output", async () => {
    const result = await runSingleCase({
      name: "secrets",
      env: { ACME_SCENARIO: "structured" },
      secrets: ["ACME_SCENARIO"],
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "structured" as const, format: "json" as const },
      verify: { rerunOriginal: true, exitCode: 0 as const }
    });
    expect(result.status).toBe("PASS");
  });
});
