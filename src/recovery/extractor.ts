import { tokenizeCommandLine } from "./tokenizer.js";
import type { ExtractedAdvice } from "../types/result.js";

interface RawHit {
  raw: string;
  pattern: string;
  confidence: number;
  line: number;
}

const LEAD_PATTERNS: Array<{ re: RegExp; pattern: string; confidence: number }> = [
  { re: /^\s*run\s*:\s*(.+)$/i, pattern: "run-colon", confidence: 0.9 },
  { re: /^\s*try\s*:\s*(.+)$/i, pattern: "try-colon", confidence: 0.9 },
  { re: /^\s*execute\s*:\s*(.+)$/i, pattern: "execute-colon", confidence: 0.9 },
  { re: /^\s*use\s*:\s*(.+)$/i, pattern: "use-colon", confidence: 0.75 },
  { re: /^\s*\$\s*(.+)$/, pattern: "shell-prompt", confidence: 0.95 },
  { re: /^\s*>\s*(.+)$/, pattern: "prompt-gt", confidence: 0.7 }
];

const INLINE_PATTERNS: Array<{ re: RegExp; pattern: string; confidence: number }> = [
  { re: /\brun\s+`([^`]+)`/i, pattern: "run-backticks", confidence: 0.95 },
  { re: /\bexecute\s+`([^`]+)`/i, pattern: "execute-backticks", confidence: 0.9 },
  { re: /\buse\s+`([^`]+)`/i, pattern: "use-backticks", confidence: 0.9 },
  { re: /\btry\s+`([^`]+)`/i, pattern: "try-backticks", confidence: 0.9 },
  { re: /`([^`]+)`/, pattern: "inline-backticks", confidence: 0.8 },
  { re: /\brun\s+'([^']+)'/i, pattern: "run-single-quotes", confidence: 0.9 },
  { re: /\btry\s+'([^']+)'/i, pattern: "try-single-quotes", confidence: 0.85 },
  { re: /\bexecute\s+'([^']+)'/i, pattern: "execute-single-quotes", confidence: 0.85 },
  { re: /\brun\s+(?:this\s+)?(?:command\s*)?[:-]?\s*([a-zA-Z0-9_@.][^\n]{1,200})/i, pattern: "run-phrase", confidence: 0.7 },
  { re: /\btry\s+(?:this\s+)?[:-]?\s*([a-zA-Z0-9_@.][^\n]{1,200})/i, pattern: "try-phrase", confidence: 0.7 },
  { re: /\bexecute\s+(?:this\s+)?[:-]?\s*([a-zA-Z0-9_@.][^\n]{1,200})/i, pattern: "execute-phrase", confidence: 0.7 },
  { re: /to\s+fix\s+this,?\s+run\s+([^\n]{1,200})/i, pattern: "to-fix-run", confidence: 0.85 },
  { re: /to\s+continue,?\s+(?:run|execute)\s+([^\n]{1,200})/i, pattern: "to-continue-run", confidence: 0.85 },
  { re: /you\s+can\s+fix\s+this\s+with\s*:?\s*([^\n]{1,200})/i, pattern: "fix-with", confidence: 0.85 }
];

function stripWrapping(text: string): string {
  // Strip trailing punctuation first, then surrounding quotes only in
  // matched pairs, so quoted values at the end survive intact.
  let out = text.trim().replace(/[.,;:!]+$/g, "").trim();
  for (;;) {
    const startsDouble = out.startsWith("\"");
    const startsSingle = out.startsWith("\u0027");
    const endsDouble = out.endsWith("\"");
    const endsSingle = out.endsWith("\u0027");
    if (out.length >= 2 && ((startsDouble && endsDouble) || (startsSingle && endsSingle))) {
      out = out.slice(1, -1).trim();
    } else {
      return out;
    }
  }
}

function harvestHintLine(line: string, lineNumber: number, hits: RawHit[]): void {
  // A hint: line only counts when the remainder is an indented command line.
  // Flowing prose ("hint: preference for all repositories...") is not advice.
  const m = /^\s*hint\s*:(\s+)(.+)$/i.exec(line);
  if (!m) return;
  const gap = m[1] ?? "";
  if (!(gap.length >= 2 || gap.includes("\t"))) return;
  const candidate = stripWrapping(m[2] ?? "");
  if (candidate.length === 0 || candidate.length > 300) return;
  if (candidate.split(/\s+/).length < 2) return;
  hits.push({ raw: candidate, pattern: "hint-colon", confidence: 0.75, line: lineNumber });
}

function harvestFromLine(line: string, lineNumber: number, hits: RawHit[]): void {
  harvestHintLine(line, lineNumber, hits);
  for (const lead of LEAD_PATTERNS) {
    const m = lead.re.exec(line);
    if (m && m[1]) {
      const candidate = stripWrapping(m[1]);
      if (candidate.length > 0 && candidate.length <= 300) {
        hits.push({ raw: candidate, pattern: lead.pattern, confidence: lead.confidence, line: lineNumber });
      }
    }
  }
  for (const inline of INLINE_PATTERNS) {
    const flags = inline.re.flags.includes("g") ? inline.re.flags : inline.re.flags + "g";
    const re = new RegExp(inline.re.source, flags);
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(line)) !== null && guard < 10) {
      guard += 1;
      const candidate = stripWrapping(m[1] ?? "");
      if (candidate.length > 0 && candidate.length <= 300) {
        hits.push({ raw: candidate, pattern: inline.pattern, confidence: inline.confidence, line: lineNumber });
      }
      if (m[0].length === 0) re.lastIndex += 1;
      if (!inline.pattern.endsWith("-backticks")) break;
    }
  }
}

function harvestFencedBlocks(text: string, hits: RawHit[]): void {
  const fence = /```(?:\w+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    const body = m[1] ?? "";
    const before = text.slice(0, m.index);
    const baseLine = before.split("\n").length;
    body.split("\n").forEach((line, idx) => {
      const cleaned = line.trim().replace(/^[$#>%]\s*/, "").trim();
      if (cleaned.length === 0 || cleaned.length > 300) return;
      if (/^[a-zA-Z0-9_@.][A-Za-z0-9_@.:/\\-]*(\s+.+)?$/.test(cleaned)) {
        hits.push({ raw: cleaned, pattern: "fenced-code-block", confidence: 0.85, line: baseLine + idx });
      }
    });
  }
}

export interface ExtractionOptions {
  mode?: "command" | "all";
}

// eslint-disable-next-line no-control-regex -- ANSI escapes are control characters by definition.
const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

const CONT_LEADS: Array<{ re: RegExp; pattern: string; confidence: number }> = [
  { re: /^\s*run\s*:\s*$/i, pattern: "run-colon-continuation", confidence: 0.85 },
  { re: /^\s*run\s*$/i, pattern: "run-continuation", confidence: 0.8 },
  { re: /^\s*try\s*:\s*$/i, pattern: "try-colon-continuation", confidence: 0.85 },
  { re: /^\s*execute\s*:\s*$/i, pattern: "execute-colon-continuation", confidence: 0.85 },
  { re: /to\s+continue,?\s+(?:run|execute)\s*:\s*$/i, pattern: "to-continue-run-continuation", confidence: 0.85 },
  { re: /to\s+fix\s+this,?\s+run\s*:\s*$/i, pattern: "to-fix-run-continuation", confidence: 0.85 }
];

function harvestContinuations(lines: string[], hits: RawHit[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const lead = CONT_LEADS.find((c) => c.re.test(line));
    if (!lead) continue;
    // Collect consecutive command lines after a bare label, as in git
    // multi-line advice. Stops at the first blank line past the start.
    let collected = 0;
    let started = false;
    for (let j = i + 1; j < Math.min(i + 7, lines.length) && collected < 3; j++) {
      const next = (lines[j] as string).trim();
      if (next.length === 0) {
        if (started) break;
        continue;
      }
      started = true;
      if (next.length > 300) break;
      hits.push({ raw: next, pattern: lead.pattern, confidence: lead.confidence, line: j + 1 });
      collected += 1;
    }
  }
}

function collectForStream(text: string, source: "stderr" | "stdout", options: ExtractionOptions): ExtractedAdvice[] {
  const clean = stripAnsi(text);
  const hits: RawHit[] = [];
  harvestFencedBlocks(clean, hits);
  const lines = clean.split("\n");
  lines.forEach((line, idx) => harvestFromLine(line, idx + 1, hits));
  harvestContinuations(lines, hits);
  const out: ExtractedAdvice[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    // A hit spanning lines is prose or an injection attempt, never a command.
    if (hit.raw.includes("\n") || hit.raw.includes("\r")) continue;
    const tokenized = tokenizeCommandLine(hit.raw);
    if (!tokenized) continue;
    if (options.mode !== "all" && !isPlausibleCommand(tokenized.command)) continue;
    // A bare backtick span whose "command" is a filesystem path ("destination
    // `C:\proj`), not verb-led advice) is a path mention, not an instruction.
    // Verb-led patterns (run/try/execute/fenced) may still carry paths.
    if (hit.pattern === "inline-backticks" && /[/\\]/.test(tokenized.command)) continue;
    const key = tokenized.command + "::" + tokenized.args.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      command: tokenized.command,
      args: tokenized.args,
      raw: hit.raw,
      source,
      line: hit.line,
      confidence: hit.confidence,
      pattern: hit.pattern
    });
  }
  return out;
}

