import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceItem } from "@foldthink/surface";
import {
  arrangeWorkspaceItemDrop,
  SpatialWorkspaceController,
} from "../src/public-browser.js";

function item(id: string, x: number, y: number, z: number): WorkspaceItem {
  return {
    id,
    kind: "item",
    version: 1,
    itemKind: "notebook",
    x,
    y,
    width: 360,
    height: 504,
    z,
    coverSurfaceId: `cover:${id}`,
    pageSurfaceIds: [`page:${id}:1`],
    activePageIndex: 0,
    stackOrder: 0,
  };
}

test("an interactive entry always settles at one stable endpoint", () => {
  const spatial = new SpatialWorkspaceController();
  spatial.select("notebook-one");
  spatial.previewTransition("notebook-one", 0.67, "in");
  spatial.settleTransition();
  assert.deepEqual(spatial.state(), { mode: "board", selectedItemId: "notebook-one" });

  spatial.previewTransition("notebook-one", 0.68, "in");
  spatial.settleTransition();
  assert.deepEqual(spatial.state(), { mode: "item", itemId: "notebook-one" });

  spatial.previewTransition("notebook-one", 0.3, "out");
  spatial.settleTransition();
  assert.deepEqual(spatial.state(), { mode: "board", selectedItemId: "notebook-one" });
});

test("movement feedback exists only for the selected board item", () => {
  const spatial = new SpatialWorkspaceController();
  spatial.beginMove("notebook-one", 0, 0);
  assert.equal(spatial.movePreview(), undefined);

  spatial.select("notebook-one");
  spatial.beginMove("notebook-one", 10, 20);
  spatial.moveTo(90, 120);
  assert.deepEqual(spatial.movePreview(), { itemId: "notebook-one", x: 90, y: 120 });
  assert.deepEqual(spatial.finishMove(), { itemId: "notebook-one", x: 90, y: 120 });
  assert.equal(spatial.movePreview(), undefined);
});

test("dropping one item over another creates one ordered stack", () => {
  const lower = item("lower", 100, 100, 1);
  const upper = item("upper", 600, 100, 2);
  const changes = arrangeWorkspaceItemDrop(
    [lower, upper],
    { itemId: upper.id, x: 110, y: 110 },
    () => "stack-one",
  );

  assert.equal(changes.length, 2);
  const lowerChange = changes.find((change) => change.action === "put" && change.element.id === "lower");
  const upperChange = changes.find((change) => change.action === "put" && change.element.id === "upper");
  assert.ok(lowerChange?.action === "put" && lowerChange.element.kind === "item");
  assert.ok(upperChange?.action === "put" && upperChange.element.kind === "item");
  assert.equal(lowerChange.element.stackId, "stack-one");
  assert.equal(lowerChange.element.stackOrder, 0);
  assert.equal(upperChange.element.stackId, "stack-one");
  assert.equal(upperChange.element.stackOrder, 1);
  assert.deepEqual({ x: upperChange.element.x, y: upperChange.element.y }, { x: 118, y: 118 });
});

test("dropping a stacked item in free space removes its stack membership", () => {
  const stacked = { ...item("moving", 118, 118, 2), stackId: "stack-one", stackOrder: 1 };
  const lower = { ...item("lower", 100, 100, 1), stackId: "stack-one" };
  const changes = arrangeWorkspaceItemDrop(
    [lower, stacked],
    { itemId: stacked.id, x: 900, y: 700 },
    () => "unused",
  );
  const change = changes[0];
  assert.ok(change?.action === "put" && change.element.kind === "item");
  assert.equal("stackId" in change.element, false);
  assert.equal(change.element.stackOrder, 0);
  assert.deepEqual({ x: change.element.x, y: change.element.y }, { x: 900, y: 700 });
});
