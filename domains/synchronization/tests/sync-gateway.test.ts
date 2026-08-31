import assert from "node:assert/strict";
import test from "node:test";
import { SceneDocument, type WorkspaceItem } from "@foldthink/surface";
import {
  WorkspaceRuntime,
  type CommandReceipt,
  type LocalCommit,
  type LocalOperation,
} from "@foldthink/workspace";
import type {
  CommittedOperation,
  WorkspaceState,
} from "../src/committed-receipt.js";
import { encodeOperationEnvelope, encodeStateBytes } from "../src/operation-envelope.js";
import type {
  JournalCommit,
  JournalSurface,
  OperationJournal,
  ValidatedOperation,
} from "../src/operation-journal.js";
import { SyncGateway } from "../src/public-server.js";

class MemoryOperationJournal implements OperationJournal {
  readonly committed = new Map<string, CommittedOperation>();
  readonly states = new Map<string, Uint8Array>();
  readonly revisions = new Map<string, number>();
  sequence = 0;

  async commit(
    _actorSessionId: string,
    operation: LocalOperation,
    validate: (surfaces: readonly JournalSurface[]) => ValidatedOperation,
  ): Promise<JournalCommit> {
    const existing = this.committed.get(operation.operationId);
    if (existing) return { operation: existing, duplicate: true };
    const validated = validate([...new Set(operation.updates.map((update) => update.surfaceId))].map((surfaceId) => {
      const state = this.states.get(surfaceId);
      return {
        surfaceId,
        revision: this.revisions.get(surfaceId) ?? 0,
        ...(state ? { state } : {}),
      };
    }));
    this.sequence += 1;
    for (const surface of validated.surfaces) {
      this.states.set(surface.surfaceId, surface.state);
      this.revisions.set(surface.surfaceId, (this.revisions.get(surface.surfaceId) ?? 0) + 1);
    }
    const committed: CommittedOperation = {
      sequence: String(this.sequence),
      envelope: encodeOperationEnvelope(operation),
      receipt: {
        operationId: operation.operationId,
        changedIds: validated.changedIds,
        surfaces: validated.surfaces.map((surface) => ({
          surfaceId: surface.surfaceId,
          revision: this.revisions.get(surface.surfaceId) ?? 1,
        })),
        syncState: "committed",
      },
    };
    this.committed.set(operation.operationId, committed);
    return { operation: committed, duplicate: false };
  }

  async readWorkspaceState(workspaceId: string): Promise<WorkspaceState> {
    return {
      workspaceId,
      cursor: String(this.sequence),
      surfaces: [...this.states].map(([surfaceId, state]) => ({
        surfaceId,
        revision: this.revisions.get(surfaceId) ?? 1,
        state: encodeStateBytes(state),
      })),
    };
  }

  async listOperationsAfter(): Promise<readonly CommittedOperation[]> {
    return [...this.committed.values()];
  }
}

function strokeOperation(): LocalOperation {
  const scene = new SceneDocument("board");
  const stroke = {
    id: "stroke-1",
    kind: "ink" as const,
    version: 1,
    points: [{ x: 1, y: 2, pressure: 0.5, time: 1 }],
    style: { color: "#111111", width: 3, minimumOpacity: 0.2, maximumOpacity: 1 },
  };
  const mutation = scene.transact([{ action: "put", element: stroke }], "test-operation");
  return {
    protocolVersion: 1,
    operationId: "018f355b-cdf6-7ca4-9ca8-64df7c7d2046",
    workspaceId: "018f355b-cdf6-7ca4-9ca8-64df7c7d2045",
    intent: { kind: "commitStroke", surfaceId: "board", stroke },
    updates: [{ surfaceId: "board", payload: mutation.update }],
  };
}

const actor = {
  sessionId: "018f355b-cdf6-7ca4-9ca8-64df7c7d2047",
  workspaceId: "018f355b-cdf6-7ca4-9ca8-64df7c7d2045",
  role: "owner" as const,
};

