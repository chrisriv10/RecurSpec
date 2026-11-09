import type { CandidateExplanation, ExtractedAdvice, RecoveryDecision } from "../types/result.js";

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
  | { kind: "sequence"; candidates: ExtractedAdvice[]; evidence: string }
  | { kind: "ambiguous"; candidates: ExtractedAdvice[]; evidence?: string };

const AMBIGUITY_EPSILON = 0.05;

function groupMembers(ranked: ExtractedAdvice[], groupId: string): ExtractedAdvice[] {
  return ranked
    .filter((candidate) => candidate.group?.id === groupId)
    .sort((a, b) => (a.group?.index ?? 0) - (b.group?.index ?? 0));
}

export function selectCandidate(
  ranked: ExtractedAdvice[],
  options: RankOptions = {}
): SelectionOutcome {
  if (ranked.length === 0) return { kind: "none" };
  const top = ranked[0] as ExtractedAdvice;
  const group = top.group;

  // A group explicitly marked as alternatives is never executed, regardless
  // of confidence differences between the options.
  if (group && group.relation === "alternative" && group.size > 1) {
    const members = groupMembers(ranked, group.id);
    const extras = ranked.filter((candidate) => candidate.group?.id !== group.id).slice(0, Math.max(0, 5 - members.length));
    return { kind: "ambiguous", candidates: [...members, ...extras].slice(0, 5), evidence: group.evidence };
  }

  // A required sequence is executed in group order. This is only possible when
  // every member survived extraction and the group still claims the same size.
  if (group && group.relation === "sequence" && group.size > 1) {
    const members = groupMembers(ranked, group.id);
    if (members.length === group.size) {
      return { kind: "sequence", candidates: members, evidence: group.evidence };
    }
    return {
      kind: "ambiguous",
      candidates: members.length > 0 ? members : ranked.slice(0, 5),
      evidence: "recovery sequence could not be reconstructed completely"
    };
  }

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

function adviceKey(candidate: ExtractedAdvice): string {
  return [candidate.source, candidate.command, candidate.args.join("\u0000"), candidate.line, candidate.pattern].join("\u0001");
}

function rankingReason(candidate: ExtractedAdvice, options: RankOptions): string {
  const prefer = options.prefer ?? ["stderr", "stdout"];
  const bits = ["confidence " + candidate.confidence.toFixed(2)];
  if (candidate.source === prefer[0]) bits.push(candidate.source + " preferred");
  if (options.originalCommand && baseName(candidate.command) === baseName(options.originalCommand)) {
    bits.push("matches original CLI");
  }
  if (candidate.group) {
    bits.push(candidate.group.relation + " group: " + candidate.group.evidence);
  }
  return bits.join("; ");
}

// Explains ranking and selection for JSON/terminal diagnostics. Ranking stays
// deterministic; this function only annotates the already-ranked candidates.
export function explainCandidates(
  ranked: ExtractedAdvice[],
  selection: SelectionOutcome,
  options: RankOptions = {}
): CandidateExplanation[] {
  const selectedKeys =
    selection.kind === "single"
      ? new Set([adviceKey(selection.candidate)])
      : selection.kind === "sequence"
        ? new Set(selection.candidates.map(adviceKey))
        : new Set<string>();
  // Selection candidates carry the execution order. Prefer their group
  // metadata when explaining a selected step so a chain assembled at runtime
  // does not report every step as "1 of 1".
  const selectedByKey =
    selection.kind === "sequence"
      ? new Map(selection.candidates.map((candidate) => [adviceKey(candidate), candidate]))
      : new Map<string, ExtractedAdvice>();

  return ranked.slice(0, 10).map((candidate, index) => {
    const key = adviceKey(candidate);
    const selected = selectedKeys.has(key);
    let decision: string;
    if (selected) {
      if (selection.kind === "sequence") {
        const group = selectedByKey.get(key)?.group ?? candidate.group;
        decision =
          "selected as required sequence step " + String((group?.index ?? 0) + 1) + " of " + String(group?.size ?? 1);
      } else {
        decision = "selected as the highest-ranked executable advice";
      }
    } else if (selection.kind === "ambiguous") {
      if (candidate.group?.relation === "alternative") {
        decision = "not executed: mutually exclusive alternative";
      } else {
        decision = "not executed: no evidence that it is required or safer than the alternatives";
      }
    } else if (selection.kind === "none") {
      decision = "not executed: no executable recovery advice matched the extracted output";
    } else {
      decision = "not executed: ranked below the selected recovery path";
    }
    return {
      command: candidate.command,
      args: [...candidate.args],
      source: candidate.source,
      line: candidate.line,
      pattern: candidate.pattern,
      confidence: candidate.confidence,
      rank: index + 1,
      selected,
      reason: rankingReason(candidate, options) + ". " + decision
    };
  });
}

export function buildDecision(
  kind: RecoveryDecision["kind"],
  selection: SelectionOutcome,
  ranked: ExtractedAdvice[],
  options: RankOptions = {},
  evidence?: string
): RecoveryDecision {
  const decision: RecoveryDecision = {
    kind,
    candidates: explainCandidates(ranked, selection, options)
  };
  if (evidence !== undefined) decision.evidence = evidence;
  return decision;
}
