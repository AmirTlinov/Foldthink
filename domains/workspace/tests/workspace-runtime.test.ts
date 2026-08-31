import assert from "node:assert/strict";
import test from "node:test";
import {
  SceneDocument,
  type EraseMask,
  type InkStroke,
  type WorkspaceItem,
} from "@foldthink/surface";
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

test("undo records inverse ink operations instead of rewriting scene history", async () => {
  const sink = new MemorySink();
  const runtime = new WorkspaceRuntime("workspace", [new SceneDocument("board")], sink);
  const mask: EraseMask = {
    id: "erase-one",
    kind: "erase",
    version: 1,
    points: [
      { x: 14, y: 8, pressure: 0.2, time: 3 },
      { x: 14, y: 22, pressure: 0.8, time: 4 },
    ],
    style: { minimumWidth: 12, maximumWidth: 40 },
    affectedStrokeIds: [stroke.id],
  };

  const strokeReceipt = await runtime.dispatch({ kind: "commitStroke", surfaceId: "board", stroke });
  const eraseReceipt = await runtime.dispatch({ kind: "eraseInk", surfaceId: "board", mask });
  assert.deepEqual(runtime.inspect("board").elements.map((element) => element.id), ["erase-one", "stroke-one"]);

  const eraseUndo = await runtime.undoOwnAction("board");
  assert.deepEqual(eraseUndo?.changedIds, [mask.id]);
  assert.deepEqual(runtime.inspect("board").elements.map((element) => element.id), [stroke.id]);

  const strokeUndo = await runtime.undoOwnAction("board");
  assert.deepEqual(strokeUndo?.changedIds, [stroke.id]);
  assert.equal(runtime.inspect("board").elements.length, 0);
  assert.equal(await runtime.undoOwnAction("board"), undefined);
  assert.deepEqual(sink.commits.map((commit) => commit.operation.intent.kind), [
    "commitStroke",
    "eraseInk",
    "undoOwnAction",
    "undoOwnAction",
  ]);
  assert.equal(
    sink.commits[2]?.operation.intent.kind === "undoOwnAction"
      ? sink.commits[2].operation.intent.targetOperationId
      : undefined,
    eraseReceipt.operationId,
  );
  assert.equal(
    sink.commits[3]?.operation.intent.kind === "undoOwnAction"
      ? sink.commits[3].operation.intent.targetOperationId
      : undefined,
    strokeReceipt.operationId,
  );
});

test("a failed undo keeps its record available for a safe retry", async () => {
  let failUndo = true;
  const runtime = new WorkspaceRuntime("workspace", [new SceneDocument("board")], {
    async commitLocal(commit): Promise<CommandReceipt> {
      if (commit.operation.intent.kind === "undoOwnAction" && failUndo) {
        failUndo = false;
        throw new Error("storage unavailable");
      }
      return { ...commit.receipt, syncState: "queued" };
    },
    async commitRemote(): Promise<void> {},
  });
  await runtime.dispatch({ kind: "commitStroke", surfaceId: "board", stroke });

  await assert.rejects(runtime.undoOwnAction("board"), /storage unavailable/u);
  assert.equal(runtime.inspect("board").elements[0]?.id, stroke.id);
  await runtime.undoOwnAction("board");
  assert.equal(runtime.inspect("board").elements.length, 0);
});

test("surface creation crosses one local durability boundary", async () => {
  const sink = new MemorySink();
  const runtime = new WorkspaceRuntime("workspace", [new SceneDocument("board")], sink);
  const receipt = await runtime.dispatch({
    kind: "createSurfaces",
    surfaces: [
      {
        surfaceId: "notebook-cover",
        changes: [{ action: "put", element: { ...stroke, id: "cover-mark" } }],
      },
      {
        surfaceId: "notebook-page-1",
        changes: [{ action: "put", element: { ...stroke, id: "page-mark" } }],
      },
    ],
  });

  assert.equal(sink.commits.length, 1);
  assert.deepEqual(receipt.changedIds, ["cover-mark", "page-mark"]);
  assert.deepEqual(runtime.surfaceIds(), ["board", "notebook-cover", "notebook-page-1"]);
  assert.equal(runtime.inspect("notebook-cover").elements[0]?.id, "cover-mark");
  assert.equal(sink.commits[0]?.surfaceStates.length, 2);
});

