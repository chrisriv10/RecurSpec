import { resolveConfig } from "../../config/loader.js";
import { effectiveSafety } from "../../safety/policy.js";
import { resolveCompletionMode } from "../../verify/verifier.js";
import type { RecoveryCase } from "../../types/config.js";

function exitCodeText(value: number | "nonzero" | "zero" | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (value === "nonzero") return "nonzero exit";
  if (value === "zero") return "exit code 0";
  return "exit code " + value;
}

function streamLines(label: string, assertion: { contains?: string | string[]; notContains?: string | string[]; matches?: string | string[] } | undefined): string[] {
  if (!assertion) return [];
  const out: string[] = [];
  const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  for (const v of list(assertion.contains)) out.push("  " + label + " contains " + JSON.stringify(v));
  for (const v of list(assertion.notContains)) out.push("  " + label + " must not contain " + JSON.stringify(v));
  for (const v of list(assertion.matches)) out.push("  " + label + " matches " + JSON.stringify(v));
  return out;
}

function evidenceLines(kase: RecoveryCase): string[] {
  const verify = kase.verify;
  const out: string[] = [];
  for (const rel of verify?.files?.exists ?? []) out.push("  " + rel + " must exist");
  for (const rel of verify?.files?.notExists ?? []) out.push("  " + rel + " must be absent");
  const json = verify?.json === undefined ? [] : Array.isArray(verify.json) ? verify.json : [verify.json];
  for (const j of json) {
    for (const [key, expected] of Object.entries(j.assertions)) {
      out.push("  " + j.path + ": " + key + " must equal " + JSON.stringify(expected));
    }
  }
  out.push(...streamLines("stdout", verify?.stdout));
  out.push(...streamLines("stderr", verify?.stderr));
  for (const s of verify?.commands ?? []) {
    out.push("  run: " + s.command + " " + (s.args ?? []).join(" ") + " (must succeed)");
  }
  return out;
}

function workspaceLines(kase: RecoveryCase): string[] {
  const ws = kase.workspace;
  if (!ws) return ["  temporary"];
  const out = ["  temporary"];
  if (ws.copy) for (const p of ws.copy) out.push("  copy: " + p);
  if (ws.remove) for (const p of ws.remove) out.push("  remove: " + p);
  if (ws.write) for (const p of Object.keys(ws.write)) out.push("  write: " + p);
  if (ws.mkdir) for (const p of ws.mkdir) out.push("  mkdir: " + p);
  return out;
}

export async function explainCommand(cwd: string, caseName: string, explicit?: string): Promise<number> {
  let loaded;
  try {
    loaded = await resolveConfig(cwd, explicit);
  } catch (err) {
    process.stderr.write(String((err as Error).message) + "\n");
    return 2;
  }
  const kase = loaded.config.cases.find((c) => c.name === caseName);
  if (!kase) {
    process.stderr.write(
      "No case named " + JSON.stringify(caseName) + " in " + loaded.configPath + ".\n\nAvailable cases:\n" +
        loaded.config.cases.map((c) => "  - " + c.name).join("\n") +
        "\n"
    );
    return 2;
  }
  const safety = effectiveSafety(loaded.config, kase);
  const mode = resolveCompletionMode(kase.verify);
  const lines: string[] = [];
  lines.push("Case: " + kase.name);
  if (kase.description) lines.push("Description: " + kase.description);
  if (kase.tags) lines.push("Tags: " + kase.tags.join(", "));
  lines.push("");
  lines.push("Original command");
  lines.push("  " + kase.run.command + " " + (kase.run.args ?? []).join(" "));
  lines.push("");
  lines.push("Expected failure");
  lines.push("  " + exitCodeText(kase.failure?.exitCode, "nonzero exit"));
  lines.push(...streamLines("stdout", kase.failure?.stdout));
  lines.push(...streamLines("stderr", kase.failure?.stderr));
  lines.push("");
  lines.push("Recovery source");
  if (kase.recovery?.steps) {
    lines.push("  explicit steps:");
    for (const s of kase.recovery.steps) lines.push("    - " + s.command + " " + (s.args ?? []).join(" "));
  } else if ((kase.recovery?.source ?? "output") === "structured") {
    lines.push("  structured hints in program output");
  } else {
    lines.push("  program output (" + (kase.recovery?.prefer ?? ["stderr", "stdout"]).join(" first, then ") + ")");
    lines.push("  maximum recovery hops: " + (kase.recovery?.maxHops ?? 3));
  }
  lines.push("");
  lines.push("Completion");
  if (mode === "retry") {
    const verify = kase.verify;
    lines.push("  retry original command, expect " + exitCodeText(verify?.exitCode, "exit code 0"));
  } else if (mode === "goal") {
    lines.push("  goal verification (original command is not rerun)");
    lines.push("");
    lines.push("Evidence");
    lines.push(...evidenceLines(kase));
  } else {
    lines.push("  custom verification (original command is not rerun)");
    lines.push("");
    lines.push("Evidence");
    lines.push(...evidenceLines(kase));
  }
  lines.push("");
  lines.push("Safety");
  lines.push("  shell: " + (safety.shell ? "enabled" : "disabled"));
  lines.push("  network: " + safety.network);
  lines.push("  allowed commands: " + (safety.allowedCommands ? safety.allowedCommands.join(", ") : "any, unless denied"));
  if (safety.deniedCommands) lines.push("  denied commands: " + safety.deniedCommands.join(", "));
  if (safety.caseAllowCommands) lines.push("  this case also allows: " + safety.caseAllowCommands.join(", "));
  if (safety.caseDenyCommands) lines.push("  this case denies: " + safety.caseDenyCommands.join(", "));
  lines.push("");
  lines.push("Workspace");
  lines.push(...workspaceLines(kase));
  lines.push("");
  lines.push("(This command only explains the contract. Run `recurspec test --case " + kase.name + "` to execute it.)");
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
