export interface StepSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string[];
  timeout?: string;
}

export interface WorkspaceSpec {
  root?: string;
  copy?: string[];
  remove?: string[];
  write?: Record<string, string>;
  mkdir?: string[];
  preserveOnFailure?: boolean;
  preserve?: boolean;
}

export interface MutateSpec {
  delete?: string[];
  envRemove?: string[];
  envSet?: Record<string, string>;
  emptyFile?: string[];
  invalidJson?: string[];
  invalidYaml?: string[];
  readOnly?: string[];
  createDirs?: string[];
  write?: Record<string, string>;
}

export interface StreamAssertion {
  contains?: string | string[];
  notContains?: string | string[];
  matches?: string | string[];
}

export interface FailureSpec {
  exitCode?: number | "nonzero" | "zero";
  stdout?: StreamAssertion;
  stderr?: StreamAssertion;
}

export interface ExtractSpec {
  mode?: "command" | "all";
}

export interface RecurSpec {
  source?: "output" | "structured" | "explicit";
  format?: "json" | "text";
  extract?: ExtractSpec;
  steps?: StepSpec[];
  prefer?: Array<"stderr" | "stdout">;
  allowCommands?: string[];
  denyCommands?: string[];
  maxHops?: number;
}

export interface JsonAssertion {
  path: string;
  assertions: Record<string, unknown>;
}

export interface VerifySpec {
  rerunOriginal?: boolean;
  exitCode?: number | "nonzero" | "zero";
  stdout?: StreamAssertion;
  stderr?: StreamAssertion;
  commands?: StepSpec[];
  files?: {
    exists?: string[];
    notExists?: string[];
  };
  json?: JsonAssertion | JsonAssertion[];
}

export interface SafetySpec {
  shell?: boolean;
  network?: "allow" | "deny" | "warn";
  allowedCommands?: string[];
  deniedCommands?: string[];
  allowPipes?: boolean;
  allowRedirection?: boolean;
}

export interface RecoveryCase {
  name: string;
  description?: string;
  tags?: string[];
  workspace?: WorkspaceSpec;
  mutate?: MutateSpec;
  setup?: StepSpec[];
  teardown?: StepSpec[];
  env?: Record<string, string>;
  inheritEnv?: string[];
  secrets?: string[];
  timeout?: string;
  run: StepSpec;
  failure?: FailureSpec;
  recovery?: RecurSpec;
  verify?: VerifySpec;
  safety?: SafetySpec;
}

export interface RecurSpecConfig {
  version: 1;
  defaults?: {
    timeout?: string;
    cwd?: string;
    shell?: boolean;
    env?: Record<string, string>;
  };
  safety?: SafetySpec;
  beforeAll?: StepSpec[];
  afterAll?: StepSpec[];
  beforeEach?: StepSpec[];
  afterEach?: StepSpec[];
  discover?: {
    command: string;
    args?: string[];
  };
  cases: RecoveryCase[];
}