export function extractFromStreams(
  stdout: string,
  stderr: string,
  options: ExtractionOptions = {}
): ExtractedAdvice[] {
  const fromStdout = collectForStream(stdout, "stdout", options);
  const fromErr = collectForStream(stderr, "stderr", options);
  const seen = new Set<string>();
  const merged: ExtractedAdvice[] = [];
  for (const c of [...fromStdout, ...fromErr]) {
    const key = c.source + "::" + c.command + "::" + c.args.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return merged;
}

export function extractCandidates(
  stdout: string,
  stderr: string,
  options: ExtractionOptions = {}
): ExtractedAdvice[] {
  return extractFromStreams(stdout, stderr, options);
}

function isPlausibleCommand(command: string): boolean {
  if (command.length > 64) return false;
  // A bare English word (modal, auxiliary, preposition, ...) after "run" is
  // prose ("run can be found in: ..."), never an executable name.
  if (/^(and|or|the|then|with|from|this|that|your|you|run|try|use|be|is|are|was|were|been|being|has|have|had|do|does|did|can|could|should|would|may|might|must|shall|will|to|in|on|at|by|for|of|a|an|if|when|where|how|why|what|which|who|not|no|it|as|so)$/i.test(command)) return false;
  return /^[A-Za-z0-9_@.][A-Za-z0-9_@.:/\\-]*$/.test(command);
}
