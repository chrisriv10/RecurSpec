import type { StreamAssertion } from "../types/config.js";

export interface StreamCheckResult {
  ok: boolean;
  messages: string[];
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function checkStream(label: string, actual: string, assertion: StreamAssertion | undefined): StreamCheckResult {
  if (!assertion) return { ok: true, messages: [] };
  const messages: string[] = [];
  let ok = true;

  for (const expected of toArray(assertion.contains)) {
    if (!actual.includes(expected)) {
      ok = false;
      messages.push(label + " should contain " + JSON.stringify(expected) + ".");
    }
  }
  for (const forbidden of toArray(assertion.notContains)) {
    if (actual.includes(forbidden)) {
      ok = false;
      messages.push(label + " should not contain " + JSON.stringify(forbidden) + ".");
    }
  }
  for (const pattern of toArray(assertion.matches)) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      ok = false;
      messages.push(label + " has an invalid regex " + JSON.stringify(pattern) + ".");
      continue;
    }
    if (!re.test(actual)) {
      ok = false;
      messages.push(label + " should match " + JSON.stringify(pattern) + ".");
    }
  }
  return { ok, messages };
}

export function checkExitCode(actual: number | null, expected: number | "nonzero" | "zero" | undefined): StreamCheckResult {
  if (expected === undefined) return { ok: true, messages: [] };
  if (actual === null) return { ok: false, messages: ["Process did not produce an exit code (killed or timed out)."] };
  if (expected === "nonzero") {
    return actual !== 0
      ? { ok: true, messages: [] }
      : { ok: false, messages: ["Expected a nonzero exit code, got 0."] };
  }
  if (expected === "zero") {
    return actual === 0
      ? { ok: true, messages: [] }
      : { ok: false, messages: ["Expected exit code 0, got " + actual + "."] };
  }
  return actual === expected
    ? { ok: true, messages: [] }
    : { ok: false, messages: ["Expected exit code " + expected + ", got " + actual + "."] };
}

