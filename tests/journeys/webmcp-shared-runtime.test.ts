import { expect, test } from "@playwright/test";

type RegisteredTool = Readonly<{
  execute(input: unknown): Promise<unknown>;
}>;

declare global {
  interface Window {
    foldthinkTestTools: Record<string, RegisteredTool>;
  }
}

test("a WebMCP patch changes the same surface the person sees", async ({ page }) => {
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
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.foldthinkTestTools).sort()))
    .toEqual(["inspect_surface", "patch_surface"]);

  const canvas = page.getByLabel("Foldthink shared surface");
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
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
    syncState: "queued",
  });

  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(before);
  const inspection = await page.evaluate(async () => {
    const inspect = window.foldthinkTestTools.inspect_surface;
    if (!inspect) throw new Error("inspect_surface was not registered.");
    return inspect.execute({});
  });
  expect(inspection).toMatchObject({
    surfaceId: "board",
    elements: [{ id: "journey-agent-note", kind: "markdown" }],
  });

  await page.reload();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(before);
});
