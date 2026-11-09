import { describe, expect, it } from "vitest";
import { checkCommandSafety } from "../../src/safety/command-check.js";
import { isDangerousWorkspacePath, isPathInside } from "../../src/safety/paths.js";

describe("checkCommandSafety", () => {
  it("allows ordinary commands", () => {
    expect(checkCommandSafety("acme", ["init"]).ok).toBe(true);
    expect(checkCommandSafety("node", ["script.mjs"]).ok).toBe(true);
  });

  it("blocks sudo and friends unconditionally", () => {
    expect(checkCommandSafety("sudo", ["rm", "-rf", "/"]).ok).toBe(false);
    expect(checkCommandSafety("shutdown", []).ok).toBe(false);
    expect(checkCommandSafety("mkfs", ["-t", "ext4"]).ok).toBe(false);
  });

  it("blocks curl-piped-to-shell", () => {
    expect(checkCommandSafety("curl", ["https://example.com/x", "|", "sh"]).ok).toBe(false);
  });

  it("blocks chaining, pipes, and redirection by default", () => {
    expect(checkCommandSafety("acme", ["init", "&&", "deploy"]).ok).toBe(false);
    expect(checkCommandSafety("acme", ["a", "|", "b"]).ok).toBe(false);
    expect(checkCommandSafety("acme", ["a", ">", "out.txt"]).ok).toBe(false);
  });

  it("honours deny and allow lists", () => {
    expect(checkCommandSafety("rm", ["-rf", "x"], { deniedCommands: ["rm"] }).ok).toBe(false);
    expect(checkCommandSafety("npm", ["install"], { allowedCommands: ["npm"] }).ok).toBe(true);
    expect(checkCommandSafety("yarn", ["install"], { allowedCommands: ["npm"] }).ok).toBe(false);
  });

  it("blocks rm of the filesystem root and parent traversal", () => {
    expect(checkCommandSafety("rm", ["-rf", "/"]).ok).toBe(false);
    expect(checkCommandSafety("rm", ["../other"]).ok).toBe(false);
  });

  it("explains why in the reason", () => {
    const res = checkCommandSafety("sudo", ["x"]);
    expect(res.ok).toBe(false);
    expect(res.reason ?? "").toMatch(/sudo|dangerous/i);
  });
});

describe("isDangerousWorkspacePath", () => {
  it("rejects traversal and absolute paths", () => {
    expect(isDangerousWorkspacePath("../../etc")).toBe(true);
    expect(isDangerousWorkspacePath("/etc/passwd")).toBe(true);
    expect(isDangerousWorkspacePath("C:\\Windows")).toBe(true);
    expect(isDangerousWorkspacePath("a/../../b")).toBe(true);
  });

  it("accepts normal relative paths", () => {
    expect(isDangerousWorkspacePath("fixtures/basic-project/**")).toBe(false);
    expect(isDangerousWorkspacePath(".acme/config.json")).toBe(false);
    expect(isDangerousWorkspacePath(".")).toBe(false);
  });

  it("accepts legitimate dot-prefixed directories such as ..cache", () => {
    expect(isDangerousWorkspacePath("..cache/file.txt")).toBe(false);
    expect(isDangerousWorkspacePath(".cache/file.txt")).toBe(false);
  });

  it("still rejects parent traversal", () => {
    expect(isDangerousWorkspacePath("../outside")).toBe(true);
    expect(isDangerousWorkspacePath("a/../../b")).toBe(true);
  });
});

describe("isPathInside", () => {
  const root = "/workspace";

  it("accepts the root itself", () => {
    expect(isPathInside(root, root)).toBe(true);
  });

  it("accepts paths inside the workspace", () => {
    expect(isPathInside(root, "/workspace/sub/file")).toBe(true);
    expect(isPathInside(root, "/workspace/..cache/file.txt")).toBe(true);
    expect(isPathInside(root, "/workspace/.cache/file.txt")).toBe(true);
  });

  it("rejects parent traversal and outside paths", () => {
    expect(isPathInside(root, "/workspace/..")).toBe(false);
    expect(isPathInside(root, "/outside")).toBe(false);
    expect(isPathInside(root, "/tmp/other")).toBe(false);
    expect(isPathInside(root, "/etc/passwd")).toBe(false);
  });

  it("rejects absolute paths outside the workspace", () => {
    expect(isPathInside(root, "/etc/passwd")).toBe(false);
    expect(isPathInside(root, "/tmp/other")).toBe(false);
  });
});
