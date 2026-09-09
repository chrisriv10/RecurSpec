import { describe, expect, it } from "vitest";
import { extractFromStreams, stripAnsi } from "../../src/recovery/extractor.js";
import { rankCandidates, selectCandidate } from "../../src/recovery/ranking.js";
import { splitShellWords } from "../../src/util/shlex.js";

function commands(text: string, mode: "command" | "all" = "command"): string[] {
  return extractFromStreams(text, "", { mode }).map((f) => f.command + " " + f.args.join(" "));
}

describe("adversarial extraction", () => {
  it("finds several backtick commands in one message", () => {
    const found = extractFromStreams("", "Run `foo init` then run `foo login`.");
    expect(found.map((f) => f.command + " " + f.args.join(" ")).sort()).toEqual(["foo init", "foo login"]);
  });

  it("prefers an explicit repair hint over a merely mentioned command", () => {
    const found = extractFromStreams("", "Error while running `foo init`.\nRun `foo repair`.");
    const ranked = rankCandidates(found);
    expect(ranked[0]).toMatchObject({ command: "foo", args: ["repair"] });
    expect(selectCandidate(ranked)).toMatchObject({ kind: "single" });
  });

  it("ignores stack-trace paths and extracts only the advice", () => {
    const found = extractFromStreams("", "at foo.bar (C:\\proj\\file.mjs:10:5)\nError: bad thing.\nRun `foo fix`.");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ command: "foo", args: ["fix"] });
  });

  it("handles quoted paths with spaces", () => {
    const found = extractFromStreams("", "Run `foo --config \"my dir/cfg.json\" init`.");
    expect(found[0]).toMatchObject({ command: "foo", args: ["--config", "my dir/cfg.json", "init"] });
  });

  it("preserves Windows executable paths instead of eating backslashes", () => {
    const found = extractFromStreams("", "Run `C:\\tools\\foo.exe init`.");
    expect(found[0]?.command).toBe("C:\\tools\\foo.exe");
    expect(splitShellWords("C:\\tools\\foo.exe init")).toEqual(["C:\\tools\\foo.exe", "init"]);
  });

  it("keeps backslash escapes inside node -e scripts intact", () => {
    expect(splitShellWords("node -e \"a\\nb\"")).toEqual(["node", "-e", "a\\nb"]);
    expect(splitShellWords("foo\\ bar baz")).toEqual(["foo bar", "baz"]);
  });

  it("handles flags with quoted values", () => {
    const found = extractFromStreams("", "Try: foo login --token \"abc 123\"");
    expect(found[0]).toMatchObject({ command: "foo", args: ["login", "--token", "abc 123"] });
  });

  it("treats identical advice in both streams as agreement, not ambiguity", () => {
    const found = extractFromStreams("Run `foo init`.", "Run `foo init`.");
    expect(found).toHaveLength(2);
    expect(selectCandidate(rankCandidates(found)).kind).toBe("single");
  });

  it("extracts fenced shell blocks with prompts", () => {
    const found = extractFromStreams("```sh\n$ foo init\n$ foo login\n```", "");
    expect(found.map((f) => f.command + " " + f.args.join(" ")).sort()).toEqual(["foo init", "foo login"]);
  });

  it("follows bare lead labels onto the next line", () => {
    expect(commands("To continue, run:\n  foo configure")).toContain("foo configure");
    expect(commands("Run:\n  foo configure")).toContain("foo configure");
    expect(commands("Run:\n  $ foo configure")).toContain("foo configure");
  });

  it("does not treat bare Use: as a command label", () => {
    expect(extractFromStreams("Use:\n  be careful out there", "")).toHaveLength(0);
  });

  it("strips trailing punctuation", () => {
    expect(commands("Try: foo login!")).toContain("foo login");
    expect(commands("Run: foo init...")).toContain("foo init");
  });

  it("strips ANSI escapes before extracting", () => {
    const esc = "\u001b[31mError:\u001b[0m disk full\nRun `\u001b[1mfoo init\u001b[0m`.";
    const found = extractFromStreams("", esc);
    expect(found.map((f) => f.command + " " + f.args.join(" "))).toContain("foo init");
    expect(stripAnsi("\u001b[31mred\u001b[0m plain")).toBe("red plain");
  });

  it("handles unicode output", () => {
    const found = extractFromStreams("", "Erreur: échec. Run `foo réparer`.");
    expect(found[0]).toMatchObject({ command: "foo", args: ["réparer"] });
  });

  it("refuses malformed quoting instead of guessing", () => {
    expect(extractFromStreams("", "Run `foo --msg \"oops`")).toHaveLength(0);
    expect(extractFromStreams("", "Run `foo 'bar`")).toHaveLength(0);
  });

  it("refuses commands spanning lines", () => {
    expect(extractFromStreams("", "Run `foo\nrm -rf /` do it")).toHaveLength(0);
  });

  it("handles CRLF line endings cleanly", () => {
    const found = extractFromStreams("Run `foo init`\r\nNext line\r\n", "");
    expect(found).toHaveLength(1);
    expect(found[0]?.raw).toBe("foo init");
  });
});
