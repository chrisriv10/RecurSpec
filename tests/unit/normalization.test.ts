import { describe, expect, it } from "vitest";
import { normalizeOutput, signatureFor } from "../../src/normalization/output.js";
import { LoopDetector } from "../../src/recovery/loop-detection.js";

describe("normalizeOutput", () => {
  it("normalizes temp dirs so reruns compare equal", () => {
    const a = normalizeOutput("failed in /tmp/recoveryspec-123/.acme");
    const b = normalizeOutput("failed in /tmp/recoveryspec-456/.acme");
    expect(a).toBe(b);
  });

  it("normalizes uuids and timestamps", () => {
    expect(normalizeOutput("id 123e4567-e89b-12d3-a456-426614174000 done")).toContain("<uuid>");
    expect(normalizeOutput("at 2024-01-02T03:04:05Z oops")).toContain("<timestamp>");
  });
});

describe("LoopDetector", () => {
  it("detects a repeated command plus normalized error", () => {
    const detector = new LoopDetector();
    expect(detector.check("acme", ["login"], "err in /tmp/recoveryspec-1")).toBe(false);
    expect(detector.check("acme", ["login"], "err in /tmp/recoveryspec-2")).toBe(true);
  });

  it("treats different errors as different states", () => {
    const detector = new LoopDetector();
    expect(detector.check("acme", ["login"], "error A")).toBe(false);
    expect(detector.check("acme", ["login"], "error B")).toBe(false);
  });
});
