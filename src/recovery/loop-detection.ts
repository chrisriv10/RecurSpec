import { signatureFor } from "../normalization/output.js";

export class LoopDetector {
  private seen = new Set<string>();

  check(command: string, args: string[], output: string): boolean {
    const signature = signatureFor(command, args, output);
    if (this.seen.has(signature)) return true;
    this.seen.add(signature);
    return false;
  }

  get size(): number {
    return this.seen.size;
  }
}

