import type { Pool, PoolClient } from "pg";
import type { SessionRole } from "./device-session.js";
import type { DeleteWorkspaceResponse } from "./session-protocol.js";
import type {
  BootstrapClaim,
  SessionStore,
  StoredJoinCapability,
  StoredSession,
} from "./session-store.js";

type SessionRow = Readonly<{
  session_id: string;
  workspace_id: string;
  role: SessionRole;
  expires_at: Date;
}>;

function storedSession(row: SessionRow): StoredSession {
  return Object.freeze({
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    role: row.role,
    expiresAt: row.expires_at,
  });
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original database failure remains the useful error.
  }
}

export class PostgresSessionStore implements SessionStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async claimBootstrap(claim: BootstrapClaim): Promise<StoredSession> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [claim.workspaceId],
      );
      const deleted = await client.query(
        "SELECT 1 FROM deleted_workspaces WHERE workspace_id = $1",
        [claim.workspaceId],
      );
      if (deleted.rowCount === 1) {
        throw Object.assign(new Error("This workspace was deleted."), {
          code: "workspace_deleted",
        });
      }
      const existing = await client.query<SessionRow>(
        `SELECT bc.session_id, bc.workspace_id, wm.role, ds.expires_at
           FROM bootstrap_claims bc
           JOIN device_sessions ds ON ds.id = bc.session_id
           JOIN workspace_members wm
             ON wm.session_id = bc.session_id AND wm.workspace_id = bc.workspace_id
          WHERE bc.bootstrap_hash = $1
            AND bc.expires_at > now()
            AND ds.expires_at > now()
            AND ds.revoked_at IS NULL
          FOR UPDATE OF bc`,
        [Buffer.from(claim.bootstrapHash)],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return storedSession(existing.rows[0]);
      }

      const workspaceInsert = await client.query(
        `INSERT INTO workspaces (id) VALUES ($1)
         ON CONFLICT (id) DO NOTHING`,
        [claim.workspaceId],
      );
      if (workspaceInsert.rowCount !== 1) {
        const concurrent = await client.query<SessionRow>(
          `SELECT bc.session_id, bc.workspace_id, wm.role, ds.expires_at
             FROM bootstrap_claims bc
             JOIN device_sessions ds ON ds.id = bc.session_id
             JOIN workspace_members wm
               ON wm.session_id = bc.session_id AND wm.workspace_id = bc.workspace_id
            WHERE bc.bootstrap_hash = $1
              AND bc.expires_at > now()
              AND ds.expires_at > now()
              AND ds.revoked_at IS NULL`,
          [Buffer.from(claim.bootstrapHash)],
        );
        if (concurrent.rows[0]) {
          await client.query("COMMIT");
          return storedSession(concurrent.rows[0]);
        }
        throw Object.assign(new Error("The workspace identifier is already claimed."), {
          code: "workspace_conflict",
        });
      }

      await client.query(
        `INSERT INTO device_sessions (id, secret_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [claim.sessionId, Buffer.from(claim.sessionSecretHash), claim.sessionExpiresAt],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, session_id, role)
         VALUES ($1, $2, 'owner')`,
        [claim.workspaceId, claim.sessionId],
      );
      await client.query(
        `INSERT INTO bootstrap_claims
           (bootstrap_hash, workspace_id, session_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [Buffer.from(claim.bootstrapHash), claim.workspaceId, claim.sessionId, claim.claimExpiresAt],
      );
      await client.query("COMMIT");
      return Object.freeze({
        sessionId: claim.sessionId,
        workspaceId: claim.workspaceId,
        role: "owner",
        expiresAt: claim.sessionExpiresAt,
      });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findSession(
    secretHash: Uint8Array,
    workspaceId: string,
    now: Date,
  ): Promise<StoredSession | undefined> {
    const result = await this.#pool.query<SessionRow>(
      `SELECT ds.id AS session_id, wm.workspace_id, wm.role, ds.expires_at
         FROM device_sessions ds
         JOIN workspace_members wm ON wm.session_id = ds.id
         JOIN workspaces w ON w.id = wm.workspace_id
        WHERE ds.secret_hash = $1
          AND wm.workspace_id = $2
          AND ds.expires_at > $3
          AND ds.revoked_at IS NULL
          AND w.deleted_at IS NULL`,
      [Buffer.from(secretHash), workspaceId, now],
    );
    return result.rows[0] ? storedSession(result.rows[0]) : undefined;
  }

  async createJoinCapability(capability: StoredJoinCapability): Promise<void> {
    await this.#pool.query(
      `INSERT INTO join_capabilities
         (token_hash, workspace_id, role, expires_at, created_by_session_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        Buffer.from(capability.tokenHash),
        capability.workspaceId,
        capability.role,
        capability.expiresAt,
        capability.createdBySessionId,
      ],
    );
  }

  async consumeJoinCapability(input: Readonly<{
    tokenHash: Uint8Array;
    sessionId: string;
    sessionSecretHash: Uint8Array;
    sessionExpiresAt: Date;
    now: Date;
  }>): Promise<StoredSession | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const capability = await client.query<Readonly<{
        workspace_id: string;
        role: Exclude<SessionRole, "owner">;
      }>>(
        `UPDATE join_capabilities
            SET consumed_at = $2
          WHERE token_hash = $1
            AND consumed_at IS NULL
            AND expires_at > $2
        RETURNING workspace_id, role`,
        [Buffer.from(input.tokenHash), input.now],
      );
      const row = capability.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return undefined;
      }
      await client.query(
        `INSERT INTO device_sessions (id, secret_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [input.sessionId, Buffer.from(input.sessionSecretHash), input.sessionExpiresAt],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, session_id, role)
         VALUES ($1, $2, $3)`,
        [row.workspace_id, input.sessionId, row.role],
      );
      await client.query("COMMIT");
      return Object.freeze({
        sessionId: input.sessionId,
        workspaceId: row.workspace_id,
        role: row.role,
        expiresAt: input.sessionExpiresAt,
      });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteWorkspace(
    actor: Readonly<{ sessionId: string; workspaceId: string; role: SessionRole }>,
    backupRetentionDays: number,
  ): Promise<DeleteWorkspaceResponse> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const deletion = await client.query<Readonly<{ queued_assets: number }>>(
        "SELECT delete_workspace_active_data($1, $2, $3) AS queued_assets",
        [actor.workspaceId, actor.sessionId, backupRetentionDays],
      );
      const tombstone = await client.query<Readonly<{
        deleted_at: Date;
        backup_retention_until: Date;
      }>>(
        `SELECT deleted_at, backup_retention_until
           FROM deleted_workspaces
          WHERE workspace_id = $1`,
        [actor.workspaceId],
      );
      const queuedAssets = deletion.rows[0]?.queued_assets;
      const receipt = tombstone.rows[0];
      if (typeof queuedAssets !== "number" || !Number.isInteger(queuedAssets) || !receipt) {
        throw new Error("PostgreSQL did not return the workspace deletion receipt.");
      }
      await client.query("COMMIT");
      return Object.freeze({
        workspaceId: actor.workspaceId,
        deletedAt: receipt.deleted_at.toISOString(),
        backupRetentionUntil: receipt.backup_retention_until.toISOString(),
        queuedAssets,
      });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
