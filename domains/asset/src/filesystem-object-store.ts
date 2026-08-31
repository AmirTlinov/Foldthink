import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AssetObjectStore, StoredObject } from "./asset-object-store.js";

const keyPattern = /^[A-Za-z0-9._/-]{1,512}$/u;

function safePath(root: string, objectKey: string): string {
  if (!keyPattern.test(objectKey) || isAbsolute(objectKey) || objectKey.split("/").includes("..")) {
    throw new TypeError("An object key must be a bounded relative path.");
  }
  const target = resolve(root, normalize(objectKey));
  const prefix = `${resolve(root)}/`;
  if (!target.startsWith(prefix)) throw new TypeError("An object key escaped its store.");
  return target;
}

export class FilesystemObjectStore implements AssetObjectStore {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new TypeError("ASSET_DIRECTORY must be absolute.");
    this.#root = root;
  }

  async put(objectKey: string, value: StoredObject): Promise<void> {
    const path = safePath(this.#root, objectKey);
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${randomUUID()}.upload`);
    await writeFile(temporary, value.bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
    await writeFile(`${path}.mime`, value.mimeType, { mode: 0o600 });
  }

  async get(objectKey: string): Promise<StoredObject | undefined> {
    const path = safePath(this.#root, objectKey);
    try {
      const [bytes, mimeType] = await Promise.all([
        readFile(path),
        readFile(`${path}.mime`, "utf8"),
      ]);
      return Object.freeze({ bytes: new Uint8Array(bytes), mimeType });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    const path = safePath(this.#root, objectKey);
    await Promise.all([
      unlink(path).catch((error: unknown) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }),
      unlink(`${path}.mime`).catch((error: unknown) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }),
    ]);
  }
}
