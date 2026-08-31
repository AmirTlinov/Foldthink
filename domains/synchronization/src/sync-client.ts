import type {
  AnonymousBootstrapRequest,
  AnonymousBootstrapResponse,
} from "@foldthink/identity/protocol";
import {
  LocalWorkspaceStore,
  type LocalIdentity,
} from "@foldthink/local-persistence/browser";
import type { WorkspaceRuntime } from "@foldthink/workspace";
import type {
  CommittedOperation,
  SyncServerMessage,
  WorkspaceState,
} from "./committed-receipt.js";
import {
  decodeBytes,
  decodeOperationEnvelope,
  encodeOperationEnvelope,
} from "./operation-envelope.js";

export type SyncClientStatus = "connecting" | "shared" | "offline" | "rejected";

class SyncRequestError extends Error {
  override readonly name = "SyncRequestError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type SyncClientOptions = Readonly<{
  runtime: WorkspaceRuntime;
  store: LocalWorkspaceStore;
  identity: LocalIdentity;
  onStatus?: (status: SyncClientStatus) => void;
  fetch?: typeof fetch;
  createWebSocket?: (url: string) => WebSocket;
  baseUrl?: string;
}>;

export class SyncClient {
  readonly #runtime: WorkspaceRuntime;
  readonly #store: LocalWorkspaceStore;
  readonly #identity: LocalIdentity;
  readonly #onStatus: (status: SyncClientStatus) => void;
  readonly #fetch: typeof fetch;
  readonly #createWebSocket: (url: string) => WebSocket;
  readonly #baseUrl: string;
  #socket: WebSocket | undefined;
  #stopped = true;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #retryMilliseconds = 1_000;
  #cursor = "0";
  #readyToSend = false;
  #flushRequested = false;
  #flushInFlight: Promise<void> | undefined;
  #stopOutboxObservation: (() => void) | undefined;

