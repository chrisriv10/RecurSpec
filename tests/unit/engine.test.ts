import { describe, expect, it } from "vitest";
import { deriveRecoveryPlan } from "../../src/recovery/engine.js";
import type { RecoveryCase } from "../../src/types/config.js";
import type { ExecutedCommand } from "../../src/types/result.js";

function failure(stdout: string): ExecutedCommand {
  return {
    command: "acme",
    args: ["deploy"],
    exitCode: 2,
    stdout,
    stderr: "",
    durationMs: 1,
    timedOut: false,
    cwd: "/tmp/x"
  };
}

function structuredCase(): RecoveryCase {
  return {
    name: "structured",
    run: { command: "acme", args: ["deploy"] },
    recovery: { source: "structured", format: "json" }
  };
}

describe("structured recovery plans", () => {
  it("treats an explicitly ordered command array as a required sequence", () => {
    const payload = {
      code: "NEEDS_CONFIG",
      recovery: {
        sequence: true,
        commands: [
          ["acme", "config", "--set", "email", "dev@example.com"],
          ["acme", "config", "--set", "name", "Dev User"]
        ]
      }
    };
    const plan = deriveRecoveryPlan(structuredCase(), failure(JSON.stringify(payload)), { originalCommand: "acme" });
    expect(plan.kind).toBe("sequence");
    if (plan.kind !== "sequence") return;
    expect(plan.candidates.map((candidate) => candidate.args.slice(0, 3).join(" "))).toEqual([
      "config --set email",
      "config --set name"
    ]);
    expect(plan.evidence).toContain("sequence");
    expect(plan.candidates.map((candidate) => candidate.group?.index)).toEqual([0, 1]);
  });

  it("preserves declaration order even when ranking prefers another executable", () => {
    const payload = {
      recovery: {
        sequence: true,
        commands: [
          ["npm", "run", "build"],
          ["git", "config", "user.email", "dev@example.com"]
        ]
      }
    };
    const plan = deriveRecoveryPlan(structuredCase(), failure(JSON.stringify(payload)), { originalCommand: "git" });
    expect(plan.kind).toBe("sequence");
    if (plan.kind !== "sequence") return;
    expect(plan.candidates.map((candidate) => candidate.command)).toEqual(["npm", "git"]);
  });

  it("preserves declaration order for object-form commands", () => {
    const payload = {
      recovery: {
        sequence: true,
        commands: [
          { command: "npm", args: ["run", "build"] },
          { command: "git", args: ["config", "user.email", "dev@example.com"] }
        ]
      }
    };
    const plan = deriveRecoveryPlan(structuredCase(), failure(JSON.stringify(payload)), { originalCommand: "git" });
    expect(plan.kind).toBe("sequence");
    if (plan.kind !== "sequence") return;
    expect(plan.candidates.map((candidate) => candidate.command)).toEqual(["npm", "git"]);
  });

  it("keeps multi-command arrays without an explicit sequence marker ambiguous", () => {
    const payload = {
      recovery: {
        commands: [
          ["acme", "config", "--set", "email", "dev@example.com"],
          ["acme", "config", "--set", "name", "Dev User"]
        ]
      }
    };
    const plan = deriveRecoveryPlan(structuredCase(), failure(JSON.stringify(payload)), { originalCommand: "acme" });
    expect(plan.kind).toBe("ambiguous");
  });

  it("keeps a single structured command on the single-candidate path", () => {
    const payload = { recovery: { commands: [["acme", "init"]] } };
    const plan = deriveRecoveryPlan(structuredCase(), failure(JSON.stringify(payload)), { originalCommand: "acme" });
    expect(plan.kind).toBe("candidate");
  });
});
