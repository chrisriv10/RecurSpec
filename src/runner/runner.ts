import { parseDuration } from "../config/duration.js";
import { checkExitCode, checkStream } from "../assertions/output.js";
import { deriveRecoveryPlan } from "../recovery/engine.js";
import { extractFromStreams } from "../recovery/extractor.js";
import { rankCandidates, selectCandidate, buildDecision } from "../recovery/ranking.js";
import { checkCommandSafety } from "../safety/command-check.js";
import { resolveInWorkspace } from "../safety/paths.js";
import { effectiveSafety, networkWarning } from "../safety/policy.js";
import { LoopDetector } from "../recovery/loop-detection.js";
import { RecoveryGraph } from "../recovery/graph.js";
import { normalizeOutput } from "../normalization/output.js";
import { buildCaseEnv } from "./env.js";
import { applyMutations, applyWorkspaceSpec, createWorkspace } from "./workspace.js";
import { looksInteractive, runStep } from "./process.js";
import { resolveExecutable } from "./resolve-exe.js";
import { displayCommand, resolveCompletionMode, verifyCompletion, type VerifyOutcome } from "../verify/verifier.js";
import { maskSecrets } from "../util/secrets.js";
import { debugLog } from "../util/debug.js";
import type { RecoveryCase, RecurSpecConfig, StepSpec } from "../types/config.js";
import type {
  CaseResult,
  CaseStatus,
  ExecutedCommand,
  ExtractedAdvice,
  RecoveryDecision,
  SafetyEvaluation,
  VerificationDetail
} from "../types/result.js";

export interface SuiteContext {
  configDir: string;
  seed?: number;
  verbose?: boolean;
}

function slug(name: string): string {
  return "recurspec-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) + "-";
}

function clampHops(value: number | undefined): number {
  if (value === undefined) return 3;
  if (value < 1) return 1;
  if (value > 10) return 10;
  return Math.floor(value);
}

