# Reporters

## Human terminal (default)

`recurspec test` prints one line per case with the recovery chain
(`deploy -> acme init -> deploy`), hop count, and duration, plus a summary with
the recovery rate, median/max hops, and grouped failure counts.
Honours `NO_COLOR=1`; `--verbose` adds the recovery trace.

Exit codes: `0` all pass, `1` one or more failed, `2` config/usage error.

Every case-level outcome (blocked or ambiguous recovery, loops, timeouts,
verification failures, missing executables) reports as exit `1`; only
configuration problems, unreadable files, and CLI misuse report as exit `2`.

## JSON (`--format json`)

Stable, versioned (`{"version": 1, "summary": {}, "cases": []}`) machine output.
Each case keeps its exact status plus `originalCommand`, `initialFailure`,
`extractedAdvice`, `recoverySteps`, `verification`, `trace`, and `warnings`.

## JUnit (`--format junit`)

Valid JUnit XML for GitHub Actions, GitLab, Jenkins, and CircleCI.
Failing recovery contracts become failed test cases with the status and
initial output in the failure body.

## Markdown (`--format markdown`)

A result table for PR comments:

```markdown
## RecurSpec

| Result | Case | Recovery |
|---|---|---|
| PASS | Missing config | `deploy -> init -> deploy` |
```
