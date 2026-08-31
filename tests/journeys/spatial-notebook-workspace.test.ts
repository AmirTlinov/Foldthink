import { expect, test, type Page } from "@playwright/test";

type RegisteredTool = Readonly<{
  execute(input: unknown): Promise<unknown>;
}>;

type InspectedItem = Readonly<{
  id: string;
  kind: "item";
  version: number;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  coverSurfaceId: string;
  pageSurfaceIds: readonly string[];
  activePageIndex: number;
  stackId?: string;
  stackOrder: number;
}>;

declare global {
  interface Window {
    foldthinkSpatialTools: Record<string, RegisteredTool>;
  }
}

async function installToolCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tools: Record<string, RegisteredTool> = {};
    window.foldthinkSpatialTools = tools;
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

async function inspectItems(page: Page): Promise<InspectedItem[]> {
  return page.evaluate(async () => {
    const inspect = window.foldthinkSpatialTools.inspect_surface;
    if (!inspect) throw new Error("inspect_surface was not registered.");
    const result = await inspect.execute({ surfaceId: "board" }) as { elements: InspectedItem[] };
    return result.elements.filter((element) => element.kind === "item");
  });
}

test("notebooks are atomic spatial objects with covers, pages, stacks, and durable deletion", async ({ browser, page }) => {
  await installToolCapture(page);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Object.keys(window.foldthinkSpatialTools).sort()))
    .toEqual(["inspect_surface", "patch_surface"]);

  await page.getByLabel("Create an item").click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect.poll(() => inspectItems(page)).toHaveLength(1);
  const first = (await inspectItems(page))[0];
  if (!first) throw new Error("The first notebook was not created.");
  expect(first.pageSurfaceIds).toHaveLength(1);
  await expect(page.getByLabel("Delete selected item")).toBeVisible();

  const canvas = page.getByLabel("Foldthink shared surface");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The workspace canvas has no visible bounds.");
  await page.mouse.click(bounds.x + 36, bounds.y + bounds.height - 36);
  await expect(page.getByLabel("Delete selected item")).toBeHidden();

  const firstCenter = {
    x: bounds.x + first.x + first.width / 2,
    y: bounds.y + first.y + first.height / 2,
  };
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: firstCenter.x - 50, y: firstCenter.y },
      { id: 2, x: firstCenter.x + 50, y: firstCenter.y },
    ],
  });
  await devtools.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x: firstCenter.x - 55, y: firstCenter.y },
      { id: 2, x: firstCenter.x + 55, y: firstCenter.y },
    ],
  });
  await devtools.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByLabel("Return to board")).toBeHidden();

  await devtools.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 3, x: firstCenter.x - 50, y: firstCenter.y },
      { id: 4, x: firstCenter.x + 50, y: firstCenter.y },
    ],
  });
  await devtools.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 3, x: firstCenter.x - 150, y: firstCenter.y },
      { id: 4, x: firstCenter.x + 150, y: firstCenter.y },
    ],
  });
  await devtools.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByLabel("Return to board")).toBeVisible();
  await page.getByLabel("Return to board").click();

  await page.mouse.dblclick(firstCenter.x, firstCenter.y, { delay: 70 });
  await expect(page.getByLabel("Return to board")).toBeVisible();
  await page.getByLabel("Add page").click();
  await expect.poll(async () => (await inspectItems(page))[0]?.pageSurfaceIds.length).toBe(2);
  await expect.poll(async () => (await inspectItems(page))[0]?.activePageIndex).toBe(1);
  await page.getByLabel("Previous page").click();
  await expect.poll(async () => (await inspectItems(page))[0]?.activePageIndex).toBe(0);
  await page.getByLabel("Return to board").click();

  await devtools.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: firstCenter.x,
    y: firstCenter.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "pen",
    force: 0.25,
  });
  await devtools.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: firstCenter.x + 80,
    y: firstCenter.y + 40,
    button: "left",
    buttons: 1,
    pointerType: "pen",
    force: 0.8,
  });
  await devtools.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: firstCenter.x + 80,
    y: firstCenter.y + 40,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "pen",
    force: 0,
  });
  await expect.poll(() => page.evaluate(async (surfaceId) => {
    const inspect = window.foldthinkSpatialTools.inspect_surface;
    const result = await inspect.execute({ surfaceId }) as { elementCount: number };
    return result.elementCount;
  }, first.coverSurfaceId)).toBe(1);
  const coverBeforeMove = await page.evaluate(async (surfaceId) => {
    const inspect = window.foldthinkSpatialTools.inspect_surface;
    return inspect.execute({ surfaceId }) as Promise<{ elements: readonly unknown[] }>;
  }, first.coverSurfaceId);

  await page.mouse.move(firstCenter.x, firstCenter.y);
  await page.mouse.down();
  await page.waitForTimeout(360);
  await page.mouse.move(firstCenter.x + 250, firstCenter.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await inspectItems(page))[0]?.x).not.toBe(first.x);
  const movedFirst = (await inspectItems(page))[0];
  if (!movedFirst) throw new Error("The moved notebook disappeared.");
  const coverAfterMove = await page.evaluate(async (surfaceId) => {
    const inspect = window.foldthinkSpatialTools.inspect_surface;
    return inspect.execute({ surfaceId }) as Promise<{ elements: readonly unknown[] }>;
  }, first.coverSurfaceId);
  expect(coverAfterMove.elements).toEqual(coverBeforeMove.elements);

  await page.getByLabel("Create an item").click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect.poll(() => inspectItems(page)).toHaveLength(2);
  const second = (await inspectItems(page)).find((item) => item.id !== first.id);
  if (!second) throw new Error("The second notebook was not created.");
  const secondCenter = {
    x: bounds.x + second.x + second.width / 2,
    y: bounds.y + second.y + second.height / 2,
  };
  const beforeLift = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.mouse.move(secondCenter.x, secondCenter.y);
  await page.mouse.down();
  await page.waitForTimeout(360);
  await page.mouse.move(firstCenter.x + 250, firstCenter.y + 40, { steps: 4 });
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(beforeLift);
  await page.mouse.up();

  await expect.poll(async () => {
    const items = await inspectItems(page);
    return items.length === 2 && Boolean(items[0]?.stackId) && items[0]?.stackId === items[1]?.stackId;
  }).toBe(true);
  const stacked = await inspectItems(page);
  expect(stacked.map((item) => item.stackOrder).sort()).toEqual([0, 1]);

  const linkedContext = process.env.TEST_DATABASE_URL ? await browser.newContext() : undefined;
  try {
    const linkedPage = linkedContext ? await linkedContext.newPage() : undefined;
    if (linkedPage) {
      await installToolCapture(linkedPage);
      const workspaceId = await page.evaluate(async () => {
        const request = indexedDB.open("foldthink");
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("workspace_meta", "readonly");
        const identityRequest = transaction.objectStore("workspace_meta").get("current");
        const identity = await new Promise<{ workspaceId: string }>((resolve, reject) => {
          identityRequest.onsuccess = () => resolve(identityRequest.result as { workspaceId: string });
          identityRequest.onerror = () => reject(identityRequest.error);
        });
        database.close();
        return identity.workspaceId;
      });
      const capability = await page.evaluate(async (id) => {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(id)}/join-capabilities`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "editor", expiresInSeconds: 600 }),
        });
        if (!response.ok) throw new Error(`Join capability failed with HTTP ${response.status}.`);
        return response.json() as Promise<{ token: string }>;
      }, workspaceId);
      await linkedPage.goto(`/#join=${encodeURIComponent(capability.token)}`);
      await expect(linkedPage.getByText("Shared")).toBeVisible({ timeout: 15_000 });
      await expect.poll(async () => {
        const items = await inspectItems(linkedPage);
        return items.length === 2 && items[0]?.stackId === items[1]?.stackId;
      }, { timeout: 15_000 }).toBe(true);
      expect((await inspectItems(linkedPage)).map((item) => item.stackOrder).sort()).toEqual([0, 1]);
    }

    await page.getByLabel("Delete selected item").click();
    await expect.poll(() => inspectItems(page)).toHaveLength(1);
    const remainingId = (await inspectItems(page))[0]?.id;
    if (linkedPage) {
      await expect.poll(() => inspectItems(linkedPage), { timeout: 15_000 }).toHaveLength(1);
      expect((await inspectItems(linkedPage))[0]?.id).toBe(remainingId);
    }
    await page.reload();
    await expect.poll(() => page.evaluate(() => Object.keys(window.foldthinkSpatialTools).sort()))
      .toEqual(["inspect_surface", "patch_surface"]);
    await expect.poll(() => inspectItems(page)).toHaveLength(1);
    expect((await inspectItems(page))[0]?.id).toBe(remainingId);
  } finally {
    await linkedContext?.close();
  }
});
