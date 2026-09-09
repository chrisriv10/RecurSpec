import { describe, expect, it } from "vitest";
import { buildCaseEnv } from "../../src/runner/env.js";
import { formatEnvForDisplay, maskSecrets } from "../../src/util/secrets.js";
import type { RecurSpecConfig, RecoveryCase } from "../../src/types/config.js";

function config(): RecurSpecConfig {
  return { version: 1, cases: [] };
}

function kase(overrides: Partial<RecoveryCase> = {}): RecoveryCase {
  return { name: "x", run: { command: "node" }, ...overrides };
}

describe("buildCaseEnv", () => {
  it("always passes PATH through so executables resolve", () => {
    const env = buildCaseEnv(config(), kase(), { PATH: "/usr/bin", SECRET_X: "1" });
    expect(env["PATH"]).toBe("/usr/bin");
    expect(env["SECRET_X"]).toBeUndefined();
  });

  it("inherits only explicitly listed variables", () => {
    const env = buildCaseEnv(config(), kase({ inheritEnv: ["RS_TEST_VAR"] }), {
      PATH: "/usr/bin",
      RS_TEST_VAR: "yes",
      OTHER: "no"
    });
    expect(env["RS_TEST_VAR"]).toBe("yes");
    expect(env["OTHER"]).toBeUndefined();
  });

  it("lets case env win over defaults and inherited values", () => {
    const cfg = config();
    cfg.defaults = { env: { A: "default", B: "default" } };
    const env = buildCaseEnv(cfg, kase({ inheritEnv: ["A"], env: { A: "case" } }), { PATH: "p", A: "parent" });
    expect(env["A"]).toBe("case");
    expect(env["B"]).toBe("default");
  });
});

describe("secrets", () => {
  it("masks secret values wherever they appear", () => {
    expect(maskSecrets("tokenabc tokenabc", ["T"], { T: "tokenabc" })).toBe("*** ***");
    expect(maskSecrets("nothing here", ["T"], { T: "tokenabc" })).toBe("nothing here");
  });

  it("formats env for display with secrets hidden", () => {
    expect(formatEnvForDisplay({ A: "1", T: "s3cret" }, ["T"])).toBe("A=1 T=***");
  });
});
