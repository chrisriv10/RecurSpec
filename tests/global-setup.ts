import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// Build dist once before any worker starts. Per-file `ensureBuilt` hooks
// previously ran `tsc` concurrently in three parallel workers, overwriting
// the same dist/ while other workers spawned `node dist/cli.js`. On Windows
// mandatory file locking makes that overwrite-while-running race flaky
// (EBUSY/EPERM/EMFILE or a partially-written cli.js), surfacing as an empty
// stdout with exit code 1. Serializing the build here removes the race.
export default async function setup(): Promise<void> {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  await execFileAsync(
    process.execPath,
    [path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
    { cwd: repoRoot, timeout: 240000 }
  );
}
