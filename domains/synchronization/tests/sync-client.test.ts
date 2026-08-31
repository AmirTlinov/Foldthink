import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { LocalWorkspaceStore } from "@foldthink/local-persistence/browser";
import { SceneDocument } from "@foldthink/surface";
import { WorkspaceRuntime } from "@foldthink/workspace";
import { SyncClient } from "../src/public-browser.js";
import { encodeStateBytes, type OperationEnvelope } from "../src/public-protocol.js";

class OpenSocket extends EventTarget {
  constructor() {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }

  close(): void {}
}

async function eventually(assertion: () => Promise<void>, timeout = 3_000): Promise<void> {
  const deadline = Date.now() + timeout;
  let failure: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw failure;
}

test("a typed rejection restores committed state and rebases an independent operation", async () => {
  const store = await LocalWorkspaceStore.open(new IDBFactory());
  const identity = await store.getOrCreateIdentity();
  const runtime = new WorkspaceRuntime(identity.workspaceId, [new SceneDocument("board")], store);
  const base = {
    kind: "markdown" as const,
    version: 1,
    x: 20,
    y: 20,
    width: 260,
    color: "#171714",
    fontSize: 20,
  };
  const rejected = await runtime.dispatch({
    kind: "patchSurface",
    surfaceId: "board",
    changes: [{ action: "put", element: { ...base, id: "rejected", source: "Rejected" } }],
  });
  const retained = await runtime.dispatch({
    kind: "patchSurface",
    surfaceId: "board",
    changes: [{ action: "put", element: { ...base, id: "retained", source: "Retained" } }],
  });
  const confirmed = new SceneDocument("board");
  const posted: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const path = new URL(String(input), "https://foldthink.test").pathname;
    if (path === "/api/session/bootstrap") {
      return Response.json({ workspaceId: identity.workspaceId, role: "owner", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    if (path.endsWith("/state")) {
      return Response.json({
        workspaceId: identity.workspaceId,
        cursor: "0",
        surfaces: [{ surfaceId: "board", revision: 0, state: encodeStateBytes(confirmed.encodeState()) }],
      });
    }
    if (path.endsWith("/operations")) {
      const envelope = JSON.parse(String(init?.body)) as OperationEnvelope;
      posted.push(envelope.operationId);
      if (envelope.operationId === rejected.operationId) {
        return Response.json({ error: { code: "invalid_operation", message: "Rejected." } }, { status: 422 });
      }
      return Response.json({
        sequence: "1",
        envelope,
        receipt: {
          operationId: envelope.operationId,
          changedIds: ["retained"],
          surfaces: [{ surfaceId: "board", revision: 1 }],
          syncState: "committed",
        },
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const client = new SyncClient({
    runtime,
    store,
    identity,
    fetch: request,
    baseUrl: "https://foldthink.test",
    createWebSocket: () => new OpenSocket() as WebSocket,
  });
  const authorization = client.authorizeEdit(undefined, 1_000);
  const committedReceipt = client.waitForCommittedReceipt(retained.operationId, 1_000);
  client.start();
  try {
    await eventually(async () => {
      assert.equal((await store.listOutbox(identity.workspaceId)).length, 0);
    });
    const loaded = await store.loadWorkspace(identity);
    assert.deepEqual(posted, [rejected.operationId, retained.operationId]);
    assert.equal(await authorization, true);
    assert.equal((await committedReceipt)?.surfaces[0]?.revision, 1);
    assert.deepEqual(runtime.inspect("board").elements.map((element) => element.id), ["retained"]);
    assert.equal(loaded.receipts.find((record) => record.operationId === rejected.operationId)?.receipt.syncState, "rejected");
    assert.equal(loaded.receipts.find((record) => record.operationId === retained.operationId)?.receipt.syncState, "committed");
  } finally {
    client.stop();
    store.close();
  }
});
