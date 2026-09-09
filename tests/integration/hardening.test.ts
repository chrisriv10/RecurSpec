import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runStep } from "../../src/runner/process.js";
import { baseConfig, repoRoot, runSingleCase } from "../helpers/acme.js";
import { runCase } from "../../src/runner/runner.js";
import type { RecoveryCase } from "../../src/types/config.js";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("process hardening", () => {
  it("captures large output without deadlock or truncation", async () => {
    const res = await runStep(
      { command: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024))"] },
      { cwd: repoRoot, env: { PATH: process.env["PATH"] ?? "" }, defaultTimeoutMs: 30000 }
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout.length).toBe(5 * 1024 * 1024);
  });

  it("runs teardown after a timeout and cleans the workspace by default", async () => {
    const result = await runSingleCase({
      name: "timeout-cleanup",
      timeout: "500ms",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: ["-e", "setTimeout(() => {}, 30000)"] },
      failure: { exitCode: "nonzero" },
      teardown: [
        {
          command: process.execPath,
          args: ["-e", "require(\u0027fs\u0027).writeFileSync(\u0027torn.txt\u0027,\u0027down\u0027)"]
        }
      ],
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("TIMEOUT");
    expect(result.workspace).toBeUndefined();
  });

  it("preserves the workspace on timeout when asked, with teardown applied", async () => {
    const result = await runSingleCase({
      name: "timeout-preserve",
      timeout: "500ms",
      workspace: { copy: ["demo/acme-cli/**"], preserveOnFailure: true },
      run: { command: process.execPath, args: ["-e", "setTimeout(() => {}, 30000)"] },
      failure: { exitCode: "nonzero" },
      teardown: [
        {
          command: process.execPath,
          args: ["-e", "require(\u0027fs\u0027).writeFileSync(\u0027torn.txt\u0027,\u0027down\u0027)"]
        }
      ],
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    try {
      expect(result.status).toBe("TIMEOUT");
      expect(result.workspace).toBeDefined();
      expect(await exists(path.join(result.workspace as string, "torn.txt"))).toBe(true);
    } finally {
      if (result.workspace) {
        const { rm } = await import("node:fs/promises");
        await rm(result.workspace, { recursive: true, force: true });
      }
    }
  });

  it("reports a missing executable as INTERNAL_ERROR without a stack trace", async () => {
    const kase: RecoveryCase = {
      name: "missing-exe",
      run: { command: "recurspec-definitely-not-a-real-binary", args: [] }
    };
    const result = await runCase(baseConfig([kase]), kase, { configDir: repoRoot });
    expect(result.status).toBe("INTERNAL_ERROR");
    expect(result.error ?? "").toMatch(/Could not execute/);
    expect(result.error ?? "").not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });
});

describe("cross-platform paths", () => {
  it("executes advice pointing at paths with spaces", async () => {
    const result = await runSingleCase({
      name: "spaces",
      workspace: {
        write: {
          "my dir/fix.mjs": "import { writeFileSync } from \"node:fs\";\nwriteFileSync(\".fixed3\", \"1\\n\");\n",
          "main.mjs":
            "import { existsSync } from \"node:fs\";\nif (!existsSync(\".fixed3\")) { console.error(\"Not ready. Run `node \\\"my dir/fix.mjs\\\"`.\"); process.exit(2); }\nconsole.log(\"ready\");\n"
        }
      },
      run: { command: process.execPath, args: ["main.mjs"] },
      failure: { exitCode: 2, stderr: { contains: "Not ready" } },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("PASS");
  });

  it("sees explicitly inherited variables in the child", async () => {
    process.env["RS_HARDENING_PROBE"] = "visible";
    try {
      const result = await runSingleCase({
        name: "inherit",
        inheritEnv: ["RS_HARDENING_PROBE"],
        run: {
          command: process.execPath,
          args: ["-e", "if (process.env.RS_HARDENING_PROBE !== \"visible\") { process.exit(3); }"]
        },
        failure: { exitCode: 0 },
        recovery: { steps: [] },
        verify: { rerunOriginal: false }
      });
      expect(result.failureMatched).toBe(true);
    } finally {
      delete process.env["RS_HARDENING_PROBE"];
    }
  });
});
