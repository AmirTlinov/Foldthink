import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { AuthorizedSession } from "@foldthink/identity/server";
import type { AssetObjectStore, StoredObject } from "./asset-object-store.js";
import {
  AssetError,
  type AssetMetadataValue,
  type AssetRecord,
  type AssetReservation,
  type ReserveAssetRequest,
} from "./asset-record.js";
import type { AssetStore, StoredAsset } from "./asset-store.js";

const sha256Pattern = /^[0-9a-f]{64}$/iu;
const mimePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/iu;
const maximumAssetBytes = 20_000_000;

export type AssetActor = AuthorizedSession;

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashToken(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

function publicRecord(record: StoredAsset): AssetRecord {
  return Object.freeze({
    assetId: record.assetId,
    workspaceId: record.workspaceId,
    state: record.state,
    purpose: record.purpose,
    mimeType: record.mimeType,
    size: record.size,
    sha256: record.sha256,
    metadata: record.metadata,
    ...(record.producer ? { producer: record.producer } : {}),
    ...(record.readyAt ? { readyAt: record.readyAt } : {}),
  });
}

function requireEdit(actor: AssetActor): void {
  if (actor.role === "viewer") throw new AssetError("forbidden", "This session cannot create assets.");
}

function assertReservation(request: ReserveAssetRequest): void {
  if (
    !mimePattern.test(request.mimeType) ||
    !Number.isInteger(request.size) ||
    request.size <= 0 ||
    request.size > maximumAssetBytes ||
    !sha256Pattern.test(request.sha256)
  ) {
    throw new AssetError("invalid", "An asset reservation needs bounded MIME, size, and SHA-256.");
  }
}

function assertMetadata(metadata: Readonly<Record<string, AssetMetadataValue>>): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(metadata);
  } catch {
    throw new AssetError("invalid", "Derived asset metadata must be JSON.");
  }
  if (encoded.length > 32_000) throw new AssetError("invalid", "Derived asset metadata is too large.");
}

export class AssetRegistry {
  readonly #store: AssetStore;
  readonly #objects: AssetObjectStore;
  readonly #now: () => Date;

  constructor(store: AssetStore, objects: AssetObjectStore, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#objects = objects;
    this.#now = now;
  }

