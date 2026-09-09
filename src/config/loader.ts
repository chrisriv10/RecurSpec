import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { checkDuplicateCaseNames, validateConfigObject, type ParsedConfig } from "./schema.js";

export const CONFIG_FILENAMES = ["recoveryspec.yml", "recoveryspec.yaml"];

export interface LoadedConfig {
  config: ParsedConfig;
  configPath: string;
  configDir: string;
}

export interface ConfigError extends Error {
  hint?: string;
  file?: string;
}

export function configNotFoundError(searchDir: string): ConfigError {
  const err = new Error(
    "RecoverySpec could not find a configuration file.\n\nLooked for:\n  " +
      CONFIG_FILENAMES.join("\n  ") +
      "\n\nSearched in:\n  " +
      searchDir +
      "\n\nCreate one with:\n\n  recoveryspec init"
  ) as ConfigError;
  err.name = "ConfigNotFoundError";
  return err;
}

export function toConfigError(message: string, hint?: string, file?: string): ConfigError {
  const err = new Error(message) as ConfigError;
  err.name = "ConfigError";
  if (hint) err.hint = hint;
  if (file) err.file = file;
  return err;
}

export async function findConfigFile(startDir: string, explicit?: string): Promise<string | null> {
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(startDir, explicit);
    return existsSync(resolved) ? resolved : null;
  }
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(startDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function loadConfigFile(filePath: string): Promise<LoadedConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw toConfigError(
      "RecoverySpec could not read " + filePath + ".",
      "Check that the file exists and is readable.",
      filePath
    );
  }
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw toConfigError(
      "RecoverySpec could not parse " + filePath + " as YAML.\n\n" + message,
      "Validate the YAML syntax, e.g. with an online YAML parser, then run recoveryspec validate.",
      filePath
    );
  }
  if (typeof data !== "object" || data === null) {
    throw toConfigError(
      "RecoverySpec config " + filePath + " must be a YAML mapping at the top level.",
      "Start the file with version: 1 and a cases: list. Run recoveryspec init for an example.",
      filePath
    );
  }
  const result = validateConfigObject(data);
  if (!result.ok) {
    const lines = result.issues.map((i) => "  " + i.path + "\n    " + i.message);
    throw toConfigError(
      "Invalid RecoverySpec configuration in " + filePath + ":\n\n" + lines.join("\n"),
      "Run recoveryspec validate for details.",
      filePath
    );
  }
  const dupes = checkDuplicateCaseNames(result.config);
  if (dupes.length > 0) {
    throw toConfigError(
      "Invalid RecoverySpec configuration in " + filePath + ":\n\n  Duplicate case name(s): " + dupes.join(", "),
      "Case names must be unique. Rename the duplicated cases.",
      filePath
    );
  }
  return {
    config: result.config,
    configPath: path.resolve(filePath),
    configDir: path.dirname(path.resolve(filePath))
  };
}

export async function resolveConfig(cwd: string, explicit?: string): Promise<LoadedConfig> {
  const found = await findConfigFile(cwd, explicit);
  if (!found && explicit) {
    throw toConfigError(
      "RecoverySpec could not find the configuration file " + explicit + ".",
      "Check the path and try again, or run recoveryspec init to create one.",
      explicit
    );
  }
  if (!found) throw configNotFoundError(cwd);
  return loadConfigFile(found);
}

