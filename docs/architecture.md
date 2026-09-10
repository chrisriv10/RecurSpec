# Architecture

Data flow for one `recurspec test` run:

```text
config (YAML -> zod schema)
  |
  v
workspace (temp dir per case: copy/remove/write/mkdir, mutations)
  |
  v
original failure (spawn, assert exit/output -> INVALID FAILURE STATE if unexpected)
  |
  v
extract candidates (deterministic patterns over stderr/stdout)
  |
  v
rank/select (confidence, stream preference, CLI affinity; ties stay ambiguous)
  |
  v
safety check (never shell by default; deny/allow lists; dangerous patterns)
  |
  v
execute recovery (recorded per-attempt verdicts)
  |
  v
chain if necessary (follow-up advice, loop signatures, max 10 hops)
  |
  v
verify completion (retry reruns the original; goal/custom check end state)
  |
  v
result (typed CaseResult incl. trace and safety evaluations)
  |
  v
reporter (human, json, junit, markdown)
```

## Modules

- `config/` — loading and zod validation. Invalid configs fail with paths, never stacks.
- `runner/` — process spawning (`process.ts`), temp workspaces (`workspace.ts`),
  executable lookup (`resolve-exe.ts`), and case orchestration (`runner.ts`).
- `recovery/` — tokenizer, extractor, ranking/selection, chain engine, loop
  detector, and the recovery graph/trace.
- `safety/` — path containment and command policy. Refuses before guessing.
- `verify/` — the completion abstraction (`retry` / `goal` / `custom`) and the
  shared assertion runners (exit codes, output, files, JSON, commands).
- `assertions/` — the reusable checks used by both failure matching and goal proof.
- `planning/` — dry-run plans. Reads config only, never spawns anything.
- `reporting/` — the four reporters plus the summary model.
- `discovery/` — experimental mutation-based candidate finder (drafts only).
- `cli/` — thin command wrappers over the above; `index.ts` is the public API.

Boundaries: reporters never change result semantics; the extractor never
executes anything; the safety check runs before every recovery execution,
including chained follow-ups.
