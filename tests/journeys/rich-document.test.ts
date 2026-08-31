import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.use({ viewport: { width: 820, height: 1180 } });

type RegisteredTool = Readonly<{
  execute(input: unknown): Promise<unknown>;
}>;

type WorkspaceItem = Readonly<{
  id: string;
  kind: "item";
  itemKind: "notebook" | "document";
  x: number;
  y: number;
  width: number;
  height: number;
  pageSurfaceIds: readonly string[];
  activePageIndex: number;
}>;

declare global {
  interface Window {
    foldthinkDocumentTools: Record<string, RegisteredTool>;
  }
}

async function installToolCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const tools: Record<string, RegisteredTool> = {};
    window.foldthinkDocumentTools = tools;
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

async function inspectItems(page: Page): Promise<WorkspaceItem[]> {
  return page.evaluate(async () => {
    const result = await window.foldthinkDocumentTools.inspect_surface.execute({ surfaceId: "board" }) as {
      elements: WorkspaceItem[];
    };
    return result.elements.filter((element) => element.kind === "item");
  });
}

async function openOnlyDocument(page: Page): Promise<WorkspaceItem> {
  const item = (await inspectItems(page)).find((candidate) => candidate.itemKind === "document");
  if (!item) throw new Error("The document item is unavailable.");
  const canvas = page.getByLabel("Foldthink shared surface");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The document canvas has no bounds.");
  await page.mouse.dblclick(
    bounds.x + item.x + item.width / 2,
    bounds.y + item.y + item.height / 2,
    { delay: 70 },
  );
  await expect(page.getByLabel("Return to board")).toBeVisible();
  return item;
}

async function openBlankEditor(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.getByLabel("Foldthink shared surface");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The document canvas has no bounds.");
  await page.mouse.dblclick(bounds.x + x, bounds.y + y, { delay: 70 });
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const content = page.locator(".foldthink-code-editor .cm-content");
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
}

async function workspaceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
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
}

async function linkedPage(source: Page, context: BrowserContext): Promise<Page> {
  const id = await workspaceId(source);
  const capability = await source.evaluate(async (workspace) => {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/join-capabilities`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "editor", expiresInSeconds: 600 }),
    });
    if (!response.ok) throw new Error(`Join capability failed with HTTP ${response.status}.`);
    return response.json() as Promise<{ token: string }>;
  }, id);
  const page = await context.newPage();
  await installToolCapture(page);
  await page.goto(`/#join=${encodeURIComponent(capability.token)}`);
  await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });
  return page;
}

