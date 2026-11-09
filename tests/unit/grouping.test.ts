import { describe, expect, it } from "vitest";
import { extractFromStreams } from "../../src/recovery/extractor.js";
import { rankCandidates, selectCandidate } from "../../src/recovery/ranking.js";

function select(stderr: string) {
  return selectCandidate(rankCandidates(extractFromStreams("", stderr), { originalCommand: "git" }));
}

describe("advice grouping", () => {
  it("treats complementary commands after a bare Run label as an ordered sequence", () => {
    const stderr =
      "Author identity unknown\n\nRun\n\n" +
      '  git config --global user.email "you@example.com"\n' +
      '  git config --global user.name "Your Name"\n\n' +
      "to set your account's default identity.";
    const selection = select(stderr);
    expect(selection.kind).toBe("sequence");
    if (selection.kind !== "sequence") return;
    expect(selection.candidates.map((c) => c.args.slice(2).join(" "))).toEqual([
      "user.email you@example.com",
      "user.name Your Name"
    ]);
    expect(selection.candidates[0]?.group?.relation).toBe("sequence");
    expect(selection.evidence).toContain("bare");
  });

  it("keeps trailing annotations as mutually exclusive alternatives", () => {
    const stderr =
      "Run\n\n" +
      "  git config pull.rebase false  # merge\n" +
      "  git config pull.rebase true   # rebase\n";
    const selection = select(stderr);
    expect(selection.kind).toBe("ambiguous");
    if (selection.kind !== "ambiguous") return;
    expect(selection.candidates).toHaveLength(2);
    expect(selection.evidence).toContain("trailing annotation");
  });

  it("treats an inline then connector as a required sequence", () => {
    const stderr = "Run `git config user.email a@b.c` then run `git config user.name A`.";
    const selection = select(stderr);
    expect(selection.kind).toBe("sequence");
    if (selection.kind !== "sequence") return;
    expect(selection.candidates.map((c) => c.args[1])).toEqual(["user.email", "user.name"]);
  });

  it("treats inline or as ambiguous even when confidences differ", () => {
    const stderr = "Run `git init` or `git clone repo`.";
    const selection = select(stderr);
    expect(selection.kind).toBe("ambiguous");
    if (selection.kind !== "ambiguous") return;
    expect(selection.candidates).toHaveLength(2);
    expect(selection.evidence).toContain("or");
  });

  it("treats an explicit one-of label as alternatives", () => {
    const stderr =
      "Run one of the following commands:\n" +
      "$ git config pull.rebase false\n" +
      "$ git config pull.rebase true\n";
    const selection = select(stderr);
    expect(selection.kind).toBe("ambiguous");
    if (selection.kind !== "ambiguous") return;
    expect(selection.evidence).toContain("one of/either");
  });

  it("does not sequence commands from different executables", () => {
    const stderr = "Run\n\n  git config user.email a@b.c\n  npm config set user.email a@b.c\n";
    const selection = select(stderr);
    expect(selection.kind).toBe("ambiguous");
  });

  it("leaves a single command ungrouped", () => {
    const found = extractFromStreams("", "Project not initialized. Run `git init` to create it.");
    expect(found).toHaveLength(1);
    expect(found[0]?.group).toBeUndefined();
    expect(selectCandidate(rankCandidates(found))).toMatchObject({ kind: "single" });
  });

  it("orders inline commands by textual position, not extraction pattern", () => {
    const stderr = "Try `acme init` then run `acme build`.";
    const selection = select(stderr);
    expect(selection.kind).toBe("sequence");
    if (selection.kind !== "sequence") return;
    expect(selection.candidates.map((candidate) => candidate.args.join(" "))).toEqual(["init", "build"]);
  });

  it("does not let a bare Run label override an inline or connector", () => {
    const stderr =
      "Run\n\n" +
      "  `acme config --set email dev@example.com` or `acme config --set name Dev`\n";
    const selection = select(stderr);
    expect(selection.kind).toBe("ambiguous");
    if (selection.kind !== "ambiguous") return;
    expect(selection.evidence).toContain("or");
  });

  it("does not let a bare Run label override an inline then connector", () => {
    const stderr = "Run\n\n  `acme config --set email dev@example.com` then `acme config --set name Dev`\n";
    const selection = select(stderr);
    expect(selection.kind).toBe("sequence");
    if (selection.kind !== "sequence") return;
    expect(selection.candidates.map((candidate) => candidate.args[2])).toEqual(["email", "name"]);
  });

  it("recognizes annotated alternatives inside fenced blocks", () => {
    const stderr =
      "Run:\n" +
      "```\n" +
      "acme config --set email dev@example.com  # dev\n" +
      "acme config --set name Dev  # prod\n" +
      "```\n";
    const selection = select(stderr);
    expect(selection.kind).toBe("ambiguous");
    if (selection.kind !== "ambiguous") return;
    expect(selection.evidence).toContain("trailing annotation");
  });

  it("assigns fenced commands their real line numbers and supports CRLF", () => {
    const stderr =
      "Intro\r\n" +
      "More\r\n" +
      "```bash\r\n" +
      "acme init\r\n" +
      "acme build\r\n" +
      "```\r\n";
    const found = extractFromStreams("", stderr);
    expect(found.map((candidate) => candidate.line)).toEqual([4, 5]);
    expect(found.map((candidate) => candidate.raw)).toEqual(["acme init", "acme build"]);
  });

  it("does not treat shared build or remote arguments as a required sequence", () => {
    const docker = select("Run\n\n  docker build -t app .\n  docker build -t worker .\n");
    expect(docker.kind).toBe("ambiguous");

    const remotes = select(
      "Run\n\n  git remote add origin https://example.com/a.git\n  git remote add upstream https://example.com/b.git\n"
    );
    expect(remotes.kind).toBe("ambiguous");
  });
});
