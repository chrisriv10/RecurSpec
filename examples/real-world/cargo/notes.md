# Cargo real-world notes

Tested against cargo 1.85.1. Assertions use stable substrings only.

## Cases

- `cargo-new-existing` (PASS via `verify.mode: goal`): `cargo new proj`
  into an existing directory prints "Use `cargo init` to initialize the
  directory". The advice extracts cleanly, `cargo init` succeeds, and goal
  verification proves the project is initialized (`Cargo.toml` exists and
  `cargo metadata --no-deps` succeeds). An earlier retry-based contract
  reported RECOVERY_DEAD_END here because retrying `cargo new proj` can
  never pass; that verdict exposed a RecurSpec modeling limitation, not a
  Cargo defect. Retrying the original command is simply not the correct
  definition of recovery for substitutive advice.

## Safety

`cargo new` / `cargo init` only touch the isolated workspace and need no
network access here. No global cargo configuration is modified.
