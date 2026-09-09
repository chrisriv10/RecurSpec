import { findConfigFile, loadConfigFile } from "../../config/loader.js";

export async function validateCommand(cwd: string, explicit?: string): Promise<number> {
  const found = await findConfigFile(cwd, explicit);
  if (!found && explicit) {
    process.stderr.write("RecurSpec could not find the configuration file " + explicit + ".\n");
    return 2;
  }
  if (!found) {
    process.stderr.write(
      "RecurSpec could not find a configuration file.\n\nLooked for:\n  recurspec.yml\n  recurspec.yaml\n\nCreate one with:\n\n  recurspec init\n"
    );
    return 2;
  }
  try {
    await loadConfigFile(found);
  } catch (err) {
    process.stderr.write(String((err as Error).message) + "\n");
    return 2;
  }
  process.stdout.write(found + ": configuration is valid.\n");
  return 0;
}
