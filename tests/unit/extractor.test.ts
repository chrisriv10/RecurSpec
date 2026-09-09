import { describe, expect, it } from "vitest";
import { extractFromStreams } from "../../src/recovery/extractor.js";

describe("extractFromStreams", () => {
  it("finds inline backtick commands", () => {
    const found = extractFromStreams("", "Error! Run `acme init` to fix it.");
    expect(found.map((f) => f.command + " " + f.args.join(" "))).toContain("acme init");
    expect(found[0]?.pattern).toBe("run-backticks");
  });

  it("finds shell prompt lines", () => {
    const found = extractFromStreams("$ acme login\n", "");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ command: "acme", args: ["login"], source: "stdout" });
  });

  it("finds Run: / Try: lead lines", () => {
    const found = extractFromStreams("", "Try: acme login --token x");
    expect(found[0]).toMatchObject({ command: "acme", pattern: "try-colon" });
  });

  it("finds fenced code blocks", () => {
    const found = extractFromStreams("```\nacme init --yes\n```", "");
    expect(found.map((f) => f.raw)).toContain("acme init --yes");
  });

  it("finds to-fix-this phrasing", () => {
    const found = extractFromStreams("", "To fix this, run npm install foo to continue.");
    expect(found.length).toBeGreaterThan(0);
  });

  it("never emits prose as commands in command mode", () => {
    const found = extractFromStreams("", "Something went wrong. Please contact support.", { mode: "command" });
    expect(found).toHaveLength(0);
  });

  it("tracks stderr vs stdout sources", () => {
    const found = extractFromStreams("Run `npm start`", "Run `npm test`");
    const sources = new Map(found.map((f) => [f.raw, f.source]));
    expect(sources.get("npm start")).toBe("stdout");
    expect(sources.get("npm test")).toBe("stderr");
  });
});
