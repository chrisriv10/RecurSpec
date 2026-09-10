# Contributing

## Setup

Requires Node.js 22+ and pnpm 9.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm demo
```

## Expectations

- Keep the core mechanism intact: failure, tool-provided advice, safe execution,
  retry, verified recovery.
- Prefer refusing a questionable command over guessing (see `SECURITY.md`).
- Add or update tests with every behavior change: `tests/unit`, `tests/integration`, `tests/cli`.
- Keep docs accurate: if the CLI, schema, or defaults change, update `README.md` and `docs/`.
- Verify on the matrix (Linux, macOS, Windows) via CI before requesting review.
