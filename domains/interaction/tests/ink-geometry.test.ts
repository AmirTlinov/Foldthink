import assert from "node:assert/strict";
import test from "node:test";
import type { InkStroke, ScenePoint } from "@foldthink/surface";
import {
  eraserWidthAtPressure,
  inkOpacityAtPressure,
  inkWidthAtPressure,
  segmentDistanceSquared,
} from "../src/ink-geometry.js";

const point = (x: number, y: number): ScenePoint => ({ x, y, pressure: 0.5, time: 1 });

const stroke: InkStroke = {
  id: "stroke",
  kind: "ink",
  version: 1,
  points: [point(0, 0), point(100, 0)],
  style: { color: "#171714", width: 10, minimumOpacity: 0.18, maximumOpacity: 0.98 },
};

test("pressure changes visible ink from configured minimum to maximum", () => {
  assert.equal(inkOpacityAtPressure(stroke, 0), 0.18);
  assert.equal(inkOpacityAtPressure(stroke, 1), 0.98);
  assert.equal(inkWidthAtPressure(stroke, 0), 4.5);
  assert.equal(inkWidthAtPressure(stroke, 1), 10);
  assert.equal(eraserWidthAtPressure({ minimumWidth: 20, maximumWidth: 100 }, 0.5), 60);
});

test("segment distance is exact for crossings, parallels, and degenerate samples", () => {
  assert.equal(segmentDistanceSquared(point(0, 0), point(10, 10), point(0, 10), point(10, 0)), 0);
  assert.equal(segmentDistanceSquared(point(0, 0), point(10, 0), point(0, 4), point(10, 4)), 16);
  assert.equal(segmentDistanceSquared(point(0, 0), point(10, 0), point(4, 3), point(4, 3)), 9);
  assert.equal(segmentDistanceSquared(point(4, 3), point(4, 3), point(0, 0), point(10, 0)), 9);
});
