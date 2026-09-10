const ESCAPABLE_AFTER_BACKSLASH = new Set([" ", "\t", "\n", "\r", "\"", "\u0027", "\\", "$", "`"]);

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
      // A backslash escapes whitespace, quotes, and other shell-significant
      // characters. Anywhere else (notably Windows path separators) it is a
      // literal character, so `C:\tools\app.exe` and `node -e "a\nb"` survive.
      const next = i + 1 < input.length ? (input[i + 1] as string) : undefined;
      if (next !== undefined && ESCAPABLE_AFTER_BACKSLASH.has(next)) {
        escaped = true;
        continue;
      }
      current += ch;
      hasToken = true;
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
    if (!inSingle && !inDouble && ch === "#" && current === "") {
      // Shell-style trailing comment: "#" starts a comment only at a token
      // boundary, so URL fragments like foo#bar survive intact.
      break;
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

