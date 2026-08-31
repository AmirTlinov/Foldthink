export type StoredObject = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
}>;

export interface AssetObjectStore {
  put(objectKey: string, value: StoredObject): Promise<void>;
  get(objectKey: string): Promise<StoredObject | undefined>;
  delete(objectKey: string): Promise<void>;
}
