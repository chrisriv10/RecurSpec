# Real-world compatibility

RecurSpec is tested against real developer tools, not only its bundled demo.
Each integration lives in `examples/real-world/<tool>/` with its config,
an `expect.json` manifest of expected statuses, and a `notes.md` explaining
the scenario. Run them with `pnpm test:real-world`.

## Result matrix

| Tool | Scenario | Advice extracted | Recovery result |
|------|----------|------------------|-----------------|
| Git | missing identity | yes, two commands | ambiguous (both required) |
| Git | missing identity, explicit steps | n/a (explicit) | pass |
| Git | unmerged branch delete | yes (`hint:` + quotes) | pass (goal: branch gone) |
| Git | divergent pull | yes, three options | ambiguous (exclusive options) |
| Git | push with no remote | no (placeholders) | correctly ignored |
| Cargo | `new` into existing dir | yes | pass (goal: project initialized) |
| npm | missing script | no (informational only) | correctly ignored |

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
  `GIT_CONFIG_NOSYSTEM=1`; the real user configuration is never touched.
- npm cases redirect `npm_config_cache` and disable the update notifier so no
  logs or cache entries leave the workspace.
- Cargo cases stay inside the workspace with no network access.

## Known limitation

A lone `hint:` line containing only prose (e.g. "Disable this message with
...") can yield a low-confidence candidate. Ranking prefers genuinely
verb-led advice, and execution still passes the safety policy, but suite
authors should prefer cases where the tool names an explicit command.
