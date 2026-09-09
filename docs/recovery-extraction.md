# Recovery extraction

Output-derived recovery (`recovery.source: output`, the default) parses the failing
command output with a deterministic, dependency-free engine. No LLM is involved.

## Recognized formats

- Inline backticks: `` Run `acme init` ``
- Fenced code blocks (``` ... ```), including `$`-prefixed lines
- Shell prompts: `$ acme init`
- Lead labels: `Run: ...`, `Try: ...`, `Execute: ...`, `Use: ...`
- Phrases: `To fix this, run ...`, `To continue, run ...`, `You can fix this with: ...`

Every candidate records `{ command, args, raw, source, line, confidence, pattern }`.
Tokenizing uses a shell-like splitter; unbalanced quotes are rejected rather than guessed.

## Ranking and selection

1. Higher-confidence patterns first.
2. `prefer: [stderr, stdout]` order (configurable).
3. Executable names related to the original command.
4. Proximity to the error.

If zero candidates exist: `NO_RECOVERY_ADVICE`. If the top candidates tie and no
preference breaks the tie: `AMBIGUOUS_RECOVERY` - nothing is executed.

## Chains

With `maxHops` (default 3, hard max 10), a successful recovery command whose output
contains one confident follow-up is followed automatically. Each hop records a
`command + normalized error` signature; repeats stop with `RECOVERY_LOOP`.

## Explicit and structured modes

- Explicit steps (`recovery.steps`) verify a known documented path, with optional `stdin`.
- Structured mode (`recovery.source: structured, format: json`) consumes
  `{"code": ..., "recovery": {"commands": [["acme", "init"]]}}` with confidence 1.0.
