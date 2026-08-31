import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AnonymousBootstrapRequest,
  ConsumeJoinCapabilityRequest,
  CreateJoinCapabilityRequest,
} from "@foldthink/identity/protocol";
import { IdentityError } from "@foldthink/identity/server";
import type { ServerRuntime } from "./compose-server-runtime.js";
import {
  assertOrigin,
  readJson,
  readSessionCookie,
  sendJson,
  setSessionCookie,
} from "./http-boundary.js";

const workspaceJoinPattern = /^\/api\/workspaces\/([^/]+)\/join-capabilities$/u;

export async function handleIdentityRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  runtime: ServerRuntime,
): Promise<boolean> {
  if (request.method === "POST" && url.pathname === "/api/session/bootstrap") {
    assertOrigin(request, runtime.config.publicOrigin);
    const body = await readJson(request) as AnonymousBootstrapRequest;
    const existingSecret = readSessionCookie(request, runtime.config.secureCookie);
    let session;
    if (existingSecret) {
      try {
        session = await runtime.authority.resume(existingSecret, body.workspaceId);
      } catch (error) {
        if (!(error instanceof IdentityError) || error.code !== "unauthorized") throw error;
        session = await runtime.authority.bootstrap(body);
      }
    } else {
      session = await runtime.authority.bootstrap(body);
    }
    setSessionCookie(response, session.sessionSecret, session.expiresAt, runtime.config.secureCookie);
    sendJson(response, 200, {
      workspaceId: session.workspaceId,
      role: session.role,
      expiresAt: session.expiresAt,
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/session/join") {
    assertOrigin(request, runtime.config.publicOrigin);
    const body = await readJson(request) as ConsumeJoinCapabilityRequest;
    const session = await runtime.authority.consumeJoinCapability(body.token);
    setSessionCookie(response, session.sessionSecret, session.expiresAt, runtime.config.secureCookie);
    sendJson(response, 200, {
      workspaceId: session.workspaceId,
      role: session.role,
      expiresAt: session.expiresAt,
    });
    return true;
  }

  const joinMatch = workspaceJoinPattern.exec(url.pathname);
  if (request.method === "POST" && joinMatch?.[1]) {
    assertOrigin(request, runtime.config.publicOrigin);
    const workspaceId = decodeURIComponent(joinMatch[1]);
    const actor = await runtime.authority.authorize(
      readSessionCookie(request, runtime.config.secureCookie),
      workspaceId,
      "owner",
    );
    const body = await readJson(request) as CreateJoinCapabilityRequest;
    const capability = await runtime.authority.createJoinCapability(actor, body);
    sendJson(response, 201, capability);
    return true;
  }
  return false;
}