  async reserve(actor: AssetActor, request: ReserveAssetRequest): Promise<AssetReservation> {
    requireEdit(actor);
    assertReservation(request);
    const assetId = randomUUID();
    const uploadToken = randomBytes(32).toString("base64url");
    const uploadExpiresAt = new Date(this.#now().getTime() + 10 * 60 * 1_000);
    await this.#store.reserve({
      assetId,
      workspaceId: actor.workspaceId,
      purpose: "user",
      mimeType: request.mimeType.toLowerCase(),
      size: request.size,
      sha256: request.sha256.toLowerCase(),
      objectKey: `user/${actor.workspaceId}/${assetId}`,
      uploadTokenHash: hashToken(uploadToken),
      uploadExpiresAt,
      createdBySessionId: actor.sessionId,
    });
    return Object.freeze({
      assetId,
      uploadToken,
      uploadExpiresAt: uploadExpiresAt.toISOString(),
    });
  }

  async acceptUpload(
    actor: AssetActor,
    assetId: string,
    uploadToken: string,
    object: StoredObject,
  ): Promise<void> {
    requireEdit(actor);
    const asset = await this.#required(actor, assetId);
    const expectedToken = asset.uploadTokenHash;
    const actualToken = hashToken(uploadToken);
    if (
      asset.state !== "reserved" ||
      !expectedToken ||
      !asset.uploadExpiresAt ||
      asset.uploadExpiresAt <= this.#now() ||
      expectedToken.byteLength !== actualToken.byteLength ||
      !timingSafeEqual(expectedToken, actualToken)
    ) {
      throw new AssetError("expired", "The upload capability is unavailable.");
    }
    if (object.bytes.byteLength !== asset.size || object.mimeType.toLowerCase() !== asset.mimeType) {
      throw new AssetError("verification_failed", "Uploaded size or MIME does not match the reservation.");
    }
    await this.#objects.put(asset.objectKey, object);
    const uploaded = await this.#store.markState(asset.assetId, "reserved", "uploaded");
    if (!uploaded) {
      await this.#objects.delete(asset.objectKey);
      throw new AssetError("expired", "The upload reservation changed before storage completed.");
    }
  }

  async finalize(actor: AssetActor, assetId: string): Promise<AssetRecord> {
    requireEdit(actor);
    const asset = await this.#required(actor, assetId);
    if (asset.state === "ready") return publicRecord(asset);
    if (asset.state !== "uploaded") throw new AssetError("not_ready", "The asset has not been uploaded.");
    const object = await this.#objects.get(asset.objectKey);
    if (
      !object ||
      object.bytes.byteLength !== asset.size ||
      object.mimeType.toLowerCase() !== asset.mimeType ||
      hashBytes(object.bytes) !== asset.sha256
    ) {
      await this.#objects.delete(asset.objectKey);
      await this.#store.markState(asset.assetId, "uploaded", "rejected");
      throw new AssetError("verification_failed", "The uploaded bytes failed verification.");
    }
    const ready = await this.#store.markState(asset.assetId, "uploaded", "ready");
    if (!ready) throw new AssetError("storage_unavailable", "The verified asset could not become ready.");
    return publicRecord(ready);
  }

  async metadata(actor: AssetActor, assetId: string): Promise<AssetRecord> {
    const asset = await this.#required(actor, assetId);
    if (asset.state !== "ready") throw new AssetError("not_ready", "The asset is not ready.");
    return publicRecord(asset);
  }

  async read(actor: AssetActor, assetId: string): Promise<StoredObject> {
    const asset = await this.#required(actor, assetId);
    if (asset.state !== "ready") throw new AssetError("not_ready", "The asset is not ready.");
    const object = await this.#objects.get(asset.objectKey);
    if (!object) throw new AssetError("storage_unavailable", "The ready asset bytes are unavailable.");
    return object;
  }

  async readyDerived(actor: AssetActor, derivationKey: string): Promise<AssetRecord | undefined> {
    const record = await this.#store.findReadyDerived(actor.workspaceId, derivationKey);
    return record ? publicRecord(record) : undefined;
  }

  async publishDerived(
    actor: AssetActor,
    input: Readonly<{
      derivationKey: string;
      mimeType: string;
      bytes: Uint8Array;
      producer: string;
      metadata?: Readonly<Record<string, AssetMetadataValue>>;
    }>,
  ): Promise<AssetRecord> {
    if (!input.derivationKey || input.derivationKey.length > 512 || !mimePattern.test(input.mimeType)) {
      throw new AssetError("invalid", "A derived asset needs a bounded key and MIME type.");
    }
    if (input.bytes.byteLength <= 0 || input.bytes.byteLength > maximumAssetBytes) {
      throw new AssetError("invalid", "A derived asset must contain between one byte and 20 MB.");
    }
    const metadata = input.metadata ?? Object.freeze({});
    assertMetadata(metadata);
    const existing = await this.#store.findReadyDerived(actor.workspaceId, input.derivationKey);
    if (existing) return publicRecord(existing);
    const sha256 = hashBytes(input.bytes);
    const objectKey = `derived/${actor.workspaceId}/${sha256}`;
    await this.#objects.put(objectKey, Object.freeze({
      bytes: input.bytes,
      mimeType: input.mimeType.toLowerCase(),
    }));
    const ready = await this.#store.createReadyDerived({
      assetId: randomUUID(),
      workspaceId: actor.workspaceId,
      mimeType: input.mimeType.toLowerCase(),
      size: input.bytes.byteLength,
      sha256,
      objectKey,
      derivationKey: input.derivationKey,
      producer: input.producer,
      metadata,
      createdBySessionId: actor.sessionId,
    });
    if (ready.sha256 !== sha256) {
      throw new AssetError("verification_failed", "A derived key resolved to different bytes.");
    }
    return publicRecord(ready);
  }

  async assertReady(actor: AssetActor, assetIds: readonly string[]): Promise<void> {
    for (const assetId of new Set(assetIds)) await this.metadata(actor, assetId);
  }

  async #required(actor: AssetActor, assetId: string): Promise<StoredAsset> {
    const asset = await this.#store.find(actor.workspaceId, assetId);
    if (!asset) throw new AssetError("not_found", "The asset does not belong to this workspace.");
    return asset;
  }
}
