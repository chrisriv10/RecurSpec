import { resolveConfig } from "./config/loader.js";
import { runCase, runStepsBestEffort } from "./runner/runner.js";
import { buildRunResult } from "./reporting/summary.js";
import type { RecoverySpecConfig } from "./types/config.js";
import type { CaseResult, RunResult } from "./types/result.js";

export type { RecoverySpecConfig, RecoveryCase } from "./types/config.js";
export type { CaseResult, RunResult, RunSummary, CaseStatus, ExecutedCommand, ExtractedAdvice } from "./types/result.js";
export type { RecoveryNode, RecoveryEdge, RecoveryTrace } from "./types/recovery.js";

export interface RunOptions {
  configPath?: string;
  cwd?: string;
  filterCases?: string[];
  filterTags?: string[];
  failFast?: boolean;
  seed?: number;
  verbose?: boolean;
}

export interface FilteredSelection {
  config: RecoverySpecConfig;
  configDir: string;
  configPath: string;
  cases: RecoverySpecConfig["cases"];
}

export async function selectCases(cwd: string, options: RunOptions = {}): Promise<FilteredSelection> {
  const loaded = await resolveConfig(cwd, options.configPath);
  let cases = loaded.config.cases;
  if (options.filterCases && options.filterCases.length > 0) {
    const wanted = new Set(options.filterCases);
    cases = cases.filter((c) => wanted.has(c.name));
  }
  if (options.filterTags && options.filterTags.length > 0) {
    const tags = new Set(options.filterTags);
    cases = cases.filter((c) => (c.tags ?? []).some((t) => tags.has(t)));
  }
  return { config: loaded.config, configDir: loaded.configDir, configPath: loaded.configPath, cases };
}

export async function runRecoverySpec(options: RunOptions = {}): Promise<RunResult> {
  const cwd = options.cwd ?? process.cwd();
  const { config, configDir, cases } = await selectCases(cwd, options);
  const results: CaseResult[] = [];
  const warnings: string[] = [];
  const base = { cwd: configDir, env: { ...process.env } as Record<string, string>, defaultTimeoutMs: 30000, shell: false };

  await runStepsBestEffort(config.beforeAll, base, warnings, "beforeAll");

  for (const kase of cases) {
    const result = await runCase(config, kase, { configDir, seed: options.seed, verbose: options.verbose });
    results.push(result);
    if (options.failFast && result.status !== "PASS") break;
  }

  await runStepsBestEffort(config.afterAll, base, warnings, "afterAll");

  return buildRunResult(results, warnings, options.seed);
}
