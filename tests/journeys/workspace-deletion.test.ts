import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

type LocalIdentity = Readonly<{
  workspaceId: string;
  bootstrapId: string;
}>;

async function currentIdentity(page: import("@playwright/test").Page): Promise<LocalIdentity> {
  return page.evaluate(async () => {
    const request = indexedDB.open("foldthink");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("workspace_meta", "readonly");
    const identityRequest = transaction.objectStore("workspace_meta").get("current");
    const identity = await new Promise<LocalIdentity>((resolve, reject) => {
      identityRequest.onsuccess = () => resolve(identityRequest.result as LocalIdentity);
      identityRequest.onerror = () => reject(identityRequest.error);
    });
    database.close();
    return identity;
  });
}

test("owner deletion removes active data, local state, and queued asset bytes", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is not configured.");
  await page.goto("/");
  await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });
  const original = await currentIdentity(page);

  const canvas = page.getByLabel("Foldthink shared surface");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The surface has no visible bounds.");
  await page.mouse.move(bounds.x + 100, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 230, bounds.y + 180, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });

  const asset = await page.evaluate(async (workspaceId) => {
    const bytes = new TextEncoder().encode("workspace deletion proof");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const reserved = await fetch(`/api/workspaces/${workspaceId}/assets`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mimeType: "text/plain", size: bytes.byteLength, sha256 }),
    });
    if (!reserved.ok) throw new Error(`Asset reservation failed with HTTP ${reserved.status}.`);
    const reservation = await reserved.json() as { assetId: string; uploadToken: string };
    const uploaded = await fetch(
      `/api/workspaces/${workspaceId}/assets/${reservation.assetId}/content?upload=${encodeURIComponent(reservation.uploadToken)}`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "text/plain" },
        body: bytes,
      },
    );
    if (!uploaded.ok) throw new Error(`Asset upload failed with HTTP ${uploaded.status}.`);
    const finalized = await fetch(
      `/api/workspaces/${workspaceId}/assets/${reservation.assetId}/finalize`,
      { method: "POST", credentials: "include" },
    );
    if (!finalized.ok) throw new Error(`Asset finalization failed with HTTP ${finalized.status}.`);
    return { assetId: reservation.assetId };
  }, original.workspaceId);

  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  try {
    const object = await pool.query<{ object_key: string }>(
      "SELECT object_key FROM assets WHERE workspace_id = $1 AND id = $2",
      [original.workspaceId, asset.assetId],
    );
    const objectKey = object.rows[0]?.object_key;
    if (!objectKey) throw new Error("The ready asset has no stored object key.");
    const objectPath = join("/tmp/foldthink-playwright-assets", objectKey);
    await expect(access(objectPath)).resolves.toBeUndefined();

    await page.getByRole("button", { name: "Create an item" }).click();
    await page.getByRole("button", { name: "Delete workspace" }).click();
    await expect(page.getByRole("dialog", { name: "Delete this workspace?" })).toBeVisible();
    await page.getByRole("button", { name: "Delete everything" }).click();

    await expect.poll(async () => (await currentIdentity(page)).workspaceId, { timeout: 15_000 })
      .not.toBe(original.workspaceId);
    await expect(page.getByText("Shared")).toBeVisible({ timeout: 15_000 });

    await expect.poll(async () => {
      const result = await pool.query<{
        tombstones: string;
        workspaces: string;
        surfaces: string;
        operations: string;
        assets: string;
        completed_objects: string;
      }>(
        `SELECT
           (SELECT count(*) FROM deleted_workspaces WHERE workspace_id = $1)::text AS tombstones,
           (SELECT count(*) FROM workspaces WHERE id = $1)::text AS workspaces,
           (SELECT count(*) FROM surfaces WHERE workspace_id = $1)::text AS surfaces,
           (SELECT count(*) FROM workspace_operations WHERE workspace_id = $1)::text AS operations,
           (SELECT count(*) FROM assets WHERE workspace_id = $1)::text AS assets,
           (SELECT count(*) FROM asset_deletion_queue
             WHERE workspace_id = $1 AND completed_at IS NOT NULL)::text AS completed_objects`,
        [original.workspaceId],
      );
      return result.rows[0];
    }, { timeout: 15_000 }).toEqual({
      tombstones: "1",
      workspaces: "0",
      surfaces: "0",
      operations: "0",
      assets: "0",
      completed_objects: "1",
    });
    await expect(access(objectPath)).rejects.toMatchObject({ code: "ENOENT" });

    const resurrectionStatus = await page.evaluate(async (identity) => {
      const response = await fetch("/api/session/bootstrap", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(identity),
      });
      return response.status;
    }, original);
    expect(resurrectionStatus).toBe(410);
  } finally {
    await pool.end();
  }
});
