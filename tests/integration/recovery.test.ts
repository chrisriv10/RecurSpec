import { describe, expect, it } from "vitest";
import { acmeArgs, runSingleCase } from "../helpers/acme.js";
import type { RecoveryCase } from "../../src/types/config.js";
import type { CaseResult } from "../../src/types/result.js";

const BT = String.fromCharCode(96);

function fakeCase(script: string, overrides: Partial<RecoveryCase> & { name: string }): Promise<CaseResult> {
  return runSingleCase({
    workspace: { write: { "fake.mjs": script } },
    run: { command: process.execPath, args: ["fake.mjs", "original"] },
    failure: { exitCode: "nonzero" },
    recovery: { source: "output", maxHops: 4 },
    verify: { rerunOriginal: true, exitCode: 0 },
    ...overrides
  });
}

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

  it("runs a required multi-command sequence in order", async () => {
    const result = await runSingleCase({
      name: "sequence",
      env: { ACME_SCENARIO: "sequence" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero", stderr: { contains: "Missing account configuration" } },
      recovery: { source: "output", maxHops: 3 },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("PASS");
    expect(result.hops).toBe(2);
    const executed = result.recoverySteps.map((step) => step.args.join(" "));
    expect(executed).toHaveLength(2);
    expect(executed[0]).toContain("--set email");
    expect(executed[1]).toContain("--set name");
    expect(result.decision?.kind).toBe("sequence");
    expect(result.decision?.candidates.every((candidate) => candidate.selected)).toBe(true);
  });

  it("refuses to run a partial required sequence when the hop budget is too small", async () => {
    const result = await runSingleCase({
      name: "sequence-budget",
      env: { ACME_SCENARIO: "sequence" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "output", maxHops: 1 },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("RECOVERY_COMMAND_FAILED");
    expect(result.recoverySteps).toHaveLength(0);
    expect(result.failureDetail ?? "").toContain("refuses to run a partial required sequence");
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
    expect(result.decision?.kind).toBe("ambiguous");
  });

  it("does not execute an alternative even when one option ranks higher", async () => {
    const result = await runSingleCase({
      name: "ambiguous-confidence",
      env: { ACME_SCENARIO: "ambiguous-confidence" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" },
      recovery: { source: "output" },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("AMBIGUOUS_RECOVERY");
    expect(result.recoverySteps).toHaveLength(0);
    expect(result.decision?.evidence ?? "").toContain("or");
    expect(result.decision?.candidates.every((candidate) => !candidate.selected)).toBe(true);
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

describe("required recovery sequence execution", () => {
  it("keeps running the queue when a chained step succeeds silently", async () => {
    const script =
      'import fs from "node:fs";\n' +
      'const mode = process.argv[2];\n' +
      'if (mode === "original") {\n' +
      '  if (fs.existsSync("b.txt")) process.exit(0);\n' +
      '  process.stderr.write("Fix: Run ' + BT + 'node fake.mjs bootstrap' + BT + '\\n");\n' +
      "  process.exit(1);\n" +
      "}\n" +
      'if (mode === "bootstrap") {\n' +
      '  process.stdout.write("Run ' + BT + 'node fake.mjs a' + BT + ' then ' + BT + 'node fake.mjs b' + BT + '\\n");\n' +
      "  process.exit(0);\n" +
      "}\n" +
      'if (mode === "a" || mode === "b") {\n' +
      '  fs.writeFileSync(mode + ".txt", "x");\n' +
      "  process.exit(0);\n" +
      "}\n" +
      "process.exit(2);\n";
    const result = await fakeCase(script, { name: "silent-chain" });
    expect(result.status).toBe("PASS");
    expect(result.recoverySteps.map((step) => step.args[1])).toEqual(["bootstrap", "a", "b"]);
    expect(result.hops).toBe(3);
    const selected = result.decision?.candidates.filter((candidate) => candidate.selected) ?? [];
    expect(selected.map((candidate) => candidate.reason.match(/step (\d+) of (\d+)/)?.slice(1).join("/"))).toEqual([
      "1/3",
      "2/3",
      "3/3"
    ]);
  });

  it("appends a nested required sequence after the pending steps", async () => {
    const script =
      'import fs from "node:fs";\n' +
      'const mode = process.argv[2];\n' +
      "const done = ['s1', 's2', 'n1', 'n2'].every((name) => fs.existsSync(name + '.txt'));\n" +
      'if (mode === "original") {\n' +
      "  if (done) process.exit(0);\n" +
      '  process.stderr.write("Fix: Run ' + BT + 'node fake.mjs s1' + BT + ' then ' + BT + 'node fake.mjs s2' + BT + '\\n");\n' +
      "  process.exit(1);\n" +
      "}\n" +
      'if (mode === "s1") {\n' +
      '  process.stdout.write("Then run ' + BT + 'node fake.mjs n1' + BT + ' then ' + BT + 'node fake.mjs n2' + BT + '\\n");\n' +
      '  fs.writeFileSync("s1.txt", "x");\n' +
      "  process.exit(0);\n" +
      "}\n" +
      'if (mode === "s2" || mode === "n1" || mode === "n2") {\n' +
      '  fs.writeFileSync(mode + ".txt", "x");\n' +
      "  process.exit(0);\n" +
      "}\n" +
      "process.exit(2);\n";
    const result = await fakeCase(script, { name: "nested-chain" });
    expect(result.status).toBe("PASS");
    expect(result.recoverySteps.map((step) => step.args[1])).toEqual(["s1", "s2", "n1", "n2"]);
    expect(result.hops).toBe(4);
  });

  it("fails instead of passing when a chained sequence exceeds the remaining budget", async () => {
    const script =
      'import fs from "node:fs";\n' +
      'const mode = process.argv[2];\n' +
      'if (mode === "original") {\n' +
      '  if (fs.existsSync("bootstrap.txt")) process.exit(0);\n' +
      '  process.stderr.write("Fix: Run ' + BT + 'node fake.mjs bootstrap' + BT + '\\n");\n' +
      "  process.exit(1);\n" +
      "}\n" +
      'if (mode === "bootstrap") {\n' +
      '  fs.writeFileSync("bootstrap.txt", "x");\n' +
      '  process.stdout.write("Run ' + BT + 'node fake.mjs a' + BT + ' then ' + BT + 'node fake.mjs b' + BT + '\\n");\n' +
      "  process.exit(0);\n" +
      "}\n" +
      'if (mode === "a" || mode === "b") process.exit(0);\n' +
      "process.exit(2);\n";
    const result = await fakeCase(script, {
      name: "chained-over-budget",
      recovery: { source: "output", maxHops: 2 }
    });
    expect(result.status).toBe("RECOVERY_COMMAND_FAILED");
    expect(result.hops).toBe(1);
    expect(result.failureDetail ?? "").toContain("refuses to run a partial required sequence");
    expect(result.verification).toHaveLength(0);
  });

  it("preflights an initial required sequence before executing its first member", async () => {
    const script =
      'const mode = process.argv[2];\n' +
      'if (mode === "original") {\n' +
      '  process.stderr.write("Fix: Run ' + BT + 'node fake.mjs ok' + BT + ' then ' + BT + 'sudo rm -rf /' + BT + '\\n");\n' +
      "  process.exit(1);\n" +
      "}\n" +
      "process.exit(0);\n";
    const result = await fakeCase(script, { name: "initial-safety-preflight" });
    expect(result.status).toBe("BLOCKED_RECOVERY");
    expect(result.recoverySteps).toHaveLength(0);
    expect(result.blockedReason ?? "").toMatch(/sudo|dangerous|Blocked/i);
  });

  it("preflights a chained required sequence before executing its first member", async () => {
    const script =
      'import fs from "node:fs";\n' +
      'const mode = process.argv[2];\n' +
      'if (mode === "original") {\n' +
      '  if (fs.existsSync("bootstrap.txt")) process.exit(0);\n' +
      '  process.stderr.write("Fix: Run ' + BT + 'node fake.mjs bootstrap' + BT + '\\n");\n' +
      "  process.exit(1);\n" +
      "}\n" +
      'if (mode === "bootstrap") {\n' +
      '  fs.writeFileSync("bootstrap.txt", "x");\n' +
      '  process.stdout.write("Then run ' + BT + 'node fake.mjs ok' + BT + ' then ' + BT + 'sudo rm -rf /' + BT + '\\n");\n' +
      "  process.exit(0);\n" +
      "}\n" +
      "process.exit(0);\n";
    const result = await fakeCase(script, { name: "chained-safety-preflight" });
    expect(result.status).toBe("BLOCKED_RECOVERY");
    expect(result.recoverySteps.map((step) => step.args[1])).toEqual(["bootstrap"]);
    expect(result.blockedReason ?? "").toMatch(/sudo|dangerous|Blocked/i);
  });

  it("refuses to truncate explicit recovery steps to maxHops", async () => {
    const script =
      'const mode = process.argv[2];\n' +
      'if (mode === "original") process.exit(1);\n' +
      "process.exit(0);\n";
    const result = await fakeCase(script, {
      name: "explicit-over-budget",
      recovery: {
        maxHops: 1,
        steps: [
          { command: process.execPath, args: ["fake.mjs", "s1"] },
          { command: process.execPath, args: ["fake.mjs", "s2"] }
        ]
      },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("RECOVERY_COMMAND_FAILED");
    expect(result.recoverySteps).toHaveLength(0);
    expect(result.failureDetail ?? "").toContain("silently truncate");
  });

  it("preflights explicit recovery steps before executing the first one", async () => {
    const script =
      'const mode = process.argv[2];\n' +
      'if (mode === "original") process.exit(1);\n' +
      "process.exit(0);\n";
    const result = await fakeCase(script, {
      name: "explicit-safety-preflight",
      recovery: {
        maxHops: 3,
        steps: [
          { command: process.execPath, args: ["fake.mjs", "ok"] },
          { command: "sudo", args: ["rm", "-rf", "/"] }
        ]
      },
      verify: { rerunOriginal: true, exitCode: 0 }
    });
    expect(result.status).toBe("BLOCKED_RECOVERY");
    expect(result.recoverySteps).toHaveLength(0);
    expect(result.blockedReason ?? "").toMatch(/sudo|dangerous|Blocked/i);
  });
});
