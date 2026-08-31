export type SessionRole = "owner" | "editor" | "viewer";

export type AuthorizedSession = Readonly<{
  sessionId: string;
  workspaceId: string;
  role: SessionRole;
}>;

export type AnonymousSession = AuthorizedSession & Readonly<{
  sessionSecret: string;
  expiresAt: string;
}>;

export type RequiredAccess = "read" | "edit" | "owner";

const accessRank: Readonly<Record<SessionRole, number>> = Object.freeze({
  viewer: 1,
  editor: 2,
  owner: 3,
});

export function roleAllows(role: SessionRole, access: RequiredAccess): boolean {
  const required = access === "read" ? 1 : access === "edit" ? 2 : 3;
  return accessRank[role] >= required;
}
