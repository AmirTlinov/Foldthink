import type { Pool } from "pg";
import type { AssetMetadataValue, AssetPurpose, AssetState } from "./asset-record.js";
import type {
  AssetStore,
  NewAssetReservation,
  NewDerivedAsset,
  StoredAsset,
} from "./asset-store.js";

type AssetRow = Readonly<{
  id: string;
  workspace_id: string;
  state: AssetState;
  purpose: AssetPurpose;
  mime_type: string;
  byte_size: string | number;
  sha256: Buffer;
  object_key: string;
  upload_token_hash: Buffer | null;
  upload_expires_at: Date | null;
  derivation_key: string | null;
  producer: string | null;
  metadata: Record<string, AssetMetadataValue>;
  ready_at: Date | null;
}>;

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function stored(row: AssetRow): StoredAsset {
  return Object.freeze({
    assetId: row.id,
    workspaceId: row.workspace_id,
    state: row.state,
    purpose: row.purpose,
    mimeType: row.mime_type,
    size: Number(row.byte_size),
    sha256: hex(row.sha256),
    objectKey: row.object_key,
    metadata: Object.freeze(structuredClone(row.metadata)),
    ...(row.upload_token_hash ? { uploadTokenHash: new Uint8Array(row.upload_token_hash) } : {}),
    ...(row.upload_expires_at ? { uploadExpiresAt: row.upload_expires_at } : {}),
    ...(row.derivation_key ? { derivationKey: row.derivation_key } : {}),
    ...(row.producer ? { producer: row.producer } : {}),
    ...(row.ready_at ? { readyAt: row.ready_at.toISOString() } : {}),
  });
}

const returning = `RETURNING id, workspace_id, state, purpose, mime_type, byte_size,
  sha256, object_key, upload_token_hash, upload_expires_at, derivation_key,
  producer, metadata, ready_at`;

export class PostgresAssetStore implements AssetStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async reserve(input: NewAssetReservation): Promise<StoredAsset> {
    const result = await this.#pool.query<AssetRow>(
      `INSERT INTO assets
         (id, workspace_id, state, purpose, mime_type, byte_size, sha256,
          object_key, upload_token_hash, upload_expires_at, created_by_session_id)
       VALUES ($1, $2, 'reserved', $3, $4, $5, $6, $7, $8, $9, $10)
       ${returning}`,
      [
        input.assetId,
        input.workspaceId,
        input.purpose,
        input.mimeType,
        input.size,
        Buffer.from(input.sha256, "hex"),
        input.objectKey,
        Buffer.from(input.uploadTokenHash),
        input.uploadExpiresAt,
        input.createdBySessionId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL did not return the reserved asset.");
    return stored(row);
  }

  async find(workspaceId: string, assetId: string): Promise<StoredAsset | undefined> {
    const result = await this.#pool.query<AssetRow>(
      `SELECT id, workspace_id, state, purpose, mime_type, byte_size, sha256,
              object_key, upload_token_hash, upload_expires_at, derivation_key,
              producer, metadata, ready_at
         FROM assets
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, assetId],
    );
    return result.rows[0] ? stored(result.rows[0]) : undefined;
  }

  async findReadyDerived(workspaceId: string, derivationKey: string): Promise<StoredAsset | undefined> {
    const result = await this.#pool.query<AssetRow>(
      `SELECT id, workspace_id, state, purpose, mime_type, byte_size, sha256,
              object_key, upload_token_hash, upload_expires_at, derivation_key,
              producer, metadata, ready_at
         FROM assets
        WHERE workspace_id = $1 AND derivation_key = $2 AND state = 'ready'`,
      [workspaceId, derivationKey],
    );
    return result.rows[0] ? stored(result.rows[0]) : undefined;
  }

  async markState(assetId: string, from: AssetState, to: AssetState): Promise<StoredAsset | undefined> {
    const result = await this.#pool.query<AssetRow>(
      `UPDATE assets
          SET state = $3,
              ready_at = CASE WHEN $3 = 'ready' THEN now() ELSE ready_at END,
              upload_token_hash = CASE WHEN $3 IN ('ready', 'rejected', 'deleted') THEN NULL ELSE upload_token_hash END
        WHERE id = $1 AND state = $2
        ${returning}`,
      [assetId, from, to],
    );
    return result.rows[0] ? stored(result.rows[0]) : undefined;
  }

  async createReadyDerived(input: NewDerivedAsset): Promise<StoredAsset> {
    const inserted = await this.#pool.query<AssetRow>(
      `INSERT INTO assets
         (id, workspace_id, state, purpose, mime_type, byte_size, sha256,
          object_key, derivation_key, producer, metadata, created_by_session_id, ready_at)
       VALUES ($1, $2, 'ready', 'derived', $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (workspace_id, derivation_key) WHERE derivation_key IS NOT NULL
       DO NOTHING
       ${returning}`,
      [
        input.assetId,
        input.workspaceId,
        input.mimeType,
        input.size,
        Buffer.from(input.sha256, "hex"),
        input.objectKey,
        input.derivationKey,
        input.producer,
        JSON.stringify(input.metadata),
        input.createdBySessionId,
      ],
    );
    const row = inserted.rows[0];
    if (row) return stored(row);
    const existing = await this.findReadyDerived(input.workspaceId, input.derivationKey);
    if (!existing) throw new Error("A concurrent derived asset did not become readable.");
    return existing;
  }
}
