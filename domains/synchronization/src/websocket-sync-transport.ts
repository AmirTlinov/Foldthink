import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AuthorizedSession } from "@foldthink/identity/server";
import WebSocket, { WebSocketServer } from "ws";
import type { CommittedOperation, SyncServerMessage } from "./committed-receipt.js";
import type { SyncGateway } from "./sync-gateway.js";

export type SyncUpgradeAuthorizer = (
  request: IncomingMessage,
  workspaceId: string,
) => Promise<AuthorizedSession>;

function sendOperation(socket: WebSocket, operation: CommittedOperation): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 1_000_000) {
    socket.close(1013, "Foldthink stream backpressure");
    return;
  }
  const message: SyncServerMessage = Object.freeze({ type: "operation", operation });
  socket.send(JSON.stringify(message));
}

export class WebSocketSyncTransport {
  readonly #server = new WebSocketServer({ noServer: true, maxPayload: 1_024 });
  readonly #gateway: SyncGateway;
  readonly #authorize: SyncUpgradeAuthorizer;

  constructor(gateway: SyncGateway, authorize: SyncUpgradeAuthorizer) {
    this.#gateway = gateway;
    this.#authorize = authorize;
  }

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://foldthink.invalid");
    if (url.pathname !== "/sync") return false;
    const workspaceId = url.searchParams.get("workspaceId") ?? "";
    const after = url.searchParams.get("after") ?? "0";
    try {
      const actor = await this.#authorize(request, workspaceId);
      this.#server.handleUpgrade(request, socket, head, (websocket) => {
        this.#accept(websocket, actor, after);
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
    return true;
  }

  close(): void {
    for (const client of this.#server.clients) client.close(1001, "Foldthink server stopping");
    this.#server.close();
  }

  #accept(socket: WebSocket, actor: AuthorizedSession, after: string): void {
    let alive = true;
    socket.on("error", () => socket.terminate());
    socket.on("pong", () => {
      alive = true;
    });
    socket.on("message", () => socket.close(1003, "The durable stream is server-originated"));
    const unsubscribe = this.#gateway.subscribe(actor.workspaceId, (operation) => {
      sendOperation(socket, operation);
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 30_000);
    socket.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    void this.#sendHistory(socket, actor, after)
      .catch(() => socket.close(1011, "Foldthink recovery failed"));
  }

  async #sendHistory(socket: WebSocket, actor: AuthorizedSession, after: string): Promise<void> {
    let cursor = after;
    while (socket.readyState === WebSocket.OPEN) {
      const operations = await this.#gateway.history(actor, cursor);
      for (const operation of operations) sendOperation(socket, operation);
      const last = operations.at(-1);
      if (!last || operations.length < 512) return;
      cursor = last.sequence;
    }
  }
}
