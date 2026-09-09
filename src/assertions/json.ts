import { readFile } from "node:fs/promises";
import { resolveInWorkspace } from "../safety/paths.js";
import type { JsonAssertion } from "../types/config.js";
import type { VerificationDetail } from "../types/result.js";

function getPath(obj: unknown, dotted: string): unknown {
  let current: unknown = obj;
  for (const part of dotted.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function checkJsonAssertions(
  workspaceDir: string,
  json: JsonAssertion | JsonAssertion[] | undefined
): Promise<VerificationDetail[]> {
  if (!json) return [];
  const list = Array.isArray(json) ? json : [json];
  const details: VerificationDetail[] = [];
  for (const assertion of list) {
    let resolved: string;
    try {
      resolved = resolveInWorkspace(workspaceDir, assertion.path);
    } catch (err) {
      details.push({ ok: false, kind: "json", message: String((err as Error).message) });
      continue;
    }
    let raw: string;
    try {
      raw = await readFile(resolved, "utf8");
    } catch {
      details.push({ ok: false, kind: "json", message: "JSON file not found: " + assertion.path });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      details.push({ ok: false, kind: "json", message: "File is not valid JSON: " + assertion.path });
      continue;
    }
    for (const [key, expected] of Object.entries(assertion.assertions)) {
      const actual = getPath(parsed, key);
      const ok = deepEqual(actual, expected);
      details.push({
        ok,
        kind: "json",
        message: ok
          ? assertion.path + " " + key + " matches " + JSON.stringify(expected)
          : assertion.path + " " + key + " expected " + JSON.stringify(expected) + " but got " + JSON.stringify(actual)
      });
    }
  }
  return details;
}

