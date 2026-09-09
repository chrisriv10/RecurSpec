import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCase } from "../../src/runner/runner.js";
import type { RecoveryCase, RecoverySpecConfig } from "../../src/types/config.js";
import type { CaseResult } from "../../src/types/result.js";

export const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export function acmeArgs(subcommand: string, extra: string[] = []): string[] {
  return [path.join("demo", "acme-cli", "acme.mjs"), subcommand, ...extra];
}

export function baseCase(overrides: Partial<RecoveryCase> & { name: string }): RecoveryCase {
  return {
    workspace: { copy: ["demo/acme-cli/**"] },
    run: { command: process.execPath, args: acmeArgs("deploy") },
    ...overrides
  };
}

export function baseConfig(cases: RecoveryCase[]): RecoverySpecConfig {
  return { version: 1, cases };
}

export async function runSingleCase(kase: RecoveryCase): Promise<CaseResult> {
  return runCase(baseConfig([kase]), kase, { configDir: repoRoot });
}
