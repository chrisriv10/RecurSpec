import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { stringify as stringifyYaml } from "yaml";
import { extractFromStreams } from "../recovery/extractor.js";
import { runStep } from "../runner/process.js";
import { SAFE_DISCOVERY_MUTATIONS } from "./mutations.js";

export interface DiscoverOptions {
  command: string;
  args: string[];
  write?: boolean;
  cwd?: string;
}

export interface DiscoveredCandidate {
  mutation: string;
  exitCode: number | null;
  stderr: string;
  advice: Array<{ command: string; args: string[]; raw: string }>;
}

export async function discoverCandidates(options: DiscoverOptions): Promise<DiscoveredCandidate[]> {
  const found: DiscoveredCandidate[] = [];
  for (const mutation of SAFE_DISCOVERY_MUTATIONS) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "recurspec-discover-"));
    try {
      for (const [rel, content] of Object.entries(mutation.apply)) {
        await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await writeFile(path.join(dir, rel), content, "utf8");
      }
      const env: Record<string, string> = { ...(process.env as Record<string, string>) };
      for (const name of mutation.removeEnv ?? []) delete env[name];
      const result = await runStep(
        { command: options.command, args: options.args },
        { cwd: options.cwd ?? dir, env, defaultTimeoutMs: 10000 }
      );
      if ((result.exitCode ?? 0) === 0) continue;
      const advice = extractFromStreams(result.stdout, result.stderr, { mode: "command" });
      if (advice.length === 0) continue;
      found.push({
        mutation: mutation.name,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 500),
        advice: advice.map((a) => ({ command: a.command, args: a.args, raw: a.raw }))
      });
    } catch {
      continue;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return found;
}

export function candidatesToYaml(candidates: DiscoveredCandidate[], command: string, args: string[]): string {
  const cases = candidates.map((c) => ({
    name: "discovered-" + c.mutation,
    description: "Discovered draft: " + c.mutation + " (requires maintainer review)",
    run: { command, args },
    failure: { exitCode: "nonzero" },
    recovery: { source: "output", extract: { mode: "command" } },
    verify: { rerunOriginal: true, exitCode: 0 }
  }));
  return stringifyYaml({ version: 1, cases });
}
