#!/usr/bin/env node
import { cac } from "cac";
import { testCommand } from "./cli/commands/test.js";
import { validateCommand } from "./cli/commands/validate.js";
import { initCommand } from "./cli/commands/init.js";
import { explainCommand } from "./cli/commands/explain.js";
import { discoverCommand } from "./cli/commands/discover.js";
import { version } from "./cli/version.js";

const cli = cac("recoveryspec");

cli
  .command("test [config]", "Run recovery contracts")
  .option("--case <name>", "Only run cases with this name (repeatable)", { type: [] })
  .option("--tag <tag>", "Only run cases with this tag (repeatable)", { type: [] })
  .option("--format <format>", "Output format: human, json, junit, markdown", { default: "human" })
  .option("--verbose", "Show recovery traces and extra detail")
  .option("--fail-fast", "Stop after the first failing case")
  .option("--seed <seed>", "Seed for any randomized behavior")
  .option("--debug", "Print internal diagnostics to stderr")
  .action(async (config: string | undefined, options: Record<string, unknown>) => {
    const toList = (v: unknown): string[] | undefined => {
      if (v === undefined) return undefined;
      return (Array.isArray(v) ? v : [v]).map(String);
    };
    const code = await testCommand(process.cwd(), {
      config,
      cases: toList(options["case"]),
      tags: toList(options["tag"]),
      format: String(options["format"] ?? "human"),
      verbose: Boolean(options["verbose"]),
      failFast: Boolean(options["fail-fast"]),
      seed: options["seed"] === undefined ? undefined : Number(options["seed"]),
      debug: Boolean(options["debug"])
    });
    process.exitCode = code;
  });

cli
  .command("validate [config]", "Validate the configuration without running anything")
  .action(async (config: string | undefined) => {
    process.exitCode = await validateCommand(process.cwd(), config);
  });

cli
  .command("init", "Create a starter recoveryspec.yml")
  .option("--force", "Overwrite an existing config file")
  .action(async (options: Record<string, unknown>) => {
    process.exitCode = await initCommand(process.cwd(), Boolean(options["force"]));
  });

cli
  .command("explain <case>", "Explain a recovery contract without running it")
  .option("--config <path>", "Path to the config file")
  .action(async (caseName: string, options: Record<string, unknown>) => {
    const explicit = options["config"] === undefined ? undefined : String(options["config"]);
    process.exitCode = await explainCommand(process.cwd(), caseName, explicit);
  });

cli
  .command("discover", "Experimentally discover candidate recovery contracts")
  .option("--config <path>", "Path to the config file")
  .option("--write", "Write draft cases to recoveryspec.discovered.yml")
  .action(async (options: Record<string, unknown>) => {
    const explicit = options["config"] === undefined ? undefined : String(options["config"]);
    process.exitCode = await discoverCommand(process.cwd(), { config: explicit, write: Boolean(options["write"]) });
  });

cli.help();
cli.version(version);

try {
  cli.parse(process.argv, { run: true });
} catch (err) {
  process.stderr.write(String((err as Error).message) + "\n");
  process.exitCode = 2;
}
