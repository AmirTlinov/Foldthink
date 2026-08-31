import assert from "node:assert/strict";
import test from "node:test";
import { SceneDocument } from "@foldthink/surface";
import type { LocalOperation } from "@foldthink/workspace";
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
  state: Uint8Array | undefined;
  revision = 0;

  async commit(
    _actorSessionId: string,
    operation: LocalOperation,
    validate: (surfaces: readonly JournalSurface[]) => ValidatedOperation,
  ): Promise<JournalCommit> {
    const existing = this.committed.get(operation.operationId);
    if (existing) return { operation: existing, duplicate: true };
    const validated = validate([{ surfaceId: "board", revision: this.revision, ...(this.state ? { state: this.state } : {}) }]);
    this.state = validated.surfaces[0]?.state;
    this.revision += 1;
    const committed: CommittedOperation = {
      sequence: String(this.revision),
      envelope: encodeOperationEnvelope(operation),
      receipt: {
        operationId: operation.operationId,
        changedIds: validated.changedIds,
        surfaces: [{ surfaceId: "board", revision: this.revision }],
        syncState: "committed",
      },
    };
    this.committed.set(operation.operationId, committed);
    return { operation: committed, duplicate: false };
  }

  async readWorkspaceState(workspaceId: string): Promise<WorkspaceState> {
    return {
      workspaceId,
      cursor: String(this.revision),
      surfaces: this.state ? [{ surfaceId: "board", revision: this.revision, state: encodeStateBytes(this.state) }] : [],
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
