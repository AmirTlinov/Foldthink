import type { Pool, PoolClient } from "pg";
import type { LocalOperation } from "@foldthink/workspace";
import {
  encodeOperationEnvelope,
  encodeStateBytes,
} from "./operation-envelope.js";
import type {
  CommittedOperation,
  CommittedReceipt,
  WorkspaceState,
} from "./committed-receipt.js";
import {
  isCommittedReceipt,
  type JournalCommit,
  type JournalSurface,
  type OperationJournal,
  type ValidatedOperation,
} from "./operation-journal.js";

type OperationRow = Readonly<{
  sequence: string;
  workspace_id: string;
  operation_id: string;
  protocol_version: number;
  intent: LocalOperation["intent"];
  receipt: unknown;
}>;

type UpdateRow = Readonly<{
  operation_id: string;
  ordinal: number;
  surface_id: string;
  payload: Buffer;
}>;

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

function committedFromRows(row: OperationRow, updates: readonly UpdateRow[]): CommittedOperation {
  if (row.protocol_version !== 1 || !isCommittedReceipt(row.receipt)) {
    throw new Error("PostgreSQL contains an incompatible Foldthink operation.");
  }
  const local: LocalOperation = Object.freeze({
    protocolVersion: 1,
    operationId: row.operation_id,
    workspaceId: row.workspace_id,
    intent: row.intent,
    updates: Object.freeze(
      updates
        .filter((update) => update.operation_id === row.operation_id)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((update) => Object.freeze({
          surfaceId: update.surface_id,
          payload: new Uint8Array(update.payload),
        })),
    ),
  });
  return Object.freeze({
    sequence: row.sequence,
    envelope: encodeOperationEnvelope(local),
    receipt: row.receipt,
  });
}

export class PostgresOperationJournal implements OperationJournal {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async commit(
    actorSessionId: string,
    operation: LocalOperation,
    validate: (surfaces: readonly JournalSurface[]) => ValidatedOperation,
  ): Promise<JournalCommit> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await this.#findOperation(client, operation.workspaceId, operation.operationId);
      if (existing) {
        await client.query("COMMIT");
        return Object.freeze({ operation: existing, duplicate: true });
      }

