import type { RunResult } from "../types/result.js";

export function renderJson(result: RunResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}

