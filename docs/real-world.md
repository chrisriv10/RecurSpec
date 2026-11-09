# Real-world compatibility

RecurSpec is tested against real developer tools, not only its bundled demo.
Each integration lives in `examples/real-world/<tool>/` with its config,
an `expect.json` manifest of expected statuses, and a `notes.md` explaining
the scenario. Run them with `pnpm test:real-world`.

## Result matrix

| Tool | Scenario | Advice extracted | Recovery result |
|------|----------|------------------|-----------------|
| Git | missing identity | yes, two required commands | pass (ordered sequence) |
| Git | missing identity, explicit steps | n/a (explicit) | pass |
| Git | unmerged branch delete | yes (`hint:` + quotes) | pass (goal: branch gone) |
| Git | divergent pull | yes, three options | ambiguous (exclusive options) |
| Git | push with no remote | no (placeholders) | correctly ignored |
| Cargo | `new .` into existing dir | yes (`cargo init`) | pass (goal: project initialized in place, parent untouched) |
| Cargo | `new proj` from parent | yes, but target path omitted | verifies honestly as `VERIFY_FAILED` (expected negative) |
| npm | missing script | no (informational only) | correctly ignored |

## Running the suite

`pnpm test:real-world` builds nothing itself; run `pnpm build` first. For each
tool directory it:

- prints the detected binary versions (cargo, git, npm, ...);
- skips a tool with an explicit reason when a required binary is unavailable;
- runs `recurspec test --format json` and compares every case against
  `expect.json`;
- fails if an expected case is missing from the report, a status differs, or
  an unlisted case ran;
- counts expected negative outcomes separately from passes.

Use `node scripts/test-real-world.mjs --require-all` to treat skipped tools as
failures on a machine that is expected to have every tool. CI runs the suite
with `--require-all`, so a missing tool binary fails the job instead of
silently reducing coverage.

## Expected negatives

Some fixtures exist to prove RecurSpec refuses to guess. They are listed in
`expect.json` with their honest non-`PASS` status and counted as expected
negatives:

- Git divergent pull (`AMBIGUOUS_RECOVERY`): three mutually exclusive options.
- npm missing script (`NO_RECOVERY_ADVICE`): the suggested `npm run` only
  lists scripts.
- Cargo parent-directory `new proj` (`VERIFY_FAILED`): the advice omits the
  target path, so it runs in the current directory and the goal state is not
  reached.

## Investigated and rejected

- `go build` outside a module, `go mod init`, `dotnet build` without a
  project, `cargo` missing-manifest errors, `tsc` diagnostics, `pip` errors,
  `git switch` to a bad ref, `git commit` outside a repo: none of these emit
  actionable recovery commands on the tested versions, so they were left out
  rather than manufactured into examples.
- `npm run <missing>` and `node --run <missing>` print informational
  suggestions (`npm run` lists scripts). RecurSpec correctly refuses to treat
  diagnostic listings as recovery.

## Safety notes

- Git `--global` cases redirect `HOME` into the workspace and set
  `GIT_CONFIG_NOSYSTEM=1`; `user.useConfigOnly` is enabled through
  `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` so Git never
  auto-detects an identity from the runner account or hostname. The real user
  configuration is never touched.
- npm cases redirect `npm_config_cache` and disable the update notifier so no
  logs or cache entries leave the workspace.
- Cargo cases stay inside the workspace with no network access
  (`CARGO_NET_OFFLINE=true`) and never touch global cargo configuration.

## Known limitations

A lone `hint:` line containing only prose (e.g. "Disable this message with
...") can yield a low-confidence candidate. Ranking prefers genuinely
verb-led advice, and execution still passes the safety policy, but suite
authors should prefer cases where the tool names an explicit command.

When a diagnostic names a command but omits an argument that identifies the
target directory (for example `cargo init` after `cargo new proj`), RecurSpec
runs the literal advice in the case cwd. It does not infer the missing path.
Fixtures must model the intended cwd or accept a `VERIFY_FAILED` negative
outcome.
