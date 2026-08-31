import assert from "node:assert/strict";
import test from "node:test";
import { GestureArena, InkSession, ViewportController } from "../src/public-browser.js";

test("one active session keeps one stroke ID and ordered actual samples", () => {
  const session = new InkSession(
    "stable-stroke",
    { color: "#111", width: 2, minimumOpacity: 0.2, maximumOpacity: 0.9 },
    { x: 0, y: 0, pressure: 0.2, time: 1 },
  );
  session.append([
    { x: 1, y: 1, pressure: 0.9, time: 3 },
    { x: 2, y: 2, pressure: 0.4, time: 2 },
  ]);
  const stroke = session.stroke();
  assert.equal(stroke.id, "stable-stroke");
  assert.deepEqual(stroke.points.map((point) => point.time), [1, 3]);
});

test("pinch keeps its world anchor under the same screen point", () => {
  const viewport = new ViewportController();
  const anchor = { x: 300, y: 200 };
  const before = viewport.screenToWorld(anchor);
  viewport.zoomAround(anchor, 2);
  const after = viewport.screenToWorld(anchor);
  assert.deepEqual(after, before);
});

test("two touches have one pinch owner", () => {
  const arena = new GestureArena();
  arena.begin(1, { x: 0, y: 0 });
  arena.begin(2, { x: 10, y: 0 });
  const update = arena.move(2, { x: 20, y: 0 });
  assert.equal(update.owner, "pinch");
});
