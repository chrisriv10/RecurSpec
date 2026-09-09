import type { RunResult } from "../types/result.js";

export function renderMarkdown(result: RunResult): string {
  const lines: string[] = [];
  lines.push("## RecoverySpec");
  lines.push("");
  const rate = result.summary.recoveryRate === null ? "n/a" : result.summary.recoveryRate.toFixed(1) + "%";
  lines.push(result.summary.passed + " / " + result.summary.total + " recovery contracts passed (recovery rate " + rate + ").");
  lines.push("");
  lines.push("| Result | Case | Recovery |");
  lines.push("|---|---|---|");
  for (const c of result.cases) {
    const icon = c.status === "PASS" ? "✅" : "❌";
    const chain = [c.originalCommand, ...c.recoverySteps.map((s) => displayShort(s.command, s.args))].join(" → ");
    const recovery = c.status === "PASS" ? "`" + chain + "`" : c.status + " after `" + chain + "`";
    lines.push("| " + icon + " | " + c.name + " | " + recovery + " |");
  }
  return lines.join("\n") + "\n";
}

function displayShort(command: string, args: string[]): string {
  const base = command.split("/").pop()?.split("\\").pop() ?? command;
  const interesting = args.filter((a) => !a.startsWith("-")).slice(0, 2);
  return ([base, ...interesting].join(" "));
}

