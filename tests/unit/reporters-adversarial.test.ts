import { describe, expect, it } from "vitest";
import { buildRunResult } from "../../src/reporting/summary.js";
import { renderJson } from "../../src/reporting/json-reporter.js";
import { renderJUnit } from "../../src/reporting/junit.js";
import { renderMarkdown } from "../../src/reporting/markdown.js";
import { renderTerminal } from "../../src/reporting/terminal.js";
import type { CaseResult, RunResult } from "../../src/types/result.js";

function nastyCase(overrides: Partial<CaseResult> & { name: string; status: CaseResult["status"] }): CaseResult {
  return {
    description: undefined,
    tags: undefined,
    durationMs: 100,
    hops: 1,
    originalCommand: "acme deploy",
    initialFailure: {
      command: "acme",
      args: ["deploy", "--msg", "<xml>&\"'"],
      exitCode: 2,
      stdout: "",
      stderr: "line one\nline two  end <tag> & \"quoted\"",
      durationMs: 10,
      timedOut: false,
      cwd: "/tmp/x"
    },
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

const MIXED: CaseResult[] = [
  nastyCase({ name: "donn\u00e9es-\u00e9t\u00e9", status: "PASS" }),
  nastyCase({ name: "pipe|name", status: "TIMEOUT" }),
  nastyCase({ name: "loop<case>", status: "RECOVERY_LOOP" }),
  nastyCase({ name: "blocked&case", status: "BLOCKED_RECOVERY", blockedReason: "nope <because>" }),
  nastyCase({ name: "ambiguous\"case\"", status: "AMBIGUOUS_RECOVERY" }),
  nastyCase({ name: "nofail", status: "NO_FAILURE", failureMatched: false })
];

function build(): RunResult {
  return buildRunResult(MIXED, []);
}

describe("reporter correctness on hostile input", () => {
  it("junit escapes markup, drops illegal control chars, stays well-formed", () => {
    const xml = renderJUnit(build());
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml.trimEnd().endsWith("</testsuite>")).toBe(true);
    expect(xml).not.toContain("");
    expect(xml).toContain("loop&lt;case&gt;");
    expect(xml).toContain("blocked&amp;case");
    expect(xml).toContain("&lt;tag&gt; &amp; &quot;quoted&quot;");
    expect((xml.match(/<testcase /g) ?? []).length).toBe(MIXED.length);
    expect(xml).toContain("failures=\"5\"");
  });

  it("junit handles a zero-case run", () => {
    const xml = renderJUnit(buildRunResult([], []));
    expect(xml).toContain("tests=\"0\"");
    expect(xml).toContain("failures=\"0\"");
    expect(xml.trimEnd().endsWith("</testsuite>")).toBe(true);
  });

  it("markdown keeps one row per case even with pipes and newlines", () => {
    const md = renderMarkdown(build());
    const rows = md.split("\n").filter((l) => l.startsWith("| "));
    // header + one row per case (the |---|---| separator starts with "|" not "| ")
    expect(rows.length).toBe(MIXED.length + 1);
    expect(md).toContain("pipe\\|name");
    expect(md).not.toContain("<tag>");
  });

  it("json is stable and round-trips", () => {
    const result = build();
    expect(renderJson(result)).toBe(renderJson(result));
    const parsed = JSON.parse(renderJson(result)) as RunResult;
    expect(parsed.cases).toHaveLength(MIXED.length);
    expect(parsed.cases.map((c) => c.status)).toContain("AMBIGUOUS_RECOVERY");
    expect(parsed.summary.byStatus["TIMEOUT"]).toBe(1);
  });

  it("terminal renders every status without throwing", () => {
    const text = renderTerminal(build(), { verbose: true, version: "0.1.0" });
    for (const status of ["TIMEOUT", "RECOVERY_LOOP", "BLOCKED_RECOVERY", "AMBIGUOUS_RECOVERY", "NO_FAILURE"]) {
      expect(text).toContain("Status: " + status);
    }
    expect(text).toContain("Recovery path:");
  });
});
