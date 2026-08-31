import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import {
  AssetError,
  AssetRegistry,
  type AssetActor,
  type AssetObjectStore,
  type StoredObject,
} from "../src/public-server.js";
import type {
  AssetStore,
  NewAssetReservation,
  NewDerivedAsset,
  QueuedAssetDeletion,
  StoredAsset,
} from "../src/asset-store.js";
import type { AssetState } from "../src/asset-record.js";

class MemoryObjects implements AssetObjectStore {
  readonly values = new Map<string, StoredObject>();

  async put(key: string, value: StoredObject): Promise<void> {
    this.values.set(key, Object.freeze({ bytes: new Uint8Array(value.bytes), mimeType: value.mimeType }));
  }

  async get(key: string): Promise<StoredObject | undefined> {
    return this.values.get(key);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class MemoryAssetStore implements AssetStore {
  readonly values = new Map<string, StoredAsset>();
  readonly deletions: QueuedAssetDeletion[] = [];
  readonly completed = new Set<string>();

  async reserve(input: NewAssetReservation): Promise<StoredAsset> {
    const value: StoredAsset = Object.freeze({
      assetId: input.assetId,
      workspaceId: input.workspaceId,
      state: "reserved",
      purpose: input.purpose,
      mimeType: input.mimeType,
      size: input.size,
      sha256: input.sha256,
      objectKey: input.objectKey,
      uploadTokenHash: input.uploadTokenHash,
      uploadExpiresAt: input.uploadExpiresAt,
      metadata: Object.freeze({}),
    });
    this.values.set(value.assetId, value);
    return value;
  }

  async find(workspaceId: string, assetId: string): Promise<StoredAsset | undefined> {
    const value = this.values.get(assetId);
    return value?.workspaceId === workspaceId ? value : undefined;
  }

  async findReadyDerived(workspaceId: string, derivationKey: string): Promise<StoredAsset | undefined> {
    return [...this.values.values()].find((value) =>
      value.workspaceId === workspaceId &&
      value.derivationKey === derivationKey &&
      value.state === "ready");
  }

  async markState(assetId: string, from: AssetState, to: AssetState): Promise<StoredAsset | undefined> {
    const current = this.values.get(assetId);
    if (!current || current.state !== from) return undefined;
    const next: StoredAsset = Object.freeze({
      ...current,
      state: to,
      ...(to === "ready" ? { readyAt: new Date().toISOString() } : {}),
    });
    this.values.set(assetId, next);
    return next;
  }

  async createReadyDerived(input: NewDerivedAsset): Promise<StoredAsset> {
    const existing = await this.findReadyDerived(input.workspaceId, input.derivationKey);
    if (existing) return existing;
    const value: StoredAsset = Object.freeze({
      assetId: input.assetId,
      workspaceId: input.workspaceId,
      state: "ready",
      purpose: "derived",
      mimeType: input.mimeType,
      size: input.size,
      sha256: input.sha256,
      objectKey: input.objectKey,
      derivationKey: input.derivationKey,
      producer: input.producer,
      metadata: input.metadata,
      readyAt: new Date().toISOString(),
    });
    this.values.set(value.assetId, value);
    return value;
  }

  async claimDeletionBatch(_now: Date, _leaseUntil: Date, limit: number): Promise<readonly QueuedAssetDeletion[]> {
    return this.deletions.splice(0, limit);
  }

  async completeDeletion(objectKey: string): Promise<void> {
    this.completed.add(objectKey);
  }

  async failDeletion(): Promise<void> {}
}

const actor: AssetActor = Object.freeze({
  sessionId: randomUUID(),
  workspaceId: randomUUID(),
  role: "owner",
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("only verified uploaded bytes become a ready asset", async () => {
  const store = new MemoryAssetStore();
  const objects = new MemoryObjects();
  const registry = new AssetRegistry(store, objects);
  const bytes = new TextEncoder().encode("visible proof");
  const reservation = await registry.reserve(actor, {
    mimeType: "text/plain",
    size: bytes.byteLength,
    sha256: sha256(bytes),
  });

  await registry.acceptUpload(actor, reservation.assetId, reservation.uploadToken, {
    bytes,
    mimeType: "text/plain",
  });
  const ready = await registry.finalize(actor, reservation.assetId);
  assert.equal(ready.state, "ready");
  assert.equal(ready.sha256, sha256(bytes));
  assert.deepEqual((await registry.read(actor, ready.assetId)).bytes, bytes);
});

test("checksum mismatch rejects bytes and another workspace cannot observe the reservation", async () => {
  const store = new MemoryAssetStore();
  const objects = new MemoryObjects();
  const registry = new AssetRegistry(store, objects);
  const expected = new TextEncoder().encode("expected");
  const actual = new TextEncoder().encode("different");
  const reservation = await registry.reserve(actor, {
    mimeType: "text/plain",
    size: actual.byteLength,
    sha256: sha256(expected),
  });
  await registry.acceptUpload(actor, reservation.assetId, reservation.uploadToken, {
    bytes: actual,
    mimeType: "text/plain",
  });
  await assert.rejects(
    registry.finalize(actor, reservation.assetId),
    (error: unknown) => error instanceof AssetError && error.code === "verification_failed",
  );
  const stranger: AssetActor = Object.freeze({ ...actor, workspaceId: randomUUID() });
  await assert.rejects(
    registry.metadata(stranger, reservation.assetId),
    (error: unknown) => error instanceof AssetError && error.code === "not_found",
  );
});

test("one derivation key reuses one verified artifact", async () => {
  const registry = new AssetRegistry(new MemoryAssetStore(), new MemoryObjects());
  const bytes = new TextEncoder().encode("<svg viewBox=\"0 0 1 1\"></svg>");
  const first = await registry.publishDerived(actor, {
    derivationKey: "latex:proof:page:1",
    mimeType: "image/svg+xml",
    bytes,
    producer: "tectonic:proof",
    metadata: { width: 612, height: 792 },
  });
  const repeated = await registry.publishDerived(actor, {
    derivationKey: "latex:proof:page:1",
    mimeType: "image/svg+xml",
    bytes,
    producer: "tectonic:proof",
    metadata: { width: 612, height: 792 },
  });
  assert.deepEqual(repeated, first);
});

test("workspace deletion drains owned object keys through one retryable queue", async () => {
  const store = new MemoryAssetStore();
  const objects = new MemoryObjects();
  const registry = new AssetRegistry(store, objects);
  const key = `user/${actor.workspaceId}/${randomUUID()}`;
  objects.values.set(key, Object.freeze({
    bytes: new TextEncoder().encode("delete me"),
    mimeType: "text/plain",
  }));
  store.deletions.push(Object.freeze({ objectKey: key, workspaceId: actor.workspaceId, attemptCount: 1 }));

  assert.deepEqual(await registry.drainDeletionQueue(), { claimed: 1, deleted: 1, failed: 0 });
  assert.equal(objects.values.has(key), false);
  assert.equal(store.completed.has(key), true);
});
