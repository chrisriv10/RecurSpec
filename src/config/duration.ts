export function parseDuration(input: string): number {
  const trimmed = input.trim();
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(trimmed);
  if (!match) {
    throw new Error(
      "Invalid duration " + JSON.stringify(trimmed) + ". Expected examples: 500ms, 10s, 2m."
    );
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  switch (unit) {
    case "ms":
      return Math.round(amount);
    case "s":
      return Math.round(amount * 1000);
    case "m":
      return Math.round(amount * 60 * 1000);
    case "h":
      return Math.round(amount * 60 * 60 * 1000);
    default:
      throw new Error("Unsupported duration unit: " + unit);
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return Math.round(ms) + "ms";
  if (ms < 60000) {
    const s = ms / 1000;
    return (Math.round(s * 10) / 10) + "s";
  }
  const m = ms / 60000;
  return (Math.round(m * 10) / 10) + "m";
}

