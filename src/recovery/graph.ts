import type { RecoveryEdge, RecoveryNode, RecoveryTrace } from "../types/recovery.js";

export class RecoveryGraph {
  private nodes: RecoveryNode[] = [];
  private edges: RecoveryEdge[] = [];
  private path: string[] = [];
  private counter = 0;

  addNode(kind: RecoveryNode["kind"], label: string, detail?: string): string {
    this.counter += 1;
    const id = "n" + this.counter;
    const node: RecoveryNode = detail === undefined ? { id, kind, label } : { id, kind, label, detail };
    this.nodes.push(node);
    this.path.push(label);
    const prev = this.lastEdgeTarget();
    if (prev) this.edges.push({ from: prev, to: id });
    return id;
  }

  addEdge(from: string, to: string, label?: string): void {
    const edge: RecoveryEdge = label === undefined ? { from, to } : { from, to, label };
    this.edges.push(edge);
  }

  private lastEdgeTarget(): string | null {
    if (this.nodes.length <= 1) return null;
    return (this.nodes[this.nodes.length - 2] as RecoveryNode).id;
  }

  trace(): RecoveryTrace {
    return {
      nodes: [...this.nodes],
      edges: [...this.edges],
      path: [...this.path]
    };
  }

  toText(): string {
    const lines: string[] = [];
    this.nodes.forEach((node, idx) => {
      const indent = "  ".repeat(Math.min(idx, 5));
      const branch = idx === 0 ? "" : "└─ ";
      lines.push(indent + branch + node.label);
    });
    return lines.join("\n");
  }
}

