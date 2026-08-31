import assert from "node:assert/strict";
import test from "node:test";
import type { InkStroke } from "@foldthink/surface";
import { EraseSession, InkSpatialIndex } from "../src/public-browser.js";

function stroke(id: string, y: number): InkStroke {
  return {
    id,
    kind: "ink",
    version: 1,
    points: [
      { x: 0, y, pressure: 0.5, time: 1 },
      { x: 100, y, pressure: 0.5, time: 2 },
    ],
    style: { color: "#171714", width: 4, minimumOpacity: 0.2, maximumOpacity: 1 },
  };
}

test("an erase gesture names only strokes whose geometry it crosses", () => {
  const index = new InkSpatialIndex([stroke("near", 10), stroke("far", 200)]);
  const session = new EraseSession(
    "mask-one",
    { minimumWidth: 10, maximumWidth: 40 },
    { x: 50, y: 0, pressure: 0.1, time: 1 },
  );
  session.append([{ x: 50, y: 30, pressure: 0.8, time: 2 }]);
  const mask = session.preview(index);

  assert.deepEqual(mask.affectedStrokeIds, ["near"]);
  assert.deepEqual(mask.points.map((sample) => sample.pressure), [0.1, 0.8]);
  assert.equal(mask.style.maximumWidth, 40);
});

test("a point eraser can hit a stroke while a distant point remains empty", () => {
  const index = new InkSpatialIndex([stroke("line", 10)]);
  const touching = new EraseSession(
    "touching",
    { minimumWidth: 10, maximumWidth: 20 },
    { x: 30, y: 12, pressure: 0.5, time: 1 },
  );
  const distant = new EraseSession(
    "distant",
    { minimumWidth: 10, maximumWidth: 20 },
    { x: 30, y: 100, pressure: 0.5, time: 1 },
  );
  assert.deepEqual(touching.preview(index).affectedStrokeIds, ["line"]);
  assert.deepEqual(distant.preview(index).affectedStrokeIds, []);
});
