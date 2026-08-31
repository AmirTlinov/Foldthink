import type { AuthorizedSession } from "@foldthink/identity/server";
import {
  SceneDocument,
  validateSceneElement,
  type SceneChange,
  type SceneElement,
} from "@foldthink/surface";
import type { CommandIntent, LocalOperation } from "@foldthink/workspace";
import type { CommittedOperation, WorkspaceState } from "./committed-receipt.js";
import {
  decodeOperationEnvelope,
  ProtocolError,
} from "./operation-envelope.js";
import type {
  JournalSurface,
  OperationJournal,
  ValidatedOperation,
} from "./operation-journal.js";

export class SyncRejection extends Error {
  override readonly name = "SyncRejection";

  constructor(
    readonly code: "forbidden" | "wrong_workspace" | "invalid_operation" | "unsupported_protocol" | "payload_too_large",
    message: string,
    readonly operationId?: string,
  ) {
    super(message);
  }
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function targetIds(intent: CommandIntent): readonly string[] {
  if (intent.kind === "commitStroke") return [intent.stroke.id];
  return intent.changes.map((change) => change.action === "put" ? change.element.id : change.elementId);
}

function assertUniqueTargets(intent: CommandIntent): void {
  const ids = targetIds(intent);
  if (new Set(ids).size !== ids.length || ids.length === 0) {
    throw new SyncRejection("invalid_operation", "One operation must change each target at most once.");
  }
}

function expectedElement(change: Extract<SceneChange, { action: "put" }>, before?: SceneElement): SceneElement {
  return Object.freeze({
    ...structuredClone(change.element),
    version: (before?.version ?? 0) + 1,
  }) as SceneElement;
}

function validateMeaning(
  intent: CommandIntent,
  before: readonly SceneElement[],
  after: readonly SceneElement[],
): void {
  const beforeById = new Map(before.map((element) => [element.id, element]));
  const afterById = new Map(after.map((element) => [element.id, element]));
  const changes: readonly SceneChange[] = intent.kind === "commitStroke"
    ? [{ action: "put", element: intent.stroke }]
    : intent.changes;
  for (const change of changes) {
    const id = change.action === "put" ? change.element.id : change.elementId;
    const previous = beforeById.get(id);
    if (change.expectedVersion !== undefined && previous?.version !== change.expectedVersion) {
      throw new SyncRejection("invalid_operation", "The operation was based on a stale element version.");
    }
    if (change.action === "delete") {
      if (!previous || afterById.has(id)) {
        throw new SyncRejection("invalid_operation", "The delete intent does not match its CRDT update.");
      }
      continue;
    }
    validateSceneElement(change.element);
    if (stable(afterById.get(id)) !== stable(expectedElement(change, previous))) {
      throw new SyncRejection("invalid_operation", "The put intent does not match its CRDT update.");
    }
  }
}

function validateOperation(
  operation: LocalOperation,
  surfaces: readonly JournalSurface[],
): ValidatedOperation {
  assertUniqueTargets(operation.intent);
  if (operation.updates.some((update) => update.surfaceId !== operation.intent.surfaceId)) {
    throw new SyncRejection("invalid_operation", "The intent and update target different surfaces.");
  }
  const current = surfaces.find((surface) => surface.surfaceId === operation.intent.surfaceId);
  const scene = new SceneDocument(operation.intent.surfaceId, current?.state);
  const before = scene.snapshot();
  const changedIds = new Set<string>();
  for (const update of operation.updates) {
    const applied = scene.applyUpdate(update.payload, operation.operationId);
    for (const id of applied.changedIds) changedIds.add(id);
  }
  const actualIds = [...changedIds].sort();
  const declaredIds = [...targetIds(operation.intent)].sort();
  if (stable(actualIds) !== stable(declaredIds)) {
    throw new SyncRejection("invalid_operation", "The intent and semantic transition change different elements.");
  }
  const after = scene.snapshot();
  validateMeaning(operation.intent, before.elements, after.elements);
  return Object.freeze({
    changedIds: Object.freeze(actualIds),
    surfaces: Object.freeze([Object.freeze({
      surfaceId: scene.surfaceId,
      state: scene.encodeState(),
    })]),
  });
}

export class SyncGateway {
  readonly #journal: OperationJournal;
  readonly #listeners = new Map<string, Set<(operation: CommittedOperation) => void>>();

  constructor(journal: OperationJournal) {
    this.#journal = journal;
  }

  async submit(actor: AuthorizedSession, envelope: unknown): Promise<CommittedOperation> {
    if (actor.role === "viewer") {
      throw new SyncRejection("forbidden", "A viewer cannot commit workspace changes.");
    }
    let operation: LocalOperation;
    try {
      operation = decodeOperationEnvelope(envelope);
    } catch (error) {
      if (error instanceof ProtocolError) {
        const code = error.code === "unsupported_protocol"
          ? "unsupported_protocol"
          : error.code === "payload_too_large"
            ? "payload_too_large"
            : "invalid_operation";
        throw new SyncRejection(code, error.message);
      }
      throw error;
    }
    if (operation.workspaceId !== actor.workspaceId) {
      throw new SyncRejection("wrong_workspace", "The operation belongs to another workspace.", operation.operationId);
    }
    const committed = await this.#journal.commit(
      actor.sessionId,
      operation,
      (surfaces) => {
        try {
          return validateOperation(operation, surfaces);
        } catch (error) {
          if (error instanceof SyncRejection) throw error;
          throw new SyncRejection("invalid_operation", "The CRDT update violates surface meaning.", operation.operationId);
        }
      },
    );
    if (!committed.duplicate) {
      for (const listener of this.#listeners.get(actor.workspaceId) ?? []) {
        try {
          listener(committed.operation);
        } catch {
          // A failed subscriber cannot turn a committed operation into a failed receipt.
        }
      }
    }
    return committed.operation;
  }

  readState(actor: AuthorizedSession): Promise<WorkspaceState> {
    return this.#journal.readWorkspaceState(actor.workspaceId);
  }

  history(actor: AuthorizedSession, after: string): Promise<readonly CommittedOperation[]> {
    if (!/^\d+$/u.test(after)) {
      throw new SyncRejection("invalid_operation", "The synchronization cursor is malformed.");
    }
    return this.#journal.listOperationsAfter(actor.workspaceId, after);
  }

  subscribe(workspaceId: string, listener: (operation: CommittedOperation) => void): () => void {
    const listeners = this.#listeners.get(workspaceId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(workspaceId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(workspaceId);
    };
  }
}
