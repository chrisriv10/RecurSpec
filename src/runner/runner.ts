import { parseDuration } from "../config/duration.js";
import { checkExitCode, checkStream } from "../assertions/output.js";
import { checkFiles } from "../assertions/files.js";
import { checkJsonAssertions } from "../assertions/json.js";
import { deriveRecoveryPlan } from "../recovery/engine.js";
import { extractFromStreams } from "../recovery/extractor.js";
import { rankCandidates, selectCandidate } from "../recovery/ranking.js";
import { checkCommandSafety } from "../safety/command-check.js";
import { resolveInWorkspace } from "../safety/paths.js";
import { effectiveSafety, networkWarning } from "../safety/policy.js";
import { LoopDetector } from "../recovery/loop-detection.js";
import { RecoveryGraph } from "../recovery/graph.js";
import { normalizeOutput } from "../normalization/output.js";
import { buildCaseEnv } from "./env.js";
import { applyMutations, applyWorkspaceSpec, createWorkspace } from "./workspace.js";
import { looksInteractive, runStep } from "./process.js";
import { maskSecrets } from "../util/secrets.js";
import { debugLog } from "../util/debug.js";
import type { RecoveryCase, RecoverySpecConfig, StepSpec } from "../types/config.js";
import type {
  CaseResult,
  CaseStatus,
  ExecutedCommand,
  ExtractedAdvice,
  VerificationDetail
} from "../types/result.js";

export interface SuiteContext {
  configDir: string;
  seed?: number;
  verbose?: boolean;
}

function slug(name: string): string {
  return "recoveryspec-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) + "-";
}

function displayCommand(command: string, args: string[]): string {
  return ([command, ...args].join(" ").trim() || command);
}

function clampHops(value: number | undefined): number {
  if (value === undefined) return 3;
  if (value < 1) return 1;
  if (value > 10) return 10;
  return Math.floor(value);
}

export async function runStepsBestEffort(
  steps: StepSpec[] | undefined,
  base: { cwd: string; env: Record<string, string>; defaultTimeoutMs: number; shell: boolean },
  warnings: string[],
  label: string
): Promise<ExecutedCommand[]> {
  const executed: ExecutedCommand[] = [];
  for (const step of steps ?? []) {
    try {
      const result = await runStep(step, base);
      executed.push(result);
    } catch (err) {
      warnings.push(label + " step " + displayCommand(step.command, step.args ?? []) + " threw: " + String((err as Error).message));
    }
  }
  return executed;
}

