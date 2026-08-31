import {
  SceneDocument,
  type SceneChange,
  type SurfaceSnapshot,
} from "@foldthink/surface";
import type { CommandReceipt } from "./command-receipt.js";
import type { CommandIntent, LocalOperation } from "./workspace-command.js";
import type { LocalCommit, WorkspaceCommitSink } from "./workspace-commit-sink.js";

export class WorkspaceRuntime {
  readonly workspaceId: string;
  readonly #surfaces: Map<string, SceneDocument>;
  readonly #commitSink: WorkspaceCommitSink;
  readonly #invocations = new Map<string, Promise<CommandReceipt>>();

  constructor(
    workspaceId: string,
    surfaces: readonly SceneDocument[],
    commitSink: WorkspaceCommitSink,
  ) {
    if (!workspaceId || surfaces.length === 0) {
      throw new TypeError("A workspace runtime needs an identity and at least one surface.");
    }
    this.workspaceId = workspaceId;
    this.#surfaces = new Map(surfaces.map((surface) => [surface.surfaceId, surface]));
    this.#commitSink = commitSink;
  }

  surface(surfaceId: string): SceneDocument {
    const surface = this.#surfaces.get(surfaceId);
    if (!surface) {
      throw new RangeError(`Unknown surface: ${surfaceId}`);
    }
    return surface;
  }

  inspect(surfaceId: string): SurfaceSnapshot {
    return this.surface(surfaceId).snapshot();
  }

  observe(surfaceId: string, listener: (snapshot: SurfaceSnapshot) => void): () => void {
    return this.surface(surfaceId).observe(listener);
  }

  dispatch(intent: CommandIntent, invocationKey?: string): Promise<CommandReceipt> {
    if (invocationKey) {
      const existing = this.#invocations.get(invocationKey);
      if (existing) {
        return existing;
      }
    }
    const pending = this.#dispatch(intent);
    if (invocationKey) {
      this.#invocations.set(invocationKey, pending);
    }
    return pending;
  }

  async #dispatch(intent: CommandIntent): Promise<CommandReceipt> {
    const liveSurface = this.surface(intent.surfaceId);
    const stagedSurface = liveSurface.fork();
    const changes: readonly SceneChange[] =
      intent.kind === "commitStroke"
        ? [{ action: "put", element: intent.stroke }]
        : intent.changes;
    const operationId = crypto.randomUUID();
    const mutation = stagedSurface.transact(changes, operationId);
    const operation: LocalOperation = Object.freeze({
      protocolVersion: 1,
      operationId,
      workspaceId: this.workspaceId,
      intent: structuredClone(intent),
      updates: Object.freeze([
        Object.freeze({ surfaceId: intent.surfaceId, payload: mutation.update }),
      ]),
    });
    const localReceipt: CommandReceipt = Object.freeze({
      operationId,
      changedIds: mutation.changedIds,
      surfaces: Object.freeze([{ surfaceId: intent.surfaceId }]),
      syncState: "local",
    });
    const commit: LocalCommit = Object.freeze({
      operation,
      receipt: localReceipt,
      surfaceStates: Object.freeze([
        Object.freeze({ surfaceId: intent.surfaceId, state: mutation.state }),
      ]),
    });

    const queuedReceipt = await this.#commitSink.commitLocal(commit);
    liveSurface.applyUpdate(mutation.update, operationId);
    this.#commitSink.publishSnapshot?.(liveSurface.snapshot());
    return queuedReceipt;
  }

  async acceptRemoteState(surfaceId: string, state: Uint8Array): Promise<SurfaceSnapshot> {
    const liveSurface = this.surface(surfaceId);
    const staged = liveSurface.fork();
    staged.applyUpdate(state, "remote-validation");
    await this.#commitSink.commitRemote(surfaceId, staged.encodeState());
    liveSurface.applyUpdate(state, "remote");
    const snapshot = liveSurface.snapshot();
    this.#commitSink.publishSnapshot?.(snapshot);
    return snapshot;
  }
}
