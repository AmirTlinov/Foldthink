import type { AssetMetadataValue, AssetPurpose, AssetRecord, AssetState } from "./asset-record.js";

export type StoredAsset = AssetRecord & Readonly<{
  objectKey: string;
  uploadTokenHash?: Uint8Array;
  uploadExpiresAt?: Date;
  derivationKey?: string;
}>;

export type NewAssetReservation = Readonly<{
  assetId: string;
  workspaceId: string;
  purpose: AssetPurpose;
  mimeType: string;
  size: number;
  sha256: string;
  objectKey: string;
  uploadTokenHash: Uint8Array;
  uploadExpiresAt: Date;
  createdBySessionId: string;
}>;

export type NewDerivedAsset = Readonly<{
  assetId: string;
  workspaceId: string;
  mimeType: string;
  size: number;
  sha256: string;
  objectKey: string;
  derivationKey: string;
  producer: string;
  metadata: Readonly<Record<string, AssetMetadataValue>>;
  createdBySessionId: string;
}>;

export interface AssetStore {
  reserve(input: NewAssetReservation): Promise<StoredAsset>;
  find(workspaceId: string, assetId: string): Promise<StoredAsset | undefined>;
  findReadyDerived(workspaceId: string, derivationKey: string): Promise<StoredAsset | undefined>;
  markState(assetId: string, from: AssetState, to: AssetState): Promise<StoredAsset | undefined>;
  createReadyDerived(input: NewDerivedAsset): Promise<StoredAsset>;
}
