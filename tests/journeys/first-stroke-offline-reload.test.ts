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
        if (!cacheName) return false;
        const cache = await caches.open(cacheName);
        const paths = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
        return [
          "/",
          "/assets/app.js",
          "/assets/app.css",
          "/assets/public-browser.js",
          "/assets/scene-element.js",
          "/widget-frame.html",
          "/assets/widget-frame.js",
          "/manifest.webmanifest",
          "/icon.svg",
        ].every((path) => paths.has(path));
      }),
    )
    .toBe(true);

  const canvas = page.getByLabel("Foldthink shared surface");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The thinking surface has no visible bounds.");
  await context.setOffline(true);
  try {
    await page.mouse.move(bounds.x + 140, bounds.y + 170);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 240, bounds.y + 120, { steps: 12 });
    await page.mouse.move(bounds.x + 340, bounds.y + 190, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByText("Saved locally, waiting to share")).toBeVisible();
    const beforeReload = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());

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
