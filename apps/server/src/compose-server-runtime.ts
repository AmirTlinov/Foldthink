import { Pool } from "pg";
import {
  AssetRegistry,
  FilesystemObjectStore,
  PostgresAssetStore,
  S3ObjectStore,
  type AssetObjectStore,
} from "@foldthink/asset/server";
import { LatexCompiler, TectonicProcessCompiler } from "@foldthink/document/server";
import {
  PostgresSessionStore,
  SessionAuthority,
} from "@foldthink/identity/server";
import {
  PostgresOperationJournal,
  SyncGateway,
  WebSocketSyncTransport,
} from "@foldthink/synchronization/server";
import type { ServerConfig } from "./server-config.js";
import { assertOrigin, readSessionCookie } from "./http-boundary.js";

export type ServerRuntime = Readonly<{
  config: ServerConfig;
  pool: Pool;
  authority: SessionAuthority;
  gateway: SyncGateway;
  assets: AssetRegistry;
  latex: LatexCompiler;
  socketTransport: WebSocketSyncTransport;
  ready(): Promise<Readonly<{
    ready: boolean;
    databaseReachable: boolean;
    schemaMigration: string | null;
    requiredSchemaMigration: string | null;
  }>>;
  close(): Promise<void>;
}>;

export function composeServerRuntime(config: ServerConfig): ServerRuntime {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  const authority = new SessionAuthority(
    new PostgresSessionStore(pool),
    config.sessionHmacKey,
  );
  const gateway = new SyncGateway(new PostgresOperationJournal(pool));
  const objectStore: AssetObjectStore = config.assets.kind === "filesystem"
    ? new FilesystemObjectStore(config.assets.directory)
    : new S3ObjectStore(config.assets);
  const assets = new AssetRegistry(new PostgresAssetStore(pool), objectStore);
  const assetCleanupTimer = setInterval(() => {
    void assets.drainDeletionQueue().catch(() => undefined);
  }, 60_000);
  assetCleanupTimer.unref();
  void assets.drainDeletionQueue().catch(() => undefined);
  const latex = new LatexCompiler(assets, new TectonicProcessCompiler(config.latex));
  const socketTransport = new WebSocketSyncTransport(gateway, async (request, workspaceId) => {
    assertOrigin(request, config.publicOrigin);
    return authority.authorize(
      readSessionCookie(request, config.secureCookie),
      workspaceId,
      "read",
    );
  });
  return Object.freeze({
    config,
    pool,
    authority,
    gateway,
    assets,
    latex,
    socketTransport,
    async ready() {
      try {
        const result = await pool.query<Readonly<{
          identity: string | null;
          sync: string | null;
          assets: string | null;
          schema_migration: string | null;
        }>>(
          `SELECT to_regclass('public.device_sessions')::text AS identity,
                  to_regclass('public.workspace_operations')::text AS sync,
                  to_regclass('public.assets')::text AS assets,
                  (SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1) AS schema_migration`,
        );
        const row = result.rows[0];
        const required = config.requiredSchemaMigration ?? null;
        const schemaMigration = row?.schema_migration ?? null;
        const expectedSchema = required === null || schemaMigration === required;
        return Object.freeze({
          ready: Boolean(row?.identity && row.sync && row.assets && expectedSchema),
          databaseReachable: true,
          schemaMigration,
          requiredSchemaMigration: required,
        });
      } catch {
        return Object.freeze({
          ready: false,
          databaseReachable: false,
          schemaMigration: null,
          requiredSchemaMigration: config.requiredSchemaMigration ?? null,
        });
      }
    },
    async close(): Promise<void> {
      clearInterval(assetCleanupTimer);
      socketTransport.close();
      await pool.end();
    },
  });
}
