import { checkExitCode, checkStream } from "../assertions/output.js";
import { checkFiles } from "../assertions/files.js";
import { checkJsonAssertions } from "../assertions/json.js";
import type { RecoveryCompletion, StepSpec, VerifySpec } from "../types/config.js";
import type { ExecutedCommand, VerificationDetail } from "../types/result.js";

export type { RecoveryCompletion };

export function displayCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ").trim() || command;
}

// Central recovery-verification abstraction. Answers: what evidence does
// this contract require before we consider the user recovered?
//   retry  - the original command must succeed again (rerunOriginal).
//   goal   - the recovery itself must produce the intended end state; no rerun.
//   custom - maintainer-defined proof, also without a rerun.
// Legacy configs without an explicit mode keep their historical meaning:
// rerunOriginal: false behaves as custom, everything else as retry.
export function resolveCompletionMode(verify: VerifySpec | undefined): RecoveryCompletion {
  if (verify?.mode) return verify.mode;
  return verify?.rerunOriginal === false ? "custom" : "retry";
}

export interface VerifyDeps {
  runOriginal: () => Promise<ExecutedCommand>;
  runStep: (step: StepSpec) => Promise<ExecutedCommand>;
  workspaceDir: string;
}

export interface VerifyOutcome {
  mode: RecoveryCompletion;
  details: VerificationDetail[];
  rerun: ExecutedCommand | null;
}

export async function verifyCompletion(verify: VerifySpec, deps: VerifyDeps): Promise<VerifyOutcome> {
  const mode = resolveCompletionMode(verify);
  const details: VerificationDetail[] = [];
  let rerun: ExecutedCommand | null = null;

  if (mode === "retry") {
    // Throws on spawn failure; the caller maps that to INTERNAL_ERROR.
    rerun = await deps.runOriginal();
    const exitCheck = checkExitCode(rerun.exitCode, verify.exitCode ?? 0);
    const outCheck = checkStream("verify stdout", rerun.stdout, verify.stdout);
    const errCheck = checkStream("verify stderr", rerun.stderr, verify.stderr);
    for (const m of [...exitCheck.messages, ...outCheck.messages, ...errCheck.messages]) {
      details.push({ ok: false, kind: "rerun", message: m });
    }
    if (details.length === 0) {
      details.push({ ok: true, kind: "rerun", message: "Original command recovered successfully." });
    }
  }

  for (const step of verify.commands ?? []) {
    try {
      const r = await deps.runStep(step);
      const ok = r.exitCode === 0;
      details.push({
        ok,
        kind: "command",
        message: ok
          ? "Postcondition command passed: " + displayCommand(step.command, step.args ?? [])
          : "Postcondition command failed (" + displayCommand(step.command, step.args ?? []) + ") with exit " + String(r.exitCode)
      });
    } catch (err) {
      details.push({ ok: false, kind: "command", message: "Postcondition command threw: " + String((err as Error).message) });
    }
  }

  for (const detail of await checkFiles(deps.workspaceDir, verify.files)) {
    details.push(detail);
  }
  for (const detail of await checkJsonAssertions(deps.workspaceDir, verify.json)) {
    details.push(detail);
  }

  return { mode, details, rerun };
}
