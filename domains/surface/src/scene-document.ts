import * as Y from "yjs";
import {
  SceneConflictError,
  type SceneChange,
  type SceneElement,
  validateSceneElement,
} from "./scene-element.js";
import type {
  AppliedSurfaceUpdate,
  SurfaceMutation,
  SurfaceSnapshot,
} from "./surface-snapshot.js";

const elementsKey = "elements";

function semanticElements(document: Y.Doc): SceneElement[] {
  const elements = document.getMap<SceneElement>(elementsKey);
  const result = [...elements.values()].map((element) => structuredClone(element));
  for (const element of result) {
    validateSceneElement(element);
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function changedElementIds(before: readonly SceneElement[], after: readonly SceneElement[]): string[] {
  const beforeById = new Map(before.map((element) => [element.id, JSON.stringify(element)]));
  const afterById = new Map(after.map((element) => [element.id, JSON.stringify(element)]));
  return [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter((id) => beforeById.get(id) !== afterById.get(id))
    .sort();
}

export class SceneDocument {
  readonly surfaceId: string;
  readonly #document: Y.Doc;
  readonly #elements: Y.Map<SceneElement>;

  constructor(surfaceId: string, state?: Uint8Array) {
    if (!surfaceId) {
      throw new TypeError("A scene document needs a surface ID.");
    }
    this.surfaceId = surfaceId;
    this.#document = new Y.Doc({ guid: surfaceId });
    this.#elements = this.#document.getMap<SceneElement>(elementsKey);
    if (state && state.byteLength > 0) {
      Y.applyUpdate(this.#document, state, "load");
      semanticElements(this.#document);
    }
  }

  snapshot(): SurfaceSnapshot {
    return Object.freeze({
      surfaceId: this.surfaceId,
      elements: Object.freeze(semanticElements(this.#document)),
      stateVector: Y.encodeStateVector(this.#document),
    });
  }

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.#document);
  }

  fork(): SceneDocument {
    return new SceneDocument(this.surfaceId, this.encodeState());
  }

  transact(changes: readonly SceneChange[], origin: string): SurfaceMutation {
    if (changes.length === 0) {
      throw new TypeError("A scene transaction needs at least one change.");
    }
    const beforeSnapshot = this.snapshot();
    const beforeVector = Y.encodeStateVector(this.#document);

    this.#document.transact(() => {
      for (const change of changes) {
        const current =
          change.action === "put"
            ? this.#elements.get(change.element.id)
            : this.#elements.get(change.elementId);
        if (
          change.expectedVersion !== undefined &&
          current?.version !== change.expectedVersion
        ) {
          throw new SceneConflictError("The element changed after it was inspected.");
        }

        if (change.action === "delete") {
          this.#elements.delete(change.elementId);
          continue;
        }

        validateSceneElement(change.element);
        const nextVersion = (current?.version ?? 0) + 1;
        this.#elements.set(
          change.element.id,
          structuredClone({ ...change.element, version: nextVersion }),
        );
      }
    }, origin);

    const snapshot = this.snapshot();
    const changedIds = changedElementIds(beforeSnapshot.elements, snapshot.elements);
    if (changedIds.length === 0) {
      throw new SceneConflictError("The transaction did not change scene meaning.");
    }
    return Object.freeze({
      surfaceId: this.surfaceId,
      changedIds: Object.freeze(changedIds),
      update: Y.encodeStateAsUpdate(this.#document, beforeVector),
      state: this.encodeState(),
      snapshot,
    });
  }

  applyUpdate(update: Uint8Array, origin = "remote"): AppliedSurfaceUpdate {
    const before = this.snapshot();
    const candidate = this.fork();
    Y.applyUpdate(candidate.#document, update, origin);
    const candidateSnapshot = candidate.snapshot();
    const changedIds = changedElementIds(before.elements, candidateSnapshot.elements);
    Y.applyUpdate(this.#document, update, origin);
    return Object.freeze({
      surfaceId: this.surfaceId,
      changedIds: Object.freeze(changedIds),
      snapshot: this.snapshot(),
    });
  }

  observe(listener: (snapshot: SurfaceSnapshot) => void): () => void {
    const handler = (): void => listener(this.snapshot());
    this.#elements.observe(handler);
    return () => this.#elements.unobserve(handler);
  }
}

export function inspectSurfaceTransition(
  surfaceId: string,
  state: Uint8Array | undefined,
  update: Uint8Array,
): Readonly<{
  changedIds: readonly string[];
  state: Uint8Array;
  snapshot: SurfaceSnapshot;
}> {
  const scene = new SceneDocument(surfaceId, state);
  const applied = scene.applyUpdate(update, "validation");
  return Object.freeze({
    changedIds: applied.changedIds,
    state: scene.encodeState(),
    snapshot: applied.snapshot,
  });
}
