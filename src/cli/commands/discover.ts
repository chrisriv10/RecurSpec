import { resolveConfig } from "../../config/loader.js";
import { candidatesToYaml, discoverCandidates } from "../../discovery/discover.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export interface DiscoverCommandOptions {
  config?: string;
  write?: boolean;
}

export async function discoverCommand(cwd: string, options: DiscoverCommandOptions): Promise<number> {
  let loaded;
  try {
    loaded = await resolveConfig(cwd, options.config);
  } catch (err) {
    process.stderr.write(String((err as Error).message) + "\n");
    return 2;
  }
  const base = loaded.config.discover;
  if (!base) {
    process.stderr.write(
      "Discovery is experimental and needs a `discover:` block in " + loaded.configPath + ".\n\nExample:\n\ndiscover:\n  command: acme\n  args: [deploy]\n"
    );
    return 2;
  }
  process.stdout.write("RecurSpec discovery (experimental): trying safe mutations...\n");
  const candidates = await discoverCandidates({ command: base.command, args: base.args ?? [], cwd: loaded.configDir });
  if (candidates.length === 0) {
    process.stdout.write("No candidate recovery contracts discovered.\n");
    return 0;
  }
  process.stdout.write("\n" + candidates.length + " candidate recovery contracts discovered:\n\n");
  for (const c of candidates) {
    process.stdout.write("  mutation: " + c.mutation + "\n");
    for (const a of c.advice) process.stdout.write("    advice: " + a.raw + "\n");
  }
  process.stdout.write("\nThese are drafts, not authoritative contracts. Review every generated case.\n");
  if (options.write) {
    const out = path.join(loaded.configDir, "recurspec.discovered.yml");
    await writeFile(out, candidatesToYaml(candidates, base.command, base.args ?? []), "utf8");
    process.stdout.write("\nWrote draft cases to " + out + ".\n");
  } else {
    process.stdout.write("\nRun `recurspec discover --write` to generate draft cases.\n");
  }
  return 0;
}
