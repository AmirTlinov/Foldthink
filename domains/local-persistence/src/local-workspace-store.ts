import type {
  CommandReceipt,
  LocalCommit,
  WorkspaceCommitSink,
} from "@foldthink/workspace";
import {
  databaseName,
  databaseVersion,
  stores,
  surfaceStateKey,
  type LocalIdentity,
  type OutboxRecord,
  type ReceiptRecord,
  type SurfaceStateRecord,
} from "./indexeddb-schema.js";

export type LoadedWorkspace = Readonly<{
  identity: LocalIdentity;
  surfaces: readonly SurfaceStateRecord[];
  outbox: readonly OutboxRecord[];
  receipts: readonly ReceiptRecord[];
}>;

export class LocalStorageError extends Error {
  override readonly name = "LocalStorageError";
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new LocalStorageError("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new LocalStorageError("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new LocalStorageError("IndexedDB transaction failed."));
  });
}

async function openDatabase(
  factory: IDBFactory,
  onVersionChange: () => void,
): Promise<IDBDatabase> {
  const request = factory.open(databaseName, databaseVersion);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(stores.meta)) {
      database.createObjectStore(stores.meta);
    }
    if (!database.objectStoreNames.contains(stores.surfaces)) {
      const surfaceStore = database.createObjectStore(stores.surfaces, { keyPath: "key" });
      surfaceStore.createIndex("workspaceId", "workspaceId", { unique: false });
    }
    if (!database.objectStoreNames.contains(stores.outbox)) {
      const outboxStore = database.createObjectStore(stores.outbox, { keyPath: "operationId" });
      outboxStore.createIndex("workspaceId", "workspaceId", { unique: false });
    }
    if (!database.objectStoreNames.contains(stores.receipts)) {
      const receiptStore = database.createObjectStore(stores.receipts, { keyPath: "operationId" });
      receiptStore.createIndex("workspaceId", "workspaceId", { unique: false });
    }
  };
  request.onblocked = () => onVersionChange();
  const database = await requestResult(request);
  database.onversionchange = () => {
    database.close();
    onVersionChange();
  };
  return database;
}

export class LocalWorkspaceStore implements WorkspaceCommitSink {
  readonly #database: IDBDatabase;
  readonly #outboxListeners = new Set<() => void>();

  private constructor(database: IDBDatabase) {
    this.#database = database;
  }

  static async open(
    factory: IDBFactory = indexedDB,
    onVersionChange: () => void = () => {},
  ): Promise<LocalWorkspaceStore> {
    return new LocalWorkspaceStore(await openDatabase(factory, onVersionChange));
  }

  async getOrCreateIdentity(): Promise<LocalIdentity> {
    const transaction = this.#database.transaction(stores.meta, "readwrite");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(stores.meta);
    const existing = (await requestResult(store.get("current"))) as LocalIdentity | undefined;
    if (existing) {
      await completed;
      return existing;
    }
    const identity: LocalIdentity = Object.freeze({
      workspaceId: crypto.randomUUID(),
      bootstrapId: `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`,
    });
    store.put(identity, "current");
    await completed;
    return identity;
  }