export async function runCase(
  config: RecoverySpecConfig,
  kase: RecoveryCase,
  ctx: SuiteContext
): Promise<CaseResult> {
  const started = Date.now();
  const graph = new RecoveryGraph();
  const warnings: string[] = [];
  const safety = effectiveSafety(config, kase);
  const netWarning = networkWarning(safety.network);
  if (netWarning) warnings.push(netWarning);

  const workspace = await createWorkspace(slug(kase.name));
  const recoverySteps: ExecutedCommand[] = [];
  const verification: VerificationDetail[] = [];
  let initialFailure: ExecutedCommand | null = null;
  let extractedAdvice: ExtractedAdvice[] = [];
  let selectedAdvice: ExtractedAdvice | null = null;
  let failureMatched = false;
  let failureDetail: string | undefined;
  let blockedReason: string | undefined;
  let errorDetail: string | undefined;
  let status: CaseStatus = "INTERNAL_ERROR";
  let hops = 0;

  const finish = async (finalStatus: CaseStatus): Promise<CaseResult> => {
    status = finalStatus;
    const failed = finalStatus !== "PASS";
    const spec = kase.workspace ?? {};
    const preserve = spec.preserve ?? (failed ? (spec.preserveOnFailure ?? false) : false);
    let workspacePath: string | undefined;
    if (preserve) {
      workspacePath = workspace.dir;
    } else {
      try {
        await workspace.cleanup(false);
      } catch {
        warnings.push("Could not delete temporary workspace " + workspace.dir + ".");
        workspacePath = workspace.dir;
      }
    }
    const secrets = kase.secrets ?? [];
    const caseEnv = initialFailure ? buildCaseEnv(config, kase) : {};
    const mask = (cmd: ExecutedCommand): ExecutedCommand => ({
      ...cmd,
      stdout: maskSecrets(cmd.stdout, secrets, caseEnv),
      stderr: maskSecrets(cmd.stderr, secrets, caseEnv)
    });
    return {
      name: kase.name,
      description: kase.description,
      tags: kase.tags,
      status,
      durationMs: Date.now() - started,
      hops: recoverySteps.length,
      originalCommand: displayCommand(kase.run.command, kase.run.args ?? []),
      initialFailure: initialFailure ? mask(initialFailure) : null,
      failureMatched,
      failureDetail,
      extractedAdvice,
      selectedAdvice,
      recoverySteps: recoverySteps.map(mask),
      blockedReason,
      verification,
      verifyOk: verification.length === 0 ? status === "PASS" : verification.every((v) => v.ok),
      trace: graph.trace(),
      warnings,
      workspace: workspacePath,
      error: errorDetail
    };
  };

  try {
    await applyWorkspaceSpec(workspace.dir, ctx.configDir, kase.workspace);
  } catch (err) {
    errorDetail = "Workspace setup failed: " + String((err as Error).message);
    return finish("INTERNAL_ERROR");
  }

  let caseEnv = buildCaseEnv(config, kase);
  try {
    const mutated = await applyMutations(workspace.dir, kase.mutate, caseEnv);
    caseEnv = mutated.env;
  } catch (err) {
    errorDetail = "Mutation setup failed: " + String((err as Error).message);
    return finish("INTERNAL_ERROR");
  }

  let defaultTimeoutMs: number;
  try {
    defaultTimeoutMs = parseDuration(kase.timeout ?? config.defaults?.timeout ?? "10s");
  } catch (err) {
    errorDetail = "Invalid timeout: " + String((err as Error).message);
    return finish("INTERNAL_ERROR");
  }

  let caseCwd = workspace.dir;
  try {
    caseCwd = kase.workspace?.root ? resolveInWorkspace(workspace.dir, kase.workspace.root) : workspace.dir;
  } catch (err) {
    errorDetail = String((err as Error).message);
    return finish("INTERNAL_ERROR");
  }

  const base = { cwd: caseCwd, env: caseEnv, defaultTimeoutMs, shell: safety.shell };
  const runOne = (step: StepSpec): Promise<ExecutedCommand> => runStep(step, base);

  await runStepsBestEffort(config.beforeEach, base, warnings, "beforeEach");
  const setupResults = await runStepsBestEffort(kase.setup, base, warnings, "setup");
  for (const r of setupResults) {
    if (r.timedOut) {
      errorDetail = "Setup step timed out: " + displayCommand(r.command, r.args);
      await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
      await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
      return finish("TIMEOUT");
    }
    if (r.exitCode !== 0) {
      errorDetail = "Setup step failed (" + displayCommand(r.command, r.args) + ") with exit code " + String(r.exitCode) + ".\nstdout: " + r.stdout.slice(-500) + "\nstderr: " + r.stderr.slice(-500);
      await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
      await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
      return finish("INTERNAL_ERROR");
    }
  }

  let initial: ExecutedCommand;
  try {
    initial = await runOne(kase.run);
  } catch (err) {
    errorDetail = "Could not execute the original command: " + String((err as Error).message);
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    return finish("INTERNAL_ERROR");
  }
  initialFailure = initial;
  graph.addNode("command", displayCommand(initial.command, initial.args));
  graph.addNode("failure", "exit " + String(initial.exitCode), (initial.stderr || initial.stdout).slice(0, 300));

  if (initial.timedOut) {
    failureDetail = "The original command timed out.";
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    return finish("TIMEOUT");
  }

  const expectedFailure = kase.failure ?? { exitCode: "nonzero" as const };
  const exitCheck = checkExitCode(initial.exitCode, expectedFailure.exitCode ?? "nonzero");
  const stdoutCheck = checkStream("stdout", initial.stdout, expectedFailure.stdout);
  const stderrCheck = checkStream("stderr", initial.stderr, expectedFailure.stderr);
  const problems = [...exitCheck.messages, ...stdoutCheck.messages, ...stderrCheck.messages];
  failureMatched = problems.length === 0;

  if (!failureMatched) {
    failureDetail = problems.join(" ");
    const combined = initial.stdout + "\n" + initial.stderr;
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    if (initial.exitCode === 0) {
      if (looksInteractive(combined) && !(kase.run.stdin && kase.run.stdin.length > 0)) {
        return finish("INTERACTIVE_RECOVERY_UNSUPPORTED");
      }
      return finish("NO_FAILURE");
    }
    if (looksInteractive(combined) && !(kase.run.stdin && kase.run.stdin.length > 0)) {
      return finish("INTERACTIVE_RECOVERY_UNSUPPORTED");
    }
    return finish("FAILURE_MISMATCH");
  }

  const maxHops = clampHops(kase.recovery?.maxHops);
  const loopDetector = new LoopDetector();
  const safetyOpts = {
    shell: safety.shell,
    allowedCommands: safety.allowedCommands,
    deniedCommands: safety.deniedCommands,
    allowPipes: safety.allowPipes,
    allowRedirection: safety.allowRedirection,
    caseAllowCommands: safety.caseAllowCommands,
    caseDenyCommands: safety.caseDenyCommands
  };

  const executeRecoveryCommand = async (
    command: string,
    args: string[],
    stdin?: string[]
  ): Promise<{ result: ExecutedCommand; blocked?: string } | { result: null; blocked: string }> => {
    const check = checkCommandSafety(command, args, safetyOpts);
    if (!check.ok) {
      return { result: null, blocked: check.reason ?? "Blocked by safety policy." };
    }
    const step: StepSpec = stdin ? { command, args, stdin } : { command, args };
    const result = await runOne(step);
    recoverySteps.push(result);
    hops = recoverySteps.length;
    graph.addNode("recovery_result", displayCommand(command, args) + " -> exit " + String(result.exitCode));
    return { result };
  };

  const plan = deriveRecoveryPlan(kase, initial, { originalCommand: kase.run.command });
  debugLog("case " + kase.name + " plan=" + plan.kind);

  if (plan.kind === "none") {
    extractedAdvice = plan.all;
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    return finish("NO_RECOVERY_ADVICE");
  }
  if (plan.kind === "ambiguous") {
    extractedAdvice = plan.candidates;
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    return finish("AMBIGUOUS_RECOVERY");
  }

  if (plan.kind === "steps") {
    for (const step of plan.steps) {
      if (recoverySteps.length >= maxHops) break;
      const outcome = await executeRecoveryCommand(step.command, step.args ?? [], step.stdin);
      if (outcome.result === null) {
        blockedReason = outcome.blocked;
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("BLOCKED_RECOVERY");
      }
      const combined = outcome.result.stdout + "\n" + outcome.result.stderr;
      if (loopDetector.check(step.command, step.args ?? [], combined)) {
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("RECOVERY_LOOP");
      }
      if (outcome.result.timedOut) {
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("TIMEOUT");
      }
      if (outcome.result.exitCode !== 0) {
        const followUps = extractFromStreams(outcome.result.stdout, outcome.result.stderr, {
          mode: kase.recovery?.extract?.mode ?? "command"
        });
        const ranked = rankCandidates(followUps, {
          prefer: kase.recovery?.prefer ?? ["stderr", "stdout"],
          originalCommand: kase.run.command
        });
        const selected = selectCandidate(ranked, { prefer: kase.recovery?.prefer });
        if (selected.kind === "single" && recoverySteps.length < maxHops) {
          extractedAdvice = ranked;
          selectedAdvice = selected.candidate;
          graph.addNode("advice", "suggested: " + displayCommand(selected.candidate.command, selected.candidate.args));
          const follow = await executeRecoveryCommand(selected.candidate.command, selected.candidate.args);
          if (follow.result === null) {
            blockedReason = follow.blocked;
            await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
            await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
            return finish("BLOCKED_RECOVERY");
          }
          if (follow.result.timedOut) {
            await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
            await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
            return finish("TIMEOUT");
          }
          if (follow.result.exitCode !== 0) {
            failureDetail = "Recovery step failed: " + displayCommand(step.command, step.args ?? []);
            await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
            await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
            return finish("RECOVERY_COMMAND_FAILED");
          }
          continue;
        }
        failureDetail = "Recovery step failed: " + displayCommand(step.command, step.args ?? []);
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("RECOVERY_COMMAND_FAILED");
      }
    }
    extractedAdvice = [];
    selectedAdvice = null;
  } else {
    extractedAdvice = plan.all;
    selectedAdvice = plan.candidate;
    graph.addNode("advice", "suggested: " + displayCommand(plan.candidate.command, plan.candidate.args));
    let current: ExtractedAdvice | null = plan.candidate;
    while (current && recoverySteps.length < maxHops) {
      const outcome = await executeRecoveryCommand(current.command, current.args);
      if (outcome.result === null) {
        blockedReason = outcome.blocked;
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("BLOCKED_RECOVERY");
      }
      const combined = outcome.result.stdout + "\n" + outcome.result.stderr;
      if (loopDetector.check(current.command, current.args, combined)) {
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("RECOVERY_LOOP");
      }
      if (outcome.result.timedOut) {
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("TIMEOUT");
      }
      if (outcome.result.exitCode === 0) break;
      if (recoverySteps.length >= maxHops) {
        failureDetail = "Recovery step failed: " + displayCommand(current.command, current.args);
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("RECOVERY_COMMAND_FAILED");
      }
      const followUps = extractFromStreams(outcome.result.stdout, outcome.result.stderr, {
        mode: kase.recovery?.extract?.mode ?? "command"
      });
      const ranked = rankCandidates(followUps, {
        prefer: kase.recovery?.prefer ?? ["stderr", "stdout"],
        originalCommand: kase.run.command
      });
      const selected = selectCandidate(ranked, { prefer: kase.recovery?.prefer });
      if (selected.kind === "none") {
        failureDetail = "Recovery step failed and offered no further advice: " + displayCommand(current.command, current.args);
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("RECOVERY_COMMAND_FAILED");
      }
      if (selected.kind === "ambiguous") {
        extractedAdvice = selected.candidates;
        await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
        await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
        return finish("AMBIGUOUS_RECOVERY");
      }
      current = selected.candidate;
      selectedAdvice = current;
      graph.addNode("advice", "suggested: " + displayCommand(current.command, current.args));
    }
  }

  const verify = kase.verify ?? { rerunOriginal: true, exitCode: 0 as const };
  let rerun: ExecutedCommand | null = null;
  if (verify.rerunOriginal !== false) {
    try {
      rerun = await runOne(kase.run);
    } catch (err) {
      errorDetail = "Verification rerun failed to execute: " + String((err as Error).message);
      await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
      await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
      return finish("INTERNAL_ERROR");
    }
    graph.addNode("verification", "retry " + displayCommand(rerun.command, rerun.args) + " -> exit " + String(rerun.exitCode));
    if (rerun.timedOut) {
      await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
      await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
      return finish("TIMEOUT");
    }
    const exitCheck2 = checkExitCode(rerun.exitCode, verify.exitCode ?? 0);
    const outCheck2 = checkStream("verify stdout", rerun.stdout, verify.stdout);
    const errCheck2 = checkStream("verify stderr", rerun.stderr, verify.stderr);
    for (const m of [...exitCheck2.messages, ...outCheck2.messages, ...errCheck2.messages]) {
      verification.push({ ok: false, kind: "rerun", message: m });
    }
    if (verification.length === 0) {
      verification.push({ ok: true, kind: "rerun", message: "Original command recovered successfully." });
    }
  }

  for (const step of verify.commands ?? []) {
    try {
      const r = await runOne(step);
      const ok = r.exitCode === 0;
      verification.push({
        ok,
        kind: "command",
        message: ok
          ? "Postcondition command passed: " + displayCommand(step.command, step.args ?? [])
          : "Postcondition command failed (" + displayCommand(step.command, step.args ?? []) + ") with exit " + String(r.exitCode)
      });
    } catch (err) {
      verification.push({ ok: false, kind: "command", message: "Postcondition command threw: " + String((err as Error).message) });
    }
  }

  for (const detail of await checkFiles(caseCwd, verify.files)) {
    verification.push(detail);
  }
  for (const detail of await checkJsonAssertions(caseCwd, verify.json)) {
    verification.push(detail);
  }

  await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
  await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");

  const rerunFailed = verification.some((v) => v.kind === "rerun" && !v.ok);
  if (rerunFailed && rerun && initialFailure) {
    const before = normalizeOutput(initialFailure.stdout + "\n" + initialFailure.stderr).trim();
    const after = normalizeOutput(rerun.stdout + "\n" + rerun.stderr).trim();
    if (before === after) {
      return finish("RECOVERY_DEAD_END");
    }
    return finish("PARTIAL_RECOVERY");
  }
  const anyFailed = verification.some((v) => !v.ok);
  if (anyFailed) return finish("VERIFY_FAILED");
  void hops;
  return finish("PASS");
}

