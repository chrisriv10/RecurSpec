import path from "node:path";

export function isDangerousWorkspacePath(p: string): boolean {
  const normalized = p.replace(/\\/g, "/");
  if (normalized === "" || normalized === "." || normalized === "./") return false;
  if (normalized.startsWith("/")) return true;
  if (/^[A-Za-z]:(\/|$)/.test(normalized)) return true;
  if (normalized.startsWith("\\\\")) return true;
  const segments = normalized.split("/");
  let depth = 0;
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}

export function resolveInWorkspace(workspaceDir: string, target: string): string {
  const resolved = path.resolve(workspaceDir, target);
  const relative = path.relative(workspaceDir, resolved);
  if (relative === "") return resolved;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to touch path outside the workspace: " + target);
  }
  return resolved;
}

