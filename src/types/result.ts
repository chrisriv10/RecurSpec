import type { RecoveryCompletion } from "./config.js";
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

export interface AdviceGroupInfo {
  id: string;
  // "sequence" means every command is required, in order. "alternative"
  // means the commands are mutually exclusive and none may be guessed.
  relation: "sequence" | "alternative";
  evidence: string;
  index: number;
  size: number;
}

export interface ExtractedAdvice {
  command: string;
  args: string[];
  raw: string;
  source: "stderr" | "stdout";
  line: number;
  // Zero-based character offset of the command in its original line. Used to
  // restore textual order when several extraction patterns match one line.
  column?: number;
  confidence: number;
  pattern: string;
  group?: AdviceGroupInfo;
}

export interface CandidateExplanation {
  command: string;
  args: string[];
  source: "stderr" | "stdout";
  line: number;
  pattern: string;
  confidence: number;
  rank: number;
  selected: boolean;
  reason: string;
}

export interface RecoveryDecision {
  kind: "none" | "single" | "sequence" | "steps" | "ambiguous";
  evidence?: string;
  candidates: CandidateExplanation[];
}

export interface SafetyEvaluation {
  command: string;
  args: string[];
  verdict: "allowed" | "blocked";
  reason: string;
  source?: "stderr" | "stdout";
  line?: number;
  pattern?: string;
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
  decision?: RecoveryDecision;
  recoverySteps: ExecutedCommand[];
  blockedReason?: string;
  safetyEvaluations: SafetyEvaluation[];
  verification: VerificationDetail[];
  verifyOk: boolean;
  completion: {
    mode: RecoveryCompletion;
    verified: boolean;
  };
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

