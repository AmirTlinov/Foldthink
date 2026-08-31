import assert from "node:assert/strict";
import test from "node:test";
import { SceneDocument, type InkStroke } from "@foldthink/surface";
import {
  WorkspaceRuntime,
  type CommandReceipt,
  type LocalCommit,
  type WorkspaceCommitSink,
} from "../src/public.js";

class MemorySink implements WorkspaceCommitSink {
  readonly commits: LocalCommit[] = [];

  async commitLocal(commit: LocalCommit): Promise<CommandReceipt> {
    this.commits.push(commit);
    return { ...commit.receipt, syncState: "queued" };
  }

  async commitRemote(): Promise<void> {}
}

const stroke: InkStroke = {
  id: "stroke-one",
  kind: "ink",
  version: 1,
  points: [
    { x: 10, y: 10, pressure: 0.4, time: 1 },
    { x: 20, y: 20, pressure: 0.8, time: 2 },
  ],
  style: {
    color: "#11110f",
    width: 2,
    minimumOpacity: 0.2,
    maximumOpacity: 0.95,
  },
};

test("a stroke becomes visible only after its local commit is durable", async () => {
  const sink = new MemorySink();
  const surface = new SceneDocument("board");
  const runtime = new WorkspaceRuntime("workspace", [surface], sink);
  const receipt = await runtime.dispatch({ kind: "commitStroke", surfaceId: "board", stroke });

  assert.equal(receipt.syncState, "queued");
  assert.equal(sink.commits.length, 1);
  assert.equal(runtime.inspect("board").elements[0]?.id, stroke.id);
  assert.equal(sink.commits[0]?.operation.operationId, receipt.operationId);
});

test("a failed local commit publishes no scene transition", async () => {
  const surface = new SceneDocument("board");
  const runtime = new WorkspaceRuntime("workspace", [surface], {
    async commitLocal(): Promise<CommandReceipt> {
      throw new Error("storage failed");
    },
    async commitRemote(): Promise<void> {},
  });

  await assert.rejects(
    runtime.dispatch({ kind: "commitStroke", surfaceId: "board", stroke }),
    /storage failed/,
  );
  assert.equal(runtime.inspect("board").elements.length, 0);
});
