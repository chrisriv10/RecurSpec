import { describe, expect, it } from "vitest";
import { acmeArgs, runSingleCase } from "../helpers/acme.js";

describe("recovery flows against the acme fixture", () => {
  it("passes a valid one-hop recovery", async () => {
    const result = await runSingleCase({
      name: "one-hop",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero", stderr: { contains: "Project not initialized" } },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0, stdout: { contains: "Deployed successfully" } }
    });
    expect(result.status).toBe("PASS");
    expect(result.hops).toBe(1);
    expect(result.failureMatched).toBe(true);
  });

  it("follows a two-step recovery chain", async () => {
    const result = await runSingleCase({
      name: "two-step",
      env: { ACME_SCENARIO: "two-step" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero", stderr: { contains: "Authentication required" } },
      recovery: { source: "output", maxHops: 3 },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("PASS");
    expect(result.hops).toBe(2);
  });

  it("supports explicit recovery steps", async () => {
    const result = await runSingleCase({
      name: "explicit",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("publish") },
      failure: { exitCode: "nonzero", stderr: { contains: "Authentication required" } },
      recovery: { steps: [{ command: process.execPath, args: acmeArgs("login", ["--token", "test-token"]) }] },
      verify: { rerunOriginal: true, stdout: { contains: "Published successfully" } }
    });
    expect(result.status).toBe("PASS");
  });

  it("consumes structured JSON recovery hints", async () => {
    const result = await runSingleCase({
      name: "structured",
      env: { ACME_SCENARIO: "structured" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "structured", format: "json" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("PASS");
  });

  it("reports a dead end when recovery succeeds but the task still fails identically", async () => {
    const result = await runSingleCase({
      name: "dead-end",
      env: { ACME_SCENARIO: "dead-end" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("publish") },
      failure: { exitCode: "nonzero", stderr: { contains: "Authentication required" } },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("RECOVERY_DEAD_END");
  });

  it("reports partial recovery when the error changes but the task still fails", async () => {
    const result = await runSingleCase({
      name: "partial",
      env: { ACME_SCENARIO: "partial" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("publish") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("PARTIAL_RECOVERY");
  });

  it("detects recovery loops", async () => {
    const result = await runSingleCase({
      name: "loop",
      env: { ACME_SCENARIO: "loop" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("login") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "output", maxHops: 5 },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("RECOVERY_LOOP");
  });

  it("reports missing advice", async () => {
    const result = await runSingleCase({
      name: "no-advice",
      env: { ACME_SCENARIO: "no-advice" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("NO_RECOVERY_ADVICE");
  });

  it("reports ambiguous advice without executing anything", async () => {
    const result = await runSingleCase({
      name: "ambiguous",
      env: { ACME_SCENARIO: "ambiguous" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("AMBIGUOUS_RECOVERY");
    expect(result.recoverySteps).toHaveLength(0);
  });

  it("blocks unsafe suggested commands", async () => {
    const result = await runSingleCase({
      name: "unsafe",
      env: { ACME_SCENARIO: "unsafe" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("BLOCKED_RECOVERY");
    expect(result.blockedReason ?? "").toMatch(/sudo|dangerous|Blocked/i);
    expect(result.recoverySteps).toHaveLength(0);
  });

  it("fails recovery commands that do not exist", async () => {
    const result = await runSingleCase({
      name: "missing-tool",
      env: { ACME_SCENARIO: "missing-tool" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("RECOVERY_COMMAND_FAILED");
  });

  it("marks unexpected success as NO_FAILURE, not a pass", async () => {
    const result = await runSingleCase({
      name: "no-failure",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("status") },
      failure: { exitCode: "nonzero" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("NO_FAILURE");
  });

  it("marks wrong failure output as FAILURE_MISMATCH", async () => {
    const result = await runSingleCase({
      name: "mismatch",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero", stderr: { contains: "this text never appears" } },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("FAILURE_MISMATCH");
  });
});
