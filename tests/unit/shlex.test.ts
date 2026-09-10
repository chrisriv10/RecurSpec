import { describe, expect, it } from "vitest";
import { splitShellWords } from "../../src/util/shlex.js";
import { tokenizeCommandLine } from "../../src/recovery/tokenizer.js";

describe("splitShellWords", () => {
  it("splits simple commands", () => {
    expect(splitShellWords("acme login --token abc")).toEqual(["acme", "login", "--token", "abc"]);
  });

  it("honours single and double quotes", () => {
    expect(splitShellWords(`acme deploy --msg "hello world"`)).toEqual(["acme", "deploy", "--msg", "hello world"]);
    expect(splitShellWords("acme deploy --msg \u0027hello world\u0027")).toEqual(["acme", "deploy", "--msg", "hello world"]);
  });

  it("returns null on unbalanced quotes instead of guessing", () => {
    expect(splitShellWords(`acme "oops`)).toBeNull();
  });
});

describe("tokenizeCommandLine", () => {
  it("strips shell prompts", () => {
    expect(tokenizeCommandLine("$ acme init")).toEqual({ command: "acme", args: ["init"] });
    expect(tokenizeCommandLine("> npm install")).toEqual({ command: "npm", args: ["install"] });
  });

  it("returns null for empty input", () => {
    expect(tokenizeCommandLine("   ")).toBeNull();
  });
});
describe("shell comments", () => {
  it("strips trailing comments at token boundaries", () => {
    expect(splitShellWords("git config x false  # merge")).toEqual(["git", "config", "x", "false"]);
  });
  it("keeps hash characters inside tokens", () => {
    expect(splitShellWords("npm install foo#bar")).toEqual(["npm", "install", "foo#bar"]);
  });
});
