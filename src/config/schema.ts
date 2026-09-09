import { z } from "zod";

const durationString = z
  .string()
  .regex(/^\d+(\.\d+)?\s*(ms|s|m|h)?$/, "Expected a duration like 500ms, 10s, or 2m.");

const stepSchema = z.object({
  command: z.string().min(1, "Step command must be a non-empty string."),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  stdin: z.array(z.string()).optional(),
  timeout: durationString.optional()
});

const streamAssertionSchema = z.object({
  contains: z.union([z.string(), z.array(z.string())]).optional(),
  notContains: z.union([z.string(), z.array(z.string())]).optional(),
  matches: z.union([z.string(), z.array(z.string())]).optional()
});

const failureSchema = z.object({
  exitCode: z.union([z.number().int(), z.literal("nonzero"), z.literal("zero")]).optional(),
  stdout: streamAssertionSchema.optional(),
  stderr: streamAssertionSchema.optional()
});

const recoverySchema = z.object({
  source: z.enum(["output", "structured", "explicit"]).optional(),
  format: z.enum(["json", "text"]).optional(),
  extract: z
    .object({
      mode: z.enum(["command", "all"]).optional()
    })
    .optional(),
  steps: z.array(stepSchema).optional(),
  prefer: z.array(z.enum(["stderr", "stdout"])).optional(),
  allowCommands: z.array(z.string()).optional(),
  denyCommands: z.array(z.string()).optional(),
  maxHops: z.number().int().min(1).max(10).optional()
});

const jsonAssertionSchema = z.object({
  path: z.string().min(1),
  assertions: z.record(z.unknown())
});

const verifySchema = z.object({
  rerunOriginal: z.boolean().optional(),
  exitCode: z.union([z.number().int(), z.literal("nonzero"), z.literal("zero")]).optional(),
  stdout: streamAssertionSchema.optional(),
  stderr: streamAssertionSchema.optional(),
  commands: z.array(stepSchema).optional(),
  files: z
    .object({
      exists: z.array(z.string()).optional(),
      notExists: z.array(z.string()).optional()
    })
    .optional(),
  json: z.union([jsonAssertionSchema, z.array(jsonAssertionSchema)]).optional()
});

const workspaceSchema = z.object({
  root: z.string().optional(),
  copy: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
  write: z.record(z.string()).optional(),
  mkdir: z.array(z.string()).optional(),
  preserveOnFailure: z.boolean().optional(),
  preserve: z.boolean().optional()
});

const mutateSchema = z.object({
  delete: z.array(z.string()).optional(),
  envRemove: z.array(z.string()).optional(),
  envSet: z.record(z.string()).optional(),
  emptyFile: z.array(z.string()).optional(),
  invalidJson: z.array(z.string()).optional(),
  invalidYaml: z.array(z.string()).optional(),
  readOnly: z.array(z.string()).optional(),
  createDirs: z.array(z.string()).optional(),
  write: z.record(z.string()).optional()
});

const safetySchema = z.object({
  shell: z.boolean().optional(),
  network: z.enum(["allow", "deny", "warn"]).optional(),
  allowedCommands: z.array(z.string()).optional(),
  deniedCommands: z.array(z.string()).optional(),
  allowPipes: z.boolean().optional(),
  allowRedirection: z.boolean().optional()
});

const caseSchema = z.object({
  name: z
    .string()
    .min(1, "Case name must be a non-empty string.")
    .regex(/^[A-Za-z0-9][A-Za-z0-9-_:.]*$/, "Case name must be unique and use letters, numbers, -, _, : or .."),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  workspace: workspaceSchema.optional(),
  mutate: mutateSchema.optional(),
  setup: z.array(stepSchema).optional(),
  teardown: z.array(stepSchema).optional(),
  env: z.record(z.string()).optional(),
  inheritEnv: z.array(z.string()).optional(),
  secrets: z.array(z.string()).optional(),
  timeout: durationString.optional(),
  run: stepSchema,
  failure: failureSchema.optional(),
  recovery: recoverySchema.optional(),
  verify: verifySchema.optional(),
  safety: safetySchema.optional()
});

export const configSchema = z.object({
  version: z.literal(1, { errorMap: () => ({ message: "Only version: 1 is supported." }) }),
  defaults: z
    .object({
      timeout: durationString.optional(),
      cwd: z.string().optional(),
      shell: z.boolean().optional(),
      env: z.record(z.string()).optional()
    })
    .optional(),
  safety: safetySchema.optional(),
  beforeAll: z.array(stepSchema).optional(),
  afterAll: z.array(stepSchema).optional(),
  beforeEach: z.array(stepSchema).optional(),
  afterEach: z.array(stepSchema).optional(),
  discover: z
    .object({
      command: z.string().min(1),
      args: z.array(z.string()).optional()
    })
    .optional(),
  cases: z.array(caseSchema).min(1, "Config must define at least one case.")
});

export type ParsedConfig = z.infer<typeof configSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
  received?: unknown;
}

export function validateConfigObject(data: unknown): { ok: true; config: ParsedConfig } | { ok: false; issues: ValidationIssue[] } {
  const parsed = configSchema.safeParse(data);
  if (parsed.success) {
    return { ok: true, config: parsed.data };
  }
  const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? formatPath(issue.path) : "(root)",
    message: issue.message,
    received: redactReceived(issue)
  }));
  return { ok: false, issues };
}

function formatPath(path: Array<string | number>): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") {
      out += "[" + part + "]";
    } else if (out === "") {
      out = part;
    } else {
      out += "." + part;
    }
  }
  return out;
}

function redactReceived(issue: unknown): unknown {
  if (typeof issue === "object" && issue !== null && "received" in issue) {
    const value = (issue as { received?: unknown }).received;
    if (typeof value === "string" && value.length > 120) return value.slice(0, 120) + "...";
    return value;
  }
  return undefined;
}

export function checkDuplicateCaseNames(config: ParsedConfig): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const c of config.cases) {
    if (seen.has(c.name)) dupes.push(c.name);
    seen.add(c.name);
  }
  return [...new Set(dupes)];
}

