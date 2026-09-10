import { describe, expect, it } from "vitest";
import { buildPlans, renderPlanJson, renderPlanTerminal } from "../../src/planning/plan.js";
import type { RecoveryCase, RecurSpecConfig } from "../../src/types/config.js";

function kase(overrides: Partial<RecoveryCase> = {}): RecoveryCase {
  return {
    name: "demo-case",
    description: "demo",
    run: { command: "acme", args: ["deploy"] },
    ...overrides
  };
}

function planned(customized: RecoveryCase) {
  const cfg: RecurSpecConfig = { version: 1, cases: [customized] };
  return buildPlans(cfg, cfg.cases);
}

describe("buildPlans", () => {
  it("describes a retry contract end to end", () => {
    const [plan] = planned(
      kase({
        workspace: { copy: ["fixtures/**"], remove: [".acme"] },
        failure: { exitCode: "nonzero", stderr: { contains: "nope" } },
        verify: { rerunOriginal: true, exitCode: 0 }
      })
    );
    expect(plan?.name).toBe("demo-case");
    expect(plan?.originalCommand).toBe("acme deploy");
    expect(plan?.workspace).toEqual(["copy: fixtures/**", "remove: .acme"]);
    expect(plan?.recovery.kind).toBe("output");
    expect(plan?.completion.mode).toBe("retry");
    expect(plan?.completion.rerun).toBe(true);
  });

  it("describes explicit steps and goal completion", () => {
    const [plan] = planned(
      kase({
        recovery: { steps: [{ command: "acme", args: ["init"] }] },
        verify: { mode: "goal", files: { exists: ["Cargo.toml"] } }
      })
    );
    expect(plan?.recovery.kind).toBe("explicit");
    expect(plan?.recovery.steps).toEqual(["acme init"]);
    expect(plan?.completion.mode).toBe("goal");
    expect(plan?.completion.rerun).toBe(false);
    expect(plan?.completion.expectations).toContain("Cargo.toml must exist");
  });

  it("renders the documented human plan", () => {
    const text = renderPlanTerminal(planned(kase({ failure: { exitCode: "nonzero" }, verify: { rerunOriginal: true, exitCode: 0 } })));
    expect(text).toContain("1. Create isolated workspace");
    expect(text).toContain("2. Run: acme deploy");
    expect(text).toContain("7. Retry original command");
  });

  it("renders goal verification as evidence, not a retry", () => {
    const text = renderPlanTerminal(planned(kase({ verify: { mode: "goal", files: { exists: ["a"] } } })));
    expect(text).toContain("7. Verify goal (original command is not rerun)");
    expect(text).toContain("- a must exist");
  });

  it("emits a versioned JSON plan document", () => {
    const parsed = JSON.parse(renderPlanJson(planned(kase()))) as {
      version: number;
      plans: Array<{ name: string }>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.plans[0]?.name).toBe("demo-case");
  });
});
