import type { AnonymousBootstrapResponse, DeleteWorkspaceResponse } from "./session-protocol.js";

export async function consumeJoinCapability(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<AnonymousBootstrapResponse> {
  const response = await fetcher("/api/session/join", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    throw new Error(`The Foldthink link is unavailable (HTTP ${response.status}).`);
  }
  const session = await response.json() as AnonymousBootstrapResponse;
  if (
    !session ||
    typeof session.workspaceId !== "string" ||
    (session.role !== "owner" && session.role !== "editor" && session.role !== "viewer")
  ) {
    throw new TypeError("The Foldthink link returned an invalid session.");
  }
  return Object.freeze(session);
}

export async function deleteWorkspace(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<DeleteWorkspaceResponse> {
  const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`The Foldthink workspace could not be deleted (HTTP ${response.status}).`);
  }
  const deletion = await response.json() as DeleteWorkspaceResponse;
  if (
    !deletion ||
    deletion.workspaceId !== workspaceId ||
    typeof deletion.deletedAt !== "string" ||
    typeof deletion.backupRetentionUntil !== "string" ||
    !Number.isInteger(deletion.queuedAssets)
  ) {
    throw new TypeError("Foldthink returned an invalid deletion receipt.");
  }
  return Object.freeze(deletion);
}
