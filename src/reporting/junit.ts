import type { RunResult, CaseResult } from "../types/result.js";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderJUnit(result: RunResult): string {
  const lines: string[] = [];
  lines.push("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
  lines.push(
    "<testsuite name=\"RecurSpec\" tests=\"" + result.summary.total + "\" failures=\"" + result.summary.failed + "\" errors=\"0\" skipped=\"0\">"
  );
  for (const c of result.cases) {
    lines.push("  <testcase classname=\"recurspec\" name=\"" + escapeXml(c.name) + "\" time=\"" + (c.durationMs / 1000).toFixed(3) + "\">");
    if (c.status !== "PASS") {
      lines.push("    <failure message=\"" + escapeXml(c.status + ": " + c.name) + "\">" + escapeXml(failureBody(c)) + "</failure>");
    }
    lines.push("  </testcase>");
  }
  lines.push("</testsuite>");
  return lines.join("\n") + "\n";
}

function failureBody(c: CaseResult): string {
  const parts: string[] = ["Status: " + c.status];
  if (c.failureDetail) parts.push("Detail: " + c.failureDetail);
  if (c.blockedReason) parts.push("Blocked: " + c.blockedReason);
  if (c.error) parts.push("Error: " + c.error);
  for (const v of c.verification.filter((vv) => !vv.ok)) parts.push("Verify: " + v.message);
  if (c.initialFailure) {
    const err = c.initialFailure.stderr || c.initialFailure.stdout;
    if (err.trim()) parts.push("Initial output:\n" + err.trim().slice(0, 2000));
  }
  return parts.join("\n");
}
