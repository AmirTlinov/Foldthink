import { Pool } from "pg";
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
  socketTransport: WebSocketSyncTransport;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}>;

export function composeServerRuntime(config: ServerConfig): ServerRuntime {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  const authority = new SessionAuthority(
    new PostgresSessionStore(pool),
    config.sessionHmacKey,
  );
  const gateway = new SyncGateway(new PostgresOperationJournal(pool));
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
    socketTransport,
    async ready(): Promise<boolean> {
      const result = await pool.query<Readonly<{ identity: string | null; sync: string | null }>>(
        `SELECT to_regclass('public.device_sessions')::text AS identity,
                to_regclass('public.workspace_operations')::text AS sync`,
      );
      return Boolean(result.rows[0]?.identity && result.rows[0]?.sync);
    },
    async close(): Promise<void> {
      socketTransport.close();
      await pool.end();
    },
  });
}