test("the gateway derives changed IDs and commits one retry exactly once", async () => {
  const journal = new MemoryOperationJournal();
  const gateway = new SyncGateway(journal);
  const envelope = encodeOperationEnvelope(strokeOperation());
  const first = await gateway.submit(actor, envelope);
  const retry = await gateway.submit(actor, envelope);
  assert.deepEqual(first.receipt.changedIds, ["stroke-1"]);
  assert.deepEqual(retry, first);
  assert.equal(journal.committed.size, 1);
});

test("the gateway rejects an intent that lies about its CRDT transition", async () => {
  const journal = new MemoryOperationJournal();
  const gateway = new SyncGateway(journal);
  const envelope = encodeOperationEnvelope(strokeOperation());
  await assert.rejects(
    gateway.submit(actor, {
      ...envelope,
      intent: {
        ...envelope.intent,
        stroke: { ...(envelope.intent.kind === "commitStroke" ? envelope.intent.stroke : {}), id: "other" },
      },
    }),
    /different elements/u,
  );
  assert.equal(journal.committed.size, 0);
});

test("the gateway validates and commits a multi-surface creation as one operation", async () => {
  const cover = new SceneDocument("cover-one");
  const page = new SceneDocument("page-one");
  const coverElement = {
    id: "cover-title",
    kind: "markdown" as const,
    version: 1,
    x: 20,
    y: 20,
    width: 300,
    source: "Notebook",
    color: "#171714",
    fontSize: 28,
  };
  const pageElement = { ...coverElement, id: "page-heading", source: "First thought" };
  const operationId = crypto.randomUUID();
  const coverMutation = cover.transact([{ action: "put", element: coverElement }], operationId);
  const pageMutation = page.transact([{ action: "put", element: pageElement }], operationId);
  const operation: LocalOperation = {
    protocolVersion: 1,
    operationId,
    workspaceId: actor.workspaceId,
    intent: {
      kind: "createSurfaces",
      surfaces: [
        { surfaceId: "cover-one", changes: [{ action: "put", element: coverElement }] },
        { surfaceId: "page-one", changes: [{ action: "put", element: pageElement }] },
      ],
    },
    updates: [
      { surfaceId: "cover-one", payload: coverMutation.update },
      { surfaceId: "page-one", payload: pageMutation.update },
    ],
  };
  const journal = new MemoryOperationJournal();
  const receipt = await new SyncGateway(journal).submit(actor, encodeOperationEnvelope(operation));

  assert.deepEqual(receipt.receipt.changedIds, ["cover-title", "page-heading"]);
  assert.deepEqual(receipt.receipt.surfaces.map((surface) => surface.surfaceId), ["cover-one", "page-one"]);
  assert.equal(journal.committed.size, 1);
  assert.equal(journal.states.size, 2);
});

test("the gateway commits a board item and its empty child surfaces atomically", async () => {
  let localCommit: LocalCommit | undefined;
  const runtime = new WorkspaceRuntime(actor.workspaceId, [new SceneDocument("board")], {
    async commitLocal(commit): Promise<CommandReceipt> {
      localCommit = commit;
      return { ...commit.receipt, syncState: "queued" };
    },
    async commitRemote(): Promise<void> {},
  });
  const notebook: WorkspaceItem = {
    id: "notebook-one",
    kind: "item",
    version: 1,
    itemKind: "notebook",
    x: 100,
    y: 120,
    width: 360,
    height: 504,
    z: 1,
    coverSurfaceId: "cover:notebook-one",
    pageSurfaceIds: ["page:notebook-one:1"],
    activePageIndex: 0,
    stackOrder: 0,
  };
  await runtime.dispatch({
    kind: "createSurfaces",
    patches: [{ surfaceId: "board", changes: [{ action: "put", element: notebook }] }],
    surfaces: [
      { surfaceId: notebook.coverSurfaceId, changes: [] },
      { surfaceId: notebook.pageSurfaceIds[0] as string, changes: [] },
    ],
  });
  assert.ok(localCommit);

  const journal = new MemoryOperationJournal();
  const committed = await new SyncGateway(journal).submit(
    actor,
    encodeOperationEnvelope(localCommit.operation),
  );

  assert.deepEqual(committed.receipt.changedIds, [notebook.id]);
  assert.deepEqual(
    committed.receipt.surfaces.map((surface) => surface.surfaceId),
    ["board", "cover:notebook-one", "page:notebook-one:1"],
  );
  assert.equal(journal.states.size, 3);
  assert.equal(new SceneDocument("board", journal.states.get("board")).snapshot().elements[0]?.id, notebook.id);
});

