import { expect, test } from "@playwright/test";

test("a linked device receives one durable stroke and keeps it after reload", async ({ browser, page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is not configured.");

  await page.goto("/");
  await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });
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
    await expect(linkedPage).not.toHaveURL(/#join=/u);
    const linkedCanvas = linkedPage.getByLabel("Foldthink shared surface");
    const before = await linkedCanvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());

    const ownerCanvas = page.getByLabel("Foldthink shared surface");
    const bounds = await ownerCanvas.boundingBox();
    if (!bounds) throw new Error("The owner surface has no visible bounds.");
    await page.mouse.move(bounds.x + 120, bounds.y + 130);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 260, bounds.y + 210, { steps: 16 });
    await page.mouse.up();

    await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });
    await expect.poll(
      () => linkedCanvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()),
      { timeout: 15_000 },
    ).not.toBe(before);
    const shared = await linkedCanvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    await linkedPage.reload();
    await expect(linkedPage.getByText("Shared")).toBeVisible({ timeout: 15_000 });
    await expect.poll(
      () => linkedCanvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()),
      { timeout: 15_000 },
    ).toBe(shared);
  } finally {
    await linkedContext.close();
  }
});
