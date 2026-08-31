import { createServer } from "node:http";
import { IdentityError } from "@foldthink/identity/server";
import { AssetError } from "@foldthink/asset/server";
import { DocumentError } from "@foldthink/document/server";
import { SyncRejection } from "@foldthink/synchronization/server";
import { composeServerRuntime } from "./compose-server-runtime.js";
import { handleAssetRoute } from "./asset-http-routes.js";
import { handleDocumentRoute } from "./document-http-routes.js";
import { HttpBoundaryError, readSessionCookie, sendJson } from "./http-boundary.js";
import { handleIdentityRoute } from "./identity-http-routes.js";
import { admissionClientKey, RequestAdmission, requestClass } from "./request-admission.js";
import { readServerConfig } from "./server-config.js";
import { ServiceObserver } from "./service-observer.js";
import { handleSyncRoute } from "./sync-http-routes.js";

const runtime = composeServerRuntime(readServerConfig(process.env));
const observer = new ServiceObserver(runtime.config.revision);
const admission = new RequestAdmission();

function failureStatus(error: unknown): number {
  if (error instanceof HttpBoundaryError) return error.status;
  if (error instanceof IdentityError) {
    if (error.code === "unauthorized" || error.code === "expired") return 401;
    if (error.code === "forbidden") return 403;
    if (error.code === "workspace_conflict") return 409;
    if (error.code === "workspace_deleted") return 410;
    return 400;
  }
  if (error instanceof SyncRejection) {
    if (error.code === "forbidden") return 403;
    if (error.code === "payload_too_large") return 413;
    if (error.code === "unsupported_protocol") return 426;
    return 422;
  }
  if (error instanceof AssetError) {
    if (error.code === "forbidden") return 403;
    if (error.code === "not_found") return 404;
    if (error.code === "not_ready") return 409;
    if (error.code === "expired") return 410;
    if (error.code === "verification_failed") return 422;
    if (error.code === "storage_unavailable") return 503;
    return 400;
  }
  if (error instanceof DocumentError) {
    if (error.code === "resource_limit") return 413;
    if (error.code === "not_available") return 503;
    if (error.code === "conflict") return 409;
    if (error.code === "compile_failed") return 422;
    return 400;
  }
  return 500;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", runtime.config.publicOrigin);
  const observation = observer.begin(request, url.pathname);
  response.setHeader("x-request-id", observation.requestId);
  const forwarded = Array.isArray(request.headers["x-forwarded-for"])
    ? request.headers["x-forwarded-for"][0]
    : request.headers["x-forwarded-for"];
  let lease: ReturnType<RequestAdmission["acquire"]> | undefined;
  void (async () => {
    const networkKey = forwarded?.split(",", 1)[0]?.trim() || request.socket.remoteAddress || "unknown";
    lease = admission.acquire(
      admissionClientKey(networkKey, readSessionCookie(request, runtime.config.secureCookie)),
      requestClass(request.method, url.pathname),
      networkKey,
    );
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "alive", revision: runtime.config.revision });
      return;
    }
    if (request.method === "GET" && url.pathname === "/ready") {
      const readiness = await runtime.ready();
      sendJson(response, readiness.ready ? 200 : 503, {
        status: readiness.ready ? "ready" : "unready",
        revision: runtime.config.revision,
        schemaMigration: readiness.schemaMigration,
        requiredSchemaMigration: readiness.requiredSchemaMigration,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/internal/metrics") {
      const readiness = await runtime.ready();
      sendJson(response, 200, {
        revision: runtime.config.revision,
        readiness,
        requests: observer.metrics(),
        websockets: runtime.socketTransport.metrics(),
      });
      return;
    }
    if (await handleIdentityRoute(request, response, url, runtime)) return;
    if (await handleAssetRoute(request, response, url, runtime)) return;
    if (await handleDocumentRoute(request, response, url, runtime)) return;
    if (await handleSyncRoute(request, response, url, runtime)) return;
    sendJson(response, 404, { error: { code: "not_found", message: "Foldthink route not found." } });
  })().then(() => {
    observation.finish(response.statusCode);
  }).catch((error: unknown) => {
    if (response.headersSent) {
      observation.finish(response.statusCode >= 400 ? response.statusCode : 500, "headers_sent");
      response.destroy();
      return;
    }
    const status = failureStatus(error);
    const code = error instanceof IdentityError ||
      error instanceof SyncRejection ||
      error instanceof AssetError ||
      error instanceof DocumentError
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
    observation.finish(status, error instanceof Error ? error.name : "UnknownError");
  }).finally(() => {
    lease?.release();
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;
server.maxRequestsPerSocket = 1_000;

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
