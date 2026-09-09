import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { resolveInWorkspace } from "../safety/paths.js";
import type { VerificationDetail } from "../types/result.js";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function checkFiles(
  workspaceDir: string,
  files: { exists?: string[]; notExists?: string[] } | undefined
): Promise<VerificationDetail[]> {
  if (!files) return [];
  const details: VerificationDetail[] = [];
  for (const rel of files.exists ?? []) {
    let resolved: string;
    try {
      resolved = resolveInWorkspace(workspaceDir, rel);
    } catch (err) {
      details.push({ ok: false, kind: "files.exists", message: String((err as Error).message) });
      continue;
    }
    const found = await exists(resolved);
    details.push({
      ok: found,
      kind: "files.exists",
      message: found ? "File exists: " + rel : "Expected file to exist: " + rel
    });
  }
  for (const rel of files.notExists ?? []) {
    const resolved = resolveInWorkspace(workspaceDir, rel);
    const found = await exists(resolved);
    details.push({
      ok: !found,
      kind: "files.notExists",
      message: !found ? "File correctly absent: " + rel : "Expected file to be absent: " + rel
    });
  }
  return details;
}

export function workspaceRelative(workspaceDir: string, p: string): string {
  return path.relative(workspaceDir, p) || ".";
}

