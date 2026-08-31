import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { LocalCommit } from "@foldthink/workspace";
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
