import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { SceneDocument, type InkStroke } from "../src/public.js";

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
