import path from "node:path";
import { describe, expect, it } from "vitest";
import { configNotFoundError } from "../../src/config/loader.js";
import { extractFromStreams } from "../../src/recovery/extractor.js";
import { baseConfig, repoRoot } from "../helpers/acme.js";
import { runCase } from "../../src/runner/runner.js";
import type { RecoveryCase } from "../../src/types/config.js";

const distCli = path.join(repoRoot, "dist", "cli.js");

// Note: dist is built once in tests/global-setup.ts before workers start.
// Test files must never rebuild/overwrite dist themselves: concurrent tsc
// writes while other workers use dist race on Windows file locking.

describe("dogfood: recurspec tests its own recovery messages", () => {
  it("the missing-config error carries machine-extractable advice", () => {
    const message = configNotFoundError("/some/dir").message;
    const found = extractFromStreams("", message);
    expect(found.map((f) => f.command + " " + f.args.join(" "))).toContain("recurspec init");
  });

  it("missing config -> init -> config exists", async () => {
    const kase: RecoveryCase = {
      name: "dogfood-missing-config",
      run: { command: process.execPath, args: [distCli, "test"] },
      failure: { exitCode: 2, stderr: { contains: "could not find a configuration file" } },
      recovery: {
        steps: [{ command: process.execPath, args: [distCli, "init"] }]
      },
      verify: {
        rerunOriginal: false,
        files: { exists: ["recurspec.yml"] }
      }
    };
    const result = await runCase(baseConfig([kase]), kase, { configDir: repoRoot });
    expect(result.status).toBe("PASS");
    expect(result.failureMatched).toBe(true);
  });

  it("validate catches a schema violation with the offending path", async () => {
    const kase: RecoveryCase = {
      name: "dogfood-invalid-config",
      workspace: { write: { "recurspec.yml": "version: 1\ncases: []\n" } },
      run: { command: process.execPath, args: [distCli, "validate"] },
      failure: { exitCode: 2, stderr: { contains: "at least one case" } },
      recovery: {
        steps: [{ command: process.execPath, args: [distCli, "init", "--force"] }]
      },
      verify: {
        rerunOriginal: false,
        commands: [{ command: process.execPath, args: [distCli, "validate"] }]
      }
    };
    const result = await runCase(baseConfig([kase]), kase, { configDir: repoRoot });
    expect(result.status).toBe("PASS");
  });
});
