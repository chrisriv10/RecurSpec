# RecurSpec

**Test whether your error messages actually get users unstuck.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange?style=flat-square)](#status)
[![GitHub stars](https://img.shields.io/github/stars/chrisriv10/RecurSpec?style=flat-square&logo=github)](https://github.com/chrisriv10/RecurSpec)

RecurSpec tests the recovery paths in command-line tools.

It triggers a known failure, follows the recovery instructions printed by the tool, retries the original command, and checks whether the problem was actually fixed.

```text
$ acme deploy

Error: Project not initialized.
Run `acme init`.
```

A normal test might check that this error appears:

```ts
expect(stderr).toContain("Run `acme init`");
```

That proves the message exists. It does not prove that `acme init` gets the user unstuck.

RecurSpec tests the whole path:

```text
error -> advice -> recovery -> retry -> result
```

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

`init` writes a starter `recurspec.yml` with one example contract:

```yaml
version: 1

cases:
  - name: missing-project-config
    description: User runs deploy before initializing a project
    workspace:
      copy: [fixtures/basic-project/**]
      remove: [.acme]
    run:
      command: acme
      args: [deploy]
    failure:
      exitCode: nonzero
      stderr:
        contains: "Project not initialized"
    recovery:
      source: output        # use the tool own advice
    verify:
      rerunOriginal: true
      exitCode: 0
```

## Example output

`pnpm demo` runs the showcase suite in `recurspec.yml` against the bundled
`demo/acme-cli` fixture CLI, which mixes working and deliberately broken recovery
paths. Real output (timings vary, exit code `1` because broken paths are caught by design):

```text
RecurSpec v0.1.0

✓ User runs deploy before initializing a project
  node demo/acme-cli/acme.mjs deploy → node demo/acme-cli/acme.mjs init → node demo/acme-cli/acme.mjs deploy
  recovered in 1 hop · 404ms

✓ Publishing with an expired session
  node demo/acme-cli/acme.mjs publish → node demo/acme-cli/acme.mjs login → node demo/acme-cli/acme.mjs publish
  recovered in 1 hop · 430ms

✓ Login then org selection, chained from tool output
  node demo/acme-cli/acme.mjs deploy → node demo/acme-cli/acme.mjs login → node demo/acme-cli/acme.mjs select-org → node demo/acme-cli/acme.mjs deploy
  recovered in 2 hops · 470ms

✗ Recovery succeeds but the original task still fails (dead end)
  node demo/acme-cli/acme.mjs publish → node demo/acme-cli/acme.mjs login
  Recovery made progress, but the original task still fails with a new error.

  Status: PARTIAL_RECOVERY

✗ The tool suggests a command that no longer exists
  node demo/acme-cli/acme.mjs deploy → node demo/acme-cli/acme.mjs setup
  The recovery command ran but failed.
  Recovery step failed and offered no further advice: node demo/acme-cli/acme.mjs setup

  Status: RECOVERY_COMMAND_FAILED

✗ The tool suggests a dangerous command that must be blocked
  node demo/acme-cli/acme.mjs deploy
  BLOCKED RECOVERY COMMAND
  Command "sudo" is never allowed (dangerous system command).

  Status: BLOCKED_RECOVERY

✗ Login and configure point at each other forever
  node demo/acme-cli/acme.mjs login → node demo/acme-cli/acme.mjs configure → node demo/acme-cli/acme.mjs login → node demo/acme-cli/acme.mjs configure
  RECOVERY LOOP DETECTED
  The same recovery step repeated. Stopped instead of looping forever.

  Status: RECOVERY_LOOP

✓ Machine-readable JSON recovery hint
  node demo/acme-cli/acme.mjs deploy → node demo/acme-cli/acme.mjs init → node demo/acme-cli/acme.mjs deploy
  recovered in 1 hop · 311ms

RecurSpec

8 recovery contracts

4 passed
1 dead ends (1 partial)
1 recovery loop
1 blocked commands

Recovery rate: 50.0%
Median hops: 1
Maximum hops: 2
```

## What it catches

Error messages can be correct while their recovery instructions are not.

RecurSpec catches cases where:

* a suggested command no longer exists
* a recovery step is incomplete
* a command succeeds but does not fix the original problem
* one recovery instruction leads to another error
* recovery instructions form a loop
* an error gives ambiguous or unsafe instructions

## Recovery paths

Recovery can come directly from the program output:

```text
Run `acme init`
Try: acme login
$ npm install foo
```

or be specified explicitly:

```yaml
recovery:
  steps:
    - command: acme
      args: [login]
```

Multi-step recovery paths are supported too (up to `maxHops`, default 3, hard max 10):

```text
deploy
  -> login required
  -> acme login
  -> organization required
  -> acme select-org
  -> deploy
  -> success
```

## Verification

A recovery command returning exit code `0` does not necessarily mean the user recovered.

By default, RecurSpec retries the original command:

```yaml
verify:
  rerunOriginal: true
  exitCode: 0
```

You can also verify output or filesystem state:

```yaml
verify:
  files:
    exists:
      - .acme/config.json
  json:
    path: .acme/config.json
    assertions:
      initialized: true
  stdout:
    contains: "Ready"
```

## Isolation

Each case runs inside its own temporary workspace.

RecurSpec does not apply test mutations directly to your project directory.

```yaml
workspace:
  copy:
    - fixtures/project/**
  remove:
    - .acme
  write:
    ".env": |
      TEST=true
```

Failed workspaces can optionally be preserved for inspection
(`preserve` / `preserveOnFailure`).

## Safety

RecurSpec does not blindly execute anything it finds in stderr.

Suggested commands are parsed and checked before execution. Shell chaining,
redirection, command substitution, destructive commands, and other unsafe patterns
are blocked by default. When RecurSpec cannot determine that a recovery command
is safe, it does not run it.

```yaml
safety:
  shell: false
  network: warn
  allowedCommands:
    - acme
    - node
    - npm
```

## CI

Recovery paths can run alongside the rest of your test suite.

```yaml
name: RecurSpec
on:
  pull_request:
  push:
jobs:
  recovery:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm recurspec test
```

RecurSpec exits with a non-zero status when a recovery contract fails
(`0` all pass, `1` recovery failure, `2` config/usage error).

Machine-readable reporters are available for CI and tooling:

```bash
recurspec test --format json
recurspec test --format junit
recurspec test --format markdown
```

## Commands

```bash
recurspec test [--case NAME] [--tag TAG] [--format human|json|junit|markdown] [--verbose] [--fail-fast] [--seed N]
recurspec validate
recurspec init [--force]
recurspec explain <case>
recurspec discover [--write]
```

Run `recurspec --help` for all options. Programmatic API:
`import { runRecurSpec } from "recurspec"`.

See `docs/` for concepts, configuration, extraction, safety, reporters, and discovery.

## Limitations

- The local backend isolates the filesystem (temp workspaces) but cannot enforce
  OS-level network sandboxing; `safety.network: deny` is advisory until a Docker
  backend exists.
- Interactive TTY programs need scripted `stdin`; full PTY support is future work.
- Recovery quality depends on tools printing greppable advice; ambiguous or missing
  advice is reported, not guessed.

## Roadmap

Docker/Podman and remote-sandbox backends, PTY support, recovery-graph
visualization, and a GitHub Action wrapper around the JSON reporter.

## Status

RecurSpec is under active development.

The configuration format may change before the first stable release.

## License

[MIT](LICENSE)
