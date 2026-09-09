import type { RecoveryTrace } from "./recovery.js";

export type CaseStatus =
  | "PASS"
  | "NO_FAILURE"
  | "FAILURE_MISMATCH"
  | "NO_RECOVERY_ADVICE"
  | "AMBIGUOUS_RECOVERY"
  | "BLOCKED_RECOVERY"
  | "RECOVERY_COMMAND_FAILED"
  | "PARTIAL_RECOVERY"
  | "RECOVERY_DEAD_END"
  | "RECOVERY_LOOP"
  | "VERIFY_FAILED"
  | "TIMEOUT"
  | "INTERACTIVE_RECOVERY_UNSUPPORTED"
  | "INTERNAL_ERROR";

export interface ExecutedCommand {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cwd: string;
}

export interface ExtractedAdvice {
  command: string;
  args: string[];
  raw: string;
  source: "stderr" | "stdout";
  line: number;
  confidence: number;
  pattern: string;
}

export interface VerificationDetail {
  ok: boolean;
  kind: string;
  message: string;
}

export interface CaseResult {
  name: string;
  description?: string;
  tags?: string[];
  status: CaseStatus;
  durationMs: number;
  hops: number;
  originalCommand: string;
  initialFailure: ExecutedCommand | null;
  failureMatched: boolean;
  failureDetail?: string;
  extractedAdvice: ExtractedAdvice[];
  selectedAdvice: ExtractedAdvice | null;
  recoverySteps: ExecutedCommand[];
  blockedReason?: string;
  verification: VerificationDetail[];
  verifyOk: boolean;
  trace: RecoveryTrace;
  warnings: string[];
  workspace?: string;
  error?: string;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  byStatus: Partial<Record<CaseStatus, number>>;
  recoveryRate: number | null;
  hops: {
    values: number[];
    average: number | null;
    median: number | null;
    max: number;
  };
  durations: {
    averageMs: number | null;
    slowest: Array<{ name: string; durationMs: number }>;
  };
  blocked: number;
  loops: number;
  deadEnds: number;
  invalidFailureStates: number;
  seed?: number;
}

export interface RunResult {
  version: 1;
  summary: RunSummary;
  cases: CaseResult[];
  warnings: string[];
}

