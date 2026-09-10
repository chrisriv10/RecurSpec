import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const STARTER = `# RecurSpec starter configuration.
# This example runs as-is with only Node.js: it fails on purpose, follows
# the printed advice, and verifies recovery. Replace the \`node\` commands
# with your own CLI to test a real recovery contract.
# Run: recurspec test
# Docs: https://github.com/chrisriv10/RecurSpec

version: 1

defaults:
  timeout: 10s

cases:
  - name: missing-project-config
    description: Placeholder example. Replace node with the CLI you want to test.

    # Each case runs in a fresh temporary directory. These files are created there.
    workspace:
      write:
        "deploy.mjs": |
          import { existsSync } from "node:fs";
          if (!existsSync(".initialized")) {
            console.error("Project not initialized. Run \`node init.mjs\` to create it.");
            process.exit(2);
          }
          console.log("Deployed successfully.");
        "init.mjs": |
          import { writeFileSync } from "node:fs";
          writeFileSync(".initialized", "yes\\n");
          console.log("Initialized.");

    # 1. This command intentionally fails.
    run:
      command: node
      args: [deploy.mjs]

    # 2. RecurSpec checks the failure looks as expected.
    failure:
      exitCode: nonzero
      stderr:
        contains: "Project not initialized"

    # 3. RecurSpec extracts the advice the tool itself printed...
    recovery:
      source: output

    # 4. ...runs it, retries the original command, and verifies recovery.
    verify:
      rerunOriginal: true
      exitCode: 0
      stdout:
        contains: "Deployed successfully"
`;

export async function initCommand(cwd: string, force: boolean): Promise<number> {
  const target = path.join(cwd, "recurspec.yml");
  if (existsSync(target) && !force) {
    process.stderr.write(
      "recurspec.yml already exists in " + cwd + ".\nRefusing to overwrite. Re-run with --force to replace it.\n"
    );
    return 2;
  }
  await writeFile(target, STARTER, "utf8");
  process.stdout.write("Created " + target + ".\nRun `recurspec test` to try the example, then edit it for your own CLI.\n");
  return 0;
}
