import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveExecutable } from "../../src/runner/resolve-exe.js";

describe("resolveExecutable", () => {
  it("resolves the current node binary through PATH", () => {
    const dir = path.dirname(process.execPath);
    const base = path.basename(process.execPath).replace(/\.(exe|cmd|bat)$/i, "");
    const found = resolveExecutable(base, { PATH: dir });
    expect(found).not.toBeNull();
  });

  it("returns null for missing binaries", () => {
    expect(resolveExecutable("recurspec-definitely-not-a-real-binary", { PATH: "/usr/bin" })).toBeNull();
    expect(resolveExecutable("", { PATH: "/usr/bin" })).toBeNull();
    expect(resolveExecutable("   ", { PATH: "/usr/bin" })).toBeNull();
  });

  it("checks relative paths with separators directly", () => {
    expect(resolveExecutable("./does-not-exist-xyz", { PATH: "/usr/bin" })).toBeNull();
    expect(resolveExecutable(process.execPath, {})).toBe(process.execPath);
  });
});
