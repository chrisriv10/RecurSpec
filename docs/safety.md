# Safety

RecurSpec executes commands that failing tools suggest. The security model is:
**when uncertain, refuse execution and report why. False negatives beat unsafe execution.**

## Layers

1. **Workspace isolation** - every case runs in its own temporary directory.
   Fixtures are copied in; the source tree is never modified. Path traversal
   (`../`, absolute paths, drive roots) in workspace operations is rejected.
2. **No shell by default** - commands run directly via `execa` without `shell: true`.
   Chaining (`&&`, `||`, `;`), pipes, redirection, and command substitution are
   blocked unless explicitly opted in.
3. **Deny/allow lists** - `safety.deniedCommands` plus a built-in never-allow set
   (`sudo`, `su`, `shutdown`, `reboot`, `mkfs`, `dd`, ...). `safety.allowedCommands`
   restricts execution to a known set; per-case `recovery.allowCommands` /
   `recovery.denyCommands` refine it further.
4. **Dangerous patterns** - `curl ... | sh`, `Invoke-Expression`, `rm -rf /`,
   and parent-traversal deletes are rejected with an explanation.

Violations produce `BLOCKED_RECOVERY` with the reason - never silent execution.

## Network policy

`safety.network: allow | warn | deny` is exposed in configuration. The local backend
cannot enforce OS-level network isolation portably, so `deny` currently emits a clear
warning that enforcement is advisory and will be strict under a future Docker backend.
RecurSpec never claims isolation it does not have.

## Environment hygiene

Child processes inherit only `PATH` (plus Windows system variables), configured
defaults, explicit `inheritEnv` entries, and case `env`. Secrets listed in `secrets`
are masked as `***` in stored output.
