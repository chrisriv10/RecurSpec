export type RecoveryNodeKind =
  | "command"
  | "failure"
  | "advice"
  | "recovery_result"
  | "verification"
  | "outcome";

export interface RecoveryNode {
  id: string;
  kind: RecoveryNodeKind;
  label: string;
  detail?: string;
}

export interface RecoveryEdge {
  from: string;
  to: string;
  label?: string;
}

export interface RecoveryTrace {
  nodes: RecoveryNode[];
  edges: RecoveryEdge[];
  path: string[];
}

