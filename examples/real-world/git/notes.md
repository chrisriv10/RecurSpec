# Git real-world notes

Tested against git 2.50.1 (windows). Assertions use stable substrings only.

## Cases

- `git-missing-identity` (PASS): `git commit` with no identity prints a bare
  `Run` label followed by two `git config --global` commands. The label plus
  the shared executable and complementary keys (`user.email`, `user.name`)
  are strong evidence that both commands are a required sequence. RecurSpec
  executes them in order and the retried commit succeeds.
- `git-missing-identity-explicit` (PASS): same failure with the documented
  two-step recovery. Proves the advice itself works when fully applied.
- `git-unmerged-branch` (PASS via `verify.mode: goal`): `run 'git branch -D side'` is
  extracted from a `hint:` line and succeeds. Goal verification proves the
  branch is gone (`git branch --list side` prints nothing) instead of
  retrying a delete that cannot meaningfully run twice. Retrying the
  original command here would report PARTIAL_RECOVERY, which misdescribes
  a completed one-shot operation.
- `git-divergent-pull` (AMBIGUOUS_RECOVERY): three mutually exclusive
  `hint: git config pull.rebase ...` options with no way to choose.
- `git-push-no-remote` (NO_RECOVERY_ADVICE): the advice contains `<name>` /
  `<url>` placeholders, so there is nothing executable. Correctly ignored.

## Safety

Cases using `--global` redirect `HOME` to `./home` inside the isolated
workspace (created via `workspace.mkdir`) and set `GIT_CONFIG_NOSYSTEM=1`,
so the real user configuration is never read or written. This was verified:
the real `~/.gitconfig` is untouched. `--global` commands are allowed by the
default policy only because the environment makes them workspace-local;
document this pattern rather than allowlisting git globally.