test("a document keeps editable Markdown, LaTeX, safe widget state, and verified images", async ({ browser, page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is not configured.");
  await installToolCapture(page);
  await page.goto("/");
  await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Create an item").click();
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await expect.poll(() => inspectItems(page)).toHaveLength(1);
  const item = await openOnlyDocument(page);
  const firstSurfaceId = item.pageSurfaceIds[0];
  if (!firstSurfaceId) throw new Error("The first document surface is unavailable.");

  await openBlankEditor(page, 410, 620);
  await replaceEditorSource(page, "# Human thought\n\nThe editable relation is $x^2 + y^2$.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const markdown = page.locator(".foldthink-markdown-block");
  await expect(markdown.getByRole("heading", { name: "Human thought" })).toBeVisible();
  await expect(markdown.locator(".katex")).toBeVisible();

  const markdownBounds = await markdown.boundingBox();
  if (!markdownBounds) throw new Error("The Markdown block has no bounds.");
  await page.mouse.dblclick(markdownBounds.x + 40, markdownBounds.y + 40, { delay: 70 });
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".foldthink-code-editor .cm-content")).toContainText("Human thought");
  await replaceEditorSource(page, "# Human thought refined\n\nThe source remains editable and $x^2 + y^2$ remains math.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(markdown.getByRole("heading", { name: "Human thought refined" })).toBeVisible();

  const patchResult = await page.evaluate(async (surfaceId) => {
    return window.foldthinkDocumentTools.patch_surface.execute({
      surfaceId,
      invocationKey: "rich-document-agent-proof",
      changes: [
        {
          action: "put",
          element: {
            id: "agent-equation",
            kind: "latex",
            version: 1,
            x: 60,
            y: 110,
            width: 390,
            height: 170,
            source: String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`,
            mode: "math",
            color: "#171714",
            fontSize: 34,
          },
        },
        {
          action: "put",
          element: {
            id: "agent-widget",
            kind: "widget",
            version: 1,
            x: 520,
            y: 80,
            width: 400,
            height: 240,
            html: '<button id="advance">Advance</button><output id="result"></output>',
            css: "body{font:26px system-ui;color:#171714}button{font:inherit;border:0;border-radius:999px;padding:.55em .9em;background:#171714;color:white}output{display:block;margin-top:18px}",
            javascript: `const result=document.querySelector('#result');
let count=Number(foldthink.state.count||0);
let parentBlocked=false;
try{void parent.document.body}catch{parentBlocked=true}
result.dataset.parentBlocked=String(parentBlocked);
result.dataset.origin=location.origin;
result.dataset.tools=String(typeof document.modelContext);
fetch('/health').then(()=>result.dataset.network='open').catch(()=>result.dataset.network='blocked');
const render=()=>result.textContent='Count '+count;
render();
document.querySelector('#advance').onclick=()=>{count+=1;render();foldthink.setState({count})}`,
            state: { count: 0 },
          },
        },
        {
          action: "put",
          element: {
            id: "agent-full-latex",
            kind: "latex",
            version: 1,
            x: 60,
            y: 1010,
            width: 390,
            height: 320,
            source: String.raw`\documentclass{article}
\begin{document}
\section*{Foldthink proof}
A durable page rendered by Tectonic.
\[
x^2+y^2=z^2
\]
\end{document}`,
            mode: "document",
            color: "#171714",
            fontSize: 28,
          },
        },
      ],
    });
  }, firstSurfaceId) as { syncState: string };
  expect(patchResult.syncState).toBe("committed");
  await expect(page.locator(".foldthink-latex-block .katex")).toBeVisible();
  await expect(page.locator(".foldthink-latex-block[data-page-count='1'] img")).toBeVisible({ timeout: 15_000 });

  const widget = page.frameLocator("iframe[title='Interactive document block agent-widget']");
  const result = widget.locator("#result");
  await expect(result).toHaveText("Count 0");
  await expect(result).toHaveAttribute("data-parent-blocked", "true");
  await expect(result).toHaveAttribute("data-origin", "null");
  await expect(result).toHaveAttribute("data-tools", "undefined");
  await expect(result).toHaveAttribute("data-network", "blocked");
  await widget.locator("#advance").evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(result).toHaveText("Count 2");

  await page.reload();
  await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });
  await openOnlyDocument(page);
  await expect(page.getByRole("heading", { name: "Human thought refined" })).toBeVisible();
  await expect(page.frameLocator("iframe[title='Interactive document block agent-widget']").locator("#result"))
    .toHaveText("Count 2");
  await expect(page.locator(".foldthink-latex-block[data-page-count='1'] img")).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Add page").click();
  await expect.poll(async () => (await inspectItems(page))[0]?.activePageIndex).toBe(1);
  await openBlankEditor(page, 110, 940);
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await page.locator("input[type='file']").setInputFiles({
    name: "proof.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByPlaceholder("Describe the image").fill("Verified one-pixel proof");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".foldthink-asset-block img[alt='Verified one-pixel proof']")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });
  await openOnlyDocument(page);
  await expect(page.locator(".foldthink-asset-block img[alt='Verified one-pixel proof']")).toBeVisible();
  await page.getByLabel("Previous page").click();
  await expect(page.getByRole("heading", { name: "Human thought refined" })).toBeVisible();

  const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  try {
    const second = await linkedPage(page, context);
    await expect.poll(() => inspectItems(second)).toHaveLength(1);
    await openOnlyDocument(second);
    await expect(second.getByRole("heading", { name: "Human thought refined" })).toBeVisible();
    await expect(second.frameLocator("iframe[title='Interactive document block agent-widget']").locator("#result"))
      .toHaveText("Count 2");
    await expect(second.locator(".foldthink-latex-block[data-page-count='1'] img")).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.close();
  }
});
