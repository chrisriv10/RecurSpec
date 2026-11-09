import type { ExtractedAdvice } from "../types/result.js";

// Conservative grouping of advice extracted from one stream.
//
// A multi-command block is only treated as a required sequence when the
// diagnostic supplies explicit evidence: a setting command pair that shares an
// executable and complementary argument prefixes, or an inline "then"
// connector. Everything else that lists several commands is reported as
// mutually exclusive/ambiguous and is never executed.

const BARE_LABEL =
  /^\s*(?:run|try|execute|to\s+fix\s+this,?\s+run|to\s+continue,?\s+run)\s*:?\s*$/i;
const ALTERNATIVE_LABEL =
  /^\s*(?:run|try|execute)\s+(?:one\s+of|either)\b[^\n]*:?\s*$/i;

const ALTERNATIVE_MARKERS = /\b(one\s+of|either|alternatively|optionally)\b/i;
const OR_MARKER = /\bor\b/i;
const THEN_MARKER = /\bthen\b/i;
const AND_MARKER = /\band\b/i;

const SETTING_COMMANDS = new Set(["config", "configure", "set"]);
const INTERPRETERS = new Set([
  "node",
  "nodejs",
  "python",
  "python3",
  "py",
  "ruby",
  "perl",
  "bash",
  "sh",
  "zsh",
  "pwsh",
  "powershell",
  "deno",
  "bun",
  "tsx"
]);

function executableName(command: string): string {
  return command.split("/").pop()?.split("\\").pop()?.toLowerCase().replace(/\.(exe|cmd|bat)$/, "") ?? command.toLowerCase();
}

function stripQuoted(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ");
}

function argsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, idx) => value === b[idx]);
}

function firstDifference(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) return i;
  }
  return max;
}

// Only setting-like commands can be complementary. A shared executable and a
// differing later argument is not enough: "docker build -t app ." and
// "docker build -t worker ." are alternative builds, and "git remote add
// origin ..." / "... upstream ..." are separate remotes, not a required order.
// Interpreted scripts (`node tool.mjs config ...`) keep their setting verb
// after the script path.
function isSettingLike(command: string, args: string[]): boolean {
  const first = args[0]?.toLowerCase();
  if (first !== undefined && SETTING_COMMANDS.has(first)) return true;
  const executable = executableName(command);
  if (!INTERPRETERS.has(executable) || args.length < 2) return false;
  const script = args[0] ?? "";
  if (!/[\\/]/.test(script) && !/\.(?:m?[jt]s|cjs|py|rb|sh|ps1)$/i.test(script)) return false;
  return SETTING_COMMANDS.has((args[1] ?? "").toLowerCase());
}

// True only for commands that look like complementary settings of the same
// tool, e.g. git config user.email ... / git config user.name ...
// Commands that differ only in their final value (config pull.rebase false /
// config pull.rebase true) are alternative values, not a sequence.
function formsComplementarySequence(items: ExtractedAdvice[]): boolean {
  if (items.length < 2) return false;
  const first = items[0] as ExtractedAdvice;
  if (items.some((item) => executableName(item.command) !== executableName(first.command))) return false;
  if (items.some((item) => !isSettingLike(item.command, item.args))) return false;
  if (items.slice(1).some((item) => argsEqual(item.args, first.args))) return false;
  for (const item of items.slice(1)) {
    const diff = firstDifference(first.args, item.args);
    const minLength = Math.min(first.args.length, item.args.length);
    if (diff === 0) return false;
    if (diff >= minLength - 1) return false;
  }
  return true;
}

