# Changelog

## 0.1.0

First public release.

### Added

- Recovery contracts: declare a failing command, the expected failure, the
  recovery source, and how to verify the user got unstuck.
- Output-derived recovery advice: deterministic extraction from program
  output (`hint:`, quoted commands, continuations, ANSI stripping) with
  ambiguity refusal instead of guessing.
- Explicit recovery steps, including multi-hop chains with loop detection.
- Retry, goal, and custom completion modes with schema validation, so
  substitutive advice and one-shot operations verify correctly.
- Safety policy: isolated workspaces, no shell by default, deny/allow lists,
  delete containment, and shell code-string blocks.
- Reporters: human terminal output, versioned JSON, JUnit, and Markdown.
- `test --dry-run` planning in human and JSON output, executing nothing.
- `validate`, `init`, and `explain` commands plus experimental `discover`.
- Programmatic API (`runRecurSpec`) with TypeScript declarations.

### Safety

- Documented in `SECURITY.md`: uncertain commands are refused, never executed.

### Testing

- 191 automated tests: unit, integration, CLI, dogfooding, and real-world
  cases against Git, Cargo, and npm.
- Packed-install smoke tests and multi-OS CI (Linux, macOS, Windows).

### Documentation

- README quick start, `docs/` guides, contributor and security notes.
