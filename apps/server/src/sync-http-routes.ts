import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerRuntime } from "./compose-server-runtime.js";
import {
  assertOrigin,
  readJson,
  readSessionCookie,
  sendJson,
} from "./http-boundary.js";

const statePattern = /^\/api\/workspaces\/([^/]+)\/state$/u;
const operationPattern = /^\/api\/workspaces\/([^/]+)\/operations$/u;

export async function handleSyncRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  runtime: ServerRuntime,
): Promise<boolean> {
  const stateMatch = statePattern.exec(url.pathname);
  if (request.method === "GET" && stateMatch?.[1]) {
    const workspaceId = decodeURIComponent(stateMatch[1]);
    const actor = await runtime.authority.authorize(
      readSessionCookie(request, runtime.config.secureCookie),
      workspaceId,
      "read",
    );
    sendJson(response, 200, await runtime.gateway.readState(actor));
    return true;
  }

  const operationMatch = operationPattern.exec(url.pathname);
  if (request.method === "POST" && operationMatch?.[1]) {
    assertOrigin(request, runtime.config.publicOrigin);
    const workspaceId = decodeURIComponent(operationMatch[1]);
    const actor = await runtime.authority.authorize(
      readSessionCookie(request, runtime.config.secureCookie),
      workspaceId,
      "edit",
    );
    const envelope = await readJson(request);
    sendJson(response, 200, await runtime.gateway.submit(actor, envelope));
    return true;
  }
  return false;
}
