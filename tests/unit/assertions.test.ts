import { describe, expect, it } from "vitest";
import { checkExitCode, checkStream } from "../../src/assertions/output.js";

describe("checkExitCode", () => {
  it("handles zero, nonzero, and exact codes", () => {
    expect(checkExitCode(1, "nonzero").ok).toBe(true);
    expect(checkExitCode(0, "nonzero").ok).toBe(false);
    expect(checkExitCode(0, "zero").ok).toBe(true);
    expect(checkExitCode(2, 2).ok).toBe(true);
    expect(checkExitCode(1, 2).ok).toBe(false);
    expect(checkExitCode(null, "nonzero").ok).toBe(false);
  });
});

describe("checkStream", () => {
  it("checks contains, notContains, and regex matches", () => {
    expect(checkStream("stderr", "hello world", { contains: "hello" }).ok).toBe(true);
    expect(checkStream("stderr", "hello world", { contains: "bye" }).ok).toBe(false);
    expect(checkStream("stderr", "hello world", { notContains: "bye" }).ok).toBe(true);
    expect(checkStream("stderr", "hello world", { notContains: "hello" }).ok).toBe(false);
    expect(checkStream("stderr", "code 42", { matches: "code \\d+" }).ok).toBe(true);
    expect(checkStream("stderr", "code x", { matches: "code \\d+" }).ok).toBe(false);
  });

  it("supports arrays and reports invalid regexes", () => {
    const res = checkStream("stderr", "a and b", { contains: ["a", "b"] });
    expect(res.ok).toBe(true);
    const bad = checkStream("stderr", "a", { matches: "([" });
    expect(bad.ok).toBe(false);
  });
});
