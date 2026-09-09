const REPLACEMENTS: Array<[RegExp, string]> = [
  [/recoveryspec-[A-Za-z0-9_-]+/g, "recoveryspec-<tmp>"],
  [/[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\[^\s"<>|]+/g, "<tmp>"],
  [/\/(var\/folders\/[^\s"<>|]+|tmp\/[^\s"<>|]*)/g, "<tmp>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "<timestamp>"],
  [/:(\d{2,5})\b/g, ":<port>"],
  [/\bpid\s+\d+\b/gi, "pid <pid>"],
  [/\bprocess\s+\d+\b/gi, "process <pid>"]
];

export function normalizeOutput(text: string): string {
  let out = text;
  for (const [re, replacement] of REPLACEMENTS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function signatureFor(command: string, args: string[], output: string): string {
  const normalized = normalizeOutput(output).trim().replace(/\s+/g, " ");
  return command + " " + args.join(" ") + " :: " + normalized.slice(0, 500);
}

