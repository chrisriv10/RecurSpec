import { describe, expect, it } from "vitest";
import { renderJson } from "../../src/reporting/json-reporter.js";
import { renderTerminal } from "../../src/reporting/terminal.js";
import { renderJUnit } from "../../src/reporting/junit.js";
import { renderMarkdown } from "../../src/reporting/markdown.js";
import { buildRunResult } from "../../src/reporting/summary.js";
import { resolveCompletionMode } from "../../src/verify/verifier.js";
import { acmeArgs, runSingleCase } from "../helpers/acme.js";
import type { CaseResult } from "../../src/types/result.js";

function goalFilesCase(overrides: object = {}) {
  return {
    name: "goal-basic",
    workspace: { copy: ["demo/acme-cli/**"] },
    run: { command: process.execPath, args: acmeArgs("deploy") },
    failure: { exitCode: "nonzero" as const, stderr: { contains: "Project not initialized" } },
    recovery: { source: "output" as const },
    verify: {
      mode: "goal" as const,
      files: { exists: [".acme/config.json"] },
      json: { path: ".acme/config.json", assertions: { initialized: true, project: "test" } }
    },
    ...overrides
  };
}

describe("completion mode resolution", () => {
  it("maps legacy configs to retry or custom", () => {
    expect(resolveCompletionMode(undefined)).toBe("retry");
    expect(resolveCompletionMode({})).toBe("retry");
    expect(resolveCompletionMode({ rerunOriginal: true })).toBe("retry");
    expect(resolveCompletionMode({ rerunOriginal: false })).toBe("custom");
    expect(resolveCompletionMode({ mode: "goal", files: { exists: ["x"] } })).toBe("goal");
    expect(resolveCompletionMode({ mode: "custom", commands: [] })).toBe("custom");
    expect(resolveCompletionMode({ mode: "retry" })).toBe("retry");
  });
});

describe("retry completion", () => {
  it("explicit retry mode behaves like the legacy default", async () => {
    const result = await runSingleCase({
      name: "explicit-retry",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      verify: { mode: "retry" as const, exitCode: 0 as const }
    });
    expect(result.status).toBe("PASS");
    expect(result.completion).toEqual({ mode: "retry", verified: true });
    expect(result.hops).toBe(1);
  });
});

describe("goal completion", () => {
  it("passes on end state without rerunning the original", async () => {
    const result = await runSingleCase(goalFilesCase());
    expect(result.status).toBe("PASS");
    expect(result.completion).toEqual({ mode: "goal", verified: true });
    expect(result.hops).toBe(1);
  });

  it("fails verification when the goal state is wrong", async () => {
    const result = await runSingleCase(
      goalFilesCase({
        name: "goal-wrong",
        verify: {
          mode: "goal" as const,
          files: { exists: [".acme/config.json"] },
          json: { path: ".acme/config.json", assertions: { project: "wrong-value" } }
        }
      })
    );
    expect(result.status).toBe("VERIFY_FAILED");
    expect(result.completion).toEqual({ mode: "goal", verified: false });
  });

  it("fails verification when the goal file is missing", async () => {
    const result = await runSingleCase(
      goalFilesCase({
        name: "goal-missing",
        verify: { mode: "goal" as const, files: { exists: [".acme/never-created.json"] } }
      })
    );
    expect(result.status).toBe("VERIFY_FAILED");
  });

  it("still reports a failed recovery command as RECOVERY_COMMAND_FAILED", async () => {
    const result = await runSingleCase({
      name: "goal-bad-recovery",
      env: { ACME_SCENARIO: "stale" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      verify: { mode: "goal" as const, files: { exists: [".acme/config.json"] } }
    });
    expect(result.status).toBe("RECOVERY_COMMAND_FAILED");
  });

  it("verifies the final state after multiple hops", async () => {
    const result = await runSingleCase({
      name: "goal-multihop",
      env: { ACME_SCENARIO: "two-step" },
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const, stderr: { contains: "Authentication required" } },
      recovery: { source: "output" as const, maxHops: 3 },
      verify: { mode: "goal" as const, files: { exists: [".acme/org-selected"] } }
    });
    expect(result.status).toBe("PASS");
    expect(result.hops).toBe(2);
    expect(result.completion.mode).toBe("goal");
  });

  it("supports one-shot operations where retry would be invalid", async () => {
    const result = await runSingleCase({
      name: "goal-oneshot",
      workspace: {
        write: {
          "res.txt": "data\n",
          "wipe.mjs":
            "import { rmSync } from \"node:fs\";\nrmSync(process.argv[2]);\nconsole.log(\"wiped\");\n",
          "del.mjs":
            "import { existsSync } from \"node:fs\";\n" +
            "const t = process.argv[2] || \"res.txt\";\n" +
            "if (!existsSync(t)) { console.error(\"nothing to delete\"); process.exit(2); }\n" +
            "console.error(\"In use. Run `node wipe.mjs \" + t + \"`.\");\n" +
            "process.exit(2);\n"
        }
      },
      run: { command: process.execPath, args: ["del.mjs", "res.txt"] },
      failure: { exitCode: 2 as const, stderr: { contains: "In use" } },
      recovery: { source: "output" as const },
      verify: { mode: "goal" as const, files: { notExists: ["res.txt"] } }
    });
    expect(result.status).toBe("PASS");
    expect(result.completion).toEqual({ mode: "goal", verified: true });
  });
});

