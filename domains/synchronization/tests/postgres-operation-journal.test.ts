import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { PostgresSessionStore, SessionAuthority } from "@foldthink/identity/server";
import { SceneDocument } from "@foldthink/surface";
import type { LocalOperation } from "@foldthink/workspace";
import { decodeBytes, encodeOperationEnvelope } from "../src/public-protocol.js";
import { PostgresOperationJournal, SyncGateway } from "../src/public-server.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL commits one concurrent retry and restores its exact surface", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured.",
}, async () => {
  if (!databaseUrl) return;
  const pool = new Pool({ connectionString: databaseUrl });
  const authority = new SessionAuthority(
    new PostgresSessionStore(pool),
    "integration-secret-key-with-at-least-32-bytes",
  );
  const workspaceId = crypto.randomUUID();
  const session = await authority.bootstrap({
    workspaceId,
    bootstrapId: `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`,
  });
  const actor = await authority.authorize(session.sessionSecret, workspaceId, "edit");
  const scene = new SceneDocument("board");
  const stroke = {
    id: crypto.randomUUID(),
    kind: "ink" as const,
    version: 1,
    points: [{ x: 10, y: 20, pressure: 0.5, time: 1 }],
    style: { color: "#111111", width: 4, minimumOpacity: 0.2, maximumOpacity: 1 },
  };
  const operationId = crypto.randomUUID();
  const mutation = scene.transact([{ action: "put", element: stroke }], operationId);
  const operation: LocalOperation = {
    protocolVersion: 1,
    operationId,
    workspaceId,
    intent: { kind: "commitStroke", surfaceId: "board", stroke },
    updates: [{ surfaceId: "board", payload: mutation.update }],
  };
  const gateway = new SyncGateway(new PostgresOperationJournal(pool));
  try {
    const [left, right] = await Promise.all([
      gateway.submit(actor, encodeOperationEnvelope(operation)),
      gateway.submit(actor, encodeOperationEnvelope(operation)),
    ]);
    assert.deepEqual(right, left);
    const count = await pool.query<Readonly<{ count: string }>>(
      "SELECT count(*)::text AS count FROM workspace_operations WHERE workspace_id = $1",
      [workspaceId],
    );
    assert.equal(count.rows[0]?.count, "1");
    const state = await gateway.readState(actor);
    const restored = new SceneDocument("board", decodeBytes(state.surfaces[0]?.state ?? ""));
    assert.equal(restored.snapshot().elements[0]?.id, stroke.id);
  } finally {
    await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    await pool.end();
  }
});

test("PostgreSQL commits multiple new surfaces and one receipt atomically", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured.",
}, async () => {
  if (!databaseUrl) return;
  const pool = new Pool({ connectionString: databaseUrl });
  const authority = new SessionAuthority(
    new PostgresSessionStore(pool),
    "integration-secret-key-with-at-least-32-bytes",
  );
  const workspaceId = crypto.randomUUID();
  const session = await authority.bootstrap({
    workspaceId,
    bootstrapId: `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`,
  });
  const actor = await authority.authorize(session.sessionSecret, workspaceId, "edit");
  const operationId = crypto.randomUUID();
  const element = {
    id: "cover-title",
    kind: "markdown" as const,
    version: 1,
    x: 20,
    y: 20,
    width: 320,
    source: "Notebook",
    color: "#171714",
    fontSize: 30,
  };
  const cover = new SceneDocument("cover");
  const page = new SceneDocument("page-1");
  const pageElement = { ...element, id: "page-title", source: "Page one" };
  const coverMutation = cover.transact([{ action: "put", element }], operationId);
  const pageMutation = page.transact([{ action: "put", element: pageElement }], operationId);
  const operation: LocalOperation = {
    protocolVersion: 1,
    operationId,
    workspaceId,
    intent: {
      kind: "createSurfaces",
      surfaces: [
        { surfaceId: "cover", changes: [{ action: "put", element }] },
        { surfaceId: "page-1", changes: [{ action: "put", element: pageElement }] },
      ],
    },
    updates: [
      { surfaceId: "cover", payload: coverMutation.update },
      { surfaceId: "page-1", payload: pageMutation.update },
    ],
  };
  const gateway = new SyncGateway(new PostgresOperationJournal(pool));
  try {
    const committed = await gateway.submit(actor, encodeOperationEnvelope(operation));
    const state = await gateway.readState(actor);
    const count = await pool.query<Readonly<{ operations: string; surfaces: string }>>(
      `SELECT
         (SELECT count(*) FROM workspace_operations WHERE workspace_id = $1)::text AS operations,
         (SELECT count(*) FROM surfaces WHERE workspace_id = $1)::text AS surfaces`,
      [workspaceId],
    );
    assert.deepEqual(committed.receipt.surfaces.map((surface) => surface.surfaceId), ["cover", "page-1"]);
    assert.equal(state.surfaces.length, 2);
    assert.deepEqual(count.rows[0], { operations: "1", surfaces: "2" });
  } finally {
    await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    await pool.end();
  }
});