test("a notebook manifest, cover, and first page become readable together", async () => {
  const sink = new MemorySink();
  const runtime = new WorkspaceRuntime("workspace", [new SceneDocument("board")], sink);
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
  const observedRegistries: string[][] = [];
  runtime.observeAll(() => observedRegistries.push([...runtime.surfaceIds()]));

  const receipt = await runtime.dispatch({
    kind: "createSurfaces",
    patches: [{
      surfaceId: "board",
      changes: [{ action: "put", element: notebook }],
    }],
    surfaces: [
      { surfaceId: notebook.coverSurfaceId, changes: [] },
      { surfaceId: notebook.pageSurfaceIds[0] as string, changes: [] },
    ],
  });

  assert.deepEqual(receipt.changedIds, [notebook.id]);
  assert.equal(sink.commits.length, 1);
  assert.deepEqual(runtime.surfaceIds(), ["board", "cover:notebook-one", "page:notebook-one:1"]);
  assert.equal(runtime.inspect("board").elements[0]?.id, notebook.id);
  assert.equal(runtime.inspect(notebook.coverSurfaceId).elements.length, 0);
  assert.equal(runtime.inspect(notebook.pageSurfaceIds[0] as string).elements.length, 0);
  assert.deepEqual(observedRegistries[0], ["board", "cover:notebook-one", "page:notebook-one:1"]);
});

test("failed surface creation publishes none of its surfaces", async () => {
  const runtime = new WorkspaceRuntime("workspace", [new SceneDocument("board")], {
    async commitLocal(): Promise<CommandReceipt> {
      throw new Error("storage failed");
    },
    async commitRemote(): Promise<void> {},
  });

  await assert.rejects(runtime.dispatch({
    kind: "createSurfaces",
    surfaces: [
      {
        surfaceId: "cover",
        changes: [{ action: "put", element: { ...stroke, id: "cover-mark" } }],
      },
      {
        surfaceId: "page",
        changes: [{ action: "put", element: { ...stroke, id: "page-mark" } }],
      },
    ],
  }), /storage failed/u);

  assert.deepEqual(runtime.surfaceIds(), ["board"]);
});

test("repair drops a rejected change and rebases an independent queued change", async () => {
  const sink = new MemorySink();
  const runtime = new WorkspaceRuntime("workspace", [new SceneDocument("board")], sink);
  const element = {
    id: "rejected-mark",
    kind: "markdown" as const,
    version: 1,
    x: 10,
    y: 10,
    width: 240,
    source: "Rejected",
    color: "#171714",
    fontSize: 20,
  };
  await runtime.dispatch({
    kind: "patchSurface",
    surfaceId: "board",
    changes: [{ action: "put", element }],
  });
  await runtime.dispatch({
    kind: "patchSurface",
    surfaceId: "board",
    changes: [{ action: "put", element: { ...element, id: "kept-mark", source: "Kept" } }],
  });
  const rejectedOperationId = sink.commits[0]?.operation.operationId;
  assert.ok(rejectedOperationId);

  const confirmed = new SceneDocument("board");
  const repair = runtime.prepareRepair(
    [{ surfaceId: "board", state: confirmed.encodeState() }],
    sink.commits.map((commit) => commit.operation),
    rejectedOperationId,
  );
  runtime.installRepair(repair.surfaceStates);

  assert.deepEqual(repair.rejectedOperationIds, [rejectedOperationId]);
  assert.equal(repair.queued.length, 1);
  assert.deepEqual(runtime.inspect("board").elements.map((candidate) => candidate.id), ["kept-mark"]);
});