function hasTrailingAnnotation(lines: string[]): boolean {
  return lines.length >= 2 && lines.every((line) => /(^|\s)#\s*\S/.test(line));
}

function isFenceDelimiter(text: string): boolean {
  return /^```/.test(text.trim());
}

interface LabelMatch {
  alternative: boolean;
  evidence: string;
}

function matchLabel(line: string): LabelMatch | null {
  if (ALTERNATIVE_LABEL.test(line)) {
    return { alternative: true, evidence: 'commands listed under a "one of/either" label' };
  }
  if (BARE_LABEL.test(line)) {
    const bare = line.trim().replace(/:$/, "").trim();
    return { alternative: false, evidence: 'commands listed after a bare "' + bare + '" label' };
  }
  return null;
}

function assignGroup(
  output: ExtractedAdvice[],
  indices: number[],
  relation: "sequence" | "alternative",
  evidence: string,
  id: string
): void {
  indices.forEach((itemIndex, index) => {
    const item = output[itemIndex] as ExtractedAdvice;
    output[itemIndex] = {
      ...item,
      group: { id, relation, evidence, index, size: indices.length }
    };
  });
}

export function attachAdviceGroups(
  items: ExtractedAdvice[],
  lines: string[],
  groupIdPrefix: string
): ExtractedAdvice[] {
  const output = items.map((item) => ({ ...item }));
  const used = new Set<number>();
  let groupCounter = 0;

  // 1. Inline connectors win over surrounding labels. A bare "Run" block that
  // contains "A or B" is still an alternative, and "A then B" is a sequence.
  const byLine = new Map<number, number[]>();
  output.forEach((item, index) => {
    const list = byLine.get(item.line) ?? [];
    list.push(index);
    byLine.set(item.line, list);
  });
  for (const [lineNumber, indices] of byLine) {
    if (indices.length < 2) continue;
    const line = lines[lineNumber - 1] ?? "";
    const outside = stripQuoted(line);
    const groupItems = indices.map((index) => output[index] as ExtractedAdvice);
    let relation: "sequence" | "alternative";
    let evidence: string;
    if (ALTERNATIVE_MARKERS.test(outside) || OR_MARKER.test(outside)) {
      relation = "alternative";
      evidence = 'inline "or"/"either" offers mutually exclusive options';
    } else if (THEN_MARKER.test(outside)) {
      relation = "sequence";
      evidence = 'inline "then" connector names a required order';
    } else if (AND_MARKER.test(outside)) {
      if (formsComplementarySequence(groupItems)) {
        relation = "sequence";
        evidence = 'inline "and" connector lists complementary required commands';
      } else {
        relation = "alternative";
        evidence = 'inline "and" groups commands whose required order is not established';
      }
    } else {
      continue;
    }
    groupCounter += 1;
    assignGroup(output, indices, relation, evidence, groupIdPrefix + "-inline-" + String(groupCounter));
    indices.forEach((index) => used.add(index));
  }

  // 2. Bare imperative labels followed by a small block of commands. Fence
  // delimiters are transparent: the commands inside a code block belong to
  // the label immediately before it.
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const label = matchLabel(lines[lineIndex] as string);
    if (!label) continue;
    const block: number[] = [];
    let started = false;
    for (let next = lineIndex + 1; next < Math.min(lineIndex + 8, lines.length); next++) {
      const text = (lines[next] as string).trim();
      if (isFenceDelimiter(text)) {
        if (started) break;
        continue;
      }
      if (text.length === 0) {
        if (started) break;
        continue;
      }
      started = true;
      const atLine: number[] = [];
      let lineHasItems = false;
      output.forEach((item, index) => {
        if (item.line === next + 1) {
          lineHasItems = true;
          if (!used.has(index)) atLine.push(index);
        }
      });
      if (atLine.length > 0) {
        block.push(...atLine);
      } else if (!lineHasItems) {
        // Prose or another label: this block is over.
        break;
      }
    }
    if (block.length < 2) continue;

    const groupItems = block.map((index) => output[index] as ExtractedAdvice);
    const rawLines = groupItems.map((item) => lines[item.line - 1] ?? item.raw);
    let relation: "sequence" | "alternative";
    let evidence: string;
    if (label.alternative) {
      relation = "alternative";
      evidence = label.evidence;
    } else if (hasTrailingAnnotation(rawLines)) {
      relation = "alternative";
      evidence = "each option carries a trailing annotation";
    } else if (!formsComplementarySequence(groupItems)) {
      relation = "alternative";
      evidence =
        "commands are listed as a group but do not provide enough evidence of a required order " +
        "(they must be complementary settings of one executable)";
    } else {
      relation = "sequence";
      evidence = label.evidence + " sharing one executable and complementary setting arguments";
    }
    groupCounter += 1;
    assignGroup(output, block, relation, evidence, groupIdPrefix + "-label-" + String(groupCounter));
    block.forEach((index) => used.add(index));
  }

  return output;
}
