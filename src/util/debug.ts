export function isDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env["DEBUG"] ?? "";
  return flag.split(",").map((s) => s.trim().toLowerCase()).includes("recoveryspec");
}

export function debugLog(message: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isDebugEnabled(env)) {
    process.stderr.write("[recoveryspec:debug] " + message + "\n");
  }
}

