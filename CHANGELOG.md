# Changelog

## Unreleased

### Added

- Ordered multi-command recovery for diagnostics that prescribe a required
  sequence: a bare `Run`/`Try`/`Execute` label with complementary setting
  commands sharing one executable, an inline `then` connector, or a structured
  JSON `recovery.commands` array marked with `"sequence": true`. Every step is
  safety checked and counted against `maxHops`. The whole sequence is
  preflighted before its first member runs, and an insufficient hop budget
  refuses the remaining sequence instead of running a partial one. Required
  follow-ups are appended FIFO after pending steps.
- Structured recovery is backward compatible: without `"sequence": true`, a
  multi-command array remains `AMBIGUOUS_RECOVERY`. Declaration order is
  authoritative for both tuple and object commands; ranking never reorders
  execution.
- Conservative alternative detection (`one of`, `either`, `or`, `optionally`,
  inline `or` under a bare label, trailing per-option annotations, mixed
  executables, final-value-only differences, and non-setting commands such as
  `docker build` or `git remote add`). These remain `AMBIGUOUS_RECOVERY` and
  execute nothing.
- Additive recovery diagnostics: optional `decision`
  (`none`/`single`/`sequence`/`steps`/`ambiguous`, evidence, ranked candidates
  with selection/rejection reasons) and per-candidate `group` metadata.
  JSON exposes both; `--verbose` terminal output explains ranking; JUnit
  failures include completion mode, the executed recovery chain, decision
  evidence, and rejected candidates; Markdown ambiguous cells include evidence.
- Real-world suite now prints tool versions, reports skips with reasons, fails
  when an expected case is missing, counts expected negatives separately, and
  supports `--require-all`. CI runs it with `--require-all`, so missing tool
  binaries are failures rather than silent skips. Malformed JSON reports and
  CLI error envelopes are reported cleanly instead of crashing the harness.

### Fixed

- Fenced recovery commands now report the real diagnostic line (the line after
  the opening fence), and CRLF output is normalized before extraction.
  Multiple commands on one line are ordered by their textual column, so
  `Try A then run B` no longer executes in reverse.
- Inline `or`/`either` connectors now override a surrounding bare `Run` label,
  and fenced label blocks are grouped without counting fence delimiters.
- Complementary sequence detection is limited to setting-like commands and
  recognizes interpreter-prefixed forms (`node tool.mjs config --set ...`),
  rejecting docker-build and git-remote false positives.
- Cargo real-world false positive: the `cargo new`/`cargo init` fixture no
  longer passes by initializing the workspace root. The advice runs inside the
  intended project, and goal verification checks `proj/Cargo.toml`,
  `cargo metadata --no-deps --manifest-path Cargo.toml`, and that the parent
  stays uninitialized. A parent-directory fixture documents the honest
  `VERIFY_FAILED` limitation when the advice omits the target path.
- Relative step `cwd` is now resolved against the case workspace (or
  `workspace.root`), never against the RecurSpec process cwd. Relative paths
  that traverse outside it, or that resolve through an outside symlink, are
  refused; absolute paths are unchanged.
- Verbose terminal output now shows safety verdicts even when decision
  candidates are present, so a blocked command is never displayed without the
  reason it was blocked.
- Explicit `recovery.steps` are safety-preflighted and fail rather than being
  silently truncated when they exceed `maxHops`.
- `Run one of ...`-style prose no longer yields a phantom `one` candidate.
- Workspace path containment uses segment-aware checks so legitimate
  dot-prefixed directories such as `..cache` are allowed while `..`
  traversal and symlink escapes remain refused.
- Git missing-identity real-world cases now force `user.useConfigOnly=true`
  through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`, so the
  failure is deterministic on every platform instead of depending on the
  runner hostname.

## 0.2.0

### Added

- First-class GitHub Action (`action.yml`, `runs.using: node24`): run
  recovery contracts in CI with `uses: chrisriv10/RecurSpec@v0.2.0`, with no
  caller-side Node or pnpm setup. See `docs/github-action.md`.
- Action Job Summary with pass/fail/total counts and the Markdown report
  table, reusing the product reporter.
- Structured Action outputs (`status`, `passed`, `failed`, `total`) plus
  optional JUnit and Markdown report files with absolute output paths.
- Action dry-run, case/tag filtering, fail-fast, and seed support.
- Workflow-command injection hardening for Action logs: tool output lines
  shaped like `::name::` or `::name params::` commands are neutralized in
  log output while report files stay byte-identical to CLI renderers.
- Markdown reporter preserves ambiguity candidate commands (#11).

### Fixed

- Eliminated concurrent `dist` rebuilds across Vitest workers by building
  once in global setup, fixing a Windows-only flaky CLI test.

## 0.1.0

### Added

- Recovery contracts for command-line tools.
- Recovery command extraction from stdout and stderr.
- Retry, goal, and custom completion modes.
- Multi-step recovery chains and loop detection.
- Command safety checks.
- Temporary workspace isolation.
- Human, JSON, JUnit, and Markdown reporters.
- Dry-run planning.
- Real CLI fixtures for Git, Cargo, and npm.
