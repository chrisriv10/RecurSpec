import { splitShellWords } from "../util/shlex.js";

export interface TokenizedCommand {
  command: string;
  args: string[];
}

export function tokenizeCommandLine(raw: string): TokenizedCommand | null {
  const cleaned = raw.trim().replace(/^[$#>%]\s*/, "").trim();
  if (cleaned.length === 0) return null;
  const tokens = splitShellWords(cleaned);
  if (!tokens || tokens.length === 0) return null;
  const [command, ...args] = tokens as [string, ...string[]];
  if (!command || /^\s*$/.test(command)) return null;
  return { command, args };
}

export function looksLikeCommand(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 300) return false;
  if (/\s{2,}/.test(trimmed) && !trimmed.includes("\"") && !trimmed.includes("\u0027")) return false;
  return /^[A-Za-z0-9_@.][A-Za-z0-9_@.:/\\-]*(\s+.+)?$/.test(trimmed);
}

