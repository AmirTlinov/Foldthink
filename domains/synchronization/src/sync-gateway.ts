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

function intentSurfaces(intent: CommandIntent): readonly Readonly<{
  surfaceId: string;
  changes: readonly SceneChange[];
  createsSurface: boolean;
}>[] {
  if (intent.kind === "createSurfaces") {
    return intent.surfaces.map((surface) => Object.freeze({
      surfaceId: surface.surfaceId,
      changes: surface.changes,
      createsSurface: true,
    }));
  }
  const changes: readonly SceneChange[] = intent.kind === "commitStroke"
    ? [{ action: "put", element: intent.stroke }]
    : intent.changes;
  return [Object.freeze({
    surfaceId: intent.surfaceId,
    changes,
    createsSurface: false,
  })];
}

function targetIds(intent: CommandIntent): readonly string[] {
  return intentSurfaces(intent).flatMap((surface) => surface.changes.map((change) =>
    change.action === "put" ? change.element.id : change.elementId));
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
  changes: readonly SceneChange[],
  before: readonly SceneElement[],
  after: readonly SceneElement[],
): void {
  const beforeById = new Map(before.map((element) => [element.id, element]));
  const afterById = new Map(after.map((element) => [element.id, element]));
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
  const declaredSurfaces = intentSurfaces(operation.intent);
  const declaredIds = declaredSurfaces.map((surface) => surface.surfaceId).sort();
  const updateIds = operation.updates.map((update) => update.surfaceId).sort();
  if (
    new Set(updateIds).size !== updateIds.length ||
    stable(declaredIds) !== stable(updateIds)
  ) {
    throw new SyncRejection("invalid_operation", "The intent and updates target different surfaces.");
  }
  const changedIds = new Set<string>();
  const validatedSurfaces = [];
  for (const declared of declaredSurfaces) {
    const current = surfaces.find((surface) => surface.surfaceId === declared.surfaceId);
    if (declared.createsSurface && (current?.state || (current?.revision ?? 0) !== 0)) {
      throw new SyncRejection("invalid_operation", "A created surface already exists.");
    }
    const scene = new SceneDocument(declared.surfaceId, current?.state);
    const before = scene.snapshot();
    const update = operation.updates.find((candidate) => candidate.surfaceId === declared.surfaceId);
    if (!update) throw new SyncRejection("invalid_operation", "A declared surface has no update.");
    const applied = scene.applyUpdate(update.payload, operation.operationId);
    const actual = [...applied.changedIds].sort();
    const expected = declared.changes.map((change) =>
      change.action === "put" ? change.element.id : change.elementId).sort();
    if (stable(actual) !== stable(expected)) {
      throw new SyncRejection("invalid_operation", "The intent and semantic transition change different elements.");
    }
    validateMeaning(declared.changes, before.elements, scene.snapshot().elements);
    for (const id of actual) changedIds.add(id);
    validatedSurfaces.push(Object.freeze({
      surfaceId: scene.surfaceId,
      state: scene.encodeState(),
    }));
  }
  const actualIds = [...changedIds].sort();
  return Object.freeze({
    changedIds: Object.freeze(actualIds),
    surfaces: Object.freeze(validatedSurfaces),
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
