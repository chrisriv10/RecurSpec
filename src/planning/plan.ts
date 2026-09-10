import { effectiveSafety } from "../safety/policy.js";
import { resolveCompletionMode } from "../verify/verifier.js";
import type { RecoveryCase, RecurSpecConfig, StepSpec, StreamAssertion } from "../types/config.js";
import type { RecoveryCompletion } from "../types/config.js";

export interface PlannedRecovery {
  kind: "explicit" | "output" | "structured";
  steps: string[];
  prefer: string[];
  maxHops: number;
}

export interface PlannedCompletion {
  mode: RecoveryCompletion;
  rerun: boolean;
  expectations: string[];
}

export interface CasePlan {
  name: string;
  description?: string;
  tags?: string[];
  workspace: string[];
  setup: string[];
  teardown: string[];
  originalCommand: string;
  expectedFailure: string[];
  recovery: PlannedRecovery;
  safety: {
    shell: boolean;
    network: string;
    allowedCommands?: string[];
    deniedCommands?: string[];
    allowPipes: boolean;
    allowRedirection: boolean;
  };
  completion: PlannedCompletion;
}

function showStep(step: StepSpec): string {
  return [step.command, ...(step.args ?? [])].join(" ");
}

function showStream(label: string, assertion: StreamAssertion | undefined, verb: string): string[] {
  if (!assertion) return [];
  const out: string[] = [];
  const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  for (const v of list(assertion.contains)) out.push(label + " " + verb + " " + JSON.stringify(v));
  for (const v of list(assertion.notContains)) out.push(label + " must not contain " + JSON.stringify(v));
  for (const v of list(assertion.matches)) out.push(label + " matches " + JSON.stringify(v));
  return out;
}

function exitText(value: number | "nonzero" | "zero" | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (value === "nonzero") return "nonzero exit";
  if (value === "zero") return "exit code 0";
  return "exit code " + value;
}

export function buildCasePlan(config: RecurSpecConfig, kase: RecoveryCase): CasePlan {
  const workspace: string[] = [];
  const ws = kase.workspace;
  if (!ws || (!ws.copy && !ws.remove && !ws.write && !ws.mkdir)) {
    workspace.push("fresh empty directory");
  } else {
    if (ws.copy) for (const p of ws.copy) workspace.push("copy: " + p);
    if (ws.remove) for (const p of ws.remove) workspace.push("remove: " + p);
    if (ws.write) for (const p of Object.keys(ws.write)) workspace.push("write: " + p);
    if (ws.mkdir) for (const p of ws.mkdir) workspace.push("mkdir: " + p);
  }

  const failure = kase.failure;
  const expectedFailure = [
    exitText(failure?.exitCode, "nonzero exit"),
    ...showStream("stdout", failure?.stdout, "contains"),
    ...showStream("stderr", failure?.stderr, "contains")
  ];

  const recovery = kase.recovery ?? {};
  const kind = recovery.steps && recovery.steps.length > 0 ? "explicit" : recovery.source === "structured" ? "structured" : "output";

  const safety = effectiveSafety(config, kase);
  const mode = resolveCompletionMode(kase.verify);
  const verify = kase.verify;
  const expectations: string[] = [];
  if (mode === "retry") {
    expectations.push(exitText(verify?.exitCode, "exit code 0"));
    expectations.push(...showStream("stdout", verify?.stdout, "contains"));
    expectations.push(...showStream("stderr", verify?.stderr, "contains"));
  } else {
    const files = verify?.files;
    for (const rel of files?.exists ?? []) expectations.push(rel + " must exist");
    for (const rel of files?.notExists ?? []) expectations.push(rel + " must be absent");
    const json = verify?.json === undefined ? [] : Array.isArray(verify.json) ? verify.json : [verify.json];
    for (const j of json) {
      for (const [key, expected] of Object.entries(j.assertions)) {
        expectations.push(j.path + ": " + key + " must equal " + JSON.stringify(expected));
      }
    }
    expectations.push(...showStream("stdout", verify?.stdout, "contains"));
    expectations.push(...showStream("stderr", verify?.stderr, "contains"));
    for (const s of verify?.commands ?? []) expectations.push(showStep(s) + " must succeed");
  }

  const plan: CasePlan = {
    name: kase.name,
    originalCommand: showStep({ command: kase.run.command, args: kase.run.args ?? [] }),
    expectedFailure,
    recovery: {
      kind,
      steps: (recovery.steps ?? []).map(showStep),
      prefer: recovery.prefer ?? ["stderr", "stdout"],
      maxHops: recovery.maxHops ?? 3
    },
    safety: {
      shell: safety.shell,
      network: safety.network,
      allowPipes: safety.allowPipes,
      allowRedirection: safety.allowRedirection
    },
    completion: { mode, rerun: mode === "retry", expectations },
    workspace,
    setup: [...(config.beforeEach ?? []), ...(kase.setup ?? [])].map(showStep),
    teardown: [...(kase.teardown ?? []), ...(config.afterEach ?? [])].map(showStep)
  };
  if (safety.allowedCommands !== undefined) plan.safety.allowedCommands = safety.allowedCommands;
  if (safety.deniedCommands !== undefined) plan.safety.deniedCommands = safety.deniedCommands;
  if (kase.description !== undefined) plan.description = kase.description;
  if (kase.tags !== undefined) plan.tags = kase.tags;
  return plan;
}

