import { describe, expect, it } from "vitest";
import os from "node:os";
import { checkExitCode, checkStream } from "../../src/assertions/output.js";
import { checkFiles } from "../../src/assertions/files.js";

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

describe("checkFiles", () => {
  const dir = os.tmpdir();

  it("reports missing and present files without throwing", async () => {
    const details = await checkFiles(dir, {
      exists: ["definitely-missing-" + process.pid],
      notExists: ["definitely-missing-" + process.pid]
    });
    expect(details).toEqual([
      { ok: false, kind: "files.exists", message: expect.stringContaining("Expected file to exist") },
      { ok: true, kind: "files.notExists", message: expect.stringContaining("correctly absent") }
    ]);
  });

  it("reports an out-of-workspace notExists path as a failed check, not a crash", async () => {
    const details = await checkFiles(dir, { notExists: ["../outside"] });
    expect(details).toHaveLength(1);
    expect(details[0]?.ok).toBe(false);
    expect(details[0]?.kind).toBe("files.notExists");
    expect(details[0]?.message).toContain("outside the workspace");
  });
});
