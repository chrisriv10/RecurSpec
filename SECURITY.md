# Security policy

RecurSpec executes commands suggested by the tools it tests. Its security
model is: **when uncertain, refuse execution and report why.**

## What is enforced

- Every case runs in its own temporary workspace; the source tree is never modified.
- Commands run directly, without a shell, by default. Chaining (`&&`, `||`, `;`),
  pipes, redirection, and command substitution are blocked unless explicitly opted in.
- Never-allowed executables (`sudo`, `su`, `shutdown`, `mkfs`, `dd`, `format`,
  `diskpart`, ...) are always refused, as are shell code-string flags
  (`sh -c`, `cmd /c`, `powershell -Command`, ...).
- Delete-family commands (`rm`, `del`, `erase`, `rmdir`, `rd`) may only target
  workspace-relative paths.
- `safety.network: deny` is currently advisory on the local backend (no OS-level
  sandboxing); a future Docker backend will enforce it.

## Reporting a vulnerability

Open a GitHub issue describing the bypass, the RecurSpec version, and a minimal
`recurspec.yml` reproducer if possible. Do not publish exploit details for
unfixed issues beyond what is needed to explain the report.
