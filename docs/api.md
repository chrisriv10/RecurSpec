# Programmatic API

The minimum useful API is one function plus result and config types:

```ts
import { runRecurSpec } from "recurspec";
import type { RunResult } from "recurspec";

const result: RunResult = await runRecurSpec({
  configPath: "recurspec.yml", // optional; auto-discovered by default
  cwd: process.cwd(),          // optional
  filterCases: ["my-case"],    // optional
  filterTags: ["auth"],        // optional
  failFast: false,             // optional
  seed: undefined,             // optional, recorded in the summary
  verbose: false               // optional
});

if (result.summary.failed > 0) process.exit(1);
```

`selectCases` lists and filters contracts without running them, and
`resolveCompletionMode` reports whether a contract verifies by `retry`,
`goal`, or `custom` proof. Everything else (`CaseResult`, `RunResult`,
`RecurSpecConfig`, `SafetyEvaluation`, ...) is exported as types only;
internal parser and runner helpers are deliberately not public.
