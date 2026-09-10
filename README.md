<p align="center">
  <img src="assets/logo.png" alt="RecurSpec logo" width="320" />
</p>

<h1 align="center">RecurSpec</h1>

<p align="center">
  <strong>Test whether your error messages actually get users unstuck.</strong>
</p>

<p align="center">
  <a href="https://github.com/chrisriv10/RecurSpec/actions/workflows/ci.yml"><img src="https://github.com/chrisriv10/RecurSpec/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/recurspec"><img src="https://img.shields.io/npm/v/recurspec?style=flat-square" alt="npm version" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" /></a>
  <a href="https://github.com/chrisriv10/RecurSpec"><img src="https://img.shields.io/github/stars/chrisriv10/RecurSpec?style=flat-square&logo=github" alt="GitHub stars" /></a>
</p>

# RecurSpec

**Test whether your error messages actually get users unstuck.**

RecurSpec tests recovery paths in command-line tools.

When a CLI says:

```text
Error: Project not initialized.
Run `acme init`.
```

a normal test can check that the message exists.

RecurSpec checks that `acme init` actually fixes the problem.

## Install

Requires Node.js 22+ and pnpm.

```bash
pnpm add -D recurspec
```

## Quick start

```bash
recurspec init
# edit recurspec.yml to describe your CLI failure + recovery
recurspec validate
recurspec test
```

`init` writes a starter `recurspec.yml` with a runnable Node.js example. Replace
the `node` commands with your own CLI to test a real recovery contract:

```yaml
cases:
  - name: missing-project-config
    workspace:
      write:
        "deploy.mjs": |
          import { existsSync } from "node:fs";
          if (!existsSync(".initialized")) {
            console.error("Project not initialized. Run `node init.mjs` to create it.");
            process.exit(2);
          }
          console.log("Deployed successfully.");
    run:
      command: node
      args: [deploy.mjs]
    failure:
      exitCode: nonzero
      stderr:
        contains: "Project not initialized"
    recovery:
      source: output
    verify:
      rerunOriginal: true
      exitCode: 0
```

## Example output

```text
✓ Placeholder example
  node deploy.mjs → node init.mjs → node deploy.mjs
  recovered in 1 hop · 331ms

✗ The tool suggests a dangerous command that must be blocked
  node demo/acme-cli/acme.mjs deploy
  BLOCKED RECOVERY COMMAND
  Command "sudo" is never allowed (dangerous system command).

  Status: BLOCKED_RECOVERY
```

The bundled demo (`pnpm demo`) mixes passing and deliberately broken recovery paths.

## Tested with real CLIs

The compatibility suite includes recovery cases from Git, Cargo, and npm.

| Tool | Case | Result |
| --- | --- | --- |
| Git | Missing identity | Ambiguous: two commands, both required |
| Git | Branch deletion | Goal recovery: branch gone, no retry |
| Git | Divergent pull advice | Ambiguous: three exclusive options |
| Cargo | Existing project directory | Goal recovery: project initialized |
| npm | Missing script | Correctly ignored: informational only |

Cargo helped uncover a flaw in RecurSpec original model. `cargo init` can complete
the user goal even though retrying `cargo new` will still fail. That led to
goal-based verification.

Run them with `pnpm test:real-world` (missing tools are skipped).

## What it catches

Error messages can be correct while their recovery instructions are not.

RecurSpec catches cases where:

* a suggested command no longer exists
* a recovery step is incomplete
* a command succeeds but does not fix the original problem
* one recovery instruction leads to another error
* recovery instructions form a loop
* an error gives ambiguous or unsafe instructions

## Retry and goal recovery

Some fixes remove a blocker:

```text
deploy
→ login required
→ login
→ deploy
→ success
```

Others replace the failed operation:

```text
cargo new .
→ directory already exists
→ cargo init
→ project initialized
```

RecurSpec supports both.

## Safety

Recovery commands are parsed and checked before execution. Shell chaining,
redirection, command substitution, and known destructive commands are blocked
by default. Each case runs in an isolated temporary workspace.

Network isolation is not enforced by the local backend, so
`safety.network: deny` stays advisory until a container backend exists.
See Limitations.

## CI

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm exec recurspec test
```

Exit codes: `0` all pass, `1` a contract failed, `2` config or usage error.
JSON, JUnit, and Markdown reporters cover CI and PR comments.

```bash
recurspec test [--case NAME] [--tag TAG] [--format human|json|junit|markdown] [--verbose] [--fail-fast] [--seed N] [--dry-run]
recurspec validate
recurspec init [--force]
recurspec explain <case>
recurspec discover [--write]
```

Programmatic API: `import { runRecurSpec } from "recurspec"`.

## Limitations

- The local backend isolates the filesystem (temp workspaces) but cannot enforce
  OS-level network sandboxing.
- Interactive TTY programs need scripted `stdin`; full PTY support is future work.
- Recovery quality depends on tools printing greppable advice; ambiguous or missing
  advice is reported, not guessed.

## Status

RecurSpec is early-stage software.
The configuration and public API may evolve before v1.0.

See `docs/` for configuration, extraction, safety, reporters, and discovery.

## License

[MIT](LICENSE)
