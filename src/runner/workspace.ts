import { mkdtemp, mkdir, rm, writeFile, readFile, stat, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import fg from "fast-glob";
import { isDangerousWorkspacePath, resolveInWorkspace } from "../safety/paths.js";
import type { MutateSpec, WorkspaceSpec } from "../types/config.js";

export interface PreparedWorkspace {
  dir: string;
  cleanup: (preserve: boolean) => Promise<void>;
}

function assertSafeTarget(target: string, kind: string): void {
  if (isDangerousWorkspacePath(target)) {
    throw new Error("Refusing " + kind + " outside the isolated workspace: " + JSON.stringify(target));
  }
}

export async function createWorkspace(prefix = "recoveryspec-"): Promise<PreparedWorkspace> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup: async (preserve: boolean) => {
      if (preserve) return;
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  };
}

export async function applyWorkspaceSpec(
  workspaceDir: string,
  projectDir: string,
  spec: WorkspaceSpec | undefined
): Promise<void> {
  if (!spec) return;

  if (spec.root) {
    assertSafeTarget(spec.root, "workspace root");
  }
  const root = spec.root ? resolveInWorkspace(workspaceDir, spec.root) : workspaceDir;
  await mkdir(root, { recursive: true });

  for (const dir of spec.mkdir ?? []) {
    assertSafeTarget(dir, "mkdir");
    await mkdir(resolveInWorkspace(root, dir), { recursive: true });
  }

  for (const pattern of spec.copy ?? []) {
    assertSafeTarget(pattern, "copy");
    const matches = await fg(pattern, { cwd: projectDir, dot: true, onlyFiles: false, followSymbolicLinks: false });
    if (matches.length === 0) continue;
    for (const rel of matches) {
      const src = path.join(projectDir, rel);
      const dest = resolveInWorkspace(root, rel);
      const st = await stat(src);
      if (st.isDirectory()) {
        await mkdir(dest, { recursive: true });
      } else {
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, await readFile(src));
      }
    }
  }

  for (const [rel, content] of Object.entries(spec.write ?? {})) {
    assertSafeTarget(rel, "write");
    const dest = resolveInWorkspace(root, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }

  for (const rel of spec.remove ?? []) {
    assertSafeTarget(rel, "remove");
    const target = resolveInWorkspace(root, rel);
    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
    }
  }
}

export async function applyMutations(
  workspaceDir: string,
  mutate: MutateSpec | undefined,
  env: Record<string, string>
): Promise<{ env: Record<string, string> }> {
  const nextEnv = { ...env };
  if (!mutate) return { env: nextEnv };

  for (const rel of mutate.delete ?? []) {
    assertSafeTarget(rel, "mutation delete");
    const target = resolveInWorkspace(workspaceDir, rel);
    if (existsSync(target)) await rm(target, { recursive: true, force: true });
  }
  for (const name of mutate.envRemove ?? []) {
    delete nextEnv[name];
  }
  for (const [key, value] of Object.entries(mutate.envSet ?? {})) {
    nextEnv[key] = value;
  }
  for (const rel of mutate.emptyFile ?? []) {
    assertSafeTarget(rel, "mutation emptyFile");
    const target = resolveInWorkspace(workspaceDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "", "utf8");
  }
  for (const rel of mutate.invalidJson ?? []) {
    assertSafeTarget(rel, "mutation invalidJson");
    const target = resolveInWorkspace(workspaceDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "{ this is not valid json,,,", "utf8");
  }
  for (const rel of mutate.invalidYaml ?? []) {
    assertSafeTarget(rel, "mutation invalidYaml");
    const target = resolveInWorkspace(workspaceDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, ":\t- [unclosed\n  bad: { indent", "utf8");
  }
  for (const rel of mutate.readOnly ?? []) {
    assertSafeTarget(rel, "mutation readOnly");
    const target = resolveInWorkspace(workspaceDir, rel);
    if (existsSync(target)) {
      try {
        await chmod(target, 0o444);
      } catch {
        await chmod(target, 0o666);
        throw new Error("readOnly mutation is not supported on this platform for " + rel);
      }
    }
  }
  for (const dir of mutate.createDirs ?? []) {
    assertSafeTarget(dir, "mutation createDirs");
    await mkdir(resolveInWorkspace(workspaceDir, dir), { recursive: true });
  }
  for (const [rel, content] of Object.entries(mutate.write ?? {})) {
    assertSafeTarget(rel, "mutation write");
    const target = resolveInWorkspace(workspaceDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return { env: nextEnv };
}