test("the gateway rejects an orphan workspace item", async () => {
  const board = new SceneDocument("board");
  const orphan: WorkspaceItem = {
    id: "orphan-item",
    kind: "item",
    version: 1,
    itemKind: "notebook",
    x: 0,
    y: 0,
    width: 360,
    height: 504,
    z: 1,
    coverSurfaceId: "missing-cover",
    pageSurfaceIds: ["missing-page"],
    activePageIndex: 0,
    stackOrder: 0,
  };
  const operationId = crypto.randomUUID();
  const mutation = board.transact([{ action: "put", element: orphan }], operationId);
  const operation: LocalOperation = {
    protocolVersion: 1,
    operationId,
    workspaceId: actor.workspaceId,
    intent: {
      kind: "patchSurface",
      surfaceId: "board",
      changes: [{ action: "put", element: orphan }],
    },
    updates: [{ surfaceId: "board", payload: mutation.update }],
  };

  await assert.rejects(
    new SyncGateway(new MemoryOperationJournal()).submit(actor, encodeOperationEnvelope(operation)),
    /created with its cover and pages/u,
  );
});

test("a stale edit cannot resurrect an element deleted on the server", async () => {
  const journal = new MemoryOperationJournal();
  const gateway = new SyncGateway(journal);
  const create = strokeOperation();
  await gateway.submit(actor, encodeOperationEnvelope(create));

  const stale = new SceneDocument("board", journal.states.get("board"));
  const deleting = new SceneDocument("board", journal.states.get("board"));
  const deleteId = crypto.randomUUID();
  const deleted = deleting.transact([{
    action: "delete",
    elementId: "stroke-1",
    expectedVersion: 1,
  }], deleteId);
  await gateway.submit(actor, encodeOperationEnvelope({
    protocolVersion: 1,
    operationId: deleteId,
    workspaceId: actor.workspaceId,
    intent: {
      kind: "patchSurface",
      surfaceId: "board",
      changes: [{ action: "delete", elementId: "stroke-1", expectedVersion: 1 }],
    },
    updates: [{ surfaceId: "board", payload: deleted.update }],
  }));

  const staleId = crypto.randomUUID();
  const original = stale.snapshot().elements[0];
  assert.ok(original?.kind === "ink");
  const staleEdit = { ...original, style: { ...original.style, color: "#ff0000" } };
  const staleMutation = stale.transact([{
    action: "put",
    element: staleEdit,
    expectedVersion: 1,
  }], staleId);
  await assert.rejects(gateway.submit(actor, encodeOperationEnvelope({
    protocolVersion: 1,
    operationId: staleId,
    workspaceId: actor.workspaceId,
    intent: {
      kind: "patchSurface",
      surfaceId: "board",
      changes: [{ action: "put", element: staleEdit, expectedVersion: 1 }],
    },
    updates: [{ surfaceId: "board", payload: staleMutation.update }],
  })), /stale element version/u);

  const restored = new SceneDocument("board", journal.states.get("board"));
  assert.equal(restored.snapshot().elements.length, 0);
  assert.equal(journal.committed.size, 2);
});
