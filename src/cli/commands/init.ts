import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const STARTER = `# RecoverySpec starter configuration.
# Edit the case below to match your own CLI, then run: recoveryspec test
# Docs: https://github.com/chrisriv10/RecurSpec

version: 1

defaults:
  timeout: 10s
  env:
    CI: "1"

safety:
  shell: false
  network: warn

cases:
  - name: missing-project-config
    description: User runs deploy before initializing a project
    workspace:
      copy:
        - fixtures/basic-project/**
      remove:
        - .acme
    run:
      command: acme
      args: [deploy]
    failure:
      exitCode: nonzero
      stderr:
        contains: "Project not initialized"
    recovery:
      source: output
      prefer: [stderr, stdout]
      extract:
        mode: command
    verify:
      rerunOriginal: true
      exitCode: 0
`;

export async function initCommand(cwd: string, force: boolean): Promise<number> {
  const target = path.join(cwd, "recoveryspec.yml");
  if (existsSync(target) && !force) {
    process.stderr.write(
      "recoveryspec.yml already exists in " + cwd + ".\nRefusing to overwrite. Re-run with --force to replace it.\n"
    );
    return 2;
  }
  await writeFile(target, STARTER, "utf8");
  process.stdout.write("Created " + target + ".\nEdit it, then run: recoveryspec test\n");
  return 0;
}
