import assert from "node:assert/strict";
import test from "node:test";
import { pageGridCellMillimeters, pageGridSpacing } from "../src/page-grid.js";

test("the canonical page grid represents five millimeter cells", () => {
  assert.equal(pageGridCellMillimeters, 5);
  assert.ok(Math.abs(pageGridSpacing - 18.897637795275593) < 1e-12);
});
