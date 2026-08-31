import { expect, test, type CDPSession, type Page } from "@playwright/test";

type RegisteredTool = Readonly<{
  execute(input: unknown): Promise<unknown>;
}>;

type InkElement = Readonly<{
  id: string;
  kind: "ink";
  color: string;
  width: number;
  minimumOpacity: number;
  maximumOpacity: number;
  pressureRange: Readonly<{ minimum: number; maximum: number }>;
}>;

type EraseElement = Readonly<{
  id: string;
  kind: "erase";
  affectedStrokeIds: readonly string[];
}>;

declare global {
  interface Window {
    foldthinkInkTools: Record<string, RegisteredTool>;
  }
}

async function installToolCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tools: Record<string, RegisteredTool> = {};
    window.foldthinkInkTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: RegisteredTool & Readonly<{ name: string }>): void {
          tools[tool.name] = tool;
        },
      },
    });
  });
}

async function inspectBoard(page: Page): Promise<readonly (InkElement | EraseElement)[]> {
  return page.evaluate(async () => {
    const inspect = window.foldthinkInkTools.inspect_surface;
    if (!inspect) throw new Error("inspect_surface was not registered.");
    const result = await inspect.execute({ surfaceId: "board" }) as {
      elements: readonly (InkElement | EraseElement)[];
    };
    return result.elements;
  });
}

async function penPath(
  devtools: CDPSession,
  points: readonly Readonly<{ x: number; y: number; force: number }>[],
): Promise<void> {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) throw new Error("A pen path needs points.");
  await devtools.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: first.x,
    y: first.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "pen",
    force: first.force,
  });
  for (const point of points.slice(1)) {
    await devtools.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      pointerType: "pen",
      force: point.force,
    });
  }
  await devtools.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: last.x,
    y: last.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "pen",
    force: 0,
  });
}

async function stationaryTwoFingerGesture(
  devtools: CDPSession,
  durationMilliseconds = 40,
): Promise<void> {
  await devtools.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 21, x: 760, y: 680 },
      { id: 22, x: 830, y: 680 },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, durationMilliseconds));
  await devtools.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("pressure ink and partial erasure survive resize and reload", async ({ page }) => {
  await installToolCapture(page);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Object.keys(window.foldthinkInkTools).sort()))
    .toEqual(["inspect_surface", "patch_surface"]);

  const canvas = page.getByLabel("Foldthink shared surface");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The thinking surface has no bounds.");
  const devtools = await page.context().newCDPSession(page);

  await page.getByRole("button", { name: "Drawing tools" }).click();
  const minimumOpacity = page.getByRole("slider", { name: "Lightest pressure" });
  await minimumOpacity.fill("0.1");
  const width = page.getByRole("slider", { name: "Width" });
  await width.fill("8");
  await page.getByRole("button", { name: "Drawing tools" }).click();

  await penPath(devtools, [
    { x: bounds.x + 180, y: bounds.y + 310, force: 0.08 },
    { x: bounds.x + 260, y: bounds.y + 300, force: 0.28 },
    { x: bounds.x + 350, y: bounds.y + 310, force: 0.58 },
    { x: bounds.x + 450, y: bounds.y + 300, force: 0.92 },
    { x: bounds.x + 540, y: bounds.y + 310, force: 0.4 },
  ]);
  await expect.poll(async () => (await inspectBoard(page)).filter((element) => element.kind === "ink").length)
    .toBe(1);
  const ink = (await inspectBoard(page)).find((element): element is InkElement => element.kind === "ink");
  if (!ink) throw new Error("The pressure stroke was not committed.");
  expect(ink.width).toBe(8);
  expect(ink.minimumOpacity).toBe(0.1);
  expect(ink.pressureRange.maximum).toBeGreaterThan(0.8);
  expect(ink.pressureRange.minimum).toBeLessThan(0.2);
  const completeInkFrame = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());

  await page.getByRole("button", { name: "Drawing tools" }).click();
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const eraserSize = page.getByRole("slider", { name: "Size" });
  await eraserSize.fill("120");
  await page.getByRole("button", { name: "Drawing tools" }).click();
  await penPath(devtools, [
    { x: bounds.x + 340, y: bounds.y + 230, force: 0.15 },
    { x: bounds.x + 345, y: bounds.y + 390, force: 0.9 },
  ]);
  await expect.poll(async () => (await inspectBoard(page)).filter((element) => element.kind === "erase").length)
    .toBe(1);
  const erase = (await inspectBoard(page)).find((element): element is EraseElement => element.kind === "erase");
  expect(erase?.affectedStrokeIds).toEqual([ink.id]);
  const erasedFrame = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(erasedFrame).not.toBe(completeInkFrame);

  const semanticBeforeResize = await inspectBoard(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect.poll(() => inspectBoard(page)).toEqual(semanticBeforeResize);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Object.keys(window.foldthinkInkTools).sort()))
    .toEqual(["inspect_surface", "patch_surface"]);
  await expect.poll(async () => (await inspectBoard(page)).filter((element) => element.kind === "erase").length)
    .toBe(1);
});

test("a two-finger tap undoes once and a stationary hold repeats in order", async ({ page }) => {
  await installToolCapture(page);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Object.keys(window.foldthinkInkTools).sort()))
    .toEqual(["inspect_surface", "patch_surface"]);
  const devtools = await page.context().newCDPSession(page);

  await penPath(devtools, [
    { x: 180, y: 300, force: 0.4 },
    { x: 440, y: 300, force: 0.7 },
  ]);
  await penPath(devtools, [
    { x: 180, y: 390, force: 0.3 },
    { x: 440, y: 390, force: 0.8 },
  ]);
  await penPath(devtools, [
    { x: 180, y: 480, force: 0.2 },
    { x: 440, y: 480, force: 0.9 },
  ]);
  await expect.poll(async () => (await inspectBoard(page)).filter((element) => element.kind === "ink").length)
    .toBe(3);

  await stationaryTwoFingerGesture(devtools);
  await expect.poll(async () => (await inspectBoard(page)).filter((element) => element.kind === "ink").length)
    .toBe(2);

  await stationaryTwoFingerGesture(devtools, 900);
  await expect.poll(async () => (await inspectBoard(page)).filter((element) => element.kind === "ink").length)
    .toBe(0);
});
