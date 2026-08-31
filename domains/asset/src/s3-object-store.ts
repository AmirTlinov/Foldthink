import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { AssetObjectStore, StoredObject } from "./asset-object-store.js";

export type S3ObjectStoreOptions = Readonly<{
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}>;

export class S3ObjectStore implements AssetObjectStore {
  readonly #bucket: string;
  readonly #client: S3Client;

  constructor(options: S3ObjectStoreOptions) {
    this.#bucket = options.bucket;
    this.#client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? false,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(objectKey: string, value: StoredObject): Promise<void> {
    await this.#client.send(new PutObjectCommand({
      Bucket: this.#bucket,
      Key: objectKey,
      Body: value.bytes,
      ContentType: value.mimeType,
    }));
  }

  async get(objectKey: string): Promise<StoredObject | undefined> {
    try {
      const response = await this.#client.send(new GetObjectCommand({
        Bucket: this.#bucket,
        Key: objectKey,
      }));
      if (!response.Body) return undefined;
      return Object.freeze({
        bytes: await response.Body.transformToByteArray(),
        mimeType: response.ContentType ?? "application/octet-stream",
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        (error.name === "NoSuchKey" || error.name === "NotFound")
      ) return undefined;
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: objectKey }));
  }
}
