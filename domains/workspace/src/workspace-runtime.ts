import {
  SceneDocument,
  type SceneChange,
  type SurfaceSnapshot,
} from "@foldthink/surface";
import type { CommandReceipt } from "./command-receipt.js";
import type { CommandIntent, LocalOperation } from "./workspace-command.js";
import type { LocalCommit, WorkspaceCommitSink } from "./workspace-commit-sink.js";

type StagedSurface = Readonly<{
  surfaceId: string;
  created: boolean;
  document: SceneDocument;
  update: Uint8Array;
  changedIds: readonly string[];
}>;

export type WorkspaceSurfaceState = Readonly<{
  surfaceId: string;
  state: Uint8Array;
}>;

export type RebasedQueuedOperation = Readonly<{
  operation: LocalOperation;
  receipt: CommandReceipt;
}>;

export type WorkspaceRepair = Readonly<{
  surfaceStates: readonly WorkspaceSurfaceState[];
  queued: readonly RebasedQueuedOperation[];
  rejectedOperationIds: readonly string[];
}>;

export class WorkspaceRuntime {
  readonly workspaceId: string;
  readonly #surfaces: Map<string, SceneDocument>;
  readonly #commitSink: WorkspaceCommitSink;
  readonly #invocations = new Map<string, Promise<CommandReceipt>>();
  readonly #listeners = new Map<string, Set<(snapshot: SurfaceSnapshot) => void>>();

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

  hasSurface(surfaceId: string): boolean {
    return this.#surfaces.has(surfaceId);
  }

