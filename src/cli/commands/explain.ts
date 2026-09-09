import { resolveConfig } from "../../config/loader.js";
import { effectiveSafety } from "../../safety/policy.js";

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
  const lines: string[] = [];
  lines.push("Case: " + kase.name);
  if (kase.description) lines.push("Description: " + kase.description);
  if (kase.tags) lines.push("Tags: " + kase.tags.join(", "));
  lines.push("");
  lines.push("Original command:");
  lines.push("  " + kase.run.command + " " + (kase.run.args ?? []).join(" "));
  lines.push("");
  lines.push("Expected failure state:");
  lines.push("  exitCode: " + JSON.stringify(kase.failure?.exitCode ?? "nonzero"));
  if (kase.failure?.stdout) lines.push("  stdout: " + JSON.stringify(kase.failure.stdout));
  if (kase.failure?.stderr) lines.push("  stderr: " + JSON.stringify(kase.failure.stderr));
  lines.push("");
  lines.push("Recovery source:");
  if (kase.recovery?.steps) {
    lines.push("  explicit steps:");
    for (const s of kase.recovery.steps) lines.push("    - " + s.command + " " + (s.args ?? []).join(" "));
  } else {
    lines.push("  " + (kase.recovery?.source ?? "output") + " (maxHops " + (kase.recovery?.maxHops ?? 3) + ")");
    lines.push("  prefer: " + JSON.stringify(kase.recovery?.prefer ?? ["stderr", "stdout"]));
  }
  lines.push("");
  lines.push("Safety policy:");
  lines.push("  shell: " + safety.shell + ", network: " + safety.network);
  if (safety.allowedCommands) lines.push("  allowedCommands: " + safety.allowedCommands.join(", "));
  if (safety.deniedCommands) lines.push("  deniedCommands: " + safety.deniedCommands.join(", "));
  if (safety.caseAllowCommands) lines.push("  case allowCommands: " + safety.caseAllowCommands.join(", "));
  if (safety.caseDenyCommands) lines.push("  case denyCommands: " + safety.caseDenyCommands.join(", "));
  lines.push("");
  lines.push("Verification:");
  const verify = kase.verify ?? { rerunOriginal: true, exitCode: 0 };
  lines.push("  rerunOriginal: " + String(verify.rerunOriginal !== false));
  if (verify.exitCode !== undefined) lines.push("  exitCode: " + JSON.stringify(verify.exitCode));
  if (verify.stdout) lines.push("  stdout: " + JSON.stringify(verify.stdout));
  if (verify.stderr) lines.push("  stderr: " + JSON.stringify(verify.stderr));
  if (verify.files) lines.push("  files: " + JSON.stringify(verify.files));
  if (verify.json) lines.push("  json: " + JSON.stringify(verify.json));
  if (verify.commands) {
    lines.push("  commands:");
    for (const s of verify.commands) lines.push("    - " + s.command + " " + (s.args ?? []).join(" "));
  }
  lines.push("");
  lines.push("(This command only explains the contract. Run `recurspec test --case " + kase.name + "` to execute it.)");
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
