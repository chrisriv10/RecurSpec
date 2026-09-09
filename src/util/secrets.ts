export function maskSecrets(text: string, secrets: string[], env: Record<string, string>): string {
  let out = text;
  for (const name of secrets) {
    const value = env[name];
    if (value && value.length > 0) {
      out = out.split(value).join("***");
    }
  }
  return out;
}

export function formatEnvForDisplay(env: Record<string, string>, secrets: string[]): string {
  return Object.entries(env)
    .map(([key, value]) => (secrets.includes(key) ? key + "=***" : key + "=" + value))
    .join(" ");
}

