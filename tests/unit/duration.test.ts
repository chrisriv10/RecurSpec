import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "../../src/config/duration.js";

describe("parseDuration", () => {
  it("parses milliseconds, seconds, minutes, hours", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("10s")).toBe(10000);
    expect(parseDuration("2m")).toBe(120000);
    expect(parseDuration("1h")).toBe(3600000);
  });

  it("defaults bare numbers to seconds", () => {
    expect(parseDuration("5")).toBe(5000);
  });

  it("rejects garbage with an actionable message", () => {
    expect(() => parseDuration("soon")).toThrow(/500ms/);
    expect(() => parseDuration("")).toThrow();
    expect(() => parseDuration("-5s")).toThrow();
  });
});

describe("formatDuration", () => {
  it("formats ms, seconds, minutes", () => {
    expect(formatDuration(182)).toBe("182ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(120000)).toBe("2m");
  });
});
