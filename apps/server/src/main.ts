import { createServer } from "node:http";
import { IdentityError } from "@foldthink/identity/server";
import { SyncRejection } from "@foldthink/synchronization/server";
import { composeServerRuntime } from "./compose-server-runtime.js";
import { HttpBoundaryError, sendJson } from "./http-boundary.js";
import { handleIdentityRoute } from "./identity-http-routes.js";
import { readServerConfig } from "./server-config.js";
import { handleSyncRoute } from "./sync-http-routes.js";

const runtime = composeServerRuntime(readServerConfig(process.env));

function failureStatus(error: unknown): number {
  if (error instanceof HttpBoundaryError) return error.status;
  if (error instanceof IdentityError) {
    if (error.code === "unauthorized" || error.code === "expired") return 401;
    if (error.code === "forbidden") return 403;
    if (error.code === "workspace_conflict") return 409;
    return 400;
  }
  if (error instanceof SyncRejection) {
    if (error.code === "forbidden") return 403;
    if (error.code === "payload_too_large") return 413;
    if (error.code === "unsupported_protocol") return 426;
    return 422;
  }
  return 500;
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", runtime.config.publicOrigin);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "alive", revision: runtime.config.revision });
      return;
    }
    if (request.method === "GET" && url.pathname === "/ready") {
      const ready = await runtime.ready();
      sendJson(response, ready ? 200 : 503, {
        status: ready ? "ready" : "migrations-required",
        revision: runtime.config.revision,
      });
      return;
    }
    if (await handleIdentityRoute(request, response, url, runtime)) return;
    if (await handleSyncRoute(request, response, url, runtime)) return;
    sendJson(response, 404, { error: { code: "not_found", message: "Foldthink route not found." } });
  })().catch((error: unknown) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const status = failureStatus(error);
    const code = error instanceof IdentityError || error instanceof SyncRejection
      ? error.code
      : error instanceof HttpBoundaryError
        ? "http_boundary"
        : "internal";
    sendJson(response, status, {
      error: {
        code,
        message: status === 500 ? "Foldthink could not complete the request." : (error as Error).message,
      },
    });
  });
});

server.on("upgrade", (request, socket, head) => {
  void runtime.socketTransport.handleUpgrade(request, socket, head).then((handled) => {
    if (!handled) socket.destroy();
  });
});

server.listen(runtime.config.port, "0.0.0.0");

async function stop(): Promise<void> {
  server.close();
  await runtime.close();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