export function buildPlans(config: RecurSpecConfig, cases: RecoveryCase[]): CasePlan[] {
  return cases.map((kase) => buildCasePlan(config, kase));
}

export function renderPlanTerminal(plans: CasePlan[]): string {
  const lines: string[] = [];
  for (const plan of plans) {
    lines.push(plan.name);
    if (plan.description) lines.push("  " + plan.description);
    lines.push("");
    let step = 0;
    const numbered = (text: string): void => {
      step += 1;
      lines.push(step + ". " + text);
    };
    numbered("Create isolated workspace (" + plan.workspace.join(", ") + ")");
    for (const s of plan.setup) lines.push("   Setup: " + s);
    numbered("Run: " + plan.originalCommand);
    numbered("Expect failure: " + plan.expectedFailure.join("; "));
    if (plan.recovery.kind === "explicit") {
      numbered("Run documented recovery steps:");
      for (const s of plan.recovery.steps) lines.push("   - " + s);
    } else if (plan.recovery.kind === "structured") {
      numbered("Extract structured recovery hints from program output");
    } else {
      numbered("Extract recovery advice from " + plan.recovery.prefer.join(" then "));
    }
    if (plan.safety.allowedCommands) {
      numbered("Allow commands: " + plan.safety.allowedCommands.join(", "));
    } else {
      numbered("Allow any executable unless denied (shell " + (plan.safety.shell ? "enabled" : "disabled") + ")");
    }
    if (plan.safety.deniedCommands) lines.push("   Deny commands: " + plan.safety.deniedCommands.join(", "));
    numbered("Maximum recovery hops: " + plan.recovery.maxHops);
    if (plan.completion.mode === "retry") {
      numbered("Retry original command");
      for (const e of plan.completion.expectations) lines.push("   Expect: " + e);
    } else if (plan.completion.mode === "goal") {
      numbered("Verify goal (original command is not rerun)");
      for (const e of plan.completion.expectations) lines.push("   - " + e);
    } else {
      numbered("Verify custom proof (original command is not rerun)");
      for (const e of plan.completion.expectations) lines.push("   - " + e);
    }
    for (const t of plan.teardown) lines.push("   Teardown: " + t);
    lines.push("");
  }
  return lines.join("\n");
}

export interface PlanDocument {
  version: 1;
  plans: CasePlan[];
}

export function renderPlanJson(plans: CasePlan[]): string {
  const doc: PlanDocument = { version: 1, plans };
  return JSON.stringify(doc, null, 2) + "\n";
}
