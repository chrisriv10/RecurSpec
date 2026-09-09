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
  const streams: Array<{ text: string; source: "stderr" | "stdout" }> = [
    { text: stdout, source: "stdout" },
    { text: stderr, source: "stderr" }
  ];
  for (const { text, source } of streams) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const recovery = (parsed as { recovery?: unknown }).recovery;
    if (typeof recovery !== "object" || recovery === null) continue;
    const commands = (recovery as { commands?: unknown }).commands;
    if (!Array.isArray(commands)) continue;
    commands.forEach((entry: unknown, idx: number) => {
      if (Array.isArray(entry) && entry.length > 0 && typeof entry[0] === "string") {
        const parts = entry.map(String);
        const cmd = parts[0] as string;
        const args = parts.slice(1);
        out.push({
          command: cmd,
          args,
          raw: cmd + " " + args.join(" "),
          source,
          line: 1,
          confidence: 1,
          pattern: "structured-json"
        });
      } else if (typeof entry === "object" && entry !== null) {
        const obj = entry as { command?: unknown; args?: unknown };
        if (typeof obj.command === "string") {
          const args = Array.isArray(obj.args) ? obj.args.map(String) : [];
          out.push({
            command: obj.command,
            args,
            raw: obj.command + " " + args.join(" "),
            source,
            line: 1 + idx,
            confidence: 1,
            pattern: "structured-json"
          });
        }
      }
    });
  }
  return out;
}