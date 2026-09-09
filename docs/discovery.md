# Discovery (experimental)

`recurspec discover` helps maintainers find likely recoverable failures.
It is intentionally conservative: it only drafts candidates, never authoritative contracts.

Configure the base command:

```yaml
discover:
  command: acme
  args: [deploy]
```

Discovery applies safe mutations (empty workspace, removed config files, corrupted
JSON/YAML, removed env vars), runs the command, and keeps failures that contain
apparent recovery advice. Output lists candidates; `--write` emits
`recurspec.discovered.yml` drafts for maintainer review.

Every generated case must be reviewed before it is trusted: discovery shows what a
tool *claims*, while `recurspec test` verifies whether the claim works.
