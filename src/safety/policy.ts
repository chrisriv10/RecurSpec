import type { RecoveryCase, RecurSpecConfig, SafetySpec } from "../types/config.js";

export interface EffectiveSafety {
  shell: boolean;
  network: "allow" | "deny" | "warn";
  allowedCommands?: string[];
  deniedCommands?: string[];
  allowPipes: boolean;
  allowRedirection: boolean;
  caseAllowCommands?: string[];
  caseDenyCommands?: string[];
}

export function effectiveSafety(config: RecurSpecConfig, kase: RecoveryCase): EffectiveSafety {
  const globalSafety: SafetySpec = config.safety ?? {};
  const caseSafety: SafetySpec = kase.safety ?? {};
  const recovery = kase.recovery ?? {};
  return {
    shell: caseSafety.shell ?? globalSafety.shell ?? config.defaults?.shell ?? false,
    network: caseSafety.network ?? globalSafety.network ?? "warn",
    allowedCommands: caseSafety.allowedCommands ?? globalSafety.allowedCommands,
    deniedCommands: caseSafety.deniedCommands ?? globalSafety.deniedCommands,
    allowPipes: caseSafety.allowPipes ?? globalSafety.allowPipes ?? false,
    allowRedirection: caseSafety.allowRedirection ?? globalSafety.allowRedirection ?? false,
    caseAllowCommands: recovery.allowCommands,
    caseDenyCommands: recovery.denyCommands
  };
}

export function networkWarning(network: string): string | null {
  if (network === "deny") {
    return "safety.network is deny, but the local backend cannot enforce OS-level network isolation. Commands run in an isolated workspace directory without network sandboxing; a future Docker backend will enforce this. Treat network access as advisory-only.";
  }
  return null;
}

