import {
  AssetError,
  type AssetRecord,
  type AssetReservation,
  type ReserveAssetRequest,
} from "./asset-record.js";

type Fetch = typeof fetch;

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined) as
    | T
    | Readonly<{ error?: Readonly<{ code?: string; message?: string }> }>
    | undefined;
  if (response.ok) return body as T;
  const failure = body && typeof body === "object" && "error" in body ? body.error : undefined;
  throw new AssetError(
    failure?.code === "forbidden" ? "forbidden" :
      failure?.code === "not_found" ? "not_found" :
        failure?.code === "not_ready" ? "not_ready" :
          failure?.code === "expired" ? "expired" :
            failure?.code === "verification_failed" ? "verification_failed" : "storage_unavailable",
    failure?.message ?? `Asset request failed with HTTP ${response.status}.`,
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class AssetClient {
  readonly #workspaceId: string;
  readonly #fetch: Fetch;

  constructor(workspaceId: string, fetcher: Fetch = fetch) {
    this.#workspaceId = workspaceId;
    this.#fetch = fetcher.bind(globalThis);
  }

  async upload(blob: Blob, signal?: AbortSignal): Promise<AssetRecord> {
    if (blob.size <= 0 || blob.size > 20_000_000) {
      throw new AssetError("invalid", "An asset must contain between one byte and 20 MB.");
    }
    const sha256 = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())));
    const request: ReserveAssetRequest = Object.freeze({
      mimeType: blob.type || "application/octet-stream",
      size: blob.size,
      sha256,
    });
    const reservation = await responseJson<AssetReservation>(await this.#fetch(
      `/api/workspaces/${encodeURIComponent(this.#workspaceId)}/assets`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      },
    ));
    await responseJson<{ uploaded: true }>(await this.#fetch(
      `/api/workspaces/${encodeURIComponent(this.#workspaceId)}/assets/${encodeURIComponent(reservation.assetId)}/content?upload=${encodeURIComponent(reservation.uploadToken)}`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": request.mimeType },
        body: blob,
        ...(signal ? { signal } : {}),
      },
    ));
    return responseJson<AssetRecord>(await this.#fetch(
      `/api/workspaces/${encodeURIComponent(this.#workspaceId)}/assets/${encodeURIComponent(reservation.assetId)}/finalize`,
      { method: "POST", credentials: "include", ...(signal ? { signal } : {}) },
    ));
  }

  async metadata(assetId: string, signal?: AbortSignal): Promise<AssetRecord> {
    return responseJson<AssetRecord>(await this.#fetch(
      `/api/workspaces/${encodeURIComponent(this.#workspaceId)}/assets/${encodeURIComponent(assetId)}`,
      { credentials: "include", ...(signal ? { signal } : {}) },
    ));
  }

  async blob(assetId: string, signal?: AbortSignal): Promise<Blob> {
    const response = await this.#fetch(
      `/api/workspaces/${encodeURIComponent(this.#workspaceId)}/assets/${encodeURIComponent(assetId)}/content`,
      { credentials: "include", ...(signal ? { signal } : {}) },
    );
    if (!response.ok) await responseJson<never>(response);
    return response.blob();
  }
}
