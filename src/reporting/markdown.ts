import type { RunResult } from "../types/result.js";

export function renderMarkdown(result: RunResult): string {
  const lines: string[] = [];
  lines.push("## RecurSpec");
  lines.push("");
  const rate = result.summary.recoveryRate === null ? "n/a" : result.summary.recoveryRate.toFixed(1) + "%";
  lines.push(result.summary.passed + " / " + result.summary.total + " recovery contracts passed (recovery rate " + rate + ").");
  lines.push("");
  lines.push("| Result | Case | Recovery |");
  lines.push("|---|---|---|");
  for (const c of result.cases) {
    const icon = c.status === "PASS" ? "✅" : "❌";
    const parts = [c.originalCommand, ...c.recoverySteps.map((s) => displayShort(s.command, s.args))];
    // Only retry recovery reruns the original command.
    if (c.status === "PASS" && c.completion.mode === "retry") parts.push(c.originalCommand);
    const chain = parts.join(" → ");
    let recovery: string;
    if (c.status === "PASS") {
      recovery = "`" + chain + "`";
    } else if (c.status === "AMBIGUOUS_RECOVERY" && c.extractedAdvice.length > 0) {
      const shown = c.extractedAdvice.slice(0, 5);
      const candidates = shown.map((a) => {
        const cmd = a.command + (a.args.length > 0 ? " " + a.args.join(" ") : "");
        return "`" + cmd + "`";
      });
      const extra = c.extractedAdvice.length > 5 ? " (+" + (c.extractedAdvice.length - 5) + " more)" : "";
      recovery = c.status + " after `" + chain + "`: " + candidates.join(", ") + extra;
    } else {
      recovery = c.status + " after `" + chain + "`";
    }
    lines.push("| " + icon + " | " + escCell(c.name) + " | " + escCell(recovery) + " |");
  }
  return lines.join("\n") + "\n";
}

function escCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/`/g, "'").replace(/\r?\n/g, "<br/>");
}

function displayShort(command: string, args: string[]): string {
  const base = command.split("/").pop()?.split("\\").pop() ?? command;
  const interesting = args.filter((a) => !a.startsWith("-")).slice(0, 2);
  return ([base, ...interesting].join(" "));
}

