export type AssetState = "reserved" | "uploaded" | "ready" | "rejected" | "deleted";
export type AssetPurpose = "user" | "derived";

export type AssetMetadataValue =
  | null
  | boolean
  | number
  | string
  | readonly AssetMetadataValue[]
  | Readonly<{ [key: string]: AssetMetadataValue }>;

export type AssetRecord = Readonly<{
  assetId: string;
  workspaceId: string;
  state: AssetState;
  purpose: AssetPurpose;
  mimeType: string;
  size: number;
  sha256: string;
  metadata: Readonly<Record<string, AssetMetadataValue>>;
  producer?: string;
  readyAt?: string;
}>;

export type AssetReservation = Readonly<{
  assetId: string;
  uploadToken: string;
  uploadExpiresAt: string;
}>;

export type ReserveAssetRequest = Readonly<{
  mimeType: string;
  size: number;
  sha256: string;
}>;

export class AssetError extends Error {
  override readonly name = "AssetError";

  constructor(
    readonly code:
      | "invalid"
      | "forbidden"
      | "not_found"
      | "not_ready"
      | "expired"
      | "verification_failed"
      | "storage_unavailable",
    message: string,
  ) {
    super(message);
  }
}
