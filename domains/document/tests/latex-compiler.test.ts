import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  AssetRegistry,
  type AssetActor,
  type AssetObjectStore,
  type StoredObject,
} from "@foldthink/asset/server";
import { LatexCompiler } from "../src/latex-compiler.js";
import type { LatexProcessCompiler } from "../src/tectonic-process-compiler.js";

type AssetStore = ConstructorParameters<typeof AssetRegistry>[0];
type StoredAsset = NonNullable<Awaited<ReturnType<AssetStore["find"]>>>;
type NewAssetReservation = Parameters<AssetStore["reserve"]>[0];
type NewDerivedAsset = Parameters<AssetStore["createReadyDerived"]>[0];
type AssetState = Parameters<AssetStore["markState"]>[1];

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
    const next: StoredAsset = Object.freeze({ ...current, state: to });
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
}

const actor: AssetActor = Object.freeze({
  sessionId: randomUUID(),
  workspaceId: randomUUID(),
  role: "owner",
});

test("one LaTeX source compiles once and reuses its verified derived manifest", async () => {
  const objects = new MemoryObjects();
  const assets = new AssetRegistry(new MemoryAssetStore(), objects);
  let calls = 0;
  const processCompiler: LatexProcessCompiler = {
    version: "proof-compiler-v1",
    async compile() {
      calls += 1;
      return Object.freeze([
        Object.freeze({
          bytes: new TextEncoder().encode('<svg viewBox="0 0 612 792"></svg>'),
          width: 612,
          height: 792,
        }),
      ]);
    },
  };
  const compiler = new LatexCompiler(assets, processCompiler);
  const source = "\\documentclass{article}\\begin{document}Proof\\end{document}";

  const first = await compiler.compile(actor, source);
  const repeated = await compiler.compile(actor, source);

  assert.deepEqual(repeated, first);
  assert.equal(calls, 1);
  assert.equal(first.sourceSha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(first.pages.length, 1);
  assert.equal((await assets.metadata(actor, first.pages[0]!.assetId)).mimeType, "image/svg+xml");
});