function adviceKey(candidate: ExtractedAdvice): string {
  return [candidate.source, candidate.command, candidate.args.join("\u0000"), candidate.line, candidate.pattern].join("\u0001");
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
  config: RecurSpecConfig,
  kase: RecoveryCase,
  ctx: SuiteContext
): Promise<CaseResult> {
  const started = Date.now();
  const graph = new RecoveryGraph();
  const warnings: string[] = [];
  const safety = effectiveSafety(config, kase);
  const netWarning = networkWarning(safety.network);
  if (netWarning) warnings.push(netWarning);
  const mode = resolveCompletionMode(kase.verify);

  const workspace = await createWorkspace(slug(kase.name));
  const recoverySteps: ExecutedCommand[] = [];
  const safetyEvaluations: SafetyEvaluation[] = [];
  let verification: VerificationDetail[] = [];
  let initialFailure: ExecutedCommand | null = null;
  let extractedAdvice: ExtractedAdvice[] = [];
  let selectedAdvice: ExtractedAdvice | null = null;
  let decisionKind: RecoveryDecision["kind"] | null = null;
  let decisionEvidence: string | undefined;
  let decisionRanked: ExtractedAdvice[] = [];
  let decisionSelected: ExtractedAdvice[] = [];
  let failureMatched = false;
  let failureDetail: string | undefined;
  let blockedReason: string | undefined;
  let errorDetail: string | undefined;

  const finish = async (finalStatus: CaseStatus): Promise<CaseResult> => {
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
    const result: CaseResult = {
      name: kase.name,
      description: kase.description,
      tags: kase.tags,
      status: finalStatus,
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
      safetyEvaluations,
      verification,
      verifyOk: verification.length === 0 ? finalStatus === "PASS" : verification.every((v) => v.ok),
      completion: { mode, verified: finalStatus === "PASS" },
      trace: graph.trace(),
      warnings,
      workspace: workspacePath,
      error: errorDetail
    };
    if (decisionKind !== null) {
      let ranked = decisionRanked;
      let selection;
      if (decisionKind === "sequence") {
        // The executed queue is the source of truth for step numbering. This
        // also covers chains assembled from follow-up advice at runtime.
        const size = decisionSelected.length;
        const chain = decisionSelected.map((candidate, index) => ({
          ...candidate,
          group: {
            id: "decision-sequence",
            relation: "sequence" as const,
            evidence: decisionEvidence ?? "executed recovery sequence",
            index,
            size
          }
        }));
        const chainByKey = new Map(chain.map((candidate) => [adviceKey(candidate), candidate]));
        ranked = decisionRanked.map((candidate) => chainByKey.get(adviceKey(candidate)) ?? candidate);
        selection = { kind: "sequence", candidates: chain, evidence: decisionEvidence ?? "" } as const;
      } else if (decisionKind === "single" && decisionSelected[0]) {
        selection = { kind: "single", candidate: decisionSelected[0] } as const;
      } else if (decisionKind === "ambiguous") {
        selection = { kind: "ambiguous", candidates: decisionRanked, evidence: decisionEvidence } as const;
      } else {
        selection = { kind: "none" } as const;
      }
      result.decision = buildDecision(
        decisionKind,
        selection,
        ranked,
        {
          prefer: kase.recovery?.prefer ?? ["stderr", "stdout"],
          originalCommand: kase.run.command
        },
        decisionEvidence
      );
    }
    return result;
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

  if (!safety.shell && resolveExecutable(kase.run.command, caseEnv) === null) {
    errorDetail =
      "Could not execute the original command: " + JSON.stringify(kase.run.command) + " was not found on PATH. " +
      "Install the tool under test or fix the case run.command.";
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    return finish("INTERNAL_ERROR");
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

  const evaluateRecoveryCommand = (
    command: string,
    args: string[],
    advice?: { source: "stderr" | "stdout"; line: number; pattern: string } | null
  ): SafetyEvaluation => {
    const check = checkCommandSafety(command, args, safetyOpts);
    const evaluation: SafetyEvaluation = advice
      ? { command, args, verdict: "allowed", reason: "", source: advice.source, line: advice.line, pattern: advice.pattern }
      : { command, args, verdict: "allowed", reason: "" };
    if (!check.ok) {
      evaluation.verdict = "blocked";
      evaluation.reason = check.reason ?? "Blocked by safety policy.";
    } else {
      evaluation.reason = "passes safety policy (shell: " + (safety.shell ? "enabled" : "disabled") + ")";
    }
    safetyEvaluations.push(evaluation);
    return evaluation;
  };

  const executeRecoveryCommand = async (
    command: string,
    args: string[],
    stdin?: string[],
    advice?: { source: "stderr" | "stdout"; line: number; pattern: string } | null,
    prechecked?: SafetyEvaluation
  ): Promise<{ result: ExecutedCommand; blocked?: string } | { result: null; blocked: string }> => {
    const evaluation = prechecked ?? evaluateRecoveryCommand(command, args, advice);
    if (evaluation.verdict === "blocked") {
      return { result: null, blocked: evaluation.reason };
    }
    const step: StepSpec = stdin ? { command, args, stdin } : { command, args };
    let result: ExecutedCommand;
    try {
      result = await runOne(step);
    } catch (err) {
      result = {
        command,
        args,
        exitCode: null,
        stdout: "",
        stderr: "Could not execute recovery command: " + String((err as Error).message),
        durationMs: 0,
        timedOut: false,
        cwd: ""
      };
    }

    recoverySteps.push(result);
    graph.addNode("recovery_result", displayCommand(command, args) + " -> exit " + String(result.exitCode));
    return { result };
  };

  interface QueuedStep {
    advice: ExtractedAdvice;
    evaluation?: SafetyEvaluation;
  }

  type EnqueueResult =
    | { ok: true }
    | { ok: false; kind: "budget"; message: string }
    | { ok: false; kind: "blocked"; reason: string };

  const sequenceBudgetError = (required: number): string | undefined => {
    const remaining = maxHops - recoverySteps.length;
    if (required <= remaining) return undefined;
    return (
      "Required recovery sequence has " + required + " step(s), but only " + remaining +
      " of " + maxHops + " recovery hop(s) remain. RecurSpec refuses to run a partial required sequence."
    );
  };

  const preflightSequence = (
    candidates: ExtractedAdvice[]
  ): { ok: true; evaluations: SafetyEvaluation[] } | { ok: false; reason: string } => {
    const evaluations = candidates.map((candidate) =>
      evaluateRecoveryCommand(candidate.command, candidate.args, candidate)
    );
    const blocked = evaluations.find((evaluation) => evaluation.verdict === "blocked");
    if (blocked) return { ok: false, reason: blocked.reason };
    return { ok: true, evaluations };
  };

  const enqueueSequence = (pending: QueuedStep[], candidates: ExtractedAdvice[]): EnqueueResult => {
    const message = sequenceBudgetError(pending.length + candidates.length);
    if (message) return { ok: false, kind: "budget", message };
    const preflight = preflightSequence(candidates);
    if (!preflight.ok) return { ok: false, kind: "blocked", reason: preflight.reason };
    candidates.forEach((candidate, index) => {
      pending.push({ advice: candidate, evaluation: preflight.evaluations[index] });
    });
    return { ok: true };
  };

  const extendDecisionChain = (candidates: ExtractedAdvice[], ranked: ExtractedAdvice[], evidence: string): void => {
    decisionSelected.push(...candidates);
    for (const candidate of ranked) {
      if (!decisionRanked.some((existing) => adviceKey(existing) === adviceKey(candidate))) {
        decisionRanked.push(candidate);
      }
    }
    if (decisionKind === "single" && decisionSelected.length > 1) {
      decisionKind = "sequence";
    }
    if (decisionKind === "sequence") {
      if (!decisionEvidence) {
        decisionEvidence = evidence;
      } else if (!decisionEvidence.includes(evidence)) {
        decisionEvidence = decisionEvidence + "; " + evidence;
      }
    }
  };

  const finishWithTeardown = async (status: CaseStatus): Promise<CaseResult> => {
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    return finish(status);
  };

  const runAdviceQueue = async (pending: QueuedStep[]): Promise<CaseStatus | null> => {
    while (pending.length > 0) {
      // Every queued entry is required. If the queue cannot fit, refuse rather
      // than execute a prefix and report success from verification.
      if (recoverySteps.length + pending.length > maxHops) {
        failureDetail =
          "Required recovery sequence has " + pending.length + " pending step(s), but only " +
          String(maxHops - recoverySteps.length) + " hop(s) remain. RecurSpec refuses to run a partial required sequence.";
        return "RECOVERY_COMMAND_FAILED";
      }
      const entry = pending.shift() as QueuedStep;
      const current = entry.advice;
      selectedAdvice = current;
      graph.addNode("advice", "suggested: " + displayCommand(current.command, current.args));
      const outcome = await executeRecoveryCommand(
        current.command,
        current.args,
        undefined,
        current,
        entry.evaluation
      );
      if (outcome.result === null) {
        blockedReason = outcome.blocked;
        return "BLOCKED_RECOVERY";
      }
      const combined = outcome.result.stdout + "\n" + outcome.result.stderr;
      if (loopDetector.check(current.command, current.args, combined)) {
        return "RECOVERY_LOOP";
      }
      if (outcome.result.timedOut) {
        return "TIMEOUT";
      }

      const extractFollowUps = (): { ranked: ExtractedAdvice[]; selected: ReturnType<typeof selectCandidate> } => {
        const followUps = extractFromStreams(outcome.result.stdout, outcome.result.stderr, {
          mode: kase.recovery?.extract?.mode ?? "command"
        });
        const ranked = rankCandidates(followUps, {
          prefer: kase.recovery?.prefer ?? ["stderr", "stdout"],
          originalCommand: kase.run.command
        });
        return { ranked, selected: selectCandidate(ranked, { prefer: kase.recovery?.prefer }) };
      };

      if (outcome.result.exitCode === 0) {
        const { ranked, selected } = extractFollowUps();
        if (selected.kind === "sequence") {
          // FIFO: the new sequence is required, but it must not replace the
          // remaining required steps that were already queued.
          const enqueued = enqueueSequence(pending, selected.candidates);
          if (!enqueued.ok) {
            if (enqueued.kind === "budget") {
              failureDetail = enqueued.message;
              return "RECOVERY_COMMAND_FAILED";
            }
            blockedReason = enqueued.reason;
            return "BLOCKED_RECOVERY";
          }
          extendDecisionChain(selected.candidates, ranked, "follow-up advice added a required recovery sequence");
        } else if (selected.kind === "single" && selected.candidate.confidence >= 0.85) {
          if (recoverySteps.length + pending.length < maxHops) {
            pending.push({ advice: selected.candidate });
            extendDecisionChain([selected.candidate], ranked, "follow-up advice extended the recovery chain");
          } else {
            warnings.push(
              "Follow-up advice " + displayCommand(selected.candidate.command, selected.candidate.args) +
                " was not run because the hop budget is exhausted."
            );
          }
        }
        // Alternatives and low-confidence advice never replace the queue or
        // stop required steps that are still pending.
        continue;
      }

      const { ranked, selected } = extractFollowUps();
      if (selected.kind === "none") {
        failureDetail = "Recovery step failed and offered no further advice: " + displayCommand(current.command, current.args);
        return "RECOVERY_COMMAND_FAILED";
      }
      if (selected.kind === "ambiguous") {
        extractedAdvice = selected.candidates;
        decisionKind = "ambiguous";
        decisionRanked = selected.candidates;
        decisionSelected = [];
        decisionEvidence = selected.evidence;
        return "AMBIGUOUS_RECOVERY";
      }
      // The failed step invalidates the rest of the current required path.
      pending.length = 0;
      if (selected.kind === "sequence") {
        const enqueued = enqueueSequence(pending, selected.candidates);
        if (!enqueued.ok) {
          if (enqueued.kind === "budget") {
            failureDetail = enqueued.message;
            return "RECOVERY_COMMAND_FAILED";
          }
          blockedReason = enqueued.reason;
          return "BLOCKED_RECOVERY";
        }
        extendDecisionChain(selected.candidates, ranked, "failed step offered a required recovery sequence");
        continue;
      }
      if (recoverySteps.length >= maxHops) {
        failureDetail = "Recovery step failed: " + displayCommand(current.command, current.args);
        return "RECOVERY_COMMAND_FAILED";
      }
      pending.push({ advice: selected.candidate });
      extendDecisionChain([selected.candidate], ranked, "failed step offered follow-up advice");
    }
    return null;
  };

  const plan = deriveRecoveryPlan(kase, initial, { originalCommand: kase.run.command });
  debugLog("case " + kase.name + " plan=" + plan.kind);

  if (plan.kind === "none") {
    extractedAdvice = plan.all;
    decisionKind = "none";
    decisionRanked = plan.all;
    decisionEvidence = "no executable recovery advice matched the extracted output";
    return finishWithTeardown("NO_RECOVERY_ADVICE");
  }
  if (plan.kind === "ambiguous") {
    extractedAdvice = plan.candidates;
    decisionKind = "ambiguous";
    decisionRanked = plan.candidates;
    decisionEvidence = plan.evidence;
    return finishWithTeardown("AMBIGUOUS_RECOVERY");
  }

  if (plan.kind === "steps") {
    decisionKind = "steps";
    decisionEvidence = "explicit recovery.steps declared by the contract";
    if (plan.steps.length > maxHops) {
      failureDetail =
        "Recovery contract declares " + plan.steps.length + " explicit step(s), but maxHops is " + maxHops +
        ". RecurSpec refuses to silently truncate the documented recovery path.";
      return finishWithTeardown("RECOVERY_COMMAND_FAILED");
    }
    // Explicit steps are a required path too. Check all of them before running
    // the first so a predictable block cannot leave a half-applied recovery.
    const explicitEvaluations = plan.steps.map((step) =>
      evaluateRecoveryCommand(step.command, step.args ?? [])
    );
    const blocked = explicitEvaluations.find((evaluation) => evaluation.verdict === "blocked");
    if (blocked) {
      blockedReason = blocked.reason;
      return finishWithTeardown("BLOCKED_RECOVERY");
    }
    for (const [stepIndex, step] of plan.steps.entries()) {
      const outcome = await executeRecoveryCommand(
        step.command,
        step.args ?? [],
        step.stdin,
        undefined,
        explicitEvaluations[stepIndex]
      );
      if (outcome.result === null) {
        blockedReason = outcome.blocked;
        return finishWithTeardown("BLOCKED_RECOVERY");
      }
      const combined = outcome.result.stdout + "\n" + outcome.result.stderr;
      if (loopDetector.check(step.command, step.args ?? [], combined)) {
        return finishWithTeardown("RECOVERY_LOOP");
      }
      if (outcome.result.timedOut) {
        return finishWithTeardown("TIMEOUT");
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
        if (selected.kind === "ambiguous") {
          extractedAdvice = selected.candidates;
          decisionKind = "ambiguous";
          decisionRanked = selected.candidates;
          decisionSelected = [];
          decisionEvidence = selected.evidence;
          return finishWithTeardown("AMBIGUOUS_RECOVERY");
        }
        if (selected.kind === "none") {
          failureDetail = "Recovery step failed: " + displayCommand(step.command, step.args ?? []);
          return finishWithTeardown("RECOVERY_COMMAND_FAILED");
        }
        if (selected.kind === "single" && recoverySteps.length >= maxHops) {
          failureDetail = "Recovery step failed: " + displayCommand(step.command, step.args ?? []);
          return finishWithTeardown("RECOVERY_COMMAND_FAILED");
        }
        extractedAdvice = ranked;
        selectedAdvice = selected.kind === "single" ? selected.candidate : (selected.candidates[0] ?? null);
        const pending: QueuedStep[] = [];
        if (selected.kind === "sequence") {
          const enqueued = enqueueSequence(pending, selected.candidates);
          if (!enqueued.ok) {
            if (enqueued.kind === "budget") {
              failureDetail = enqueued.message;
              return finishWithTeardown("RECOVERY_COMMAND_FAILED");
            }
            blockedReason = enqueued.reason;
            return finishWithTeardown("BLOCKED_RECOVERY");
          }
        } else {
          pending.push({ advice: selected.candidate });
        }
        const followStatus = await runAdviceQueue(pending);
        if (followStatus) return finishWithTeardown(followStatus);
        continue;
      }
    }
    extractedAdvice = [];
    selectedAdvice = null;
  } else if (plan.kind === "sequence") {
    extractedAdvice = plan.all;
    selectedAdvice = plan.candidates[0] ?? null;
    decisionKind = "sequence";
    decisionRanked = plan.all;
    decisionSelected = [...plan.candidates];
    decisionEvidence = plan.evidence;
    const pending: QueuedStep[] = [];
    const enqueued = enqueueSequence(pending, plan.candidates);
    if (!enqueued.ok) {
      if (enqueued.kind === "budget") {
        failureDetail = enqueued.message;
        return finishWithTeardown("RECOVERY_COMMAND_FAILED");
      }
      blockedReason = enqueued.reason;
      return finishWithTeardown("BLOCKED_RECOVERY");
    }
    const sequenceStatus = await runAdviceQueue(pending);
    if (sequenceStatus) return finishWithTeardown(sequenceStatus);
  } else {
    extractedAdvice = plan.all;
    selectedAdvice = plan.candidate;
    decisionKind = "single";
    decisionRanked = plan.all;
    decisionSelected = [plan.candidate];
    const candidateStatus = await runAdviceQueue([{ advice: plan.candidate }]);
    if (candidateStatus) return finishWithTeardown(candidateStatus);
  }

  const verify = kase.verify ?? { rerunOriginal: true, exitCode: 0 as const };
  let verifyOutcome: VerifyOutcome;
  try {
    verifyOutcome = await verifyCompletion(verify, {
      runOriginal: () => runOne(kase.run),
      runStep: (step) => runOne(step),
      workspaceDir: caseCwd
    });
  } catch (err) {
    errorDetail = "Verification rerun failed to execute: " + String((err as Error).message);
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    return finish("INTERNAL_ERROR");
  }
  verification = verifyOutcome.details;
  const rerun = verifyOutcome.rerun;
  if (mode === "retry" && rerun) {
    graph.addNode("verification", "retry " + displayCommand(rerun.command, rerun.args) + " -> exit " + String(rerun.exitCode));
  } else if (mode === "goal") {
    graph.addNode("verification", "verify goal");
  } else {
    graph.addNode("verification", "verify custom");
  }
  if (rerun && rerun.timedOut) {
    await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
    await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");
    return finish("TIMEOUT");
  }

  await runStepsBestEffort(kase.teardown, base, warnings, "teardown");
  await runStepsBestEffort(config.afterEach, base, warnings, "afterEach");

  if (mode === "retry") {
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
    return finish("PASS");
  }
  if (verification.some((v) => !v.ok)) return finish("VERIFY_FAILED");
  return finish("PASS");
}
