import { expect, test } from "@playwright/test";

test("the first stroke survives an offline application reload", async ({ context, page }) => {
  await page.goto("/");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByLabel("Foldthink shared surface")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cacheName = (await caches.keys()).find((name) => name.startsWith("foldthink-shell-"));
        if (!cacheName) return 0;
        const cache = await caches.open(cacheName);
        return (await cache.keys()).length;
      }),
    )
    .toBe(5);

  const canvas = page.getByLabel("Foldthink shared surface");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The thinking surface has no visible bounds.");
  await page.mouse.move(bounds.x + 140, bounds.y + 170);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 240, bounds.y + 120, { steps: 12 });
  await page.mouse.move(bounds.x + 340, bounds.y + 190, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText("Saved on this device")).toBeVisible();
  const beforeReload = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());

  await context.setOffline(true);
  try {
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(async () => (await (await fetch("/assets/app.js")).arrayBuffer()).byteLength),
    ).toBeGreaterThan(1_000);
    await page.reload();
    await expect(page.getByLabel("Foldthink shared surface")).toBeVisible();
    await expect(page.getByText("Saved locally, waiting to share")).toBeVisible();
    const afterReload = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    expect(afterReload).toBe(beforeReload);
  } finally {
    await context.setOffline(false);
  }
});