      const workspaceLock = await client.query(
        `SELECT id FROM workspaces WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [operation.workspaceId],
      );
      if (workspaceLock.rowCount !== 1) {
        throw new Error("The authorized workspace is unavailable.");
      }

      const surfaceIds = [...new Set(operation.updates.map((update) => update.surfaceId))].sort();
      const locked = await client.query<Readonly<{
        surface_id: string;
        revision: string;
        state: Buffer;
      }>>(
        `SELECT surface_id, revision::text, state
           FROM surfaces
          WHERE workspace_id = $1 AND surface_id = ANY($2::text[])
          ORDER BY surface_id
          FOR UPDATE`,
        [operation.workspaceId, surfaceIds],
      );
      const currentById = new Map(locked.rows.map((row) => [row.surface_id, row]));

      const afterLock = await this.#findOperation(client, operation.workspaceId, operation.operationId);
      if (afterLock) {
        await client.query("COMMIT");
        return Object.freeze({ operation: afterLock, duplicate: true });
      }

      const current = surfaceIds.map((surfaceId): JournalSurface => {
        const row = currentById.get(surfaceId);
        return Object.freeze({
          surfaceId,
          revision: row ? Number(row.revision) : 0,
          ...(row ? { state: new Uint8Array(row.state) } : {}),
        });
      });
      const validated = validate(current);
      const revisionBySurface = new Map(current.map((surface) => [surface.surfaceId, surface.revision + 1]));
      const receipt: CommittedReceipt = Object.freeze({
        operationId: operation.operationId,
        changedIds: Object.freeze([...validated.changedIds]),
        surfaces: Object.freeze(validated.surfaces.map((surface) => Object.freeze({
          surfaceId: surface.surfaceId,
          revision: revisionBySurface.get(surface.surfaceId) ?? 1,
        }))),
        syncState: "committed",
      });

      for (const surface of validated.surfaces) {
        await client.query(
          `INSERT INTO surfaces (workspace_id, surface_id, revision, state)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id, surface_id) DO UPDATE
             SET revision = EXCLUDED.revision, state = EXCLUDED.state`,
          [
            operation.workspaceId,
            surface.surfaceId,
            revisionBySurface.get(surface.surfaceId) ?? 1,
            Buffer.from(surface.state),
          ],
        );
      }
      const inserted = await client.query<Readonly<{ sequence: string }>>(
        `INSERT INTO workspace_operations
           (workspace_id, operation_id, actor_session_id, protocol_version, intent, receipt)
         VALUES ($1, $2, $3, 1, $4, $5)
         RETURNING sequence::text`,
        [operation.workspaceId, operation.operationId, actorSessionId, operation.intent, receipt],
      );
      const sequence = inserted.rows[0]?.sequence;
      if (!sequence) throw new Error("PostgreSQL did not return an operation sequence.");
      for (const [ordinal, update] of operation.updates.entries()) {
        await client.query(
          `INSERT INTO surface_updates
             (workspace_id, surface_id, revision, ordinal, operation_id, payload)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            operation.workspaceId,
            update.surfaceId,
            revisionBySurface.get(update.surfaceId) ?? 1,
            ordinal,
            operation.operationId,
            Buffer.from(update.payload),
          ],
        );
      }
      await client.query("COMMIT");
      return Object.freeze({
        duplicate: false,
        operation: Object.freeze({
          sequence,
          envelope: encodeOperationEnvelope(operation),
          receipt,
        }),
      });
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async readWorkspaceState(workspaceId: string): Promise<WorkspaceState> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const surfaceResult = await client.query<Readonly<{ surface_id: string; revision: string; state: Buffer }>>(
        `SELECT surface_id, revision::text, state
           FROM surfaces
          WHERE workspace_id = $1
          ORDER BY surface_id`,
        [workspaceId],
      );
      const cursorResult = await client.query<Readonly<{ cursor: string }>>(
        `SELECT COALESCE(max(sequence), 0)::text AS cursor
           FROM workspace_operations
          WHERE workspace_id = $1`,
        [workspaceId],
      );
      await client.query("COMMIT");
      return Object.freeze({
        workspaceId,
        cursor: cursorResult.rows[0]?.cursor ?? "0",
        surfaces: Object.freeze(surfaceResult.rows.map((row) => Object.freeze({
          surfaceId: row.surface_id,
          revision: Number(row.revision),
          state: encodeStateBytes(new Uint8Array(row.state)),
        }))),
      });
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listOperationsAfter(workspaceId: string, sequence: string): Promise<readonly CommittedOperation[]> {
    const operations = await this.#pool.query<OperationRow>(
      `SELECT sequence::text, workspace_id, operation_id, protocol_version, intent, receipt
         FROM workspace_operations
        WHERE workspace_id = $1 AND sequence > $2::bigint
        ORDER BY sequence
        LIMIT 512`,
      [workspaceId, sequence],
    );
    if (operations.rows.length === 0) return Object.freeze([]);
    const operationIds = operations.rows.map((row) => row.operation_id);
    const updates = await this.#pool.query<UpdateRow>(
      `SELECT operation_id, ordinal, surface_id, payload
         FROM surface_updates
        WHERE workspace_id = $1 AND operation_id = ANY($2::uuid[])
        ORDER BY operation_id, ordinal`,
      [workspaceId, operationIds],
    );
    return Object.freeze(operations.rows.map((row) => committedFromRows(row, updates.rows)));
  }

  async #findOperation(
    client: PoolClient,
    workspaceId: string,
    operationId: string,
  ): Promise<CommittedOperation | undefined> {
    const result = await client.query<OperationRow>(
      `SELECT sequence::text, workspace_id, operation_id, protocol_version, intent, receipt
         FROM workspace_operations
        WHERE workspace_id = $1 AND operation_id = $2`,
      [workspaceId, operationId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const updates = await client.query<UpdateRow>(
      `SELECT operation_id, ordinal, surface_id, payload
         FROM surface_updates
        WHERE workspace_id = $1 AND operation_id = $2
        ORDER BY ordinal`,
      [workspaceId, operationId],
    );
    return committedFromRows(row, updates.rows);
  }
}
