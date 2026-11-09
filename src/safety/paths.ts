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

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  // A segment that begins with ".." means an actual parent step; a directory
  // literally named "..cache" (or ".cache") is not an escape attempt.
  return relative !== ".." && !relative.startsWith(".." + path.sep);
}

export function resolveInWorkspace(workspaceDir: string, target: string): string {
  const resolved = path.resolve(workspaceDir, target);
  if (!isPathInside(workspaceDir, resolved)) {
    throw new Error("Refusing to touch path outside the workspace: " + target);
  }
  return resolved;
}

