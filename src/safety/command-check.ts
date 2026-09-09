import { splitShellWords } from "../util/shlex.js";

export interface CommandCheck {
  ok: boolean;
  reason?: string;
}

export interface SafetyOptions {
  shell?: boolean;
  allowedCommands?: string[];
  deniedCommands?: string[];
  allowPipes?: boolean;
  allowRedirection?: boolean;
  caseAllowCommands?: string[];
  caseDenyCommands?: string[];
}

const ALWAYS_DANGEROUS = new Set([
  "sudo",
  "su",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "mkfs",
  "dd",
  "format"
]);

function hasShellMetacharacters(text: string): { found: string | null } {
  const patterns: Array<[RegExp, string]> = [
    [/\$\(.+\)/, "command substitution $(...)"],
    [/`[^`]*`/, "command substitution with backticks"],
    [/\|\s*sh\b/, "piping into a shell"],
    [/\|\s*bash\b/, "piping into a shell"],
    [/\bcurl\b.*\|\s*sh\b/, "curl piped into a shell"],
    [/\bwget\b.*\|\s*sh\b/, "wget piped into a shell"],
    [/Invoke-Expression/, "PowerShell Invoke-Expression"],
    [/\/c\s+format\b/i, "shell format command"]
  ];
  for (const [re, label] of patterns) {
    if (re.test(text)) return { found: label };
  }
  return { found: null };
}

function containsChaining(text: string): string | null {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\u0027" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === "\"" && !inSingle) { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) continue;
    const two = text.slice(i, i + 2);
    if (two === "&&" || two === "||") return two;
    if (ch === ";") return ";";
  }
  return null;
}

export function checkCommandSafety(command: string, args: string[], options: SafetyOptions = {}): CommandCheck {
  const exe = command.trim();
  const base = exe.split("/").pop()?.split("\\").pop() ?? exe;
  const lowerBase = base.toLowerCase().replace(/\.exe$/, "").replace(/\.cmd$/, "").replace(/\.bat$/, "");

  const denied = new Set([
    ...(options.deniedCommands ?? []).map((s) => s.toLowerCase()),
    ...(options.caseDenyCommands ?? []).map((s) => s.toLowerCase())
  ]);
  if (denied.has(lowerBase) || denied.has(exe.toLowerCase())) {
    return { ok: false, reason: "Command " + JSON.stringify(exe) + " is on the deny list for this case." };
  }
  if (ALWAYS_DANGEROUS.has(lowerBase)) {
    return { ok: false, reason: "Command " + JSON.stringify(exe) + " is never allowed (dangerous system command)." };
  }

  if (lowerBase === "rm") {
    const joined = args.join(" ");
    if (/(^|\s)(\/|\*)(($|\s))/.test(joined) || args.includes("-rf") && (args.includes("/") || args.includes("/*"))) {
      return { ok: false, reason: "rm with a filesystem-root target is blocked." };
    }
    if (args.some((a) => a === ".." || a.includes("../") || a.includes("..\\"))) {
      return { ok: false, reason: "rm with parent-directory traversal is blocked." };
    }
  }

  const fullText = [exe, ...args].join(" ");
  const meta = hasShellMetacharacters(fullText);
  if (meta.found) {
    return { ok: false, reason: "Blocked dangerous shell construct: " + meta.found + "." };
  }

  if (!options.shell) {
    const chain = containsChaining(fullText);
    if (chain) {
      return { ok: false, reason: "Command chaining (" + chain + ") requires safety.shell: true, which is off." };
    }
    if (!options.allowPipes && /(^|\s)\|(\s|$)/.test(fullText)) {
      return { ok: false, reason: "Pipes are blocked by default. Set safety.allowPipes: true to opt in." };
    }
    if (!options.allowRedirection && /(^|\s)(>>?|<)(\s|$)/.test(fullText)) {
      return { ok: false, reason: "Shell redirection is blocked by default. Set safety.allowRedirection: true to opt in." };
    }
    for (const token of [exe, ...args]) {
      if (token.includes("\n") || token.includes("\0")) {
        return { ok: false, reason: "Command contains embedded newlines or null bytes." };
      }
    }
  }

  const allowed = [...(options.allowedCommands ?? []), ...(options.caseAllowCommands ?? [])];
  if (allowed.length > 0) {
    const set = new Set(allowed.map((s) => s.toLowerCase()));
    if (!set.has(lowerBase) && !set.has(exe.toLowerCase())) {
      return { ok: false, reason: "Command " + JSON.stringify(exe) + " is not in safety.allowedCommands." };
    }
  }

  return { ok: true };
}

export function checkRawCommandLine(raw: string, options: SafetyOptions = {}): CommandCheck {
  const tokens = splitShellWords(raw);
  if (!tokens || tokens.length === 0) {
    return { ok: false, reason: "Could not tokenize the suggested command. Refusing to execute it." };
  }
  const [command, ...args] = tokens as [string, ...string[]];
  return checkCommandSafety(command, args, options);
}

