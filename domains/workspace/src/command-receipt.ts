export type ReceiptSurface = Readonly<{
  surfaceId: string;
  revision?: number;
}>;

export type SyncState = "local" | "queued" | "committed" | "rejected";

export type CommandReceipt = Readonly<{
  operationId: string;
  changedIds: readonly string[];
  surfaces: readonly ReceiptSurface[];
  syncState: SyncState;
  rejection?: Readonly<{
    code: string;
    message: string;
  }>;
}>;
