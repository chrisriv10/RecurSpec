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
````

A normal test might check that this error appears.

RecurSpec checks that this works:

```text
acme deploy
  ↓
Project not initialized
  ↓
acme init
  ↓
acme deploy
  ↓
success
```

## Install

```bash
npm install --save-dev recurspec
```

## Quick start

Create `recurspec.yml`:

```yaml
version: 1

cases:
  - name: missing-project-config

    workspace:
      remove:
        - .acme

    run:
      command: acme
      args: [deploy]

    failure:
      stderr:
        contains: "Project not initialized"

    recovery:
      source: output

    verify:
      rerunOriginal: true
      exitCode: 0
```

Run it:

```bash
npx recurspec test
```

```text
RecurSpec

✓ missing project config
  deploy → acme init → deploy
  recovered in 1 step

✓ expired credentials
  publish → acme login → publish
  recovered in 1 step

✗ missing organization
  deploy → acme login → deploy

  Recovery command succeeded, but deploy still fails.

  No organization selected.

3 recovery paths
2 passed
1 dead end
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

RecurSpec treats recovery instructions as something that can be tested.

```text
failure
  ↓
recovery advice
  ↓
recovery command
  ↓
retry
  ↓
verification
```

Recovery can come directly from the program's output:

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

Multi-step recovery paths are supported too:

```text
deploy
  ↓
login required
  ↓
acme login
  ↓
organization required
  ↓
acme select-org
  ↓
deploy
  ↓
success
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

Failed workspaces can optionally be preserved for inspection.

## Safety

RecurSpec does not blindly execute anything it finds in stderr.

Suggested commands are parsed and checked before execution. Shell chaining, redirection, command substitution, destructive commands, and other unsafe patterns are blocked by default.

Commands can also be restricted explicitly:

```yaml
safety:
  allowedCommands:
    - acme
    - node
    - npm
```

When RecurSpec cannot determine that a recovery command is safe, it does not run it.

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

      - run: npm ci
      - run: npx recurspec test
```

RecurSpec exits with a non-zero status when a recovery contract fails.

Machine-readable reporters are available for CI and tooling:

```bash
recurspec test --format json
recurspec test --format junit
recurspec test --format markdown
```

## Commands

```text
recurspec test                  Run recovery tests
recurspec validate              Validate configuration
recurspec init                  Create a starter config
recurspec explain <case>        Inspect a recovery contract
```

Run `recurspec --help` for all options.

## Why RecurSpec?

CLI tests commonly verify the failure itself:

```ts
expect(stderr).toContain("Run `acme init`");
```

That proves the message exists.

It does not prove that `acme init` gets the user unstuck.

RecurSpec tests the whole path:

```text
error → advice → recovery → retry → result
```

## Status

RecurSpec is under active development.

The configuration format may change before the first stable release.

## License

[MIT](LICENSE)
