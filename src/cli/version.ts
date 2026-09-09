import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const candidate of [path.join(here, "..", "package.json"), path.join(here, "..", "..", "package.json")]) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (parsed.version) return parsed.version;
      } catch {
        continue;
      }
    }
  } catch {
    // fall through to default
  }
  return "0.1.0";
}

export const version = loadVersion();
