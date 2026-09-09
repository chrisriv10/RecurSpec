import { runRecoverySpec } from "../../index.js";
import { renderTerminal } from "../../reporting/terminal.js";
import { renderJson } from "../../reporting/json-reporter.js";
import { renderJUnit } from "../../reporting/junit.js";
import { renderMarkdown } from "../../reporting/markdown.js";
import { version as packageVersion } from "../version.js";

export interface TestCommandOptions {
  config?: string;
  cases?: string[];
  tags?: string[];
  format?: string;
  verbose?: boolean;
  failFast?: boolean;
  seed?: number;
  debug?: boolean;
}

function exitCodeFor(format: string, failed: boolean): number {
  void format;
  return failed ? 1 : 0;
}

export async function testCommand(cwd: string, options: TestCommandOptions): Promise<number> {
  const format = options.format ?? "human";
  if (!["human", "json", "junit", "markdown"].includes(format)) {
    process.stderr.write("Unknown format " + JSON.stringify(format) + ". Expected human, json, junit, or markdown.\n");
    return 2;
  }
  if (options.debug) process.env["DEBUG"] = "recoveryspec";

  let result;
  try {
    result = await runRecoverySpec({
      cwd,
      configPath: options.config,
      filterCases: options.cases,
      filterTags: options.tags,
      failFast: options.failFast,
      seed: options.seed,
      verbose: options.verbose
    });
  } catch (err) {
    const message = String((err as Error).message);
    if (format === "json") {
      process.stdout.write(JSON.stringify({ version: 1, error: message }, null, 2) + "\n");
    } else {
      process.stderr.write(message + "\n");
    }
    return 2;
  }

  if (format === "json") {
    process.stdout.write(renderJson(result));
  } else if (format === "junit") {
    process.stdout.write(renderJUnit(result));
  } else if (format === "markdown") {
    process.stdout.write(renderMarkdown(result));
  } else {
    process.stdout.write(renderTerminal(result, { verbose: options.verbose, version: packageVersion }) + "\n");
  }

  const failed = result.summary.failed > 0;
  return exitCodeFor(format, failed);
}
