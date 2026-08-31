import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { LocalCommit, WorkspaceRepair } from "@foldthink/workspace";
import { LocalWorkspaceStore } from "../src/public-browser.js";

test("surface, outbox, and receipt cross one IndexedDB transaction", async () => {
  const store = await LocalWorkspaceStore.open(new IDBFactory());
  const identity = await store.getOrCreateIdentity();
  const operationId = crypto.randomUUID();
  const commit: LocalCommit = {
    operation: {
      protocolVersion: 1,
      operationId,
      workspaceId: identity.workspaceId,
      intent: { kind: "patchSurface", surfaceId: "board", changes: [] },
      updates: [{ surfaceId: "board", payload: new Uint8Array([1, 2]) }],
    },
    receipt: {
      operationId,
      changedIds: ["element"],
      surfaces: [{ surfaceId: "board" }],
      syncState: "local",
    },
    surfaceStates: [{ surfaceId: "board", state: new Uint8Array([3, 4]) }],
  };

  const receipt = await store.commitLocal(commit);
  const loaded = await store.loadWorkspace(identity);
  assert.equal(receipt.syncState, "queued");
  assert.equal(loaded.surfaces.length, 1);
  assert.equal(loaded.outbox[0]?.operationId, operationId);
  assert.equal(loaded.receipts[0]?.receipt.syncState, "queued");
  store.close();
});

test("acknowledgement removes exactly its outbox operation", async () => {
  const store = await LocalWorkspaceStore.open(new IDBFactory());
  const identity = await store.getOrCreateIdentity();
  const operationId = crypto.randomUUID();
  const base = {
    operation: {
      protocolVersion: 1 as const,
      operationId,
      workspaceId: identity.workspaceId,
      intent: { kind: "patchSurface" as const, surfaceId: "board", changes: [] },
      updates: [{ surfaceId: "board", payload: new Uint8Array([1]) }],
    },
    receipt: {
      operationId,
      changedIds: ["element"],
      surfaces: [{ surfaceId: "board" }],
      syncState: "local" as const,
    },
    surfaceStates: [{ surfaceId: "board", state: new Uint8Array([1]) }],
  };
  await store.commitLocal(base);
  await store.acknowledge(identity.workspaceId, {
    ...base.receipt,
    syncState: "committed",
    surfaces: [{ surfaceId: "board", revision: 1 }],
  });
  assert.equal((await store.listOutbox(identity.workspaceId)).length, 0);
  store.close();
});

test("a blank device adopts a linked workspace atomically", async () => {
  const store = await LocalWorkspaceStore.open(new IDBFactory());
  const identity = await store.getOrCreateIdentity();
  const linked = await store.adoptLinkedWorkspace(
    identity,
    "018f355b-cdf6-7ca4-9ca8-64df7c7d2045",
  );
  assert.equal((await store.getOrCreateIdentity()).workspaceId, linked.workspaceId);
  store.close();
});

test("a durable local commit wakes the delivery owner once", async () => {
  const store = await LocalWorkspaceStore.open(new IDBFactory());
  const identity = await store.getOrCreateIdentity();
  let wakeups = 0;
  const stop = store.observeOutbox(() => wakeups += 1);
  const operationId = crypto.randomUUID();
  await store.commitLocal({
    operation: {
      protocolVersion: 1,
      operationId,
      workspaceId: identity.workspaceId,
      intent: { kind: "patchSurface", surfaceId: "board", changes: [] },
      updates: [{ surfaceId: "board", payload: new Uint8Array([1]) }],
    },
    receipt: {
      operationId,
      changedIds: ["element"],
      surfaces: [{ surfaceId: "board" }],
      syncState: "local",
    },
    surfaceStates: [{ surfaceId: "board", state: new Uint8Array([1]) }],
  });
  stop();
  assert.equal(wakeups, 1);
  store.close();
});

test("repair replaces replica, outbox, and rejection receipts atomically", async () => {
  const store = await LocalWorkspaceStore.open(new IDBFactory());
  const identity = await store.getOrCreateIdentity();
  const rejectedId = crypto.randomUUID();
  const retainedId = crypto.randomUUID();
  const commit = async (operationId: string, byte: number): Promise<void> => {
    await store.commitLocal({
      operation: {
        protocolVersion: 1,
        operationId,
        workspaceId: identity.workspaceId,
        intent: { kind: "patchSurface", surfaceId: "board", changes: [] },
        updates: [{ surfaceId: "board", payload: new Uint8Array([byte]) }],
      },
      receipt: {
        operationId,
        changedIds: [`element-${byte}`],
        surfaces: [{ surfaceId: "board" }],
        syncState: "local",
      },
      surfaceStates: [{ surfaceId: "board", state: new Uint8Array([byte]) }],
    });
  };
  await commit(rejectedId, 1);
  await commit(retainedId, 2);
  const retained = (await store.listOutbox(identity.workspaceId)).find((record) => record.operationId === retainedId);
  assert.ok(retained);
  const repair: WorkspaceRepair = {
    surfaceStates: [{ surfaceId: "board", state: new Uint8Array([9]) }],
    queued: [{
      operation: { ...retained.operation, updates: [{ surfaceId: "board", payload: new Uint8Array([8]) }] },
      receipt: {
        operationId: retainedId,
        changedIds: ["element-2"],
        surfaces: [{ surfaceId: "board" }],
        syncState: "queued",
      },
    }],
    rejectedOperationIds: [rejectedId],
  };
  await store.installRepair(identity.workspaceId, repair, [{
    operationId: rejectedId,
    code: "invalid_operation",
    message: "Rejected by the semantic owner.",
  }]);

  const loaded = await store.loadWorkspace(identity);
  assert.deepEqual([...loaded.surfaces[0]?.state ?? []], [9]);
  assert.deepEqual(loaded.outbox.map((record) => record.operationId), [retainedId]);
  assert.deepEqual([...loaded.outbox[0]?.operation.updates[0]?.payload ?? []], [8]);
  assert.equal(loaded.receipts.find((record) => record.operationId === rejectedId)?.receipt.syncState, "rejected");
  assert.equal(loaded.receipts.find((record) => record.operationId === retainedId)?.receipt.syncState, "queued");
  store.close();
});
