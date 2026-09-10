import { describe, expect, it } from "vitest";
import { extractFromStreams } from "../../src/recovery/extractor.js";
import { rankCandidates, selectCandidate } from "../../src/recovery/ranking.js";

// Sanitized replicas of real git diagnostics (git 2.50.1). These pin the
// parser behavior that the real-world suite depends on.

const BRANCH_D =
  "error: the branch 'unmerged' is not fully merged\n" +
  "hint: If you are sure you want to delete it, run 'git branch -D unmerged'\n" +
  "hint: Disable this message with \"git config set advice.forceDeleteBranch false\"";

const DIVERGENT =
  "hint: You have divergent branches and need to specify how to reconcile them.\n" +
  "hint: You can do so by running one of the following commands sometime before\n" +
  "hint: your next pull:\n" +
  "hint:\n" +
  "hint: \tgit config pull.rebase false  # merge\n" +
  "hint: \tgit config pull.rebase true   # rebase\n" +
  "hint: \tgit config pull.ff only       # fast-forward only";

const IDENTITY =
  "Author identity unknown\n" +
  "\n" +
  "*** Please tell me who you are.\n" +
  "\n" +
  "Run\n" +
  "\n" +
  "  git config --global user.email \"you@example.com\"\n" +
  "  git config --global user.name \"Your Name\"\n" +
  "\n" +
  "to set your account's default identity.";

describe("git-style diagnostics", () => {
  it("extracts single-quoted advice after run", () => {
    const found = extractFromStreams("", BRANCH_D);
    expect(found.map((f) => f.command + " " + f.args.join(" "))).toContain("git branch -D unmerged");
  });

  it("prefers the true recovery command over hint prose", () => {
    const ranked = rankCandidates(extractFromStreams("", BRANCH_D), { originalCommand: "git" });
    expect(ranked[0]).toMatchObject({ command: "git", args: ["branch", "-D", "unmerged"] });
    expect(selectCandidate(ranked)).toMatchObject({ kind: "single" });
  });

  it("reads hint: lines with trailing shell comments", () => {
    const found = extractFromStreams("", DIVERGENT);
    const cmds = found.map((f) => f.command + " " + f.args.join(" "));
    expect(cmds).toContain("git config pull.rebase false");
    expect(cmds).toContain("git config pull.rebase true");
    expect(cmds).toContain("git config pull.ff only");
    expect(cmds.every((c) => !c.includes("#"))).toBe(true);
  });

  it("reports three-way exclusive options as ambiguous", () => {
    const ranked = rankCandidates(extractFromStreams("", DIVERGENT), { originalCommand: "git" });
    expect(selectCandidate(ranked).kind).toBe("ambiguous");
  });

  it("collects both commands after a bare Run label", () => {
    const found = extractFromStreams("", IDENTITY);
    const cmds = found.map((f) => f.command + " " + f.args.join(" "));
    expect(cmds).toContain("git config --global user.email you@example.com");
    expect(cmds).toContain("git config --global user.name Your Name");
  });

  it("treats the identity pair as ambiguous for a single-command executor", () => {
    const ranked = rankCandidates(extractFromStreams("", IDENTITY), { originalCommand: "git" });
    expect(selectCandidate(ranked).kind).toBe("ambiguous");
  });
});

describe("hint line discipline", () => {
  it("requires indented command lines after hint:", () => {
    const tab = String.fromCharCode(9);
    const found = extractFromStreams("", "hint: " + tab + "git config pull.rebase false");
    expect(found.map((f) => f.command + " " + f.args.join(" "))).toContain("git config pull.rebase false");
  });

  it("ignores flowing prose after hint:", () => {
    expect(extractFromStreams("", "hint: preference for all repositories. See docs.")).toHaveLength(0);
    expect(extractFromStreams("", "hint: invocation.")).toHaveLength(0);
  });
});
