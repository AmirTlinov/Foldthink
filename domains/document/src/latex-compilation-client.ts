import {
  DocumentError,
  type LatexCompilation,
} from "./document-protocol.js";

type Fetch = typeof fetch;

export class LatexCompilationClient {
  readonly #workspaceId: string;
  readonly #fetch: Fetch;

  constructor(workspaceId: string, fetcher: Fetch = fetch) {
    this.#workspaceId = workspaceId;
    this.#fetch = fetcher.bind(globalThis);
  }

  async compile(source: string, signal?: AbortSignal): Promise<LatexCompilation> {
    const response = await this.#fetch(
      `/api/workspaces/${encodeURIComponent(this.#workspaceId)}/latex/compile`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source }),
        ...(signal ? { signal } : {}),
      },
    );
    const body = await response.json().catch(() => undefined) as
      | LatexCompilation
      | Readonly<{ error?: Readonly<{ code?: string; message?: string }> }>
      | undefined;
    if (response.ok) return body as LatexCompilation;
    const failure = body && typeof body === "object" && "error" in body ? body.error : undefined;
    throw new DocumentError(
      failure?.code === "invalid" ? "invalid" :
        failure?.code === "resource_limit" ? "resource_limit" :
          failure?.code === "not_available" ? "not_available" : "compile_failed",
      failure?.message ?? `LaTeX compilation failed with HTTP ${response.status}.`,
    );
  }
}
