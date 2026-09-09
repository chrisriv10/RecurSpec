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
