# Recovery extraction

Output-derived recovery (`recovery.source: output`, the default) parses the failing
command output with a deterministic, dependency-free engine. No LLM is involved.

## Recognized formats

- Inline backticks: `` Run `acme init` ``
- Fenced code blocks (``` ... ```), including `$`-prefixed lines
- Shell prompts: `$ acme init`
- Lead labels: `Run: ...`, `Try: ...`, `Execute: ...`, `Use: ...`
- Phrases: `To fix this, run ...`, `To continue, run ...`, `You can fix this with: ...`

Every candidate records `{ command, args, raw, source, line, confidence, pattern }`
and may also carry `column` and grouping metadata. Fenced code blocks report the
real line inside the diagnostic (the line after the opening fence), and CRLF
output is normalized before line accounting. Tokenizing uses a shell-like
splitter; unbalanced quotes are rejected rather than guessed.

## Ranking and selection

1. Higher-confidence patterns first.
2. `prefer: [stderr, stdout]` order (configurable).
3. Executable names related to the original command.
4. Proximity to the error.

If zero candidates exist: `NO_RECOVERY_ADVICE`. If the top candidates tie and no
preference breaks the tie: `AMBIGUOUS_RECOVERY` - nothing is executed.

## Required sequences vs alternatives

Several commands can appear in one diagnostic. RecurSpec only treats them as a
required, ordered sequence when the output supplies strong evidence:

- an inline `then` connector (`Run \`acme migrate\` then run \`acme deploy\``),
  which takes precedence over any surrounding label; an inline `and` is
  accepted only when it joins complementary settings;
- a bare imperative label (`Run`, `Try`, `Execute`) followed by 2-3 command
  lines that are complementary settings of one executable (for example
  `git config --global user.email ...` and `git config --global user.name ...`).
  Interpreted forms such as `node tool.mjs config --set ...` are recognized
  after the script path.

Everything else is an alternative and is never executed:

- `one of`, `either`, `or`, `alternatively`, `optionally`, including an inline
  `or` between backticked commands under a bare label;
- per-option trailing annotations such as Git's `# merge`, `# rebase`,
  `# fast-forward only`;
- mixed executables, duplicated commands, or non-setting commands that merely
  share a prefix (`docker build -t app .` vs `... -t worker .`,
  `git remote add origin ...` vs `... upstream ...`);
- commands whose only difference is their final value
  (`git config pull.rebase false` vs `... true`);
- any group without enough evidence of order or complementarity.

Inline connector groups are evaluated before label blocks, so a bare `Run` label
cannot turn an `or` group into a sequence. Fence delimiters are transparent to
label scanning and never count as candidate lines.

A selected sequence is executed in order. The whole sequence is safety-checked
and budget-checked before the first member runs. If `maxHops` cannot fit every
step, including steps discovered from later output, RecurSpec runs none of the
remaining sequence and reports `RECOVERY_COMMAND_FAILED` with an explanation
instead of running a partial sequence. This prevents predictable partial
execution, but it is not a transaction or rollback: a command that already ran
is not undone.

Grouped candidates carry `group: { id, relation, evidence, index, size }` in
JSON output. The selected path also records a `decision` explaining every
candidate's rank and why it was selected, rejected, or not executed.

## Diagnostics

Each `CaseResult` may include an optional `decision`:

- `kind`: `none`, `single`, `sequence`, `steps`, or `ambiguous`;
- `evidence`: why the decision was made;
- `candidates`: per-command rank, confidence, source, line, pattern, and a
  human-readable reason.

This is additive: reporters and consumers that do not know about `decision`
keep working unchanged.

## Chains

With `maxHops` (default 3, hard max 10), a successful recovery command whose output
contains one confident follow-up is followed automatically. Required follow-up
sequences are appended FIFO after steps that are still pending; they never
replace or drop queued steps. A successful command that prints no further advice
does not stop the pending queue. Each hop records a `command + normalized error`
signature; repeats stop with `RECOVERY_LOOP`. A required sequence that does not
fit the remaining hop budget fails instead of reporting `PASS` from a later
verification.

## Explicit and structured modes

- Explicit steps (`recovery.steps`) verify a known documented path, with optional `stdin`.
  All steps are safety-checked before the first one runs. A declared path longer
  than `maxHops` fails instead of being silently truncated.
- Structured mode (`recovery.source: structured, format: json`) consumes:

  ```json
  {
    "code": "NEEDS_CONFIG",
    "recovery": {
      "sequence": true,
      "commands": [
        ["acme", "config", "--set", "email", "dev@example.com"],
        ["acme", "config", "--set", "name", "Dev User"]
      ]
    }
  }
  ```

  A multi-command array is executed as a required ordered sequence only when
  `recovery.sequence` is exactly `true`. Declaration order is authoritative;
  ranking can annotate candidates but never reorders execution. Without the
  marker, a multi-command array remains `AMBIGUOUS_RECOVERY` for backward
  compatibility, and a single-command array keeps the ordinary
  single-candidate path. Both tuple (`["cmd", "arg"]`) and object
  (`{"command": "cmd", "args": ["arg"]}`) entries preserve their declared order.
