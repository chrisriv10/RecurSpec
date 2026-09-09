import type { CaseResult, CaseStatus, RunResult, RunSummary } from "../types/result.js";

export function buildSummary(cases: CaseResult[], seed?: number): RunSummary {
  const byStatus = {} as Partial<Record<CaseStatus, number>>;
  for (const c of cases) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }
  const passed = byStatus["PASS"] ?? 0;
  const reachedFailure = cases.filter((c) => c.failureMatched).length;
  const recoveryRate = reachedFailure > 0 ? (passed / reachedFailure) * 100 : null;

  const hopValues = cases.filter((c) => c.status === "PASS").map((c) => c.hops);
  const average = hopValues.length > 0 ? hopValues.reduce((a, b) => a + b, 0) / hopValues.length : null;
  const sorted = [...hopValues].sort((a, b) => a - b);
  const median = sorted.length > 0 ? (sorted[Math.floor(sorted.length / 2)] as number) : null;
  const max = hopValues.length > 0 ? Math.max(...hopValues) : 0;

  const durations = cases.map((c) => c.durationMs);
  const averageMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const slowest = [...cases]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((c) => ({ name: c.name, durationMs: c.durationMs }));

  const summary: RunSummary = {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    byStatus,
    recoveryRate,
    hops: { values: hopValues, average, median, max },
    durations: { averageMs, slowest },
    blocked: byStatus["BLOCKED_RECOVERY"] ?? 0,
    loops: byStatus["RECOVERY_LOOP"] ?? 0,
    deadEnds: (byStatus["RECOVERY_DEAD_END"] ?? 0) + (byStatus["PARTIAL_RECOVERY"] ?? 0),
    invalidFailureStates: (byStatus["NO_FAILURE"] ?? 0) + (byStatus["FAILURE_MISMATCH"] ?? 0)
  };
  if (seed !== undefined) summary.seed = seed;
  return summary;
}

export function buildRunResult(cases: CaseResult[], warnings: string[], seed?: number): RunResult {
  return { version: 1, summary: buildSummary(cases, seed), cases, warnings };
}

