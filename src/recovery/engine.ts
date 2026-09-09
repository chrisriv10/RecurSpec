import { extractFromStreams } from "./extractor.js";
import { rankCandidates, selectCandidate } from "./ranking.js";
import type { RecoveryCase } from "../types/config.js";
import type { ExecutedCommand, ExtractedAdvice } from "../types/result.js";
import type { StepSpec } from "../types/config.js";

export type RecoveryPlan =
  | { kind: "steps"; steps: StepSpec[] }
  | { kind: "candidate"; candidate: ExtractedAdvice; all: ExtractedAdvice[] }
  | { kind: "none"; all: ExtractedAdvice[] }
  | { kind: "ambiguous"; candidates: ExtractedAdvice[] };

export interface PlanOptions {
  originalCommand: string;
}

export function deriveRecoveryPlan(
  kase: RecoveryCase,
  failure: ExecutedCommand,
  options: PlanOptions
): RecoveryPlan {
  const recovery = kase.recovery ?? {};

  if (recovery.steps && recovery.steps.length > 0) {
    return { kind: "steps", steps: recovery.steps };
  }

  if (recovery.source === "structured" || recovery.format === "json") {
    const structured = parseStructuredRecovery(failure.stdout, failure.stderr);
    if (structured.length > 0) {
      const ranked = rankCandidates(structured, {
        prefer: recovery.prefer ?? ["stderr", "stdout"],
        originalCommand: options.originalCommand
      });
      const selected = selectCandidate(ranked, { prefer: recovery.prefer });
      if (selected.kind === "single") return { kind: "candidate", candidate: selected.candidate, all: ranked };
      if (selected.kind === "ambiguous") return { kind: "ambiguous", candidates: selected.candidates };
      return { kind: "none", all: [] };
    }
    return { kind: "none", all: [] };
  }

  const extracted = extractFromStreams(failure.stdout, failure.stderr, {
    mode: recovery.extract?.mode ?? "command"
  });
  const ranked = rankCandidates(extracted, {
    prefer: recovery.prefer ?? ["stderr", "stdout"],
    originalCommand: options.originalCommand
  });
  const selected = selectCandidate(ranked, { prefer: recovery.prefer });
  if (selected.kind === "single") return { kind: "candidate", candidate: selected.candidate, all: ranked };
  if (selected.kind === "ambiguous") return { kind: "ambiguous", candidates: selected.candidates };
  return { kind: "none", all: ranked };
}

export function parseStructuredRecovery(stdout: string, stderr: string): ExtractedAdvice[] {
  const out: ExtractedAdvice[] = [];
  for (const [text, source] of [[stdout, "stdout"], [stderr, "stderr"]] as const) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        recovery?: { commands?: Array<string[] | { command?: string; args?: string[] }> };
      };
      const commands = parsed.recovery?.commands ?? [];
      commands.forEach((entry, idx) => {
        if (Array.isArray(entry) && entry.length > 0 && typeof entry[0] === "string") {
          const [command, ...args] = entry as string[];
          out.push({
            command: command as string,
            args: args.map(String),
            raw: (command as string) + " " + args.join(" "),
            source,
            line: 1,
            confidence: 1,
            pattern: "structured-json"
          });
        } else if (typeof entry === "object" && entry !== null && typeof entry.command === "string") {
          out.push({
            command: entry.command,
            args: (entry.args ?? []).map(String),
            raw: entry.command + " " + (entry.args ?? []).join(" "),
            source,
            line: 1 + idx,
            confidence: 1,
            pattern: "structured-json"
          });
        }
      });
    } catch {
      continue;
    }
  }
  return out;
}

