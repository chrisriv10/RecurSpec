# Cargo real-world notes

Tested against cargo 1.85.1. Assertions use stable substrings only.
All cases run with `CARGO_NET_OFFLINE=true` and touch only the isolated
workspace.

## Cases

- `cargo-new-existing` (PASS via `verify.mode: goal`): the case runs
  `cargo new .` inside an existing `proj` directory. Cargo prints
  "Use `cargo init` to initialize the directory". The advice extracts
  cleanly, `cargo init` runs in the same directory, and goal verification
  proves the project is initialized **there**:
  `proj/Cargo.toml` exists, the isolated workspace parent has no
  `Cargo.toml`, and `cargo metadata --no-deps --manifest-path Cargo.toml`
  succeeds from `proj`. The explicit manifest path prevents Cargo from
  discovering a parent manifest by accident.
  The parent check is the regression guard: an earlier version of
  this fixture ran `cargo new proj` from the workspace root, executed the
  advice in the root, and passed because it only looked for a root
  `Cargo.toml`. The intended `proj/` directory stayed empty. (Verification
  file assertions cannot point outside the case cwd, so the parent guard is
  a small `node` postcondition instead.)

- `cargo-new-parent-existing` (VERIFY_FAILED, intentional): running
  `cargo new proj` from the parent prints the same bare `cargo init`
  advice. That command initializes the current directory (the workspace
  root), not `proj`, and the diagnostic does not state the missing path.
  Goal verification requires `proj/Cargo.toml` and `cargo metadata` from
  `proj`, so the case fails honestly. This pins the rule that RecurSpec
  must not guess an omitted target directory. It is an expected negative,
  not a Cargo or RecurSpec defect.

## Safety

`cargo new` / `cargo init` only touch the isolated workspace and need no
network access here. No global cargo configuration is modified.
