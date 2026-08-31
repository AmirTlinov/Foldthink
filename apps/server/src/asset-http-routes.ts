import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReserveAssetRequest } from "@foldthink/asset/protocol";
import type { ServerRuntime } from "./compose-server-runtime.js";
import {
  assertOrigin,
  readBytes,
  readJson,
  readSessionCookie,
  sendBytes,
  sendJson,
} from "./http-boundary.js";

const collectionPattern = /^\/api\/workspaces\/([^/]+)\/assets$/u;
const assetPattern = /^\/api\/workspaces\/([^/]+)\/assets\/([^/]+)$/u;
const contentPattern = /^\/api\/workspaces\/([^/]+)\/assets\/([^/]+)\/content$/u;
const finalizePattern = /^\/api\/workspaces\/([^/]+)\/assets\/([^/]+)\/finalize$/u;

function segment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export async function handleAssetRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  runtime: ServerRuntime,
): Promise<boolean> {
  const collection = collectionPattern.exec(url.pathname);
  if (request.method === "POST" && collection?.[1]) {
    assertOrigin(request, runtime.config.publicOrigin);
    const workspaceId = segment(collection[1]);
    const actor = await runtime.authority.authorize(
      readSessionCookie(request, runtime.config.secureCookie),
      workspaceId,
      "edit",
    );
    const reservation = await runtime.assets.reserve(actor, await readJson(request, 32_000) as ReserveAssetRequest);
    sendJson(response, 201, reservation);
    return true;
  }

  const content = contentPattern.exec(url.pathname);
  if (content?.[1] && content[2]) {
    const workspaceId = segment(content[1]);
    const assetId = segment(content[2]);
    if (request.method === "PUT") {
      assertOrigin(request, runtime.config.publicOrigin);
      const actor = await runtime.authority.authorize(
        readSessionCookie(request, runtime.config.secureCookie),
        workspaceId,
        "edit",
      );
      const uploadToken = url.searchParams.get("upload") ?? "";
      const mimeHeader = request.headers["content-type"];
      const mimeType = Array.isArray(mimeHeader) ? mimeHeader[0] ?? "" : mimeHeader ?? "";
      await runtime.assets.acceptUpload(actor, assetId, uploadToken, {
        bytes: await readBytes(request, 20_000_000),
        mimeType,
      });
      sendJson(response, 200, { uploaded: true });
      return true;
    }
    if (request.method === "GET") {
      const actor = await runtime.authority.authorize(
        readSessionCookie(request, runtime.config.secureCookie),
        workspaceId,
        "read",
      );
      const object = await runtime.assets.read(actor, assetId);
      sendBytes(response, object.bytes, object.mimeType);
      return true;
    }
  }

  const finalize = finalizePattern.exec(url.pathname);
  if (request.method === "POST" && finalize?.[1] && finalize[2]) {
    assertOrigin(request, runtime.config.publicOrigin);
    const workspaceId = segment(finalize[1]);
    const actor = await runtime.authority.authorize(
      readSessionCookie(request, runtime.config.secureCookie),
      workspaceId,
      "edit",
    );
    sendJson(response, 200, await runtime.assets.finalize(actor, segment(finalize[2])));
    return true;
  }

  const asset = assetPattern.exec(url.pathname);
  if (request.method === "GET" && asset?.[1] && asset[2]) {
    const workspaceId = segment(asset[1]);
    const actor = await runtime.authority.authorize(
      readSessionCookie(request, runtime.config.secureCookie),
      workspaceId,
      "read",
    );
    sendJson(response, 200, await runtime.assets.metadata(actor, segment(asset[2])));
    return true;
  }
  return false;
}