describe("custom completion", () => {
  it("runs maintainer-defined proof without a rerun", async () => {
    const result = await runSingleCase({
      name: "custom-basic",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      verify: {
        mode: "custom" as const,
        commands: [{ command: process.execPath, args: acmeArgs("status") }],
        stdout: undefined,
        files: { exists: [".acme/config.json"] }
      }
    });
    expect(result.status).toBe("PASS");
    expect(result.completion).toEqual({ mode: "custom", verified: true });
  });

  it("treats legacy rerunOriginal:false as custom", async () => {
    const result = await runSingleCase({
      name: "custom-legacy",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      verify: { rerunOriginal: false, files: { exists: [".acme/config.json"] } }
    });
    expect(result.status).toBe("PASS");
    expect(result.completion.mode).toBe("custom");
  });
});

describe("completion reporters", () => {
  function rendered(result: CaseResult): { terminal: string; json: string } {
    const run = buildRunResult([result], []);
    return { terminal: renderTerminal(run, { version: "0.1.0" }), json: renderJson(run) };
  }

  it("shows goal wording and no invented retry edge", async () => {
    const result = await runSingleCase(goalFilesCase({ name: "goal-words" }));
    expect(result.status).toBe("PASS");
    const { terminal, json } = rendered(result);
    expect(terminal).toContain("goal satisfied in 1 hop");
    expect(terminal).not.toContain("recovered in");
    const chain = terminal.split("\n").find((l) => l.includes("deploy"));
    expect(chain?.trim().endsWith("deploy")).toBe(false);
    const parsed = JSON.parse(json) as { cases: CaseResult[] };
    expect(parsed.cases[0]?.completion).toEqual({ mode: "goal", verified: true });
  });

  it("keeps retry wording for retry recovery", async () => {
    const result = await runSingleCase({
      name: "retry-words",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      verify: { mode: "retry" as const, exitCode: 0 as const }
    });
    const { terminal } = rendered(result);
    expect(terminal).toContain("recovered in 1 hop");
  });

  it("renders custom success consistently across reporters", async () => {
    const result = await runSingleCase({
      name: "custom-words",
      workspace: { copy: ["demo/acme-cli/**"] },
      run: { command: process.execPath, args: acmeArgs("deploy") },
      failure: { exitCode: "nonzero" as const },
      recovery: { source: "output" as const },
      verify: { mode: "custom" as const, files: { exists: [".acme/config.json"] } }
    });
    expect(result.status).toBe("PASS");
    const run = buildRunResult([result], []);
    expect(renderTerminal(run, { version: "0.1.0" })).toContain("verified in 1 hop");
    expect(renderMarkdown(run)).toContain("custom-words");
    const junit = renderJUnit(run);
    expect(junit).toContain("tests=\"1\"");
    expect(junit).not.toContain("<failure");
    const parsed = JSON.parse(renderJson(run)) as { cases: CaseResult[] };
    expect(parsed.cases[0]?.completion).toEqual({ mode: "custom", verified: true });
  });
});
