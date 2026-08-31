import type { CommandReceipt } from "@foldthink/workspace";
import type { OperationEnvelope } from "./operation-envelope.js";

export type CommittedReceipt = CommandReceipt & Readonly<{
  syncState: "committed";
  surfaces: readonly Readonly<{
    surfaceId: string;
    revision: number;
  }>[];
}>;

export type RejectedReceipt = CommandReceipt & Readonly<{
  syncState: "rejected";
  rejection: Readonly<{
    code: string;
    message: string;
  }>;
}>;

export type CommittedOperation = Readonly<{
  sequence: string;
  envelope: OperationEnvelope;
  receipt: CommittedReceipt;
}>;

export type WorkspaceState = Readonly<{
  workspaceId: string;
  cursor: string;
  surfaces: readonly Readonly<{
    surfaceId: string;
    revision: number;
    state: string;
  }>[];
}>;

export type SyncServerMessage = Readonly<{
  type: "operation";
  operation: CommittedOperation;
}>;
