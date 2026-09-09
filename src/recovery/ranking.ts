import type { ExtractedAdvice } from "../types/result.js";

export interface RankOptions {
  prefer?: Array<"stderr" | "stdout">;
  originalCommand?: string;
  errorLine?: number;
  totalLines?: number;
}

function baseName(cmd: string): string {
  return cmd.split("/").pop()?.split("\\").pop()?.toLowerCase().replace(/\.(exe|cmd|bat)$/, "") ?? cmd;
}

export function rankCandidates(candidates: ExtractedAdvice[], options: RankOptions = {}): ExtractedAdvice[] {
  const prefer = options.prefer ?? ["stderr", "stdout"];
  const originalBase = options.originalCommand ? baseName(options.originalCommand) : null;

  return [...candidates].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const aPref = prefer.indexOf(a.source);
    const bPref = prefer.indexOf(b.source);
    if (aPref !== bPref) return aPref - bPref;
    if (originalBase) {
      const aRelated = baseName(a.command) === originalBase ? 0 : 1;
      const bRelated = baseName(b.command) === originalBase ? 0 : 1;
      if (aRelated !== bRelated) return aRelated - bRelated;
    }
    if (options.errorLine !== undefined) {
      const aDist = Math.abs(a.line - options.errorLine);
      const bDist = Math.abs(b.line - options.errorLine);
      if (aDist !== bDist) return aDist - bDist;
    }
    return a.line - b.line;
  });
}

export type SelectionOutcome =
  | { kind: "none" }
  | { kind: "single"; candidate: ExtractedAdvice }
  | { kind: "ambiguous"; candidates: ExtractedAdvice[] };

const AMBIGUITY_EPSILON = 0.05;

export function selectCandidate(
  ranked: ExtractedAdvice[],
  options: RankOptions = {}
): SelectionOutcome {
  if (ranked.length === 0) return { kind: "none" };
  const top = ranked[0] as ExtractedAdvice;
  if (ranked.length === 1) return { kind: "single", candidate: top };
  if (top.confidence < 0.8) {
    return { kind: "ambiguous", candidates: ranked.slice(0, 5) };
  }
  const runnerUp = ranked[1] as ExtractedAdvice;
  const sameCommand = runnerUp.command === top.command && runnerUp.args.join(" ") === top.args.join(" ");
  if (sameCommand) return { kind: "single", candidate: top };
  if (Math.abs(runnerUp.confidence - top.confidence) <= AMBIGUITY_EPSILON) {
    const prefer = options.prefer ?? ["stderr", "stdout"];
    if (runnerUp.source !== top.source && prefer[0] === top.source) {
      return { kind: "single", candidate: top };
    }
    return { kind: "ambiguous", candidates: ranked.slice(0, 5) };
  }
  return { kind: "single", candidate: top };
}