  async loadWorkspace(identity: LocalIdentity): Promise<LoadedWorkspace> {
    const transaction = this.#database.transaction(
      [stores.surfaces, stores.outbox, stores.receipts],
      "readonly",
    );
    const completed = transactionDone(transaction);
    const [surfaces, outbox, receipts] = await Promise.all([
      requestResult(
        transaction.objectStore(stores.surfaces).index("workspaceId").getAll(identity.workspaceId),
      ) as Promise<SurfaceStateRecord[]>,
      requestResult(
        transaction.objectStore(stores.outbox).index("workspaceId").getAll(identity.workspaceId),
      ) as Promise<OutboxRecord[]>,
      requestResult(
        transaction.objectStore(stores.receipts).index("workspaceId").getAll(identity.workspaceId),
      ) as Promise<ReceiptRecord[]>,
    ]);
    await completed;
    return Object.freeze({
      identity,
      surfaces: Object.freeze(surfaces),
      outbox: Object.freeze(outbox.sort((left, right) => left.createdAt - right.createdAt)),
      receipts: Object.freeze(receipts),
    });
  }

  async adoptLinkedWorkspace(current: LocalIdentity, workspaceId: string): Promise<LocalIdentity> {
    const transaction = this.#database.transaction(
      [stores.meta, stores.surfaces, stores.outbox, stores.receipts],
      "readwrite",
    );
    const completed = transactionDone(transaction);
    const [surfaces, outbox, receipts] = await Promise.all([
      requestResult(transaction.objectStore(stores.surfaces).index("workspaceId").count(current.workspaceId)),
      requestResult(transaction.objectStore(stores.outbox).index("workspaceId").count(current.workspaceId)),
      requestResult(transaction.objectStore(stores.receipts).index("workspaceId").count(current.workspaceId)),
    ]);
    if (surfaces > 0 || outbox > 0 || receipts > 0) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new LocalStorageError("A device with local work cannot silently adopt another workspace.");
    }
    const identity: LocalIdentity = Object.freeze({
      workspaceId,
      bootstrapId: current.bootstrapId,
    });
    transaction.objectStore(stores.meta).put(identity, "current");
    await completed;
    return identity;
  }

  async commitLocal(commit: LocalCommit): Promise<CommandReceipt> {
    const transaction = this.#database.transaction(
      [stores.surfaces, stores.outbox, stores.receipts],
      "readwrite",
    );
    const completed = transactionDone(transaction);
    const surfaceStore = transaction.objectStore(stores.surfaces);
    for (const surface of commit.surfaceStates) {
      const record: SurfaceStateRecord = {
        key: surfaceStateKey(commit.operation.workspaceId, surface.surfaceId),
        workspaceId: commit.operation.workspaceId,
        surfaceId: surface.surfaceId,
        state: surface.state,
      };
      surfaceStore.put(record);
    }
    const queuedReceipt: CommandReceipt = Object.freeze({
      ...commit.receipt,
      syncState: "queued",
    });
    const outboxRecord: OutboxRecord = {
      operationId: commit.operation.operationId,
      workspaceId: commit.operation.workspaceId,
      operation: commit.operation,
      createdAt: Date.now(),
    };
    const receiptRecord: ReceiptRecord = {
      operationId: commit.operation.operationId,
      workspaceId: commit.operation.workspaceId,
      receipt: queuedReceipt,
    };
    transaction.objectStore(stores.outbox).put(outboxRecord);
    transaction.objectStore(stores.receipts).put(receiptRecord);
    await completed;
    for (const listener of this.#outboxListeners) listener();
    return queuedReceipt;
  }

  async commitRemote(surfaceId: string, state: Uint8Array): Promise<void> {
    const identity = await this.getOrCreateIdentity();
    const transaction = this.#database.transaction(stores.surfaces, "readwrite");
    const completed = transactionDone(transaction);
    const record: SurfaceStateRecord = {
      key: surfaceStateKey(identity.workspaceId, surfaceId),
      workspaceId: identity.workspaceId,
      surfaceId,
      state,
    };
    transaction.objectStore(stores.surfaces).put(record);
    await completed;
  }

  async listOutbox(workspaceId: string): Promise<readonly OutboxRecord[]> {
    const transaction = this.#database.transaction(stores.outbox, "readonly");
    const completed = transactionDone(transaction);
    const records = (await requestResult(
      transaction.objectStore(stores.outbox).index("workspaceId").getAll(workspaceId),
    )) as OutboxRecord[];
    await completed;
    return Object.freeze(records.sort((left, right) => left.createdAt - right.createdAt));
  }

  async acknowledge(workspaceId: string, receipt: CommandReceipt): Promise<CommandReceipt> {
    const transaction = this.#database.transaction([stores.outbox, stores.receipts], "readwrite");
    const completed = transactionDone(transaction);
    transaction.objectStore(stores.outbox).delete(receipt.operationId);
    const record: ReceiptRecord = {
      operationId: receipt.operationId,
      workspaceId,
      receipt,
    };
    transaction.objectStore(stores.receipts).put(record);
    await completed;
    return receipt;
  }

  observeOutbox(listener: () => void): () => void {
    this.#outboxListeners.add(listener);
    return () => this.#outboxListeners.delete(listener);
  }

  close(): void {
    this.#database.close();
  }
}
