import type { LocalOperation } from "@foldthink/workspace";
import type { CommittedOperation, CommittedReceipt, WorkspaceState } from "./committed-receipt.js";

export type JournalSurface = Readonly<{
  surfaceId: string;
  revision: number;
  state?: Uint8Array;
}>;

export type ValidatedSurface = Readonly<{
  surfaceId: string;
  state: Uint8Array;
}>;

export type ValidatedOperation = Readonly<{
  changedIds: readonly string[];
  surfaces: readonly ValidatedSurface[];
}>;

export type JournalCommit = Readonly<{
  operation: CommittedOperation;
  duplicate: boolean;
}>;

export interface OperationJournal {
  commit(
    actorSessionId: string,
    operation: LocalOperation,
    validate: (surfaces: readonly JournalSurface[]) => ValidatedOperation,
  ): Promise<JournalCommit>;
  readWorkspaceState(workspaceId: string): Promise<WorkspaceState>;
  listOperationsAfter(workspaceId: string, sequence: string): Promise<readonly CommittedOperation[]>;
}

export function isCommittedReceipt(value: unknown): value is CommittedReceipt {
  return Boolean(
    value &&
    typeof value === "object" &&
    "syncState" in value &&
    value.syncState === "committed" &&
    "operationId" in value &&
    typeof value.operationId === "string",
  );
}
