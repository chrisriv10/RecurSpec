import { describe, expect, it } from "vitest";
import { parseReport, validateManifest } from "../../scripts/lib/real-world-report.mjs";

describe("real-world report parser", () => {
  it("accepts a well-formed report and keeps name/status pairs", () => {
    const parsed = parseReport(JSON.stringify({ version: 1, cases: [{ name: "a", status: "PASS" }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.report.cases).toEqual([{ name: "a", status: "PASS" }]);
  });

  it("rejects empty stdout", () => {
    expect(parseReport("  \n")).toMatchObject({ ok: false, reason: "stdout was empty" });
  });

  it("rejects non-JSON stdout", () => {
    expect(parseReport("Error: unknown option --format")).toMatchObject({
      ok: false,
      reason: "stdout was not JSON"
    });
  });

  it("reports a CLI error envelope instead of crashing", () => {
    const parsed = parseReport(JSON.stringify({ error: "config file not found" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("error envelope");
    expect(parsed.reason).toContain("config file not found");
  });

  it("rejects JSON that is not a case report", () => {
    expect(parseReport(JSON.stringify({ version: 1 }))).toMatchObject({
      ok: false,
      reason: "report has no cases array"
    });
    expect(parseReport(JSON.stringify([]))).toMatchObject({
      ok: false,
      reason: "report was not a JSON object"
    });
  });

  it("rejects malformed case entries", () => {
    expect(parseReport(JSON.stringify({ cases: [null] }))).toMatchObject({
      ok: false,
      reason: "report contains a malformed case"
    });
    expect(parseReport(JSON.stringify({ cases: [{ status: "PASS" }] }))).toMatchObject({
      ok: false,
      reason: "report case is missing a name"
    });
    expect(parseReport(JSON.stringify({ cases: [{ name: "a" }] }))).toMatchObject({
      ok: false,
      reason: "report case a is missing a status"
    });
  });
});

describe("real-world expectation manifest", () => {
  const valid = {
    tool: "git",
    requiredBinaries: ["git"],
    config: "recurspec.yml",
    expected: { "git-case": "PASS" }
  };

  it("accepts a valid manifest", () => {
    expect(validateManifest(valid)).toEqual({ ok: true });
  });

  it("rejects a missing or malformed expected map", () => {
    expect(validateManifest({ ...valid, expected: undefined })).toMatchObject({ ok: false });
    expect(validateManifest({ ...valid, expected: [] })).toMatchObject({ ok: false });
    expect(validateManifest({ ...valid, expected: { case: 1 } })).toMatchObject({
      ok: false,
      reason: "expect.json expected.case must be a status string"
    });
  });

  it("rejects malformed required binaries and config names", () => {
    expect(validateManifest({ ...valid, requiredBinaries: "git" })).toMatchObject({ ok: false });
    expect(validateManifest({ ...valid, requiredBinaries: ["git", 1] })).toMatchObject({ ok: false });
    expect(validateManifest({ ...valid, config: "" })).toMatchObject({
      ok: false,
      reason: "expect.json config must be a non-empty string"
    });
    expect(validateManifest(null)).toMatchObject({ ok: false });
  });
});
