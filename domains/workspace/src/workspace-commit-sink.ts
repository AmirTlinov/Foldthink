import type { SurfaceSnapshot } from "@foldthink/surface";
import type { CommandReceipt } from "./command-receipt.js";
import type { LocalOperation } from "./workspace-command.js";

export type LocalCommit = Readonly<{
  operation: LocalOperation;
  receipt: CommandReceipt;
  surfaceStates: readonly Readonly<{
    surfaceId: string;
    state: Uint8Array;
  }>[];
}>;

export interface WorkspaceCommitSink {
  commitLocal(commit: LocalCommit): Promise<CommandReceipt>;
  commitRemote(surfaceId: string, state: Uint8Array): Promise<void>;
  publishSnapshot?(snapshot: SurfaceSnapshot): void;
}
