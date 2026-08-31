import type { IncomingMessage, ServerResponse } from "node:http";

const sessionCookie = "foldthink_session";
const secureSessionCookie = "__Host-foldthink_session";

export class HttpBoundaryError extends Error {
  override readonly name = "HttpBoundaryError";

  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function assertOrigin(request: IncomingMessage, publicOrigin: string): void {
  if (request.headers.origin !== publicOrigin) {
    throw new HttpBoundaryError(403, "The request origin is not allowed.");
  }
}

export function readSessionCookie(request: IncomingMessage, secureOnly = false): string | undefined {
  const acceptedName = secureOnly ? secureSessionCookie : sessionCookie;
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === acceptedName) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function setSessionCookie(
  response: ServerResponse,
  secret: string,
  expiresAt: string,
  secure: boolean,
): void {
  const expires = new Date(expiresAt);
  const maximumAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1_000));
  const name = secure ? secureSessionCookie : sessionCookie;
  response.setHeader(
    "set-cookie",
    `${name}=${encodeURIComponent(secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maximumAge}${secure ? "; Secure" : ""}`,
  );
}

export async function readJson(request: IncomingMessage, maximumBytes = 2_800_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new HttpBoundaryError(413, "The request body is too large.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpBoundaryError(400, "The request body is not valid JSON.");
  }
}

export async function readBytes(request: IncomingMessage, maximumBytes: number): Promise<Uint8Array> {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new HttpBoundaryError(413, "The request body is too large.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new HttpBoundaryError(413, "The request body is too large.");
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "origin-agent-cluster": "?1",
    "permissions-policy": "tools=(self)",
  });
  response.end(body);
}

export function sendBytes(
  response: ServerResponse,
  value: Uint8Array,
  contentType: string,
): void {
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": value.byteLength,
    "content-disposition": "attachment",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
  });
  response.end(Buffer.from(value));
}
