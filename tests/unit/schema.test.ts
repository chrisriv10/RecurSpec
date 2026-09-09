import { describe, expect, it } from "vitest";
import { validateConfigObject } from "../../src/config/schema.js";

describe("validateConfigObject", () => {
  it("accepts a minimal valid config", () => {
    const res = validateConfigObject({
      version: 1,
      cases: [{ name: "x", run: { command: "acme", args: ["deploy"] } }]
    });
    expect(res.ok).toBe(true);
  });

  it("reports bad maxHops with a path", () => {
    const res = validateConfigObject({
      version: 1,
      cases: [
        {
          name: "x",
          run: { command: "acme" },
          recovery: { maxHops: 20 }
        }
      ]
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.some((i) => i.path.includes("maxHops"))).toBe(true);
    }
  });

  it("requires run.command and case names", () => {
    const res = validateConfigObject({ version: 1, cases: [{ name: "x" }] });
    expect(res.ok).toBe(false);
  });

  it("rejects configs without cases", () => {
    expect(validateConfigObject({ version: 1, cases: [] }).ok).toBe(false);
  });
});
