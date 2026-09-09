import { execa, type Options as ExecaOptions } from "execa";
import { parseDuration } from "../config/duration.js";
import type { ExecutedCommand } from "../types/result.js";
import type { StepSpec } from "../types/config.js";

export interface RunStepOptions {
  cwd: string;
  env?: Record<string, string>;
  defaultTimeoutMs: number;
  stdinLines?: string[];
  shell?: boolean;
}

const INTERACTIVE_HINTS: RegExp[] = [
  /password\s*:/i,
  /enter\s+passphrase/i,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /press\s+enter/i,
  /select\s+an\s+option/i
];

export function looksInteractive(output: string): boolean {
  return INTERACTIVE_HINTS.some((re) => re.test(output));
}

export async function runStep(step: StepSpec, options: RunStepOptions): Promise<ExecutedCommand> {
  const args = step.args ?? [];
  const timeoutMs = step.timeout ? parseDuration(step.timeout) : options.defaultTimeoutMs;
  const cwd = step.cwd ?? options.cwd;
  const started = Date.now();
  const stdinInput = step.stdin ? step.stdin.join("\n") + "\n" : options.stdinLines ? options.stdinLines.join("\n") + "\n" : undefined;

  const execaOptions: ExecaOptions = {
    cwd,
    env: { ...(options.env ?? {}), ...(step.env ?? {}) } as Record<string, string>,
    timeout: timeoutMs,
    // SIGTERM first so children can clean up, then SIGKILL so a hung
    // process can never outlive its timeout.
    killSignal: "SIGTERM",
    forceKillAfterDelay: 5000,
    // 100 MiB cap: large diagnostics must not exhaust memory or deadlock.
    maxBuffer: 100 * 1024 * 1024,
    reject: false,
    stripFinalNewline: false,
    input: stdinInput,
    shell: options.shell === true ? true : undefined
  };

  try {
    const result = await execa(step.command, args, execaOptions);
    return {
      command: step.command,
      args,
      exitCode: result.exitCode ?? null,
      stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""),
      stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? ""),
      durationMs: Date.now() - started,
      timedOut: (result as { timedOut?: unknown }).timedOut === true,
      cwd
    };
  } catch (err) {
    const anyErr = err as { timedOut?: boolean; stdout?: string; stderr?: string; exitCode?: number };
    if (anyErr.timedOut) {
      return {
        command: step.command,
        args,
        exitCode: null,
        stdout: typeof anyErr.stdout === "string" ? anyErr.stdout : "",
        stderr: typeof anyErr.stderr === "string" ? anyErr.stderr : "",
        durationMs: Date.now() - started,
        timedOut: true,
        cwd
      };
    }
    throw err;
  }
}

