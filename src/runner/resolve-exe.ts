import { accessSync, constants } from "node:fs";
import path from "node:path";

function isExecutableFile(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Deterministic cross-platform executable lookup. Returns the resolved path
// or null when nothing executable matches. Unlike spawning and inspecting
// the failure, this behaves identically on Windows, macOS, and Linux:
// a missing tool is always reported the same way.
export function resolveExecutable(command: string, env: Record<string, string>): string | null {
  const trimmed = command.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    const candidates = [trimmed];
    if (process.platform === "win32") {
      candidates.push(trimmed + ".exe", trimmed + ".cmd", trimmed + ".bat");
    }
    for (const c of candidates) {
      if (isExecutableFile(c)) return c;
    }
    return null;
  }
  const pathValue = env["PATH"] ?? env["Path"] ?? "";
  const dirs = pathValue.split(path.delimiter).filter((d) => d.length > 0);
  const extensions = process.platform === "win32"
    ? (env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase())
    : [""];
  for (const dir of dirs) {
    const base = path.join(dir, trimmed);
    if (process.platform !== "win32") {
      if (isExecutableFile(base)) return base;
      continue;
    }
    const lowered = base.toLowerCase();
    if (extensions.some((ext) => lowered.endsWith(ext)) && isExecutableFile(base)) return base;
    for (const ext of extensions) {
      const candidate = base + ext;
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}
