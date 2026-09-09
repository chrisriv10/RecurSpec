export function splitShellWords(input: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let hasToken = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (escaped) {
      current += ch;
      escaped = false;
      hasToken = true;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "\u0027" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
      continue;
    }
    if (ch === "\"" && !inSingle) {
      inDouble = !inDouble;
      hasToken = true;
      continue;
    }
    if (!inSingle && !inDouble && (ch === " " || ch === "\t" || ch === "\n" || ch === "\r")) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (escaped || inSingle || inDouble) return null;
  if (hasToken) tokens.push(current);
  return tokens;
}

