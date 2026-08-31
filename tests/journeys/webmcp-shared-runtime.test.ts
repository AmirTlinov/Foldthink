import { expect, test } from "@playwright/test";

type RegisteredTool = Readonly<{
  execute(input: unknown): Promise<unknown>;
}>;

declare global {
  interface Window {
    foldthinkTestTools: Record<string, RegisteredTool>;
  }
}

test("a committed WebMCP patch reaches the person and a linked device", async ({ browser, page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is not configured.");
  await page.addInitScript(() => {
    const tools: Record<string, RegisteredTool> = {};
    window.foldthinkTestTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: RegisteredTool & Readonly<{ name: string }>): void {
          tools[tool.name] = tool;
        },
      },
    });
  });

  await page.goto("/");
  await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.foldthinkTestTools).sort()))
    .toEqual(["inspect_surface", "patch_surface"]);

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
  const linkedContext = await browser.newContext();
  const linkedPage = await linkedContext.newPage();
  try {
    await linkedPage.goto(`/#join=${encodeURIComponent(capability.token)}`);
    await expect(linkedPage.getByText("Shared")).toBeVisible({ timeout: 15_000 });
    const canvas = page.getByLabel("Foldthink shared surface");
    const linkedCanvas = linkedPage.getByLabel("Foldthink shared surface");
    const before = await linkedCanvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    const result = await page.evaluate(async () => {
    const patch = window.foldthinkTestTools.patch_surface;
    if (!patch) throw new Error("patch_surface was not registered.");
    return patch.execute({
      invocationKey: "journey-agent-note",
      changes: [
        {
          action: "put",
          element: {
            id: "journey-agent-note",
            kind: "markdown",
            version: 1,
            x: 80,
            y: 90,
            width: 420,
            source: "Think together",
            color: "#171714",
            fontSize: 34,
          },
        },
      ],
    });
    });
    expect(result).toMatchObject({
      changedIds: ["journey-agent-note"],
      syncState: "committed",
      surfaces: [{ surfaceId: "board", revision: expect.any(Number) }],
    });

    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(before);
    await expect.poll(() => linkedCanvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()), {
      timeout: 15_000,
    }).not.toBe(before);
    const inspection = await page.evaluate(async () => {
      const inspect = window.foldthinkTestTools.inspect_surface;
      if (!inspect) throw new Error("inspect_surface was not registered.");
      return inspect.execute({});
    });
    expect(inspection).toMatchObject({
      surfaceId: "board",
      revision: { committed: (result as { surfaces: { revision: number }[] }).surfaces[0]?.revision },
      elements: [{ id: "journey-agent-note", kind: "markdown" }],
    });

    const shared = await linkedCanvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    await linkedPage.reload();
    await expect(linkedPage.getByText("Shared")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => linkedCanvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(shared);
  } finally {
    await linkedContext.close();
  }
});
