import type { CommandReceipt, LocalOperation } from "@foldthink/workspace";

export const databaseName = "foldthink";
export const databaseVersion = 1;

export const stores = Object.freeze({
  meta: "workspace_meta",
  surfaces: "surface_state",
  outbox: "outbox",
  receipts: "receipts",
});

export type LocalIdentity = Readonly<{
  workspaceId: string;
  bootstrapId: string;
}>;

export type SurfaceStateRecord = Readonly<{
  key: string;
  workspaceId: string;
  surfaceId: string;
  state: Uint8Array;
}>;

export type OutboxRecord = Readonly<{
  operationId: string;
  workspaceId: string;
  operation: LocalOperation;
  createdAt: number;
}>;

export type ReceiptRecord = Readonly<{
  operationId: string;
  workspaceId: string;
  receipt: CommandReceipt;
}>;

export function surfaceStateKey(workspaceId: string, surfaceId: string): string {
  return `${workspaceId}:${surfaceId}`;
}
