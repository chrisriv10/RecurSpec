import type { RecoveryCase, RecurSpecConfig } from "../types/config.js";

const ALWAYS_PASSTHROUGH = ["PATH"];
const WINDOWS_PASSTHROUGH = ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT", "COMSPEC"];

export function buildCaseEnv(
  config: RecurSpecConfig,
  kase: RecoveryCase,
  parent: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ALWAYS_PASSTHROUGH) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  if (process.platform === "win32") {
    for (const name of WINDOWS_PASSTHROUGH) {
      const value = parent[name];
      if (value !== undefined && env[name] === undefined) env[name] = value;
    }
  }
  Object.assign(env, config.defaults?.env ?? {});
  for (const name of kase.inheritEnv ?? []) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, kase.env ?? {});
  return env;
}