  constructor(options: SyncClientOptions) {
    this.#runtime = options.runtime;
    this.#store = options.store;
    this.#identity = options.identity;
    this.#onStatus = options.onStatus ?? (() => {});
    this.#fetch = options.fetch ?? fetch;
    this.#createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
    this.#baseUrl = options.baseUrl ?? "";
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#stopOutboxObservation = this.#store.observeOutbox(() => {
      void this.#requestFlush().catch(() => this.#scheduleRetry());
    });
    void this.synchronizeOnce().catch(() => this.#scheduleRetry());
  }

  stop(): void {
    this.#stopped = true;
    this.#readyToSend = false;
    this.#stopOutboxObservation?.();
    this.#stopOutboxObservation = undefined;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#socket?.close(1000, "Foldthink page closed");
    this.#socket = undefined;
  }

  async synchronizeOnce(): Promise<void> {
    if (this.#stopped) return;
    this.#onStatus("connecting");
    await this.#bootstrap();
    const state = await this.#request<WorkspaceState>(
      `/api/workspaces/${encodeURIComponent(this.#identity.workspaceId)}/state`,
      { method: "GET" },
    );
    this.#advanceCursor(state.cursor);
    for (const surface of state.surfaces) {
      await this.#runtime.acceptRemoteState(surface.surfaceId, decodeBytes(surface.state));
    }
    await this.#openSocket();
    this.#readyToSend = true;
    await this.#requestFlush();
    this.#retryMilliseconds = 1_000;
    this.#onStatus("shared");
  }

  async #bootstrap(): Promise<void> {
    const request: AnonymousBootstrapRequest = {
      workspaceId: this.#identity.workspaceId,
      bootstrapId: this.#identity.bootstrapId,
    };
    const response = await this.#request<AnonymousBootstrapResponse>("/api/session/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.workspaceId !== this.#identity.workspaceId) {
      throw new Error("The server returned a different workspace identity.");
    }
  }

  #requestFlush(): Promise<void> {
    this.#flushRequested = true;
    if (!this.#readyToSend || this.#stopped) return Promise.resolve();
    if (this.#flushInFlight) return this.#flushInFlight;
    this.#flushInFlight = this.#drainOutbox().finally(() => {
      this.#flushInFlight = undefined;
      if (this.#flushRequested && this.#readyToSend && !this.#stopped) {
        void this.#requestFlush().catch(() => this.#scheduleRetry());
      }
    });
    return this.#flushInFlight;
  }

  async #drainOutbox(): Promise<void> {
    while (this.#flushRequested && this.#readyToSend && !this.#stopped) {
      this.#flushRequested = false;
      for (const record of await this.#store.listOutbox(this.#identity.workspaceId)) {
        let committed: CommittedOperation;
        try {
          committed = await this.#request<CommittedOperation>(
            `/api/workspaces/${encodeURIComponent(this.#identity.workspaceId)}/operations`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(encodeOperationEnvelope(record.operation)),
            },
          );
        } catch (error) {
          if (error instanceof SyncRequestError && [403, 413, 422, 426].includes(error.status)) {
            await this.#repairRejectedOperation(record.operation.operationId, error);
            this.#onStatus("rejected");
            this.#flushRequested = true;
            break;
          }
          throw error;
        }
        await this.#store.acknowledge(this.#identity.workspaceId, committed.receipt);
        this.#advanceCursor(committed.sequence);
        this.#onStatus("shared");
      }
    }
  }

  async #repairRejectedOperation(
    operationId: string,
    rejection: SyncRequestError,
  ): Promise<void> {
    const state = await this.#request<WorkspaceState>(
      `/api/workspaces/${encodeURIComponent(this.#identity.workspaceId)}/state`,
      { method: "GET" },
    );
    const outbox = await this.#store.listOutbox(this.#identity.workspaceId);
    const repair = this.#runtime.prepareRepair(
      state.surfaces.map((surface) => Object.freeze({
        surfaceId: surface.surfaceId,
        state: decodeBytes(surface.state),
      })),
      outbox.map((record) => record.operation),
      operationId,
    );
    const rejections = repair.rejectedOperationIds.map((rejectedId) => Object.freeze({
      operationId: rejectedId,
      code: rejectedId === operationId ? rejection.code : "dependent_repair",
      message: rejectedId === operationId
        ? rejection.message
        : "The queued operation could not be replayed on committed workspace state.",
    }));
    await this.#store.installRepair(this.#identity.workspaceId, repair, rejections);
    this.#runtime.installRepair(repair.surfaceStates);
    this.#advanceCursor(state.cursor);
  }

  async #openSocket(): Promise<void> {
    this.#socket?.close(1000, "Foldthink reconnect");
    const base = this.#baseUrl || location.origin;
    const url = new URL("/sync", base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("workspaceId", this.#identity.workspaceId);
    url.searchParams.set("after", this.#cursor);
    const socket = this.#createWebSocket(url.toString());
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      void this.#acceptMessage(event.data).catch(() => {
        this.#onStatus("rejected");
      });
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("The synchronization stream timed out.")), 8_000);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("The synchronization stream could not open."));
      }, { once: true });
    });
    socket.addEventListener("close", () => {
      if (!this.#stopped && socket === this.#socket) this.#scheduleRetry();
    }, { once: true });
  }

  async #acceptMessage(data: unknown): Promise<void> {
    if (typeof data !== "string") throw new TypeError("Foldthink accepts text synchronization messages.");
    const message = JSON.parse(data) as SyncServerMessage;
    if (!message || message.type !== "operation") throw new TypeError("Unknown synchronization message.");
    const operation = decodeOperationEnvelope(message.operation.envelope);
    if (operation.workspaceId !== this.#identity.workspaceId) {
      throw new TypeError("A synchronization message belongs to another workspace.");
    }
    for (const update of operation.updates) {
      await this.#runtime.acceptRemoteState(update.surfaceId, update.payload);
    }
    await this.#store.acknowledge(this.#identity.workspaceId, message.operation.receipt);
    this.#advanceCursor(message.operation.sequence);
    this.#onStatus("shared");
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    // Window.fetch rejects a foreign receiver. Keep the injected boundary as a
    // plain function instead of accidentally calling it as a SyncClient method.
    const performFetch = this.#fetch;
    const response = await performFetch(`${this.#baseUrl}${path}`, {
      ...init,
      credentials: "include",
    });
    if (!response.ok) {
      let code = "http_error";
      let message = `Foldthink synchronization failed with HTTP ${response.status}.`;
      try {
        const body = await response.json() as Readonly<{
          error?: Readonly<{ code?: unknown; message?: unknown }>;
        }>;
        if (typeof body.error?.code === "string") code = body.error.code;
        if (typeof body.error?.message === "string") message = body.error.message;
      } catch {
        // The HTTP status remains the stable failure fact.
      }
      throw new SyncRequestError(response.status, code, message);
    }
    return response.json() as Promise<T>;
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#retryTimer) return;
    this.#readyToSend = false;
    this.#onStatus("offline");
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.synchronizeOnce().catch(() => this.#scheduleRetry());
    }, this.#retryMilliseconds);
    this.#retryMilliseconds = Math.min(this.#retryMilliseconds * 2, 30_000);
  }

  #advanceCursor(candidate: string): void {
    if (/^\d+$/u.test(candidate) && BigInt(candidate) > BigInt(this.#cursor)) {
      this.#cursor = candidate;
    }
  }
}
