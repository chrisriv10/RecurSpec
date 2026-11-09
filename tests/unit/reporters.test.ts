import { describe, expect, it } from "vitest";
import { buildRunResult } from "../../src/reporting/summary.js";
import { renderJson } from "../../src/reporting/json-reporter.js";
import { renderJUnit } from "../../src/reporting/junit.js";
import { renderMarkdown } from "../../src/reporting/markdown.js";
import { renderTerminal } from "../../src/reporting/terminal.js";
import type { CaseResult } from "../../src/types/result.js";

function stubCase(overrides: Partial<CaseResult> & { name: string; status: CaseResult["status"] }): CaseResult {
  return {
    description: undefined,
    tags: undefined,
    durationMs: 100,
    hops: 1,
    originalCommand: "acme deploy",
    initialFailure: null,
    failureMatched: true,
    failureDetail: undefined,
    extractedAdvice: [],
    selectedAdvice: null,
    recoverySteps: [],
    blockedReason: undefined,
    verification: [],
    completion: { mode: "retry", verified: true },
    safetyEvaluations: [],
    verifyOk: true,
    trace: { nodes: [], edges: [], path: ["acme deploy"] },
    warnings: [],
    workspace: undefined,
    error: undefined,
    ...overrides
  };
}

const passing = stubCase({ name: "ok-case", status: "PASS", hops: 1, durationMs: 182 });
const failing = stubCase({
  name: "bad-case",
  status: "RECOVERY_DEAD_END",
  hops: 1,
  durationMs: 441,
  failureDetail: "still broken"
});

describe("reporters", () => {
  it("json output preserves exact status codes", () => {
    const result = buildRunResult([passing, failing], []);
    const parsed = JSON.parse(renderJson(result)) as { cases: Array<{ status: string }> };
    expect(parsed.cases.map((c) => c.status)).toEqual(["PASS", "RECOVERY_DEAD_END"]);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("version", 1);
  });

  it("junit marks failures as failed test cases", () => {
    const result = buildRunResult([passing, failing], []);
    const xml = renderJUnit(result);
    expect(xml).toContain("<testsuite");
    expect(xml).toContain("failures=\"1\"");
    expect(xml).toContain("bad-case");
    expect(xml).toContain("RECOVERY_DEAD_END");
  });

  it("markdown renders a result table", () => {
    const result = buildRunResult([passing, failing], []);
    const md = renderMarkdown(result);
    expect(md).toContain("| Result | Case | Recovery |");
    expect(md).toContain("ok-case");
  });

  it("markdown renders ambiguous candidate commands in the recovery cell", () => {
    const ambiguous = stubCase({
      name: "ambiguous-case",
      status: "AMBIGUOUS_RECOVERY",
      originalCommand: "acme sync",
      extractedAdvice: [
        { command: "git", args: ["checkout", "main"], raw: "git checkout main", source: "stderr", line: 2, confidence: 0.8, pattern: "hint-colon" },
        { command: "git", args: ["switch", "main"], raw: "git switch main", source: "stderr", line: 3, confidence: 0.8, pattern: "hint-colon" }
      ],
      decision: {
        kind: "ambiguous",
        evidence: "three exclusive options",
        candidates: []
      }
    });
    const md = renderMarkdown(buildRunResult([ambiguous], []));
    expect(md).toContain("| ❌ | ambiguous-case |");
    expect(md).toContain("AMBIGUOUS_RECOVERY after 'acme sync': 'git checkout main', 'git switch main'");
    expect(md).toContain("three exclusive options");
  });

  it("junit failures include completion mode, recovery chain, and decision evidence", () => {
    const failedSequence = stubCase({
      name: "sequence-case",
      status: "RECOVERY_COMMAND_FAILED",
      originalCommand: "git commit -m test",
      completion: { mode: "retry", verified: false },
      recoverySteps: [
        {
          command: "git",
          args: ["config", "user.email", "a@b.c"],
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
          cwd: "/tmp/x"
        }
      ],
      decision: {
        kind: "sequence",
        evidence: "commands listed after a bare Run label",
        candidates: [
          {
            command: "git",
            args: ["config", "user.name", "A"],
            source: "stderr",
            line: 8,
            pattern: "run-continuation",
            confidence: 0.8,
            rank: 2,
            selected: false,
            reason: "confidence 0.80. not executed: sequence failed"
          }
        ]
      }
    });
    const xml = renderJUnit(buildRunResult([failedSequence], []));
    expect(xml).toContain("Completion: retry (verified: false)");
    expect(xml).toContain("Recovery chain: git commit -m test -&gt; git config user.email a@b.c");
    expect(xml).toContain("Recovery decision: sequence - commands listed after a bare Run label");
    expect(xml).toContain("Candidate rejected: git config user.name A");

    const text = renderTerminal(buildRunResult([failedSequence], []), { version: "0.1.0", verbose: true });
    expect(text).toContain("evidence: commands listed after a bare Run label");
    expect(text).toContain("2. git config user.name A");
    expect(text).toContain("ranking: confidence 0.80");
  });

  it("terminal output groups failures with status", () => {
    const result = buildRunResult([passing, failing], []);
    const text = renderTerminal(result, { version: "0.1.0" });
    expect(text).toContain("1 recovery contracts".replace("1", "2"));
    expect(text).toContain("Status: RECOVERY_DEAD_END");
  });

  it("summary computes recovery rate over valid failure states only", () => {
    const invalid = stubCase({ name: "no-fail", status: "NO_FAILURE", failureMatched: false });
    const result = buildRunResult([passing, invalid], []);
    expect(result.summary.recoveryRate).toBe(100);
    const empty = buildRunResult([invalid], []);
    expect(empty.summary.recoveryRate).toBeNull();
  });
});
