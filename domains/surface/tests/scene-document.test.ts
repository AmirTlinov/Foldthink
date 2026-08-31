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

test("document source and widget state remain canonical scene facts", () => {
  const document = new SceneDocument("document:proof");
  document.transact([
    {
      action: "put",
      element: {
        id: "markdown:proof",
        kind: "markdown",
        version: 1,
        x: 80,
        y: 90,
        width: 720,
        height: 260,
        source: "# Source\n\n$E = mc^2$",
        color: "#171714",
        fontSize: 30,
      },
    },
    {
      action: "put",
      element: {
        id: "latex:proof",
        kind: "latex",
        version: 1,
        x: 80,
        y: 390,
        width: 720,
        height: 820,
        source: "\\documentclass{article}\\begin{document}Proof\\end{document}",
        mode: "document",
        color: "#171714",
        fontSize: 28,
      },
    },
    {
      action: "put",
      element: {
        id: "widget:proof",
        kind: "widget",
        version: 1,
        x: 80,
        y: 110,
        width: 720,
        height: 280,
        html: "<button>Count</button>",
        css: "button { font: inherit; }",
        javascript: "foldthink.setState({ count: foldthink.state.count + 1 })",
        state: { count: 2 },
      },
    },
  ], "document-source");

  const restored = new SceneDocument("document:proof", document.encodeState()).snapshot();
  assert.deepEqual(restored.elements, document.snapshot().elements);
});