  surfaceIds(): readonly string[] {
    return Object.freeze([...this.#surfaces.keys()].sort());
  }

  inspect(surfaceId: string): SurfaceSnapshot {
    return this.surface(surfaceId).snapshot();
  }

  observe(surfaceId: string, listener: (snapshot: SurfaceSnapshot) => void): () => void {
    this.surface(surfaceId);
    const listeners = this.#listeners.get(surfaceId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(surfaceId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(surfaceId);
    };
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
    const operationId = crypto.randomUUID();
    const staged = this.#stageIn(this.#surfaces, intent, operationId);
    const operation: LocalOperation = Object.freeze({
      protocolVersion: 1,
      operationId,
      workspaceId: this.workspaceId,
      intent: structuredClone(intent),
      updates: Object.freeze(staged.map((surface) => Object.freeze({
        surfaceId: surface.surfaceId,
        payload: surface.update,
      }))),
    });
    const localReceipt: CommandReceipt = Object.freeze({
      operationId,
      changedIds: Object.freeze([...new Set(staged.flatMap((surface) => surface.changedIds))].sort()),
      surfaces: Object.freeze(staged.map((surface) => Object.freeze({ surfaceId: surface.surfaceId }))),
      syncState: "local",
    });
    const commit: LocalCommit = Object.freeze({
      operation,
      receipt: localReceipt,
      surfaceStates: Object.freeze(staged.map((surface) => Object.freeze({
        surfaceId: surface.surfaceId,
        state: surface.document.encodeState(),
      }))),
    });

    const queuedReceipt = await this.#commitSink.commitLocal(commit);
    for (const surface of staged) {
      let snapshot: SurfaceSnapshot;
      if (surface.created) {
        this.#surfaces.set(surface.surfaceId, surface.document);
        snapshot = surface.document.snapshot();
      } else {
        const live = this.surface(surface.surfaceId);
        live.applyUpdate(surface.update, operationId);
        snapshot = live.snapshot();
      }
      this.#publish(snapshot);
    }
    return queuedReceipt;
  }

  async acceptRemoteState(surfaceId: string, state: Uint8Array): Promise<SurfaceSnapshot> {
    const liveSurface = this.#surfaces.get(surfaceId);
    const staged = liveSurface?.fork() ?? new SceneDocument(surfaceId);
    staged.applyUpdate(state, "remote-validation");
    await this.#commitSink.commitRemote(surfaceId, staged.encodeState());
    let snapshot: SurfaceSnapshot;
    if (liveSurface) {
      liveSurface.applyUpdate(state, "remote");
      snapshot = liveSurface.snapshot();
    } else {
      this.#surfaces.set(surfaceId, staged);
      snapshot = staged.snapshot();
    }
    this.#publish(snapshot);
    return snapshot;
  }

  prepareRepair(
    confirmedStates: readonly WorkspaceSurfaceState[],
    queuedOperations: readonly LocalOperation[],
    rejectedOperationId: string,
  ): WorkspaceRepair {
    const documents = new Map<string, SceneDocument>();
    for (const surface of confirmedStates) {
      if (documents.has(surface.surfaceId)) {
        throw new TypeError("Confirmed workspace state repeats a surface.");
      }
      documents.set(surface.surfaceId, new SceneDocument(surface.surfaceId, surface.state));
    }
    if (documents.size === 0) documents.set("board", new SceneDocument("board"));

    const queued: RebasedQueuedOperation[] = [];
    const rejected = new Set([rejectedOperationId]);
    for (const operation of queuedOperations) {
      if (operation.operationId === rejectedOperationId) continue;
      try {
        const staged = this.#stageIn(documents, operation.intent, operation.operationId);
        const rebased: LocalOperation = Object.freeze({
          ...operation,
          intent: structuredClone(operation.intent),
          updates: Object.freeze(staged.map((surface) => Object.freeze({
            surfaceId: surface.surfaceId,
            payload: surface.update,
          }))),
        });
        const receipt: CommandReceipt = Object.freeze({
          operationId: operation.operationId,
          changedIds: Object.freeze([...new Set(staged.flatMap((surface) => surface.changedIds))].sort()),
          surfaces: Object.freeze(staged.map((surface) => Object.freeze({ surfaceId: surface.surfaceId }))),
          syncState: "queued",
        });
        for (const surface of staged) documents.set(surface.surfaceId, surface.document);
        queued.push(Object.freeze({ operation: rebased, receipt }));
      } catch {
        rejected.add(operation.operationId);
      }
    }
    return Object.freeze({
      surfaceStates: Object.freeze([...documents.values()].map((document) => Object.freeze({
        surfaceId: document.surfaceId,
        state: document.encodeState(),
      }))),
      queued: Object.freeze(queued),
      rejectedOperationIds: Object.freeze([...rejected]),
    });
  }

  installRepair(surfaceStates: readonly WorkspaceSurfaceState[]): void {
    const repaired = new Map(surfaceStates.map((surface) => [
      surface.surfaceId,
      new SceneDocument(surface.surfaceId, surface.state),
    ]));
    if (repaired.size === 0) throw new TypeError("A repaired workspace needs at least one surface.");
    this.#surfaces.clear();
    for (const [surfaceId, document] of repaired) this.#surfaces.set(surfaceId, document);
    for (const document of repaired.values()) this.#publish(document.snapshot());
  }

  #stageIn(
    surfaces: ReadonlyMap<string, SceneDocument>,
    intent: CommandIntent,
    operationId: string,
  ): readonly StagedSurface[] {
    if (intent.kind === "createSurfaces") {
      if (intent.surfaces.length === 0 || intent.surfaces.length > 16) {
        throw new TypeError("One command creates between one and 16 surfaces.");
      }
      const ids = intent.surfaces.map((surface) => surface.surfaceId);
      if (new Set(ids).size !== ids.length || ids.some((surfaceId) => surfaces.has(surfaceId))) {
        throw new RangeError("Every created surface needs one new ID.");
      }
      return Object.freeze(intent.surfaces.map((surface) => {
        const document = new SceneDocument(surface.surfaceId);
        const mutation = document.transact(surface.changes, operationId);
        return Object.freeze({
          surfaceId: surface.surfaceId,
          created: true,
          document,
          update: mutation.update,
          changedIds: mutation.changedIds,
        });
      }));
    }

    const live = surfaces.get(intent.surfaceId);
    if (!live) throw new RangeError(`Unknown surface: ${intent.surfaceId}`);
    const document = live.fork();
    const changes: readonly SceneChange[] = intent.kind === "commitStroke"
      ? [{ action: "put", element: intent.stroke }]
      : intent.changes;
    const mutation = document.transact(changes, operationId);
    return Object.freeze([Object.freeze({
      surfaceId: intent.surfaceId,
      created: false,
      document,
      update: mutation.update,
      changedIds: mutation.changedIds,
    })]);
  }

  #publish(snapshot: SurfaceSnapshot): void {
    this.#commitSink.publishSnapshot?.(snapshot);
    for (const listener of this.#listeners.get(snapshot.surfaceId) ?? []) listener(snapshot);
  }
}
