# Concepts

## The executable recovery contract

Traditional test: "Does this command emit the right error?"

RecoverySpec: "If a developer follows the error instructions exactly, can they actually complete what they were trying to do?"

An error message that tells a developer how to recover is treated as an **executable contract**.
Each recovery case drives one contract through five steps:

1. **Trigger failure** - run the original command in an isolated workspace and confirm the expected failure state.
2. **Capture the advice** - read the recovery instructions the tool itself emitted (or a configured explicit step).
3. **Safely execute that advice** - run it inside the isolated workspace, subject to the safety policy.
4. **Retry the original task** - run the original command again.
5. **Verify real recovery** - check exit codes, output, files, and JSON state, not just that the recovery command exited zero.

## Result states

A case never collapses to a bare boolean internally. The possible states are:

- `PASS` - the developer got unstuck.
- `NO_FAILURE` / `FAILURE_MISMATCH` - the intended failure state never happened (invalid contract, not a pass).
- `NO_RECOVERY_ADVICE` - the tool gave no executable advice.
- `AMBIGUOUS_RECOVERY` - several equally plausible commands; RecoverySpec refuses to guess.
- `BLOCKED_RECOVERY` - the advice violates the safety policy.
- `RECOVERY_COMMAND_FAILED` - the advice ran but failed.
- `PARTIAL_RECOVERY` - the error changed but the task still fails.
- `RECOVERY_DEAD_END` - the advice succeeded but the task fails identically.
- `RECOVERY_LOOP` - recovery steps repeat; execution stops instead of looping forever.
- `VERIFY_FAILED` - the retry passed but postconditions failed.
- `TIMEOUT` - a step exceeded its timeout and was killed.
- `INTERACTIVE_RECOVERY_UNSUPPORTED` - the tool seems to need a TTY without scripted stdin.
- `INTERNAL_ERROR` - setup or infrastructure failed.

## Recovery rate honesty

The summary recovery rate is computed over cases that reached a valid failure state only.
Cases that never failed as expected are reported separately as invalid failure states,
so a suite cannot inflate its score with contracts that never exercised recovery.
