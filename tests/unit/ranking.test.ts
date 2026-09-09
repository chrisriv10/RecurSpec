import { describe, expect, it } from "vitest";
import { rankCandidates, selectCandidate } from "../../src/recovery/ranking.js";
import type { ExtractedAdvice } from "../../src/types/result.js";

function advice(overrides: Partial<ExtractedAdvice> & { command: string }): ExtractedAdvice {
  return {
    args: [],
    raw: overrides.command,
    source: "stderr",
    line: 1,
    confidence: 0.8,
    pattern: "test",
    ...overrides
  };
}

describe("rankCandidates", () => {
  it("prefers higher confidence first", () => {
    const ranked = rankCandidates([
      advice({ command: "b", confidence: 0.7 }),
      advice({ command: "a", confidence: 0.95 })
    ]);
    expect(ranked[0]?.command).toBe("a");
  });

  it("prefers stderr by default", () => {
    const ranked = rankCandidates([
      advice({ command: "a", source: "stdout", confidence: 0.8 }),
      advice({ command: "b", source: "stderr", confidence: 0.8 })
    ]);
    expect(ranked[0]?.command).toBe("b");
  });

  it("honours a stdout preference", () => {
    const ranked = rankCandidates(
      [
        advice({ command: "a", source: "stdout", confidence: 0.8 }),
        advice({ command: "b", source: "stderr", confidence: 0.8 })
      ],
      { prefer: ["stdout", "stderr"] }
    );
    expect(ranked[0]?.command).toBe("a");
  });

  it("prefers commands related to the original CLI", () => {
    const ranked = rankCandidates(
      [
        advice({ command: "npm", confidence: 0.9 }),
        advice({ command: "acme", confidence: 0.9 })
      ],
      { originalCommand: "acme" }
    );
    expect(ranked[0]?.command).toBe("acme");
  });
});

describe("selectCandidate", () => {
  it("returns none when empty", () => {
    expect(selectCandidate([])).toEqual({ kind: "none" });
  });

  it("returns single for one candidate", () => {
    const c = advice({ command: "acme" });
    expect(selectCandidate([c])).toEqual({ kind: "single", candidate: c });
  });

  it("flags low-confidence ambiguity instead of guessing", () => {
    const out = selectCandidate([advice({ command: "a", confidence: 0.7 }), advice({ command: "b", confidence: 0.7 })]);
    expect(out.kind).toBe("ambiguous");
  });

  it("picks a clear high-confidence winner", () => {
    const top = advice({ command: "a", confidence: 0.95 });
    const out = selectCandidate([top, advice({ command: "b", confidence: 0.7 })]);
    expect(out).toEqual({ kind: "single", candidate: top });
  });
});
