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
  { re: /\btry\s+`([^`]+)`/i, pattern: "try-backticks", confidence: 0.9 },
  { re: /`([^`]+)`/, pattern: "inline-backticks", confidence: 0.8 },
  { re: /\brun\s+(?:this\s+)?(?:command\s*)?[:\-]?\s*([a-zA-Z0-9_@.][^\n]{1,200})/i, pattern: "run-phrase", confidence: 0.7 },
  { re: /\btry\s+(?:this\s+)?[:\-]?\s*([a-zA-Z0-9_@.][^\n]{1,200})/i, pattern: "try-phrase", confidence: 0.7 },
  { re: /\bexecute\s+(?:this\s+)?[:\-]?\s*([a-zA-Z0-9_@.][^\n]{1,200})/i, pattern: "execute-phrase", confidence: 0.7 },
  { re: /to\s+fix\s+this,?\s+run\s+([^\n]{1,200})/i, pattern: "to-fix-run", confidence: 0.85 },
  { re: /to\s+continue,?\s+(?:run|execute)\s+([^\n]{1,200})/i, pattern: "to-continue-run", confidence: 0.85 },
  { re: /you\s+can\s+fix\s+this\s+with\s*:?\s*([^\n]{1,200})/i, pattern: "fix-with", confidence: 0.85 }
];

function stripWrapping(text: string): string {
  return text.trim().replace(/^["\u0027]+|["\u0027.,;:!]+$/g, "").trim();
}

function harvestFromLine(line: string, lineNumber: number, hits: RawHit[]): void {
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

function collectForStream(text: string, source: "stderr" | "stdout", options: ExtractionOptions): ExtractedAdvice[] {
  const hits: RawHit[] = [];
  harvestFencedBlocks(text, hits);
  text.split("\n").forEach((line, idx) => harvestFromLine(line, idx + 1, hits));
  const out: ExtractedAdvice[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const tokenized = tokenizeCommandLine(hit.raw);
    if (!tokenized) continue;
    if (options.mode !== "all" && !isPlausibleCommand(tokenized.command)) continue;
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
  if (/^(and|or|the|then|with|from|this|that|your|you|run|try|use)$/i.test(command)) return false;
  return /^[A-Za-z0-9_@.][A-Za-z0-9_@.:/\\-]*$/.test(command);
}

