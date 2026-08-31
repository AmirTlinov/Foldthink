import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { SceneDocument, type EraseMask, type InkStroke } from "../src/public.js";

function stroke(id: string, x: number): InkStroke {
  return {
    id,
    kind: "ink",
    version: 1,
    points: [
      { x, y: 10, pressure: 0.5, time: 1 },
      { x: x + 10, y: 20, pressure: 0.7, time: 2 },
    ],
    style: {
      color: "#171714",
      width: 2,
      minimumOpacity: 0.25,
      maximumOpacity: 0.95,
    },
  };
}

test("scene updates converge when duplicated and reordered", () => {
  const left = new SceneDocument("board");
  const right = new SceneDocument("board");
  const leftUpdate = left.transact([{ action: "put", element: stroke("a", 10) }], "left").update;
  const rightUpdate = right.transact([{ action: "put", element: stroke("b", 30) }], "right").update;

  left.applyUpdate(rightUpdate);
  left.applyUpdate(rightUpdate);
  right.applyUpdate(leftUpdate);

  assert.deepEqual(left.snapshot().elements, right.snapshot().elements);
  assert.deepEqual(
    Y.decodeStateVector(left.snapshot().stateVector),
    Y.decodeStateVector(right.snapshot().stateVector),
  );
});

test("a snapshot and later update reconstruct the exact scene", () => {
  const scene = new SceneDocument("board");
  scene.transact([{ action: "put", element: stroke("a", 10) }], "first");
  const snapshot = scene.encodeState();
  const later = scene.transact([{ action: "put", element: stroke("b", 30) }], "later");

  const restored = new SceneDocument("board", snapshot);
  restored.applyUpdate(later.update);
  assert.deepEqual(restored.snapshot().elements, scene.snapshot().elements);
});

test("an erase mask is durable geometry and deleting it restores the stroke fact", () => {
  const scene = new SceneDocument("page-one");
  const ink = stroke("ink-one", 10);
  scene.transact([{ action: "put", element: ink }], "ink");
  const mask: EraseMask = {
    id: "erase-one",
    kind: "erase",
    version: 1,
    points: [
      { x: 12, y: 8, pressure: 0.1, time: 3 },
      { x: 18, y: 22, pressure: 0.9, time: 4 },
    ],
    style: { minimumWidth: 10, maximumWidth: 80 },
    affectedStrokeIds: [ink.id],
  };
  const erased = scene.transact([{ action: "put", element: mask }], "erase");

  const restored = new SceneDocument("page-one", scene.encodeState());
  assert.deepEqual(restored.snapshot().elements.map((element) => element.id), [mask.id, ink.id]);
  restored.transact([{
    action: "delete",
    elementId: mask.id,
    expectedVersion: 1,
  }], "undo");
  assert.deepEqual(restored.snapshot().elements, [ink]);
  assert.deepEqual(erased.changedIds, [mask.id]);
});
