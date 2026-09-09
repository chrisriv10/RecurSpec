# Configuration

RecoverySpec reads `recoveryspec.yml` (or `recoveryspec.yaml`) from the current directory.
Validate without running: `recoveryspec validate`. Scaffold a starter file: `recoveryspec init`.

## Top-level shape

```yaml
version: 1

defaults:
  timeout: 10s
  env:
    CI: "1"

safety:
  shell: false
  network: warn

beforeAll: []   # steps run once before all cases
afterAll: []    # steps run once after all cases
beforeEach: []  # steps run before every case
afterEach: []   # steps run after every case (even on failure)

cases:
  - name: missing-project-config
    # ... see below
```

## Case reference

| Key | Purpose |
|---|---|
| `name` | Unique identifier (letters, numbers, `-_:.`). |
| `description`, `tags` | Human text; tags enable `--tag` filtering. |
| `workspace` | `copy` / `remove` / `write` / `mkdir` / `root` / `preserve` / `preserveOnFailure`. |
| `mutate` | `delete`, `envRemove`, `envSet`, `emptyFile`, `invalidJson`, `invalidYaml`, `readOnly`, `createDirs`, `write`. |
| `setup` / `teardown` | Steps run before / after the case. Teardown always runs. |
| `env` / `inheritEnv` / `secrets` | Case environment; explicit inheritance; values masked as `***`. |
| `timeout` | e.g. `500ms`, `10s`, `2m`. Kills the process tree on expiry. |
| `run` | The original command: `command`, `args`, `cwd`, `env`, `stdin`, `timeout`. |
| `failure` | Expected failure: `exitCode` (`0`, `2`, `nonzero`, `zero`) plus `stdout`/`stderr` `contains` / `notContains` / `matches` (string or list). |
| `recovery` | `source: output | structured | explicit`, `steps`, `prefer`, `allowCommands`, `denyCommands`, `maxHops` (1-10, default 3), `format`, `extract.mode`. |
| `verify` | `rerunOriginal` (default true), `exitCode`, `stdout`/`stderr`, `commands`, `files.exists` / `files.notExists`, `json` assertions. |
| `safety` | Per-case override: `shell`, `network`, `allowedCommands`, `deniedCommands`, `allowPipes`, `allowRedirection`. |

## Durations

Accept `500ms`, `10s`, `2m`, `1h`, or a bare number (seconds).

## Environment handling

Only `PATH` (plus Windows system vars) passes through by default.
Inherit more explicitly with `inheritEnv: [NODE_OPTIONS]`, set values with `env`,
and list names in `secrets` to mask them in output.
