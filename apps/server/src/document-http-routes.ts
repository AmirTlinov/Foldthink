import type { IncomingMessage, ServerResponse } from "node:http";
import { DocumentError } from "@foldthink/document/protocol";
import type { ServerRuntime } from "./compose-server-runtime.js";
import {
  assertOrigin,
  readJson,
  readSessionCookie,
  sendJson,
} from "./http-boundary.js";

const compilePattern = /^\/api\/workspaces\/([^/]+)\/latex\/compile$/u;

export async function handleDocumentRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  runtime: ServerRuntime,
): Promise<boolean> {
  const match = compilePattern.exec(url.pathname);
  if (request.method !== "POST" || !match?.[1]) return false;
  assertOrigin(request, runtime.config.publicOrigin);
  const workspaceId = decodeURIComponent(match[1]);
  const actor = await runtime.authority.authorize(
    readSessionCookie(request, runtime.config.secureCookie),
    workspaceId,
    "edit",
  );
  const body: unknown = await readJson(request, 550_000);
  if (!body || typeof body !== "object" || !("source" in body) || typeof body.source !== "string") {
    throw new DocumentError("invalid", "A LaTeX compilation needs a source string.");
  }
  sendJson(response, 200, await runtime.latex.compile(actor, body.source));
  return true;
}
