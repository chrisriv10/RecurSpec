import pc from "picocolors";
import type { CaseResult, RunResult } from "../types/result.js";

export function isColorSupported(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  if (env["TERM"] === "dumb") return false;
  return true;
}

function statusLine(c: CaseResult, colors: boolean): string {
  const ok = c.status === "PASS";
  const mark = ok ? "âœ“" : "âœ—";
  const title = c.description ?? c.name;
  if (!colors) return mark + " " + title;
  return ok ? pc.green(mark + " " + title) : pc.red(mark + " " + title);
}

function chainLine(c: CaseResult): string {
  const parts = [c.originalCommand];
  for (const step of c.recoverySteps) {
    parts.push([step.command, ...step.args].join(" "));
  }
  if (c.verifyOk && c.status === "PASS") parts.push(c.originalCommand);
  return "  " + parts.join(" â†’ ");
}

export function renderTerminal(result: RunResult, options: { verbose?: boolean; version?: string } = {}): string {
  const colors = isColorSupported();
  const lines: string[] = [];
  const title = "RecurSpec" + (options.version ? " v" + options.version : ""); lines.push(colors ? pc.bold(title) : title);
  lines.push("");

  for (const c of result.cases) {
    lines.push(statusLine(c, colors));
    lines.push(chainLine(c));
    if (c.status === "PASS") {
      lines.push("  recovered in " + c.hops + (c.hops === 1 ? " hop" : " hops") + " Â· " + c.durationMs + "ms");
    } else {
      const detail = humanDetail(c);
      if (detail) {
        for (const dl of detail.split("\n")) lines.push("  " + dl);
      }
      lines.push("");
      lines.push("  Status: " + c.status);
      if (options.verbose) {
        lines.push("");
        lines.push("  Recovery path:");
        for (const label of c.trace.path) lines.push("    " + label);
      }
    }
    lines.push("");
  }

  const s = result.summary;
  lines.push("RecurSpec");
  lines.push("");
  lines.push(s.total + " recovery contracts");
  lines.push("");
  lines.push(s.passed + " passed");
  const partial = s.byStatus["PARTIAL_RECOVERY"] ?? 0;
  const dead = (s.byStatus["RECOVERY_DEAD_END"] ?? 0) + partial;
  if (dead > 0) lines.push(dead + " dead ends (" + partial + " partial)");
  const missing = s.byStatus["NO_RECOVERY_ADVICE"] ?? 0;
  if (missing > 0) lines.push(missing + " missing advice");
  if (s.loops > 0) lines.push(s.loops + (s.loops === 1 ? " recovery loop" : " recovery loops"));
  if (s.blocked > 0) lines.push(s.blocked + " blocked commands");
  if (s.invalidFailureStates > 0) lines.push(s.invalidFailureStates + " invalid failure states");
  lines.push("");
  lines.push("Recovery rate: " + (s.recoveryRate === null ? "n/a (no valid failure states)" : s.recoveryRate.toFixed(1) + "%"));
  lines.push("Median hops: " + (s.hops.median === null ? "n/a" : String(s.hops.median)));
  lines.push("Maximum hops: " + s.hops.max);
  if (s.seed !== undefined) lines.push("Seed: " + s.seed);
  for (const w of result.warnings) lines.push("warning: " + w);
  return lines.join("\n");
}

function humanDetail(c: CaseResult): string {
  switch (c.status) {
    case "NO_FAILURE":
      return "The command was expected to fail, but it succeeded.\nMarked INVALID FAILURE STATE instead of passing recovery.";
    case "FAILURE_MISMATCH":
      return "The command failed differently than the contract expects.\n" + (c.failureDetail ?? "");
    case "NO_RECOVERY_ADVICE":
      return "No executable recovery advice was found in the tool output.";
    case "AMBIGUOUS_RECOVERY": {
      const list = c.extractedAdvice.map((a) => "    - " + a.command + " " + a.args.join(" ") + " (" + a.source + ":" + a.line + ", " + a.pattern + ")").join("\n");
      return "Recovery advice was ambiguous, so nothing was executed:\n" + list;
    }
    case "BLOCKED_RECOVERY":
      return "BLOCKED RECOVERY COMMAND\n" + (c.blockedReason ?? "Blocked by safety policy.");
    case "RECOVERY_COMMAND_FAILED":
      return "The recovery command ran but failed.\n" + (c.failureDetail ?? "");
    case "PARTIAL_RECOVERY":
      return "Recovery made progress, but the original task still fails with a new error.";
    case "RECOVERY_DEAD_END": {
      const before = c.initialFailure ? snippet(c.initialFailure.stderr || c.initialFailure.stdout) : "";
      return "Recovery command succeeded, but the original task still fails.\n\n  Initial error:\n" + indent(before) + "\n\n  Status: RECOVERY_DEAD_END";
    }
    case "RECOVERY_LOOP":
      return "RECOVERY LOOP DETECTED\nThe same recovery step repeated. Stopped instead of looping forever.";
    case "VERIFY_FAILED":
      return "Verification failed:\n" + c.verification.filter((v) => !v.ok).map((v) => "    - " + v.message).join("\n");
    case "TIMEOUT":
      return "TIMEOUT\nA command exceeded its timeout and was killed.";
    case "INTERACTIVE_RECOVERY_UNSUPPORTED":
      return "INTERACTIVE_RECOVERY_UNSUPPORTED\nThe tool seems to need interactive input. Provide scripted stdin to support it.";
    case "INTERNAL_ERROR":
      return "Internal error: " + (c.error ?? "unknown");
    default:
      return c.failureDetail ?? "";
  }
}

function snippet(text: string): string {
  return text.trim().split("\n").slice(0, 6).join("\n");
}

function indent(text: string): string {
  return text.split("\n").map((l) => "    " + l).join("\n");
}


