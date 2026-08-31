import assert from "node:assert/strict";
import test from "node:test";
import { DrawingToolController } from "../src/public-browser.js";

test("the drawing tool controller publishes one immutable pen or eraser policy", () => {
  const controller = new DrawingToolController();
  const observed = [];
  controller.observe((state) => observed.push(state));

  controller.select("eraser");
  controller.setEraserMaximumWidth(200);
  controller.select("pen");
  controller.setPenColor("#CA3120");
  controller.setPenWidth(7.5);
  controller.setMinimumOpacity(0.12);

  assert.equal(observed.length, 6);
  assert.deepEqual(controller.state(), {
    selected: "pen",
    pen: {
      color: "#ca3120",
      width: 7.5,
      minimumOpacity: 0.12,
      maximumOpacity: 0.98,
    },
    eraser: { minimumWidth: 50, maximumWidth: 200 },
  });
  assert.ok(Object.isFrozen(controller.state().pen));
  assert.throws(() => controller.setPenWidth(401), /Pen width/u);
});

test("a supplied tool policy is copied and validated at the boundary", () => {
  const source = {
    selected: "pen" as const,
    pen: { color: "#171714", width: 3, minimumOpacity: 0.2, maximumOpacity: 0.9 },
    eraser: { minimumWidth: 10, maximumWidth: 40 },
  };
  const controller = new DrawingToolController(source);
  source.pen.width = 20;
  assert.equal(controller.state().pen.width, 3);
  assert.throws(() => new DrawingToolController({
    ...source,
    eraser: { minimumWidth: 80, maximumWidth: 40 },
  }), /Maximum eraser width/u);
});
