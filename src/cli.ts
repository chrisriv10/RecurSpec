#!/usr/bin/env node
import { Command } from "commander";
import { testCommand } from "./cli/commands/test.js";
import { validateCommand } from "./cli/commands/validate.js";
import { initCommand } from "./cli/commands/init.js";
import { explainCommand } from "./cli/commands/explain.js";
import { discoverCommand } from "./cli/commands/discover.js";
import { version } from "./cli/version.js";

const program = new Command();
program.name("recoveryspec").description("Test whether your error messages actually get users unstuck.").version(version);

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program
  .command("test")
  .description("Run recovery contracts")
  .argument("[config]", "Path to the config file")
  .option("--case <name>", "Only run cases with this name (repeatable)", collect, [])
  .option("--tag <tag>", "Only run cases with this tag (repeatable)", collect, [])
  .option("--format <format>", "Output format: human, json, junit, markdown", "human")
  .option("--verbose", "Show recovery traces and extra detail")
  .option("--fail-fast", "Stop after the first failing case")
  .option("--seed <seed>", "Seed for any randomized behavior")
  .option("--debug", "Print internal diagnostics to stderr")
  .action(
    async (
      config: string | undefined,
      options: { case: string[]; tag: string[]; format: string; verbose?: boolean; failFast?: boolean; seed?: string; debug?: boolean }
    ) => {
      process.exitCode = await testCommand(process.cwd(), {
        config,
        cases: options.case.length > 0 ? options.case : undefined,
        tags: options.tag.length > 0 ? options.tag : undefined,
        format: options.format,
        verbose: options.verbose,
        failFast: options.failFast,
        seed: options.seed === undefined ? undefined : Number(options.seed),
        debug: options.debug
      });
    }
  );

program
  .command("validate")
  .description("Validate the configuration without running anything")
  .argument("[config]", "Path to the config file")
  .action(async (config: string | undefined) => {
    process.exitCode = await validateCommand(process.cwd(), config);
  });

program
  .command("init")
  .description("Create a starter recoveryspec.yml")
  .option("--force", "Overwrite an existing config file")
  .action(async (options: { force?: boolean }) => {
    process.exitCode = await initCommand(process.cwd(), Boolean(options.force));
  });

program
  .command("explain")
  .description("Explain a recovery contract without running it")
  .argument("<case>", "Name of the case to explain")
  .option("--config <path>", "Path to the config file")
  .action(async (caseName: string, options: { config?: string }) => {
    process.exitCode = await explainCommand(process.cwd(), caseName, options.config);
  });

program
  .command("discover")
  .description("Experimentally discover candidate recovery contracts")
  .option("--config <path>", "Path to the config file")
  .option("--write", "Write draft cases to recoveryspec.discovered.yml")
  .action(async (options: { config?: string; write?: boolean }) => {
    process.exitCode = await discoverCommand(process.cwd(), { config: options.config, write: options.write });
  });

await program.parseAsync(process.argv);
