import { describe, expect, it } from "vitest";
import { validateConfigObject } from "../../src/config/schema.js";

function configWithVerify(verify: object) {
  return {
    version: 1,
    cases: [{ name: "x", run: { command: "tool" }, verify }]
  };
}

function messages(result: { ok: false; issues: Array<{ path: string; message: string }> }): string[] {
  return result.issues.map((i) => i.path + ": " + i.message);
}

describe("verify mode validation", () => {
  it("accepts explicit retry mode", () => {
    const res = validateConfigObject(configWithVerify({ mode: "retry", exitCode: 0 }));
    expect(res.ok).toBe(true);
  });

  it("accepts goal mode with assertions", () => {
    const res = validateConfigObject(configWithVerify({ mode: "goal", files: { exists: ["a"] } }));
    expect(res.ok).toBe(true);
  });

  it("accepts custom mode with commands", () => {
    const res = validateConfigObject(
      configWithVerify({ mode: "custom", commands: [{ command: "tool", args: ["status"] }] })
    );
    expect(res.ok).toBe(true);
  });

  it("rejects goal mode combined with rerunOriginal:true", () => {
    const res = validateConfigObject(configWithVerify({ mode: "goal", rerunOriginal: true, files: { exists: ["a"] } }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(messages(res).join("\n")).toMatch(/mode is "goal".*rerunOriginal is true/s);
    }
  });

  it("rejects custom mode combined with rerunOriginal:true", () => {
    const res = validateConfigObject(configWithVerify({ mode: "custom", rerunOriginal: true }));
    expect(res.ok).toBe(false);
  });

  it("rejects retry mode combined with rerunOriginal:false", () => {
    const res = validateConfigObject(configWithVerify({ mode: "retry", rerunOriginal: false }));
    expect(res.ok).toBe(false);
  });

  it("rejects goal mode without any goal assertion", () => {
    const res = validateConfigObject(configWithVerify({ mode: "goal" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(messages(res).join("\n")).toMatch(/at least one goal assertion/);
    }
  });

  it("rejects custom mode without any postcondition", () => {
    const res = validateConfigObject(configWithVerify({ mode: "custom" }));
    expect(res.ok).toBe(false);
  });

  it("rejects exitCode together with goal mode", () => {
    const res = validateConfigObject(configWithVerify({ mode: "goal", exitCode: 0, files: { exists: ["a"] } }));
    expect(res.ok).toBe(false);
  });

  it("keeps legacy configs valid", () => {
    expect(validateConfigObject(configWithVerify({ rerunOriginal: true, exitCode: 0 })).ok).toBe(true);
    expect(validateConfigObject(configWithVerify({ rerunOriginal: false })).ok).toBe(true);
    expect(validateConfigObject(configWithVerify({})).ok).toBe(true);
    expect(
      validateConfigObject({
        version: 1,
        cases: [{ name: "x", run: { command: "tool" } }]
      }).ok
    ).toBe(true);
  });

  it("rejects unknown modes", () => {
    const res = validateConfigObject(configWithVerify({ mode: "skipRetry" }));
    expect(res.ok).toBe(false);
  });
});
