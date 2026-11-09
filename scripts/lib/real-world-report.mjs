// Validation helpers for scripts/test-real-world.mjs.
//
// The real-world harness consumes `recurspec test --format json` output. A
// broken build, an unknown option, or a config error can still print JSON
// (for example an `{ "error": ... }` envelope), so the harness must not assume
// every parseable payload is a case report.

export function parseReport(stdout) {
  const text = String(stdout ?? "").trim();
  if (text.length === 0) return { ok: false, reason: "stdout was empty" };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "stdout was not JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "report was not a JSON object" };
  }
  if (parsed.cases === undefined && parsed.error !== undefined) {
    return { ok: false, reason: "error envelope: " + String(parsed.error) };
  }
  if (!Array.isArray(parsed.cases)) {
    return { ok: false, reason: "report has no cases array" };
  }
  const cases = [];
  for (const entry of parsed.cases) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, reason: "report contains a malformed case" };
    }
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      return { ok: false, reason: "report case is missing a name" };
    }
    if (typeof entry.status !== "string" || entry.status.length === 0) {
      return { ok: false, reason: "report case " + entry.name + " is missing a status" };
    }
    cases.push({ name: entry.name, status: entry.status });
  }
  return { ok: true, report: { cases } };
}

export function validateManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, reason: "expect.json must be a JSON object" };
  }
  if (typeof manifest.config !== "string" || manifest.config.length === 0) {
    return { ok: false, reason: "expect.json config must be a non-empty string" };
  }
  if (
    manifest.requiredBinaries !== undefined &&
    (!Array.isArray(manifest.requiredBinaries) ||
      manifest.requiredBinaries.some((bin) => typeof bin !== "string" || bin.length === 0))
  ) {
    return { ok: false, reason: "expect.json requiredBinaries must be an array of names" };
  }
  if (
    manifest.expected === null ||
    typeof manifest.expected !== "object" ||
    Array.isArray(manifest.expected)
  ) {
    return { ok: false, reason: "expect.json expected must be an object" };
  }
  for (const [name, status] of Object.entries(manifest.expected)) {
    if (typeof status !== "string" || status.length === 0) {
      return { ok: false, reason: "expect.json expected." + name + " must be a status string" };
    }
  }
  return { ok: true };
}
